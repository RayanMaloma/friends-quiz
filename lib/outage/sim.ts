/**
 * «انقطاع الاتصال» — the station simulation (المحطة 07).
 *
 * A pure, deterministic model of the station's coupled systems. Time moves
 * in fixed one-second ticks (`step`), never in wall-clock deltas, so the
 * outcome depends only on what players did and on which tick it landed —
 * not on how often a device polls or how fast a browser is.
 *
 * Couplings (every arrow is enforced here, not in the UI):
 *
 *   generators ──► supply ──► allocations × breakers ──► each system's power
 *   power ──► pump flow ──► reactor cooling ──► reactor temperature
 *   valves (reactor / generator loop) split the flow between the reactor and the backup generator
 *   backup generator heat ◄── its cooling loop (else it overheats and faults)
 *   power + filter + scrubber ──► O₂ production;  breaches (doors / vents) ──► O₂ loss
 *   security power + controller + lockdown ──► door commands
 *   comms power + relay + tuning ──► message reception (codes)
 *   maintenance jobs need their device isolated for their whole duration
 *
 * Device commands (`act`) check their preconditions against the current
 * state and either change it or return a short reason. They never complete a
 * mission by themselves: missions complete when the resulting state stays
 * stable (see missions.ts).
 */

/* ------------------------------------------------------------------ */
/* Identifiers                                                         */
/* ------------------------------------------------------------------ */

export type SysId = "cooling" | "life" | "comms" | "security";
export const SYSTEMS: readonly SysId[] = ["cooling", "life", "comms", "security"];

export type SectionId = "A" | "B" | "C";
export const SECTIONS: readonly SectionId[] = ["A", "B", "C"];

/** Doors (security): the reactor gate, the parts store and the three sections. true = open. */
export type DoorId = "gate" | "store" | SectionId;
export const DOORS: readonly DoorId[] = ["gate", "store", "A", "B", "C"];

/** Isolation valves (security): the coolant line, the main generator's fuel and the three section vents. true = open. */
export type ValveId = "coolant" | "fuel" | SectionId;
export const VALVES: readonly ValveId[] = ["coolant", "fuel", "A", "B", "C"];

/** What a code can lock: a door, or the lockdown override. */
export type LockId = DoorId | "override";

/** Devices maintenance can fix (`hullA` … = a section's hull). */
export type DeviceId = "main" | "backup" | "pump" | "filter" | "relay" | "controller" | "hullA" | "hullB" | "hullC";
export const DEVICES: readonly DeviceId[] = ["main", "backup", "pump", "filter", "relay", "controller", "hullA", "hullB", "hullC"];

/** Repair procedures. Every part-based one uses a spare part from the store. */
export type Procedure = "coupling" | "bearing" | "filter" | "relay" | "seal" | "reboot";
export const PROCEDURES: readonly Procedure[] = ["coupling", "bearing", "filter", "relay", "seal", "reboot"];
export type Part = Exclude<Procedure, "reboot">;
export const PARTS: readonly Part[] = ["coupling", "bearing", "filter", "relay", "seal"];

export const hullOf = (s: SectionId): DeviceId => `hull${s}` as DeviceId;

/* ------------------------------------------------------------------ */
/* Physics constants                                                   */
/* ------------------------------------------------------------------ */

export const BACKUP_OUTPUT = 40;
export const MAIN_NOMINAL = 100;
/** What each system needs to run fully (the pump's need depends on its power). */
export const NEED = { life: 30, comms: 15, security: 15 } as const;
export const PUMP_NEED_PER_PCT = 0.6;
export const ALLOC_MAX: Record<SysId, number> = { cooling: 60, life: 45, comms: 20, security: 20 };
export const ALLOC_STEP = 5;
/** Full flow removes this many °C per second from the reactor. */
export const COOLING_RATE = 3;
export const REACTOR_FLOOR = 45;
export const REACTOR_WARN = 100;
export const REACTOR_CRITICAL = 130;
export const REACTOR_MELTDOWN = 150;
export const O2_WARN = 40;
export const O2_LOW = 25;
export const O2_FAIL = 15;
export const O2_PRODUCTION = 0.6;
export const BACKUP_FAULT_HEAT = 100;
export const COOLANT_MIN = 10;
export const WRONG_CODE_LIMIT = 3;
export const WRONG_CODE_LOCK_TICKS = 15;
/** The life-support scrubber must be restarted within this many seconds of its breaker closing. */
export const SCRUBBER_WINDOW = 5;
/** Comms receive within ± this many units of the signal peak. */
export const TUNE_TOLERANCE = 2;
export const JOB_TICKS: Record<Procedure, number> = { coupling: 6, bearing: 6, filter: 5, relay: 5, seal: 6, reboot: 4 };
export const CALIBRATE_TICKS = 3;

/** Per-difficulty physics (how hard the station pushes back). */
export interface Physics {
  /** Reactor heating, °C per second. */
  heat: number;
  /** Crew O₂ use per second (percentage points). */
  o2Use: number;
  /** O₂ lost per second through an open breach. */
  leak: number;
  /** Backup generator heating per second while it runs uncooled. */
  backupHeat: number;
  /** Seconds the reactor may stay critical before the meltdown. */
  meltdownGrace: number;
  /** Seconds with no power at all before the station is lost (generator mission). */
  blackoutLimit: number;
  /** Maintenance sees the diagnosis itself (no monitor needed). */
  diagnosisForMaintenance: boolean;
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export interface Fault {
  /** Shown to maintenance, e.g. "E-41". */
  code: string;
  fix: Procedure;
}

export interface Job {
  device: DeviceId;
  procedure: Procedure;
  /** Ticks left. */
  left: number;
  total: number;
}

export interface Message {
  id: string;
  /** Tick it was sent; it is received once the comms link is up. */
  at: number;
  /** Tick it was received (null = still waiting for the link). */
  got: number | null;
  /** Sender signature (the command's own is shown on the monitor). */
  sig: string;
  /** What the code is for. */
  label: string;
  /** The digits as transmitted (enciphered when `cipher`). */
  digits: string;
  cipher: boolean;
  /** Comms' decryption attempt: the key used and the result. */
  decoded: { key: number; digits: string } | null;
  /** Free text (no code). */
  text?: string;
}

export interface LogEntry {
  t: number;
  text: string;
}

export interface Sim {
  t: number;
  power: {
    main: "on" | "off" | "fault";
    /** Main generator output when on. */
    mainCap: number;
    backup: "on" | "off" | "fault";
    /** Hidden from the electrician: only the monitor sees it. */
    backupHeat: number;
    breakers: Record<SysId, boolean>;
    alloc: Record<SysId, number>;
    /** Consecutive seconds with zero supply. */
    dark: number;
    /** Tick the life-support breaker last closed. */
    lifeOnAt: number | null;
  };
  cooling: {
    pump: "on" | "off";
    /** 0–100 %. */
    power: number;
    /** 0–100 %. */
    coolant: number;
    valves: { reactor: boolean; gen: boolean };
  };
  reactor: { temp: number; critical: number };
  life: { o2: number; scrubber: "running" | "stopped" };
  sections: Record<SectionId, { breach: boolean; lost: boolean; pressure: number }>;
  doors: Record<DoorId, boolean>;
  valves: Record<ValveId, boolean>;
  locks: Partial<Record<LockId, string>>;
  lockdown: boolean;
  /** Wrong codes in a row, and the tick until which code entry is locked. */
  wrong: { count: number; until: number };
  comms: {
    freq: number;
    peak: number;
    /** The command signature (monitor). */
    sig: string;
    /** Cipher key (monitor). */
    key: number;
    /** Expected handshake (monitor), null when none is pending. */
    handshake: string | null;
    confirmed: boolean;
  };
  faults: Partial<Record<DeviceId, Fault>>;
  parts: Record<Part, number>;
  job: Job | null;
  /** A section whose pressure sensor drifts (shows a fake drop) until calibrated. */
  drift: SectionId | null;
  calibrating: { section: SectionId; left: number } | null;
  messages: Message[];
  log: LogEntry[];
  /** Operational errors with real consequences (score −150 each). */
  errors: number;
  /** Systems that collapsed (reactor critical, O₂ low, generator burnt, section vented): no bonus. */
  collapses: number;
  /** One collapse per episode: set while the reactor is critical / O₂ is low. */
  flags: { critical: boolean; lowO2: boolean };
}

export function initialSim(): Sim {
  return {
    t: 0,
    power: {
      main: "on",
      mainCap: MAIN_NOMINAL,
      backup: "off",
      backupHeat: 35,
      breakers: { cooling: true, life: true, comms: true, security: true },
      alloc: { cooling: 40, life: 30, comms: 15, security: 15 },
      dark: 0,
      lifeOnAt: null,
    },
    cooling: { pump: "on", power: 60, coolant: 85, valves: { reactor: true, gen: false } },
    reactor: { temp: 52, critical: 0 },
    life: { o2: 96, scrubber: "running" },
    sections: {
      A: { breach: false, lost: false, pressure: 100 },
      B: { breach: false, lost: false, pressure: 100 },
      C: { breach: false, lost: false, pressure: 100 },
    },
    doors: { gate: false, store: true, A: true, B: true, C: true },
    valves: { coolant: true, fuel: true, A: true, B: true, C: true },
    locks: {},
    lockdown: false,
    wrong: { count: 0, until: 0 },
    comms: { freq: 42, peak: 42, sig: "K7", key: 0, handshake: null, confirmed: false },
    faults: {},
    parts: { coupling: 2, bearing: 2, filter: 2, relay: 2, seal: 2 },
    job: null,
    drift: null,
    calibrating: null,
    messages: [],
    log: [],
    errors: 0,
    collapses: 0,
    flags: { critical: false, lowO2: false },
  };
}

/* ------------------------------------------------------------------ */
/* Derived quantities                                                  */
/* ------------------------------------------------------------------ */

export const supply = (s: Sim) =>
  (s.power.main === "on" ? s.power.mainCap : 0) + (s.power.backup === "on" ? BACKUP_OUTPUT : 0);

/** Allocated power of the systems whose breaker is closed. */
export const allocated = (s: Sim) => SYSTEMS.reduce((n, k) => n + (s.power.breakers[k] ? s.power.alloc[k] : 0), 0);

/** Every allocation counts against the supply, breaker open or not (it is reserved). */
export const reserved = (s: Sim) => SYSTEMS.reduce((n, k) => n + s.power.alloc[k], 0);

export const need = (s: Sim, k: SysId) => (k === "cooling" ? s.cooling.power * PUMP_NEED_PER_PCT : NEED[k]);

/** Power actually delivered to a system (allocations are scaled down when the supply can't cover them). */
export function delivered(s: Sim, k: SysId): number {
  if (!s.power.breakers[k]) return 0;
  const total = allocated(s);
  const g = supply(s);
  const scale = total > g ? (total > 0 ? g / total : 0) : 1;
  return s.power.alloc[k] * scale;
}

/** 0–1: how much of its need a system gets. */
export function efficiency(s: Sim, k: SysId): number {
  const n = need(s, k);
  const d = delivered(s, k);
  if (n <= 0) return d > 0 ? 1 : 0;
  return Math.min(1, d / n);
}

/** Fully powered and its controller healthy. */
export const securityUp = (s: Sim) => efficiency(s, "security") >= 0.999 && !s.faults.controller;
export const commsUp = (s: Sim) => efficiency(s, "comms") >= 0.999 && !s.faults.relay;
export const linked = (s: Sim) => commsUp(s) && Math.abs(s.comms.freq - s.comms.peak) <= TUNE_TOLERANCE;

/** Coolant actually moving: 0–1 of full flow. */
export function flow(s: Sim): number {
  if (s.cooling.pump !== "on") return 0;
  return (s.cooling.power / 100) * efficiency(s, "cooling") * Math.min(1, s.cooling.coolant / 20);
}

/** Share of the flow through the reactor loop and the generator loop. */
export function loopShare(s: Sim): { reactor: number; gen: number } {
  const { reactor, gen } = s.cooling.valves;
  if (reactor && gen) return { reactor: 0.6, gen: 0.4 };
  return { reactor: reactor ? 1 : 0, gen: gen ? 1 : 0 };
}

export const reactorCooling = (s: Sim) => flow(s) * loopShare(s).reactor * COOLING_RATE;

/** O₂ made per second (0 when the filter is clogged, the scrubber stopped or no power). */
export function o2Production(s: Sim): number {
  if (s.faults.filter || s.life.scrubber !== "running" || !s.power.breakers.life) return 0;
  return O2_PRODUCTION * Math.min(1.5, delivered(s, "life") / NEED.life);
}

/** O₂ lost per second through one section's breach (0 when contained). */
export function breachLoss(s: Sim, id: SectionId, leak: number): number {
  const sec = s.sections[id];
  if (!sec.breach || sec.lost) return 0;
  const door = s.doors[id];
  const vent = s.valves[id];
  if (!door && !vent) return 0;
  if (door && vent) return leak;
  return leak * (door ? 0.4 : 0.3);
}

export const contained = (s: Sim, id: SectionId) => !s.doors[id] && !s.valves[id];

/** What the monitor's pressure sensor shows (a drifting sensor fakes a breach until calibrated). */
export function pressureReading(s: Sim, id: SectionId): number {
  if (s.drift === id) return Math.max(38, 100 - Math.min(s.t, 60));
  return Math.round(s.sections[id].pressure);
}

/** Why a job's device is not isolated right now (null = it is). */
export function isolationIssue(s: Sim, device: DeviceId): string | null {
  switch (device) {
    case "main":
      if (s.power.main === "on") return "أوقف المولد الرئيسي أولًا";
      if (s.valves.fuel) return "أغلق صمام الوقود أولًا";
      return null;
    case "backup":
      if (s.power.backup === "on") return "أوقف المولد الاحتياطي أولًا";
      if (s.power.backupHeat >= 50) return "المولد الاحتياطي ساخن";
      return null;
    case "pump":
      if (s.cooling.pump === "on") return "أوقف المضخة أولًا";
      if (s.valves.coolant) return "اعزل خط التبريد أولًا";
      return null;
    case "filter":
      return s.power.breakers.life ? "افصل قاطع الأكسجين أولًا" : null;
    case "relay":
      return s.power.breakers.comms ? "افصل قاطع الاتصالات أولًا" : null;
    case "controller":
      return s.power.breakers.security ? "افصل قاطع الأمان أولًا" : null;
    case "hullA":
    case "hullB":
    case "hullC": {
      const sec = device.slice(4) as SectionId;
      return contained(s, sec) ? null : `اعزل القسم ${sec} أولًا`;
    }
  }
}

/** Store parts need the store door open (lockdown closes it). */
const needsPart = (p: Procedure): p is Part => p !== "reboot";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const LOG_MAX = 30;

export function log(s: Sim, text: string) {
  s.log.push({ t: s.t, text });
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 1000) / 1000;

/** Interlocks re-checked after every change (state that can't coexist). */
export function enforce(s: Sim) {
  // The cooling breaker can't stay closed with the reactor gate open.
  if (s.doors.gate && s.power.breakers.cooling) {
    s.power.breakers.cooling = false;
    log(s, "فصل قاطع التبريد: البوابة مفتوحة");
  }
  // The pump stops on no power, a closed coolant line, no coolant, a fault, or both loops closed.
  if (s.cooling.pump === "on") {
    const why = !s.power.breakers.cooling || delivered(s, "cooling") <= 0
      ? "لا طاقة"
      : !s.valves.coolant
        ? "خط التبريد معزول"
        : s.faults.pump
          ? "عطل"
          : s.cooling.coolant < COOLANT_MIN
            ? "سائل التبريد منخفض"
            : !s.cooling.valves.reactor && !s.cooling.valves.gen
              ? "الصمامات مغلقة"
              : null;
    if (why) {
      s.cooling.pump = "off";
      log(s, `توقفت المضخة: ${why}`);
    }
  }
  if (s.power.main === "on" && !s.valves.fuel) {
    s.power.main = "off";
    log(s, "توقف المولد الرئيسي: لا وقود");
  }
  if (s.power.breakers.life) s.power.lifeOnAt ??= s.t;
  else s.power.lifeOnAt = null;
}

/* ------------------------------------------------------------------ */
/* One second                                                          */
/* ------------------------------------------------------------------ */

/** Advances the station by one second. Mutates `s`. */
export function step(s: Sim, ph: Physics) {
  s.t += 1;

  // Power.
  s.power.dark = supply(s) <= 0 ? s.power.dark + 1 : 0;

  // Backup generator heat: cooled by its loop when coolant flows through it.
  const genFlow = flow(s) * loopShare(s).gen;
  if (s.power.backup === "on") {
    s.power.backupHeat += genFlow > 0.05 ? 0.3 - Math.max(0, s.power.backupHeat - 50) * 0.08 * Math.min(1, genFlow * 3) : ph.backupHeat;
    if (s.power.backupHeat >= BACKUP_FAULT_HEAT) {
      s.power.backup = "fault";
      s.faults.backup = { code: s.faults.backup?.code ?? "E-90", fix: "reboot" };
      s.errors += 1;
      s.collapses += 1;
      log(s, "احترق المولد الاحتياطي");
    }
  } else {
    s.power.backupHeat = Math.max(30, s.power.backupHeat - 1);
  }
  s.power.backupHeat = round1(s.power.backupHeat);

  // Reactor.
  const temp = s.reactor.temp + ph.heat - reactorCooling(s);
  s.reactor.temp = round1(Math.max(REACTOR_FLOOR, temp));
  if (s.reactor.temp >= REACTOR_CRITICAL) {
    s.reactor.critical += 1;
    if (!s.flags.critical) {
      s.flags.critical = true;
      s.collapses += 1;
      log(s, "المفاعل في المنطقة الحرجة");
    }
  } else {
    s.reactor.critical = 0;
    if (s.reactor.temp < REACTOR_WARN) s.flags.critical = false;
  }

  // Air.
  let o2 = s.life.o2 + o2Production(s) - ph.o2Use;
  for (const id of SECTIONS) {
    o2 -= breachLoss(s, id, ph.leak);
    const sec = s.sections[id];
    if (sec.breach && !contained(s, id) && !sec.lost) sec.pressure = Math.max(35, sec.pressure - 2);
    else if (!sec.breach && !sec.lost) sec.pressure = Math.min(100, sec.pressure + 3);
  }
  s.life.o2 = round1(clamp(o2, 0, 100));
  if (s.life.o2 < O2_LOW && !s.flags.lowO2) {
    s.flags.lowO2 = true;
    s.collapses += 1;
    log(s, "الأكسجين تحت الحد الآمن");
  } else if (s.life.o2 >= O2_WARN) {
    s.flags.lowO2 = false;
  }

  // The scrubber trips its breaker if it isn't restarted in time.
  if (s.life.scrubber === "stopped" && s.power.breakers.life && s.power.lifeOnAt !== null && s.t - s.power.lifeOnAt > SCRUBBER_WINDOW) {
    s.power.breakers.life = false;
    log(s, "فصل قاطع الأكسجين: المنقّي لم يعمل");
  }

  // Comms: messages arrive while the link is up.
  if (linked(s)) for (const m of s.messages) if (m.got === null && m.at <= s.t) m.got = s.t;

  // Maintenance job: the device must stay isolated the whole time.
  if (s.job) {
    const issue = isolationIssue(s, s.job.device);
    if (issue) {
      log(s, `توقف الإصلاح: ${issue}`);
      s.job = null;
    } else if (--s.job.left <= 0) {
      finishJob(s, s.job);
      s.job = null;
    }
  }

  // Sensor calibration.
  if (s.calibrating && --s.calibrating.left <= 0) {
    if (s.drift === s.calibrating.section) s.drift = null;
    log(s, `معايرة الحساس ${s.calibrating.section}`);
    s.calibrating = null;
  }

  enforce(s);
}

function finishJob(s: Sim, job: Job) {
  const fault = s.faults[job.device];
  if (!fault) return;
  delete s.faults[job.device];
  if (needsPart(job.procedure)) s.parts[job.procedure] -= 1;
  switch (job.device) {
    case "main":
      s.power.main = "off";
      s.power.mainCap = MAIN_NOMINAL;
      break;
    case "backup":
      s.power.backup = "off";
      break;
    case "hullA":
    case "hullB":
    case "hullC":
      s.sections[job.device.slice(4) as SectionId].breach = false;
      break;
    default:
      break;
  }
  log(s, `تم إصلاح ${DEVICE_NAMES[job.device]}`);
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export type Command =
  | { type: "main"; on: boolean }
  | { type: "backup"; on: boolean }
  | { type: "breaker"; sys: SysId; on: boolean }
  | { type: "alloc"; sys: SysId; value: number }
  | { type: "pump"; on: boolean }
  | { type: "pumpPower"; value: number }
  | { type: "loop"; loop: "reactor" | "gen"; open: boolean }
  | { type: "door"; door: DoorId; open: boolean; code?: string }
  | { type: "override"; code: string }
  | { type: "valve"; valve: ValveId; open: boolean }
  | { type: "purge"; section: SectionId }
  | { type: "tune"; freq: number }
  | { type: "decrypt"; message: string; key: number }
  | { type: "handshake"; code: string }
  | { type: "calibrate"; section: SectionId }
  | { type: "repair"; device: DeviceId; procedure: Procedure }
  | { type: "scrubber" }
  | { type: "refill" };

/** null = done; a string = refused, with the reason (nothing changed except error counters). */
export type CommandResult = null | string;

export const SYS_NAMES: Record<SysId, string> = { cooling: "التبريد", life: "الأكسجين", comms: "الاتصالات", security: "الأمان" };
const SYS_FOR: Record<SysId, string> = { cooling: "للتبريد", life: "للأكسجين", comms: "للاتصالات", security: "للأمان" };
export const DEVICE_NAMES: Record<DeviceId, string> = {
  main: "المولد الرئيسي",
  backup: "المولد الاحتياطي",
  pump: "مضخة التبريد",
  filter: "فلتر الأكسجين",
  relay: "مرحّل الاتصالات",
  controller: "وحدة تحكم الأمان",
  hullA: "هيكل القسم A",
  hullB: "هيكل القسم B",
  hullC: "هيكل القسم C",
};
export const DOOR_NAMES: Record<DoorId, string> = { gate: "بوابة المفاعل", store: "المستودع", A: "باب A", B: "باب B", C: "باب C" };
export const VALVE_NAMES: Record<ValveId, string> = { coolant: "خط التبريد", fuel: "الوقود", A: "تهوية A", B: "تهوية B", C: "تهوية C" };
export const PROCEDURE_NAMES: Record<Procedure, string> = {
  coupling: "استبدال القارنة",
  bearing: "استبدال المحمل",
  filter: "استبدال الفلتر",
  relay: "استبدال المرحّل",
  seal: "ختم الهيكل",
  reboot: "إعادة تشغيل",
};

/** Checks a code typed for `lock`. Wrong codes count as errors and lock the keypad after three. */
function checkCode(s: Sim, lock: LockId, code: string | undefined): CommandResult {
  const want = s.locks[lock];
  if (!want) return null;
  if (s.wrong.until > s.t) return `الإدخال مقفل ${s.wrong.until - s.t}ث`;
  if (!code) return "يتطلب رمز تحقق";
  if (code !== want) {
    s.errors += 1;
    s.wrong.count += 1;
    log(s, "رمز خاطئ");
    if (s.wrong.count >= WRONG_CODE_LIMIT) {
      s.wrong = { count: 0, until: s.t + WRONG_CODE_LOCK_TICKS };
      return `رمز خاطئ — الإدخال مقفل ${WRONG_CODE_LOCK_TICKS}ث`;
    }
    return "رمز خاطئ";
  }
  s.wrong.count = 0;
  delete s.locks[lock];
  return null;
}

/** Applies one device command at the current tick. Mutates `s` (also when refused: error counters, log). */
export function act(s: Sim, c: Command): CommandResult {
  const res = run(s, c);
  if (res === null) enforce(s);
  return res;
}

function run(s: Sim, c: Command): CommandResult {
  const p = s.power;
  switch (c.type) {
    /* -------- generators -------- */
    case "main":
      if (c.on) {
        if (p.main === "on") return null;
        if (p.main === "fault") return "المولد معطل";
        if (s.job?.device === "main") return "صيانة جارية";
        if (!s.valves.fuel) return "صمام الوقود مغلق";
        p.main = "on";
        log(s, "تشغيل المولد الرئيسي");
      } else if (p.main === "on") {
        p.main = "off";
        log(s, "إيقاف المولد الرئيسي");
      }
      return null;
    case "backup":
      if (c.on) {
        if (p.backup === "on") return null;
        if (p.backup === "fault") return "المولد معطل";
        if (s.job?.device === "backup") return "صيانة جارية";
        p.backup = "on";
        log(s, "تشغيل المولد الاحتياطي");
      } else if (p.backup === "on") {
        p.backup = "off";
        log(s, "إيقاف المولد الاحتياطي");
      }
      return null;

    /* -------- distribution -------- */
    case "breaker": {
      if (!c.on) {
        if (p.breakers[c.sys]) log(s, `فصل قاطع ${SYS_NAMES[c.sys]}`);
        p.breakers[c.sys] = false;
        return null;
      }
      if (p.breakers[c.sys]) return null;
      if (c.sys === "cooling" && s.doors.gate) return "بوابة المفاعل مفتوحة";
      if (c.sys === "comms" && s.faults.relay) return "المرحّل معطل";
      if (c.sys === "security" && s.faults.controller) return "وحدة التحكم معطلة";
      if (s.job && isolationIssueAfter(s, c.sys)) return "صيانة جارية";
      if (p.alloc[c.sys] <= 0) return `لا طاقة مخصصة ${SYS_FOR[c.sys]}`;
      p.breakers[c.sys] = true;
      log(s, `تشغيل قاطع ${SYS_NAMES[c.sys]}`);
      return null;
    }
    case "alloc": {
      const v = Math.round(c.value / ALLOC_STEP) * ALLOC_STEP;
      if (v < 0 || v > ALLOC_MAX[c.sys]) return "قيمة غير مسموحة";
      const before = p.alloc[c.sys];
      if (v > before && reserved(s) - before + v > supply(s)) return "الطاقة المتاحة غير كافية";
      p.alloc[c.sys] = v;
      if (v !== before) log(s, `طاقة ${SYS_NAMES[c.sys]}: ${v}`);
      return null;
    }

    /* -------- cooling -------- */
    case "pump":
      if (!c.on) {
        if (s.cooling.pump === "on") log(s, "إيقاف المضخة");
        s.cooling.pump = "off";
        return null;
      }
      if (s.cooling.pump === "on") return null;
      if (s.faults.pump) return "المضخة معطلة";
      if (s.job?.device === "pump") return "صيانة جارية";
      if (!p.breakers.cooling || delivered(s, "cooling") <= 0) return "لا توجد طاقة للمضخة";
      if (!s.valves.coolant) return "خط التبريد معزول";
      if (s.cooling.coolant < COOLANT_MIN) return "سائل التبريد منخفض";
      if (!s.cooling.valves.reactor && !s.cooling.valves.gen) return "صمامات التبريد مغلقة";
      s.cooling.pump = "on";
      log(s, "تشغيل المضخة");
      return null;
    case "pumpPower": {
      const v = Math.round(c.value / 10) * 10;
      if (v < 0 || v > 100) return "قيمة غير مسموحة";
      if (v !== s.cooling.power) log(s, `قوة المضخة ${v}%`);
      s.cooling.power = v;
      return null;
    }
    case "loop":
      s.cooling.valves[c.loop] = c.open;
      log(s, `${c.open ? "فتح" : "إغلاق"} صمام ${c.loop === "reactor" ? "المفاعل" : "المولد"}`);
      return null;

    /* -------- security: doors -------- */
    case "door": {
      if (s.doors[c.door] === c.open) return null;
      if (!securityUp(s)) return s.faults.controller ? "وحدة التحكم معطلة" : "نظام الأمان بلا طاقة";
      if (s.lockdown) return "الإغلاق الطارئ مفعّل";
      if (c.door !== "gate" && c.door !== "store" && s.sections[c.door].lost) return "القسم مفصول";
      const bad = checkCode(s, c.door, c.code);
      if (bad) return bad;
      s.doors[c.door] = c.open;
      log(s, `${c.open ? "فتح" : "إغلاق"} ${DOOR_NAMES[c.door]}`);
      // Opening a breached section into the station: a costly mistake.
      if (c.open && c.door !== "gate" && c.door !== "store" && s.sections[c.door].breach) {
        s.errors += 1;
        s.life.o2 = Math.max(0, s.life.o2 - 4);
        log(s, `تسرب من القسم ${c.door}`);
      }
      return null;
    }
    case "override": {
      if (!s.lockdown) return null;
      if (!securityUp(s)) return s.faults.controller ? "وحدة التحكم معطلة" : "نظام الأمان بلا طاقة";
      const bad = checkCode(s, "override", c.code || undefined);
      if (bad) return bad;
      s.lockdown = false;
      log(s, "رفع الإغلاق الطارئ");
      return null;
    }

    /* -------- security: valves (manual, no power needed) -------- */
    case "valve":
      if (s.valves[c.valve] === c.open) return null;
      if (c.open && s.lockdown) return "الإغلاق الطارئ مفعّل";
      if (c.open && c.valve !== "coolant" && c.valve !== "fuel" && s.sections[c.valve].lost) return "القسم مفصول";
      s.valves[c.valve] = c.open;
      log(s, `${c.open ? "فتح" : "إغلاق"} صمام ${VALVE_NAMES[c.valve]}`);
      return null;
    case "purge": {
      const sec = s.sections[c.section];
      if (sec.lost) return "القسم مفصول";
      if (s.doors[c.section]) return `أغلق باب ${c.section} أولًا`;
      // Venting a section seals it off for good: the breach stops, the air in it is lost.
      sec.lost = true;
      s.valves[c.section] = false;
      s.life.o2 = Math.max(0, s.life.o2 - 6);
      s.collapses += 1;
      if (!sec.breach) s.errors += 1;
      sec.breach = false;
      delete s.faults[hullOf(c.section)];
      log(s, `تفريغ القسم ${c.section}`);
      return null;
    }

    /* -------- comms -------- */
    case "tune": {
      const v = Math.round(c.freq);
      if (v < 0 || v > 99) return "قيمة غير مسموحة";
      s.comms.freq = v;
      return null;
    }
    case "decrypt": {
      const m = s.messages.find((x) => x.id === c.message && x.got !== null);
      if (!m) return "الرسالة غير موجودة";
      if (!m.cipher) return null;
      m.decoded = { key: c.key, digits: shiftDigits(m.digits, -c.key) };
      return null;
    }
    case "handshake":
      if (!s.comms.handshake) return "لا يوجد طلب تأكيد";
      if (!linked(s)) return "لا إشارة";
      if (c.code !== s.comms.handshake) {
        s.errors += 1;
        log(s, "رمز تأكيد خاطئ");
        return "رمز خاطئ";
      }
      s.comms.confirmed = true;
      s.comms.handshake = null;
      log(s, "تأكيد الاتصال بالقيادة");
      return null;

    /* -------- monitor -------- */
    case "calibrate":
      if (s.calibrating) return "معايرة جارية";
      s.calibrating = { section: c.section, left: CALIBRATE_TICKS };
      return null;

    /* -------- maintenance -------- */
    case "repair": {
      if (s.job) return "صيانة أخرى جارية";
      const fault = s.faults[c.device];
      if (!fault) return "لا يوجد عطل";
      if (c.procedure !== fault.fix) {
        s.errors += 1;
        log(s, `إجراء خاطئ على ${DEVICE_NAMES[c.device]}`);
        return "إجراء غير مناسب";
      }
      if (needsPart(c.procedure)) {
        if (!s.doors.store) return "المستودع مغلق";
        if (s.parts[c.procedure] <= 0) return "القطع نفدت";
      }
      const issue = isolationIssue(s, c.device);
      if (issue) return issue;
      s.job = { device: c.device, procedure: c.procedure, left: JOB_TICKS[c.procedure], total: JOB_TICKS[c.procedure] };
      log(s, `بدء ${PROCEDURE_NAMES[c.procedure]}`);
      return null;
    }
    case "scrubber":
      if (s.life.scrubber === "running") return null;
      if (!p.breakers.life) return "شغّل قاطع الأكسجين أولًا";
      if (p.lifeOnAt !== null && s.t - p.lifeOnAt > SCRUBBER_WINDOW) return "فات وقت التزامن";
      s.life.scrubber = "running";
      log(s, "تشغيل منقّي الهواء");
      return null;
    case "refill":
      if (s.cooling.coolant >= 60) return "المستوى كافٍ";
      if (s.cooling.pump === "on") return "أوقف المضخة أولًا";
      if (!s.doors.store) return "المستودع مغلق";
      s.cooling.coolant = 90;
      log(s, "تعبئة سائل التبريد");
      return null;
  }
}

/** Closing a breaker would break the isolation of the running job. */
function isolationIssueAfter(s: Sim, sys: SysId): boolean {
  const d = s.job?.device;
  return (sys === "life" && d === "filter") || (sys === "comms" && d === "relay") || (sys === "security" && d === "controller");
}

export function shiftDigits(digits: string, by: number): string {
  return [...digits].map((ch) => String((((Number(ch) + by) % 10) + 10) % 10)).join("");
}
