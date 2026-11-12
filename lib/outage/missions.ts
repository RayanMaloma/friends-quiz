/**
 * «انقطاع الاتصال» — mission (fault) definitions.
 *
 * A mission is data plus three functions over the simulation:
 * - `setup` injects the fault into the station when the mission starts
 *   (and queues the command's messages);
 * - `stable` says whether the station is back in a safe state for this fault;
 *   the mission completes only after it stays true for `hold` seconds in a row
 *   (pressing a last button never completes anything by itself);
 * - `failure` (optional) is a mission-specific final failure.
 *
 * Adding a fault = adding an entry here: the engine (engine.ts), the
 * permissions (roles.ts) and the screens read these definitions and never
 * special-case a mission id.
 */
import {
  breachLoss,
  hullOf,
  linked,
  o2Production,
  O2_FAIL,
  REACTOR_CRITICAL,
  reactorCooling,
  SECTIONS,
  supply,
  type Fault,
  type Message,
  type Physics,
  type SectionId,
  type Sim,
} from "./sim";
import type { PanelId } from "./roles";

export type MissionId = "reactor" | "oxygen" | "generator" | "leak" | "comms" | "security" | "dual";
export const MISSION_IDS: readonly MissionId[] = ["reactor", "oxygen", "generator", "leak", "comms", "security", "dual"];

/** Values drawn once per match from the seed (codes, the leaking section…). */
export interface MissionParams {
  code: string;
  /** Hard: the override code is split between comms (first half) and the monitor (second half). */
  split: boolean;
  section: SectionId;
  /** A second section whose sensor drifts (hard). */
  decoySection: SectionId | null;
  peak: number;
  handshake: string;
  faultCode: string;
  faultCode2: string;
  /** Fake messages from an unverified channel (wrong code, wrong signature). */
  decoys: { sig: string; code: string }[];
}

export interface Ctx {
  ph: Physics;
  /** Codes travel enciphered (the key is on the monitor). */
  cipher: boolean;
  /** Mission window for time-limited missions (seconds). */
  window: number;
  /** How warm the backup generator already is when the main one fails (°C). */
  backupWarm: number;
}

export interface MissionDef {
  id: MissionId;
  /** The fault, as the TV names it. */
  title: string;
  /** What the crew has to reach (one short line). */
  goal: string;
  /** Panels the solution needs: never all on one player (see roles.ts). */
  panels: PanelId[];
  /** Seconds `stable` must hold. */
  hold: number;
  setup(s: Sim, p: MissionParams, ctx: Ctx, msg: (m: Omit<Message, "id" | "got" | "decoded">) => void): void;
  stable(s: Sim, p: MissionParams): boolean;
  failure?(s: Sim, p: MissionParams, ctx: Ctx, elapsed: number): string | null;
  /** Seconds until this fault becomes fatal at the current trend (TV countdown), null = not shrinking. */
  eta?(s: Sim, p: MissionParams, ctx: Ctx, elapsed: number): number | null;
}

const enc = (digits: string, ctx: Ctx, key: number) =>
  ctx.cipher ? [...digits].map((ch) => String((Number(ch) + key) % 10)).join("") : digits;

/** Queues the code message (and its decoys) for `label`. */
function sendCode(
  s: Sim,
  p: MissionParams,
  ctx: Ctx,
  msg: Parameters<MissionDef["setup"]>[3],
  label: string,
  digits: string,
) {
  msg({ at: s.t + 2, sig: s.comms.sig, label, digits: enc(digits, ctx, s.comms.key), cipher: ctx.cipher });
  p.decoys.forEach((d, i) => msg({ at: s.t + 4 + i * 3, sig: d.sig, label, digits: enc(d.code, ctx, s.comms.key), cipher: ctx.cipher }));
}

function setFault(s: Sim, device: keyof Sim["faults"], fault: Fault) {
  s.faults[device] = fault;
}

/** Seconds until the reactor turns critical + its grace, at the current net heating. */
function reactorEta(s: Sim, ctx: Ctx, rise: number): number | null {
  if (rise <= 0.01) return null;
  const toCritical = Math.max(0, REACTOR_CRITICAL - s.reactor.temp) / rise;
  return Math.ceil(toCritical + Math.max(0, ctx.ph.meltdownGrace - s.reactor.critical));
}

export const MISSIONS: Record<MissionId, MissionDef> = {
  /* 1. The mandatory example: the reactor overheats, cooling is down. */
  reactor: {
    id: "reactor",
    title: "ارتفاع حرارة المفاعل",
    goal: "شغّلوا التبريد وأنزلوا الحرارة تحت 70°",
    panels: ["cooling", "breakers", "grid", "doors", "comms"],
    hold: 5,
    setup(s, p, ctx, msg) {
      s.reactor.temp = Math.max(s.reactor.temp, 91);
      s.cooling.pump = "off";
      s.power.breakers.cooling = false;
      // The generator runs damaged at 80%, and every unit of it is spoken for:
      // cooling needs power moved from somewhere else.
      s.power.mainCap = Math.min(s.power.mainCap, 80);
      s.power.alloc = { cooling: 0, life: 40, comms: 20, security: 20 };
      s.doors.gate = true;
      s.locks.gate = p.code;
      sendCode(s, p, ctx, msg, "بوابة المفاعل", p.code);
    },
    stable: (s) => s.cooling.pump === "on" && s.reactor.temp <= 70,
    eta: (s, _p, ctx) => reactorEta(s, ctx, ctx.ph.heat - reactorCooling(s)),
  },

  /* 2. O₂ falls: the scrubber filter is clogged; the spare is in the locked store. */
  oxygen: {
    id: "oxygen",
    title: "انخفاض الأكسجين",
    goal: "أعيدوا الأكسجين فوق 60%",
    panels: ["maint", "breakers", "doors", "comms"],
    hold: 3,
    setup(s, p, ctx, msg) {
      s.life.o2 = Math.min(s.life.o2, 52);
      setFault(s, "filter", { code: p.faultCode, fix: "filter" });
      s.doors.store = false;
      s.locks.store = p.code;
      sendCode(s, p, ctx, msg, "المستودع", p.code);
    },
    stable: (s) => !s.faults.filter && s.power.breakers.life && s.life.o2 >= 60,
    eta: (s, _p, ctx) => o2Eta(s, ctx),
  },

  /* 3. The main generator fails: run on the hot backup, shed load, repair, restart. */
  generator: {
    id: "generator",
    title: "تعطل المولد الرئيسي",
    goal: "أصلحوا المولد الرئيسي وأعيدوا تشغيله",
    panels: ["maint", "valves", "breakers", "grid"],
    hold: 3,
    setup(s, p, ctx) {
      s.power.main = "fault";
      setFault(s, "main", { code: p.faultCode, fix: "coupling" });
      // The backup is available but already warm (only the monitor sees how warm).
      s.power.backupHeat = Math.max(s.power.backupHeat, ctx.backupWarm);
    },
    stable: (s) => s.power.main === "on" && !s.faults.main,
    failure: (s, _p, ctx) => (s.power.dark >= ctx.ph.blackoutLimit ? "انقطعت الطاقة بالكامل" : null),
    eta: (s, _p, ctx) => (supply(s) <= 0 ? Math.max(0, ctx.ph.blackoutLimit - s.power.dark) : null),
  },

  /* 4. A hull breach in one section: only the monitor's pressure sensors show which. */
  leak: {
    id: "leak",
    title: "تسريب في المنشأة",
    goal: "اعزلوا القسم المتسرّب وأغلقوا التسريب",
    panels: ["monitor", "doors", "valves", "maint"],
    hold: 3,
    setup(s, p) {
      s.sections[p.section].breach = true;
      setFault(s, hullOf(p.section), { code: p.faultCode, fix: "seal" });
      if (p.decoySection) s.drift = p.decoySection;
    },
    // Either sealed and reopened (the section is back), or vented (sealed off for good).
    stable: (s, p) => {
      const sec = s.sections[p.section];
      if (sec.breach) return false;
      return sec.lost || (s.doors[p.section] && s.valves[p.section]);
    },
    eta: (s, _p, ctx) => o2Eta(s, ctx),
  },

  /* 5. The comms relay burns out and the command's signal moves. */
  comms: {
    id: "comms",
    title: "تعطل الاتصالات",
    goal: "أعيدوا الاتصال وأكّدوا الهوية",
    panels: ["maint", "breakers", "comms", "monitor"],
    hold: 2,
    setup(s, p, _ctx, msg) {
      setFault(s, "relay", { code: p.faultCode, fix: "relay" });
      s.power.breakers.comms = false;
      s.comms.peak = p.peak;
      s.comms.handshake = p.handshake;
      s.comms.confirmed = false;
      msg({ at: s.t + 1, sig: s.comms.sig, label: "القيادة", digits: "", cipher: false, text: "أرسلوا رمز التأكيد" });
    },
    stable: (s) => s.comms.confirmed && linked(s),
    failure: (_s, _p, ctx, elapsed) => (elapsed >= ctx.window ? "انقطع الاتصال بالقيادة نهائيًا" : null),
    eta: (_s, _p, ctx, elapsed) => Math.max(0, ctx.window - elapsed),
  },

  /* 6. The security controller crashes into a lockdown that also isolates the coolant line. */
  security: {
    id: "security",
    title: "فشل نظام الأمان",
    goal: "أعيدوا تشغيل الأمان وارفعوا الإغلاق",
    panels: ["maint", "breakers", "comms", "doors", "valves", "cooling"],
    hold: 3,
    setup(s, p, ctx, msg) {
      setFault(s, "controller", { code: p.faultCode, fix: "reboot" });
      s.power.breakers.security = false;
      s.lockdown = true;
      s.doors.gate = false;
      s.doors.store = false;
      for (const id of ["A", "B", "C"] as const) if (!s.sections[id].lost) s.doors[id] = false;
      s.valves.coolant = false;
      s.locks.override = p.code;
      // Hard: comms gets the first half, the monitor shows the second.
      sendCode(s, p, ctx, msg, "رفع الإغلاق", p.split ? p.code.slice(0, 2) : p.code);
    },
    stable: (s) => !s.lockdown && !s.faults.controller && s.valves.coolant && s.cooling.pump === "on",
    eta: (s, _p, ctx) => reactorEta(s, ctx, ctx.ph.heat - reactorCooling(s)),
  },

  /* 7. Two vital systems at once: the pump's bearing seizes and life support trips. */
  dual: {
    id: "dual",
    title: "عطل مزدوج: التبريد والأكسجين",
    goal: "أصلحوا المضخة وأعيدوا المنقّي معًا",
    panels: ["maint", "valves", "cooling", "breakers", "grid"],
    hold: 5,
    setup(s, p) {
      setFault(s, "pump", { code: p.faultCode, fix: "bearing" });
      s.cooling.pump = "off";
      s.cooling.coolant = Math.min(s.cooling.coolant, 14);
      s.reactor.temp = Math.max(s.reactor.temp, 88);
      s.power.breakers.life = false;
      s.life.scrubber = "stopped";
      s.life.o2 = Math.min(s.life.o2, 70);
      if (s.power.main === "on") s.power.mainCap = Math.min(s.power.mainCap, 75);
    },
    stable: (s) => s.cooling.pump === "on" && s.reactor.temp <= 75 && s.life.scrubber === "running" && s.power.breakers.life && s.life.o2 >= 55,
    eta: (s, _p, ctx) => {
      const r = reactorEta(s, ctx, ctx.ph.heat - reactorCooling(s));
      const o = o2Eta(s, ctx);
      return r === null ? o : o === null ? r : Math.min(r, o);
    },
  },
};

/* Trend helpers (TV countdowns). */

function o2Eta(s: Sim, ctx: Ctx): number | null {
  const loss = ctx.ph.o2Use + SECTIONS.reduce((n, id) => n + breachLoss(s, id, ctx.ph.leak), 0) - o2Production(s);
  if (loss <= 0.01) return null;
  return Math.ceil(Math.max(0, s.life.o2 - O2_FAIL) / loss);
}
