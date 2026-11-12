import { describe, expect, it } from "vitest";
import {
  advance,
  applyCommand,
  applyHostMove,
  applySettings,
  GRADES,
  LEVELS,
  maxScore,
  newDoc,
  POINTS,
  scoreOf,
  startGame,
  touch,
  type Difficulty,
  type OutageDoc,
  type OutageGame,
  type RosterEntry,
} from "@/lib/outage/engine";
import { MISSIONS, MISSION_IDS } from "@/lib/outage/missions";
import { baseAssignment, cooperative, LAYOUTS, PANELS, panelOf, redistribute, titleOf, type PanelId } from "@/lib/outage/roles";
import {
  act,
  delivered,
  efficiency,
  initialSim,
  linked,
  o2Production,
  reactorCooling,
  securityUp,
  shiftDigits,
  step,
  supply,
  type Command,
  type Sim,
} from "@/lib/outage/sim";
import { buildOutageGuestView, buildOutageHostView } from "@/lib/outage/views";
import type { Snapshot } from "@/lib/types";
import { codeFor, nextCommand } from "./helpers/outageCrew";

// «انقطاع الاتصال»: the station simulation and the match engine, without a
// database. These tests drive the real rules: every coupling, refusal and
// completion is checked on the simulation's state, not on a screen.

const T0 = 1_700_000_000_000;
const EASY = LEVELS.easy.ph;
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `لاعب ${i}` }));
const rosterOf = (n: number): RosterEntry[] => players(n).map((p) => ({ ...p, active: true }));

function start(difficulty: Difficulty, n = 4, seed = 7): OutageDoc {
  const res = startGame(newDoc({ difficulty }), players(n), T0, seed);
  expect(res.error).toBeUndefined();
  return res.doc;
}

/** Runs the clock to `sec` seconds of active time (every player's phone checking in). */
function at(doc: OutageDoc, sec: number, n = 4): OutageDoc {
  const now = T0 + sec * 1000;
  let d = doc;
  for (const p of players(n)) d = touch(d, p.id, now);
  return advance(d, now, rosterOf(n));
}

/** Sends `cmd` from whoever holds its panel, at `sec`. */
function send(doc: OutageDoc, sec: number, cmd: Command) {
  const g = doc.game!;
  return applyCommand(doc, g.assignment[panelOf(cmd)], cmd, T0 + sec * 1000);
}

/** A station in normal operation, then the reactor fault injected exactly as the mission does. */
function reactorStation(): Sim {
  const s = initialSim();
  MISSIONS.reactor.setup(s, params(), { ph: EASY, cipher: false, window: 300, backupWarm: 45 }, (m) =>
    s.messages.push({ ...m, id: "m1", got: null, decoded: null }),
  );
  return s;
}

function params() {
  return { code: "4719", split: false, section: "B" as const, decoySection: null, peak: 70, handshake: "315", faultCode: "E-41", faultCode2: "E-42", decoys: [] };
}

const run = (s: Sim, secs: number) => {
  for (let i = 0; i < secs; i++) step(s, EASY);
};

/* ------------------------------------------------------------------ */

describe("specialties for 3–8 players", () => {
  for (const n of [3, 4, 5, 6, 7, 8]) {
    it(`${n} players: every panel has exactly one owner, everyone has a panel, no fault is solvable alone`, () => {
      const ids = players(n).map((p) => p.id);
      const a = baseAssignment(ids);
      expect(Object.keys(a).sort()).toEqual([...PANELS].sort());
      for (const id of ids) expect(PANELS.filter((p) => a[p] === id).length).toBeGreaterThan(0);
      expect(LAYOUTS[n].flat().sort()).toEqual([...PANELS].sort());
      expect(cooperative(a)).toBe(true);
    });
  }

  it("six players: one specialty each", () => {
    const a = baseAssignment(players(6).map((p) => p.id));
    const names = players(6).map((p) => titleOf(PANELS.filter((x) => a[x] === p.id)).map((t) => t.name));
    expect(names.flat().sort()).toEqual(["الاتصالات", "الأمان", "التبريد", "الصيانة", "الكهرباء", "المراقبة"].sort());
    expect(names.every((x) => x.length === 1)).toBe(true);
  });

  it("four players: electrical, cooling, security+maintenance, comms+monitor", () => {
    expect(LAYOUTS[4]).toEqual([["breakers", "grid"], ["cooling"], ["doors", "valves", "maint"], ["comms", "monitor"]]);
  });

  it("seven and eight players split electrical and security into independent sub-panels", () => {
    expect(LAYOUTS[7].some((s) => s.length === 1 && s[0] === "breakers")).toBe(true);
    expect(LAYOUTS[7].some((s) => s.length === 1 && s[0] === "grid")).toBe(true);
    expect(LAYOUTS[8].some((s) => s.length === 1 && s[0] === "doors")).toBe(true);
    expect(LAYOUTS[8].some((s) => s.length === 1 && s[0] === "valves")).toBe(true);
  });

  it("starting needs 3–8 seated players", () => {
    expect(startGame(newDoc(), players(2), T0, 1).error).toMatch(/3/);
    expect(startGame(newDoc(), players(9), T0, 1).error).toMatch(/8/);
  });

  it("a leaver's panels go to the others after the grace period (cooperation kept); a returner gets them back", () => {
    for (const n of [3, 4, 6, 8]) {
      const ids = players(n).map((p) => p.id);
      const base = baseAssignment(ids);
      const present = new Set(ids.slice(1));
      const a = redistribute(base, ids, present);
      for (const p of PANELS) expect(present.has(a[p])).toBe(true);
      expect(cooperative(a)).toBe(true);
      expect(redistribute(base, ids, new Set(ids))).toEqual(base);
    }
  });
});

describe("permissions", () => {
  it("every command belongs to exactly one panel and only its holder may send it", () => {
    const doc = start("easy", 4);
    const g = doc.game!;
    const cmd: Command = { type: "pump", on: true };
    const owner = g.assignment[panelOf(cmd)];
    const other = g.players.find((p) => p.id !== owner)!.id;
    expect(applyCommand(doc, other, cmd, T0 + 1000).error).toBe("ليست من صلاحياتك");
    expect(applyCommand(doc, "stranger", cmd, T0 + 1000).error).toBe("NOT_SEATED");
  });

  it("each phone view carries only its own panels' data", () => {
    const doc = at(start("medium", 6), 10, 6);
    const snap = snapshotOf(doc, 6);
    const g = doc.game!;
    for (const p of g.players) {
      const v = buildOutageGuestView(snap, doc, p.id)!;
      const mine = PANELS.filter((x) => g.assignment[x] === p.id);
      expect(v.game!.panels).toEqual(mine);
      expect(Object.keys(v.game!.data).sort()).toEqual([...mine].sort());
    }
  });

  it("the TV never shows codes, keys, the signal, diagnoses or the backup generator's heat", () => {
    const doc = at(start("hard", 4), 12);
    const g = doc.game!;
    const tv = JSON.stringify(buildOutageHostView(snapshotOf(doc, 4), doc));
    for (const m of g.missions) expect(tv).not.toContain(m.params.code);
    expect(tv).not.toMatch(/"(digits|key|peak|sig|handshake|backupHeat|diagnoses|faults?Code)"/);
    expect(tv).not.toContain(`"${g.sim.comms.sig}"`);
  });
});

/* ------------------------------------------------------------------ */

describe("the mandatory reactor chain (every step depends on the previous one)", () => {
  it("refuses each step until its conditions hold, then cools the reactor for real", () => {
    const s = reactorStation();
    expect(s.reactor.temp).toBe(91);
    expect(s.cooling.pump).toBe("off");

    // 1–2. Cooling tries the pump: no power.
    expect(act(s, { type: "pump", on: true })).toBe("لا توجد طاقة للمضخة");
    // 3–4. Electrical tries the breaker: the reactor gate is open.
    expect(act(s, { type: "breaker", sys: "cooling", on: true })).toBe("بوابة المفاعل مفتوحة");
    // 5–6. Security tries to close the gate: a code is required.
    expect(act(s, { type: "door", door: "gate", open: false })).toBe("يتطلب رمز تحقق");
    // 7. The code only reaches comms while the link is up.
    expect(s.messages[0].got).toBeNull();
    run(s, 3);
    expect(s.messages[0].got).not.toBeNull();
    // 8–10. Security types it: the gate closes.
    expect(act(s, { type: "door", door: "gate", open: false, code: s.messages[0].digits })).toBeNull();
    expect(s.doors.gate).toBe(false);
    // The breaker still refuses: nothing is allocated to cooling…
    expect(act(s, { type: "breaker", sys: "cooling", on: true })).toBe("لا طاقة مخصصة للتبريد");
    // …and every unit is spoken for: power must be moved from another system.
    expect(act(s, { type: "alloc", sys: "cooling", value: 20 })).toBe("الطاقة المتاحة غير كافية");
    // 11. Transfer: life 40→30, comms 20→15, security 20→15 frees 20.
    expect(act(s, { type: "alloc", sys: "life", value: 30 })).toBeNull();
    expect(act(s, { type: "alloc", sys: "comms", value: 15 })).toBeNull();
    expect(act(s, { type: "alloc", sys: "security", value: 15 })).toBeNull();
    expect(act(s, { type: "alloc", sys: "cooling", value: 20 })).toBeNull();
    // 12. The breaker closes.
    expect(act(s, { type: "breaker", sys: "cooling", on: true })).toBeNull();
    // 13. Cooling sets the pump to what the allocation can feed, and starts it.
    expect(act(s, { type: "pumpPower", value: 30 })).toBeNull();
    expect(act(s, { type: "pump", on: true })).toBeNull();
    // 14. The temperature now falls, by the simulation alone.
    const before = s.reactor.temp;
    run(s, 10);
    expect(s.reactor.temp).toBeLessThan(before - 3);
    // 15. The mission is stable only once below 70.
    expect(MISSIONS.reactor.stable(s, params())).toBe(false);
    run(s, 60);
    expect(s.reactor.temp).toBeLessThanOrEqual(70);
    expect(MISSIONS.reactor.stable(s, params())).toBe(true);
  });

  it("does not complete on a last button press: only after the stable state holds", () => {
    let doc = start("easy", 4);
    doc = at(doc, 4);
    const g = doc.game!;
    expect(g.missions[0].status).toBe("active");
    // Cheat-free shortcut: force the station cool for just under the hold time.
    g.sim.reactor.temp = 60;
    g.sim.cooling.pump = "on";
    g.sim.doors.gate = false;
    g.sim.power.breakers.cooling = true;
    g.sim.power.alloc = { cooling: 40, life: 30, comms: 5, security: 5 };
    doc = at(doc, 4 + MISSIONS.reactor.hold - 1);
    expect(doc.game!.missions[0].status).toBe("active");
    doc = at(doc, 4 + MISSIONS.reactor.hold + 1);
    expect(doc.game!.missions[0].status).toBe("done");
  });
});

describe("couplings", () => {
  it("power → cooling: the pump's flow is capped by the power it gets", () => {
    const s = initialSim();
    s.cooling.power = 100;
    s.power.alloc = { cooling: 30, life: 30, comms: 5, security: 5 };
    expect(efficiency(s, "cooling")).toBeCloseTo(0.5);
    const half = reactorCooling(s);
    s.power.alloc.cooling = 60;
    expect(reactorCooling(s)).toBeCloseTo(half * 2);
  });

  it("cooling → reactor: heats when the pump stops, cools when it runs", () => {
    const s = initialSim();
    s.reactor.temp = 90;
    run(s, 10);
    expect(s.reactor.temp).toBeLessThan(90);
    act(s, { type: "pump", on: false });
    const t = s.reactor.temp;
    run(s, 10);
    expect(s.reactor.temp).toBeCloseTo(t + 10 * EASY.heat, 5);
  });

  it("the reactor gate interlock trips the cooling breaker and stops the pump", () => {
    const s = initialSim();
    s.doors.gate = true;
    run(s, 1);
    expect(s.power.breakers.cooling).toBe(false);
    expect(s.cooling.pump).toBe("off");
  });

  it("power → oxygen: moving power from life support to cooling lowers O₂ (a decision with a cost)", () => {
    const s = initialSim();
    s.power.alloc = { cooling: 40, life: 30, comms: 15, security: 15 };
    const full = o2Production(s);
    expect(act(s, { type: "alloc", sys: "life", value: 10 })).toBeNull();
    expect(act(s, { type: "alloc", sys: "cooling", value: 60 })).toBeNull();
    expect(o2Production(s)).toBeLessThan(full / 2);
    s.life.o2 = 80;
    run(s, 20);
    expect(s.life.o2).toBeLessThan(80);
    expect(reactorCooling(s)).toBeGreaterThan(0);
  });

  it("losing generation browns every system out proportionally", () => {
    const s = initialSim();
    s.power.main = "fault";
    expect(supply(s)).toBe(0);
    run(s, 1);
    expect(s.cooling.pump).toBe("off");
    expect(securityUp(s)).toBe(false);
    act(s, { type: "backup", on: true });
    expect(supply(s)).toBe(40);
    expect(delivered(s, "life")).toBeCloseTo(30 * (40 / 100));
  });

  it("security power gates every door command; valves are manual", () => {
    const s = initialSim();
    act(s, { type: "alloc", sys: "security", value: 5 });
    expect(act(s, { type: "door", door: "A", open: false })).toBe("نظام الأمان بلا طاقة");
    expect(act(s, { type: "valve", valve: "A", open: false })).toBeNull();
  });

  it("the backup generator overheats without its cooling loop (hidden from the electrician), not with it", () => {
    const hot = initialSim();
    hot.power.backupHeat = 85;
    act(hot, { type: "backup", on: true });
    run(hot, 30);
    expect(hot.power.backup).toBe("fault");
    expect(hot.errors).toBe(1);
    const cooled = initialSim();
    cooled.power.backupHeat = 85;
    act(cooled, { type: "backup", on: true });
    act(cooled, { type: "loop", loop: "gen", open: true });
    run(cooled, 60);
    expect(cooled.power.backup).toBe("on");
    expect(cooled.power.backupHeat).toBeLessThan(65);
  });

  it("comms receive only while powered, repaired and tuned to the peak", () => {
    const s = initialSim();
    s.comms.peak = 70;
    s.messages.push({ id: "m1", at: 0, got: null, sig: "K7", label: "x", digits: "1234", cipher: false, decoded: null });
    run(s, 3);
    expect(linked(s)).toBe(false);
    expect(s.messages[0].got).toBeNull();
    act(s, { type: "tune", freq: 69 });
    run(s, 1);
    expect(s.messages[0].got).not.toBeNull();
  });

  it("a repair needs its device isolated for its whole duration", () => {
    const s = initialSim();
    s.faults.pump = { code: "E-20", fix: "bearing" };
    act(s, { type: "pump", on: false });
    expect(act(s, { type: "repair", device: "pump", procedure: "bearing" })).toBe("اعزل خط التبريد أولًا");
    act(s, { type: "valve", valve: "coolant", open: false });
    expect(act(s, { type: "repair", device: "pump", procedure: "bearing" })).toBeNull();
    run(s, 2);
    act(s, { type: "valve", valve: "coolant", open: true });
    run(s, 1);
    expect(s.job).toBeNull();
    expect(s.faults.pump).toBeDefined();
  });

  it("a wrong procedure is an operational error; the right one fixes the device and uses a part", () => {
    const s = initialSim();
    s.faults.filter = { code: "E-31", fix: "filter" };
    act(s, { type: "breaker", sys: "life", on: false });
    expect(act(s, { type: "repair", device: "filter", procedure: "relay" })).toBe("إجراء غير مناسب");
    expect(s.errors).toBe(1);
    expect(act(s, { type: "repair", device: "filter", procedure: "filter" })).toBeNull();
    run(s, 5);
    expect(s.faults.filter).toBeUndefined();
    expect(s.parts.filter).toBe(1);
  });

  it("the scrubber must be restarted within 5 s of its breaker closing (two players in sync), else it trips", () => {
    const late = initialSim();
    late.life.scrubber = "stopped";
    late.power.breakers.life = false;
    act(late, { type: "breaker", sys: "life", on: true });
    run(late, 7);
    expect(late.power.breakers.life).toBe(false);
    expect(act(late, { type: "scrubber" })).toBe("شغّل قاطع الأكسجين أولًا");
    const sync = initialSim();
    sync.life.scrubber = "stopped";
    sync.power.breakers.life = false;
    act(sync, { type: "breaker", sys: "life", on: true });
    run(sync, 3);
    expect(act(sync, { type: "scrubber" })).toBeNull();
    run(sync, 10);
    expect(sync.power.breakers.life).toBe(true);
    expect(o2Production(sync)).toBeGreaterThan(0);
  });
});

describe("codes", () => {
  it("wrong codes are errors; three in a row lock the keypad; the right one unlocks", () => {
    const s = reactorStation();
    expect(act(s, { type: "door", door: "gate", open: false, code: "0000" })).toBe("رمز خاطئ");
    expect(act(s, { type: "door", door: "gate", open: false, code: "0001" })).toBe("رمز خاطئ");
    expect(act(s, { type: "door", door: "gate", open: false, code: "0002" })).toMatch(/مقفل/);
    expect(s.errors).toBe(3);
    expect(act(s, { type: "door", door: "gate", open: false, code: "4719" })).toMatch(/مقفل/);
    run(s, 15);
    expect(act(s, { type: "door", door: "gate", open: false, code: "4719" })).toBeNull();
    expect(s.locks.gate).toBeUndefined();
  });

  it("medium: codes travel enciphered; only the monitor's key decodes them, and a decoy has a foreign signature", () => {
    let doc = start("medium", 4, 11);
    doc = at(doc, 9);
    const s = doc.game!.sim;
    const real = s.messages.find((m) => m.sig === s.comms.sig)!;
    const decoy = s.messages.find((m) => m.sig !== s.comms.sig)!;
    expect(real.cipher).toBe(true);
    expect(decoy).toBeDefined();
    expect(real.digits).not.toBe(doc.game!.missions[0].params.code);
    expect(shiftDigits(real.digits, -s.comms.key)).toBe(doc.game!.missions[0].params.code);
    const res = send(doc, 9, { type: "decrypt", message: real.id, key: s.comms.key });
    expect(res.error).toBeUndefined();
    expect(res.doc.game!.sim.messages.find((m) => m.id === real.id)!.decoded!.digits).toBe(doc.game!.missions[0].params.code);
    expect(codeFor(s, "بوابة المفاعل")).toBe(doc.game!.missions[0].params.code);
  });
});

describe("faults, decisions and blackouts", () => {
  it("every one of the seven faults is defined, injectable and needs at least two panels", () => {
    expect(MISSION_IDS).toHaveLength(7);
    for (const id of MISSION_IDS) {
      const def = MISSIONS[id];
      expect(new Set(def.panels).size).toBeGreaterThanOrEqual(2);
      const s = initialSim();
      def.setup(s, params(), { ph: EASY, cipher: false, window: 200, backupWarm: 45 }, () => {});
      expect(def.stable(s, params())).toBe(false);
    }
  });

  it("levels: 3 / 5 / 7 faults in 12 / 10 / 8 minutes, the reactor first", () => {
    for (const [d, n, min] of [["easy", 3, 12], ["medium", 5, 10], ["hard", 7, 8]] as const) {
      const g = start(d).game!;
      expect(g.missions).toHaveLength(n);
      expect(g.totalTicks).toBe(min * 60);
      expect(g.missions[0].id).toBe("reactor");
      expect(new Set(g.missions.map((m) => m.id)).size).toBe(n);
    }
  });

  it("hard: a fault starts while another is still unsolved (simultaneous faults)", () => {
    let doc = start("hard", 4, 3);
    doc.game!.missions[0].status = "done";
    doc.game!.missions[0].doneTick = 1;
    doc = at(doc, 10);
    expect(doc.game!.missions[1].status).toBe("active");
    doc = at(doc, 10 + LEVELS.hard.overlap! + 2);
    const active = doc.game!.missions.filter((m) => m.status === "active");
    expect(active.length).toBe(2);
    const tv = buildOutageHostView(snapshotOf(doc, 4, T0 + (12 + LEVELS.hard.overlap!) * 1000), doc);
    expect(tv.game!.faults).toHaveLength(2);
  });

  it("easy never overlaps faults and never blacks anyone out", () => {
    const doc = at(start("easy", 6), 400, 6);
    const g = doc.game!;
    expect(g.missions.filter((m) => m.status === "active").length).toBeLessThanOrEqual(1);
    expect(g.blackouts).toHaveLength(0);
  });

  it("the leak: sealing keeps the clean bonus, venting is quick but costs O₂ and the bonus", () => {
    const p = params();
    const ctx = { ph: EASY, cipher: false, window: 200, backupWarm: 45 };
    const seal = initialSim();
    MISSIONS.leak.setup(seal, p, ctx, () => {});
    act(seal, { type: "door", door: "B", open: false });
    act(seal, { type: "valve", valve: "B", open: false });
    expect(act(seal, { type: "repair", device: "hullB", procedure: "seal" })).toBeNull();
    run(seal, 6);
    act(seal, { type: "door", door: "B", open: true });
    act(seal, { type: "valve", valve: "B", open: true });
    expect(MISSIONS.leak.stable(seal, p)).toBe(true);
    expect(seal.collapses).toBe(0);

    const vent = initialSim();
    MISSIONS.leak.setup(vent, p, ctx, () => {});
    act(vent, { type: "door", door: "B", open: false });
    const o2 = vent.life.o2;
    expect(act(vent, { type: "purge", section: "B" })).toBeNull();
    expect(MISSIONS.leak.stable(vent, p)).toBe(true);
    expect(vent.life.o2).toBeLessThan(o2);
    expect(vent.collapses).toBe(1);
    expect(act(vent, { type: "door", door: "B", open: true })).toBe("القسم مفصول");
  });

  it("opening the breached section before it's sealed is an error with a real O₂ cost", () => {
    const s = initialSim();
    MISSIONS.leak.setup(s, params(), { ph: EASY, cipher: false, window: 200, backupWarm: 45 }, () => {});
    act(s, { type: "door", door: "B", open: false });
    const o2 = s.life.o2;
    act(s, { type: "door", door: "B", open: true });
    expect(s.errors).toBe(1);
    expect(s.life.o2).toBe(o2 - 4);
  });

  it("medium/hard: blackouts name one connected player for a while; their tools keep working", () => {
    let doc = start("medium", 4, 5);
    // A calm station (faults that can't kill it in this window), so the clock reaches the blackout.
    doc.game!.missions.forEach((m, i) => {
      m.id = i === 0 ? "reactor" : "comms";
      if (i === 0) {
        m.status = "done";
        m.doneTick = 0;
      }
    });
    doc = at(doc, LEVELS.medium.blackout!.first + 1);
    const g = doc.game!;
    expect(g.blackouts).toHaveLength(1);
    const b = g.blackouts[0];
    expect(b.to - b.from).toBe(LEVELS.medium.blackout!.seconds);
    const panel = PANELS.find((p) => g.assignment[p] === b.playerId)!;
    const cmd = anyCommandFor(panel);
    const res = applyCommand(doc, b.playerId, cmd, T0 + (LEVELS.medium.blackout!.first + 1) * 1000);
    expect(res.error ?? "").not.toMatch(/صلاحيات|متوقفة/);
    const view = buildOutageGuestView(snapshotOf(doc, 4, T0 + (LEVELS.medium.blackout!.first + 1) * 1000), doc, b.playerId)!;
    expect(view.game!.blackout).toBeGreaterThan(0);
    doc = at(doc, LEVELS.medium.blackout!.first + LEVELS.medium.blackout!.seconds + 2);
    expect(buildOutageGuestView(snapshotOf(doc, 4), doc, b.playerId)!.game!.blackout).toBeNull();
  });
});

describe("time, failure and success", () => {
  it("time is the server's: polling more or less often never changes the result", () => {
    const a = at(start("medium", 4, 9), 120);
    let b = start("medium", 4, 9);
    for (let s = 1; s <= 120; s += 7) b = at(b, s);
    b = at(b, 120);
    expect(b.game!.sim).toEqual(a.game!.sim);
    expect(b.game!.missions).toEqual(a.game!.missions);
  });

  it("the same seed and the same commands give the same match", () => {
    const play = () => {
      let d = start("hard", 5, 42);
      for (let sec = 2; sec < 200; sec += 3) {
        d = at(d, sec, 5);
        if (d.game!.outcome) break;
        const cmd = nextCommand(d.game!);
        if (cmd) d = send(d, sec, cmd).doc;
      }
      return d.game!;
    };
    expect(play()).toEqual(play());
  });

  it("an unattended reactor melts down — a clear, explained failure", () => {
    const doc = at(start("easy", 4), 400);
    const g = doc.game!;
    expect(g.outcome).toBe("failed");
    expect(g.reason).toBe("انصهار المفاعل");
    expect(g.score!.grade).toBe("F");
  });

  it("running out of time fails the mission", () => {
    let doc = start("easy", 4);
    // Keep the station alive but never finish a fault.
    doc.game!.missions.forEach((m) => (m.status = "done"));
    doc.game!.missions[2].status = "waiting";
    doc.game!.missions[2].id = "comms";
    for (let s = 5; s <= 725; s += 20) doc = at(doc, s);
    const g = doc.game!;
    expect(g.outcome).toBe("failed");
    expect(["انتهى الوقت", "انقطع الاتصال بالقيادة نهائيًا"]).toContain(g.reason);
  });

  it("a command that lands after the end is refused", () => {
    let doc = at(start("easy", 4), 400);
    const res = send(doc, 401, { type: "pump", on: true });
    expect(res.error).toBe("انتهت المهمة");
    doc = res.doc;
    expect(doc.game!.outcome).toBe("failed");
  });

  it("pause freezes the station and the clock; commands wait", () => {
    let doc = at(start("easy", 4), 10);
    doc = applyHostMove(doc, { type: "pause" }, T0 + 10_000).doc;
    const frozen = doc.game!.sim;
    doc = at(doc, 70);
    expect(doc.game!.sim).toEqual(frozen);
    expect(send(doc, 70, { type: "pump", on: true }).error).toBe("اللعبة متوقفة");
    doc = applyHostMove(doc, { type: "resume" }, T0 + 70_000).doc;
    doc = at(doc, 80);
    expect(doc.game!.sim.t).toBe(20);
  });

  it("a crew below two connected players holds the station until someone is back", () => {
    let doc = start("easy", 3);
    const now = T0 + 40_000;
    const roster = rosterOf(3);
    doc = touch(doc, "p0", now);
    doc = advance(doc, now, roster);
    expect(doc.game!.held).toBe(true);
    const t = doc.game!.sim.t;
    doc = advance(doc, now + 30_000, roster);
    expect(doc.game!.sim.t).toBe(t);
    doc = touch(touch(doc, "p1", now + 30_000), "p0", now + 30_000);
    doc = advance(doc, now + 30_000, roster);
    expect(doc.game!.held).toBe(false);
  });

  it("the scripted crew saves the station on easy and medium with 3, 6 and 8 players", () => {
    for (const d of ["easy", "medium"] as const) {
      for (const n of [3, 6, 8]) {
        const g = crewPlays(d, n, 2026 + n, 3);
        expect(g.outcome, `${d} ${n}`).toBe("success");
        expect(g.score!.completed).toBe(g.missions.length);
        expect(["S", "A", "B", "C"]).toContain(g.score!.grade);
      }
    }
  });

  it("two faults can complete on the same second", () => {
    let doc = start("hard", 4, 3);
    const g = doc.game!;
    g.missions[0].status = "done";
    g.missions[0].doneTick = 0;
    g.missions[1] = { ...g.missions[1], id: "comms", status: "active", startTick: 1, held: 1 };
    g.missions[2] = { ...g.missions[2], id: "oxygen", status: "active", startTick: 1, held: 2 };
    g.sim.comms.confirmed = true;
    g.sim.life.o2 = 90;
    doc = at(doc, 1);
    expect(doc.game!.missions[1].status).toBe("done");
    expect(doc.game!.missions[2].status).toBe("done");
    expect(doc.game!.missions[1].doneTick).toBe(doc.game!.missions[2].doneTick);
  });
});

describe("score", () => {
  const finished = (over: Partial<OutageGame>, errors = 0, collapses = 0): OutageGame => {
    const g = start("easy").game!;
    Object.assign(g, over);
    g.sim.errors = errors;
    g.sim.collapses = collapses;
    return g;
  };

  it("1000 per fault, 10 per second left, −150 per error, +500 for no collapse", () => {
    const g = finished({ outcome: "success" }, 2, 0);
    g.missions.forEach((m) => (m.status = "done"));
    g.sim.t = 300;
    const sc = scoreOf(g);
    expect(sc.points).toEqual({ missions: 3000, time: (720 - 300) * 10, errors: -300, clean: 500 });
    expect(sc.score).toBe(3000 + 4200 - 300 + 500);
  });

  it("never negative; failure is F and earns no time or bonus", () => {
    const g = finished({ outcome: "failed" }, 40, 3);
    g.sim.t = 100;
    const sc = scoreOf(g);
    expect(sc.score).toBe(0);
    expect(sc.grade).toBe("F");
    expect(sc.points.time).toBe(0);
  });

  it("grades are fractions of each level's maximum, so they are fair across levels", () => {
    for (const d of ["easy", "medium", "hard"] as const) {
      const l = LEVELS[d];
      expect(maxScore(l)).toBe(l.missions * POINTS.mission + l.seconds * POINTS.second + POINTS.clean);
    }
    expect(GRADES.map((x) => x.grade)).toEqual(["S", "A", "B"]);
    const g = finished({ outcome: "success" });
    g.missions.forEach((m) => (m.status = "done"));
    g.sim.t = 720;
    g.sim.errors = 3;
    expect(scoreOf(g).grade).toBe("C");
  });
});

describe("lobby", () => {
  it("difficulty defaults to easy and is chosen before the start only", () => {
    expect(newDoc().settings.difficulty).toBe("easy");
    const d = applySettings(newDoc(), { difficulty: "hard" }).doc;
    expect(d.settings.difficulty).toBe("hard");
    const running = startGame(d, players(3), T0, 1).doc;
    expect(applySettings(running, { difficulty: "easy" }).error).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */

function crewPlays(d: Difficulty, n: number, seed: number, every: number): OutageGame {
  let doc = start(d, n, seed);
  for (let sec = every; sec < LEVELS[d].seconds + 5; sec += every) {
    doc = at(doc, sec, n);
    if (doc.game!.outcome) break;
    const cmd = nextCommand(doc.game!);
    if (cmd) doc = send(doc, sec, cmd).doc;
  }
  return doc.game!;
}

function anyCommandFor(panel: PanelId): Command {
  const byPanel: Record<PanelId, Command> = {
    breakers: { type: "backup", on: false },
    grid: { type: "alloc", sys: "life", value: 30 },
    cooling: { type: "pumpPower", value: 50 },
    doors: { type: "door", door: "A", open: true },
    valves: { type: "valve", valve: "A", open: true },
    comms: { type: "tune", freq: 42 },
    monitor: { type: "calibrate", section: "A" },
    maint: { type: "refill" },
  };
  return byPanel[panel];
}

function snapshotOf(doc: OutageDoc, n: number, now = T0 + (doc.game?.sim.t ?? 0) * 1000): Snapshot {
  return {
    now: new Date(now).toISOString(),
    session: {
      id: "s1",
      code: "1234",
      status: "PLAYING",
      current_index: 0,
      total_questions: 0,
      host_token_hash: "h",
      game_id: null,
      config: {} as Snapshot["session"]["config"],
      created_at: new Date(T0).toISOString(),
      kind: "outage",
      match: doc,
      match_version: 1,
    },
    players: players(n).map((p) => ({ id: p.id, person_id: null, display_name: p.name, token_hash: "t" })),
    rounds: [],
    answers: [],
  } as unknown as Snapshot;
}
