/**
 * A scripted crew for «انقطاع الاتصال» tests: looks at the whole station (as
 * the team would by talking) and returns the next sensible command, which the
 * test then sends from whoever holds its panel. Used to prove every mission
 * is solvable on every level, at a human pace, through the real rules.
 */
import {
  ALLOC_MAX,
  hullOf,
  SYSTEMS,
  type SysId,
  reserved,
  shiftDigits,
  supply,
  type Command,
  type SectionId,
  type Sim,
} from "@/lib/outage/sim";
import type { OutageGame } from "@/lib/outage/engine";

/** The code the command really sent for `label` (decoys have another signature). */
export function codeFor(s: Sim, label: string): string | null {
  const m = s.messages.find((x) => x.got !== null && x.sig === s.comms.sig && x.label === label);
  if (!m) return null;
  return m.cipher ? shiftDigits(m.digits, -s.comms.key) : m.digits;
}

export function nextCommand(g: OutageGame): Command | null {
  const s = g.sim;
  const active = g.missions.filter((m) => m.status === "active");
  const p = s.power;

  // Power first: no supply at all → backup.
  if (supply(s) <= 0 && p.backup === "off") return { type: "backup", on: true };
  if (p.backup === "on" && !s.cooling.valves.gen && s.power.backupHeat > 55) return { type: "loop", loop: "gen", open: true };
  if (p.backup !== "on" && s.cooling.valves.gen) return { type: "loop", loop: "gen", open: false };
  if (p.backup === "on" && s.power.backupHeat > 80 && s.cooling.pump === "off" && p.main === "on") return { type: "backup", on: false };

  // Allocations: life 30, comms 15, security 15, the rest to cooling; on the backup alone, keep doors and cooling alive.
  const g0 = supply(s);
  const busyDoors = s.lockdown || active.some((m) => m.id === "leak" || m.id === "oxygen" || m.id === "comms") || !!s.locks.store;
  const hot = s.reactor.temp > 95 && !busyDoors && !s.doors.gate;
  const want: Record<SysId, number> =
    g0 >= 75
      ? hot
        ? { life: 25, comms: 0, security: 0, cooling: Math.min(ALLOC_MAX.cooling, g0 - 25) }
        : { life: 30, comms: 15, security: 15, cooling: Math.min(ALLOC_MAX.cooling, g0 - 60) }
      : { life: 10, comms: 0, security: 15, cooling: 15 };
  for (const k of SYSTEMS) if (p.alloc[k] > want[k]) return { type: "alloc", sys: k, value: want[k] };
  for (const k of ["security", "comms", "life", "cooling"] as const) {
    const free = g0 - reserved(s);
    const v = Math.min(want[k], p.alloc[k] + Math.floor(free / 5) * 5);
    if (v > p.alloc[k]) return { type: "alloc", sys: k, value: v };
  }

  // Security controller / lockdown.
  if (s.faults.controller) {
    if (p.breakers.security) return { type: "breaker", sys: "security", on: false };
    if (!s.job) return { type: "repair", device: "controller", procedure: "reboot" };
    return null;
  }
  if (!p.breakers.security && p.alloc.security > 0) return { type: "breaker", sys: "security", on: true };
  if (s.lockdown) {
    const sec = active.find((m) => m.id === "security");
    let code = codeFor(s, "رفع الإغلاق");
    if (code && sec?.params.split) code += sec.params.code.slice(2);
    if (code) return { type: "override", code };
  }

  // Store (parts).
  const needsStore = (Object.values(s.faults).some((f) => f && f.fix !== "reboot") || s.cooling.coolant < 20) && !s.doors.store;
  if (needsStore && !s.lockdown) {
    const code = s.locks.store ? codeFor(s, "المستودع") : undefined;
    if (!s.locks.store || code) return { type: "door", door: "store", open: true, code: code ?? undefined };
  }

  // Comms.
  if (s.faults.relay) {
    if (p.breakers.comms) return { type: "breaker", sys: "comms", on: false };
    if (!s.job) return { type: "repair", device: "relay", procedure: "relay" };
  } else {
    if (!p.breakers.comms && p.alloc.comms > 0) return { type: "breaker", sys: "comms", on: true };
    if (s.comms.freq !== s.comms.peak) return { type: "tune", freq: s.comms.peak };
    if (s.comms.handshake) return { type: "handshake", code: s.comms.handshake };
  }

  // Reactor gate.
  if (s.doors.gate) {
    const code = s.locks.gate ? codeFor(s, "بوابة المفاعل") : undefined;
    if (!s.locks.gate || code) return { type: "door", door: "gate", open: false, code: code ?? undefined };
  }

  // Breach.
  const leak = active.find((m) => m.id === "leak");
  if (leak) {
    const x: SectionId = leak.params.section;
    const sec = s.sections[x];
    if (sec.breach) {
      if (s.doors[x]) return { type: "door", door: x, open: false };
      if (s.valves[x]) return { type: "valve", valve: x, open: false };
      if (!s.job) return { type: "repair", device: hullOf(x), procedure: "seal" };
    } else if (!sec.lost) {
      if (!s.doors[x]) return { type: "door", door: x, open: true };
      if (!s.valves[x]) return { type: "valve", valve: x, open: true };
    }
  }

  // Main generator.
  if (s.faults.main) {
    if (s.valves.fuel) return { type: "valve", valve: "fuel", open: false };
    if (!s.job && s.doors.store) return { type: "repair", device: "main", procedure: "coupling" };
  } else {
    if (!s.valves.fuel) return { type: "valve", valve: "fuel", open: true };
    if (p.main === "off") return { type: "main", on: true };
  }

  // Pump.
  if (s.faults.pump) {
    if (s.cooling.pump === "on") return { type: "pump", on: false };
    if (s.cooling.coolant < 60 && s.doors.store) return { type: "refill" };
    if (s.valves.coolant) return { type: "valve", valve: "coolant", open: false };
    if (!s.job && s.doors.store) return { type: "repair", device: "pump", procedure: "bearing" };
  } else if (!s.valves.coolant && !s.lockdown) {
    return { type: "valve", valve: "coolant", open: true };
  }
  if (s.cooling.coolant < 20 && s.cooling.pump === "off" && s.doors.store) return { type: "refill" };

  // O₂ filter.
  if (s.faults.filter) {
    if (p.breakers.life) return { type: "breaker", sys: "life", on: false };
    if (!s.job && s.doors.store) return { type: "repair", device: "filter", procedure: "filter" };
  } else if (s.life.scrubber === "stopped") {
    if (!p.breakers.life) return { type: "breaker", sys: "life", on: true };
    return { type: "scrubber" };
  } else if (!p.breakers.life && p.alloc.life > 0) {
    return { type: "breaker", sys: "life", on: true };
  }

  if (g0 - reserved(s) < 5 && p.alloc.cooling < 30 && p.backup === "off" && !s.faults.backup) return { type: "backup", on: true };
  if (!p.breakers.cooling && !s.doors.gate && p.alloc.cooling > 0) return { type: "breaker", sys: "cooling", on: true };

  // Pump power matched to its allocation.
  const target = Math.max(10, Math.min(100, Math.floor(p.alloc.cooling / 0.6 / 10) * 10));
  if (s.cooling.power !== target) return { type: "pumpPower", value: target };
  if (s.cooling.pump === "off" && p.breakers.cooling && !s.faults.pump && s.valves.coolant) return { type: "pump", on: true };
  return null;
}
