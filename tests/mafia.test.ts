import { describe, expect, it } from "vitest";
import {
  advance,
  applyHostMove,
  applyPlayerMove,
  createMatch,
  resolveNight,
  type Rng,
} from "@/lib/mafia/engine";
import { IDLE_NIGHT_SECONDS, roleCounts, SECONDS, SETTLE_MS, type Role } from "@/lib/mafia/rules";
import type { MafiaMatch, Phase, PlayerMove } from "@/lib/mafia/types";
import { buildMafiaGuestView, buildMafiaHostView } from "@/lib/mafia/views";
import { cue } from "@/lib/mafia/narration";
import type { Snapshot } from "@/lib/types";

const T0 = 1_700_000_000_000;
const first: Rng = () => 0;
const last: Rng = () => 0.999;

/** A match with fixed roles (p1, p2, … in order), placed in `phase`. */
function table(roles: Role[], phase: Phase = "mafia", now = T0): MafiaMatch {
  const created = createMatch(roles.map((_, i) => ({ id: `p${i + 1}`, name: `لاعب ${i + 1}` })), now, first);
  const m = created.state!;
  return {
    ...m,
    phase,
    phaseStartedAt: now,
    deadline: now + 30_000,
    players: m.players.map((p, i) => ({ ...p, role: roles[i] })),
  };
}

function move(m: MafiaMatch, playerId: string, mv: PlayerMove, now = T0 + 1000): MafiaMatch {
  const res = applyPlayerMove(m, playerId, mv, now);
  if (res.error) throw new Error(`${playerId} ${JSON.stringify(mv)} → ${res.error}`);
  return res.state;
}

const night = (m: MafiaMatch, phase: "mafia" | "detective" | "doctor", targetId: string) =>
  ({ type: "night", phase, round: m.round, targetId }) as const;

/** Runs the clock past the current phase. */
const pass = (m: MafiaMatch, rng: Rng = first) => advance(m, m.deadline!, rng);

const alive = (m: MafiaMatch, id: string) => m.players.find((p) => p.id === id)!.alive;

// p1 mafia, p2 detective, p3 doctor, p4–p6 citizens
const SIX: Role[] = ["mafia", "detective", "doctor", "citizen", "citizen", "citizen"];

describe("setup", () => {
  it("deals the approved table for 4–12 players, one detective and one doctor", () => {
    const expected: Record<number, number> = { 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 2, 11: 3, 12: 3 };
    for (let n = 4; n <= 12; n++) {
      const { state } = createMatch(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `n${i}` })), T0);
      const count = (r: Role) => state!.players.filter((p) => p.role === r).length;
      expect(count("mafia")).toBe(expected[n]);
      expect(count("detective")).toBe(1);
      expect(count("doctor")).toBe(1);
      expect(count("citizen")).toBe(n - expected[n] - 2);
      expect(roleCounts(n)).toEqual({ mafia: expected[n], detective: 1, doctor: 1, citizen: n - expected[n] - 2 });
    }
  });

  it("refuses fewer than 4 or more than 12 players", () => {
    const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `n${i}` }));
    expect(createMatch(players(3), T0).error).toBeTruthy();
    expect(createMatch(players(13), T0).error).toBeTruthy();
  });

  it("shuffles roles (not always the same seat for the mafia)", () => {
    const seats = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const { state } = createMatch(Array.from({ length: 6 }, (_, j) => ({ id: `p${j}`, name: `n${j}` })), T0);
      seats.add(state!.players.findIndex((p) => p.role === "mafia"));
    }
    expect(seats.size).toBeGreaterThan(2);
  });

  it("runs intro → role reveal → nightfall → mafia on the clock", () => {
    let m = createMatch(Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `n${i}` })), T0).state!;
    expect(m.phase).toBe("intro");
    m = pass(m);
    expect(m.phase).toBe("roleReveal");
    m = pass(m);
    expect(m.phase).toBe("nightfall");
    m = pass(m);
    expect(m.phase).toBe("mafia");
    expect(m.deadline! - m.phaseStartedAt).toBe(SECONDS.mafia * 1000);
  });

  it("plays the intro for exactly 10 seconds: no skipping, pausing or acting during it", () => {
    let m = createMatch(Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `n${i}` })), T0).state!;
    expect(m.deadline).toBe(T0 + 10_000);
    expect(applyHostMove(m, { type: "skipReveal" }, T0 + 1000).state).toBe(m);
    expect(applyHostMove(m, { type: "pause" }, T0 + 1000).state).toBe(m);
    expect(applyPlayerMove(m, "p0", { type: "seeRole" }, T0 + 1000).error).toBe("MF_INTRO");
    expect(applyPlayerMove(m, "p0", { type: "vote", round: 1, choice: "skip" }, T0 + 1000).error).toBe("MF_INTRO");
    expect(advance(m, T0 + 9_999).phase).toBe("intro");
    m = advance(m, T0 + 10_000);
    expect(m.phase).toBe("roleReveal");
    expect(applyPlayerMove(m, "p0", { type: "seeRole" }, T0 + 10_500).error).toBeUndefined();
  });

  it("sends no role to any phone during the intro", () => {
    const m = createMatch(Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `n${i}` })), T0).state!;
    const snap = snapshotOf(m);
    for (const p of m.players) {
      const v = buildMafiaGuestView(snap, m, p.id)!;
      expect(v.seated).toBe(true);
      expect(v.secret).toBeNull();
      expect(JSON.stringify(v)).not.toMatch(/"role":"(mafia|detective|doctor|citizen)"/);
    }
  });

  it("ends the role reveal early once everyone has looked (after the settle)", () => {
    let m = table(SIX, "roleReveal");
    for (const p of m.players) m = move(m, p.id, { type: "seeRole" }, T0 + 2000);
    expect(advance(m, T0 + 2000 + SETTLE_MS - 1).phase).toBe("roleReveal");
    expect(advance(m, T0 + 2000 + SETTLE_MS).phase).toBe("nightfall");
  });
});

describe("night", () => {
  it("kills the mafia's majority pick", () => {
    // 11 players: p1–p3 mafia.
    const roles: Role[] = ["mafia", "mafia", "mafia", "detective", "doctor", ...Array<Role>(6).fill("citizen")];
    let m = table(roles);
    m = move(m, "p1", night(m, "mafia", "p6"));
    m = move(m, "p2", night(m, "mafia", "p6"));
    m = move(m, "p3", night(m, "mafia", "p7"));
    const r = resolveNight(m, first);
    expect(r.dawn).toEqual({ outcome: "killed", victimId: "p6", role: "citizen" });
    expect(alive(r, "p6")).toBe(false);
    expect(alive(r, "p7")).toBe(true);
  });

  it("breaks a tie between the top picks at random (either can die)", () => {
    const roles: Role[] = ["mafia", "mafia", "detective", "doctor", "citizen", "citizen", "citizen"];
    let m = table(roles);
    m = move(m, "p1", night(m, "mafia", "p5"));
    m = move(m, "p2", night(m, "mafia", "p6"));
    const a = resolveNight(m, first).dawn!.victimId;
    const b = resolveNight(m, last).dawn!.victimId;
    expect(new Set([a, b])).toEqual(new Set(["p5", "p6"]));
  });

  it("no mafia vote = no assassination", () => {
    const r = resolveNight(table(SIX), first);
    expect(r.dawn).toEqual({ outcome: "quiet", victimId: null, role: null });
    expect(r.players.every((p) => p.alive)).toBe(true);
  });

  it("lets a mafia member change the target until the phase closes", () => {
    let m = table(SIX);
    m = move(m, "p1", night(m, "mafia", "p4"));
    m = move(m, "p1", night(m, "mafia", "p5"));
    expect(resolveNight(m, first).dawn!.victimId).toBe("p5");
  });

  it("checks who may act, on whom, and when", () => {
    const m = table(SIX);
    const err = (id: string, mv: PlayerMove, now = T0 + 1000) => applyPlayerMove(m, id, mv, now).error;
    expect(err("p4", night(m, "mafia", "p5"))).toBe("MF_NOT_YOURS"); // a citizen
    expect(err("p1", night(m, "mafia", "p1"))).toBe("MF_TARGET"); // mafia on mafia
    expect(err("p1", night(m, "mafia", "nobody"))).toBe("MF_TARGET");
    expect(err("p1", { ...night(m, "mafia", "p4"), round: 2 })).toBe("MF_CLOSED"); // late packet
    expect(err("p1", night(m, "mafia", "p4"), m.deadline!)).toBe("MF_CLOSED"); // after the deadline
    expect(err("p2", night(m, "detective", "p1"))).toBe("MF_CLOSED"); // not the detective's phase
    expect(err("x", night(m, "mafia", "p4"))).toBe("NOT_A_PLAYER");
    const dead = { ...m, players: m.players.map((p) => (p.id === "p1" ? { ...p, alive: false } : p)) };
    expect(applyPlayerMove(dead, "p1", night(m, "mafia", "p4"), T0 + 1000).error).toBe("MF_DEAD");
  });

  it("treats a repeated submission as a no-op", () => {
    const m = move(table(SIX), "p1", night(table(SIX), "mafia", "p4"));
    expect(applyPlayerMove(m, "p1", night(m, "mafia", "p4"), T0 + 2000).state).toBe(m);
  });

  it("detective sees the exact role, once per night, and may re-investigate later", () => {
    let m = table(SIX, "detective");
    m = move(m, "p2", night(m, "detective", "p1"));
    expect(m.investigations).toEqual([{ round: 1, targetId: "p1", role: "mafia" }]);
    expect(applyPlayerMove(m, "p2", night(m, "detective", "p3"), T0 + 2000).error).toBe("MF_LOCKED");
    expect(applyPlayerMove(m, "p2", night(m, "detective", "p2"), T0 + 2000).error).toBe("MF_TARGET"); // not self
    // Next night: same person again.
    let n2: MafiaMatch = { ...m, round: 2, night: { mafiaVotes: {}, detectiveTargetId: null, doctorTargetId: null } };
    n2 = move(n2, "p2", night(n2, "detective", "p1"));
    expect(n2.investigations.map((i) => i.targetId)).toEqual(["p1", "p1"]);
  });

  it("doctor saves the target, may protect themselves, never the same person twice", () => {
    let m = table(SIX);
    m = move(m, "p1", night(m, "mafia", "p4"));
    m = { ...m, phase: "doctor" };
    m = move(m, "p3", night(m, "doctor", "p4"));
    const r = resolveNight(m, first);
    expect(r.dawn).toEqual({ outcome: "saved", victimId: "p4", role: null });
    expect(alive(r, "p4")).toBe(true);
    expect(r.doctorHistory).toEqual(["p4"]);

    const next: MafiaMatch = { ...r, round: 2, phase: "doctor", night: { mafiaVotes: {}, detectiveTargetId: null, doctorTargetId: null } };
    expect(applyPlayerMove(next, "p3", night(next, "doctor", "p4"), T0 + 1000).error).toBe("MF_TARGET");
    expect(applyPlayerMove(next, "p3", night(next, "doctor", "p3"), T0 + 1000).error).toBeUndefined();
  });

  it("no doctor choice = no protection", () => {
    let m = table(SIX);
    m = move(m, "p1", night(m, "mafia", "p4"));
    expect(resolveNight(m, first).dawn!.outcome).toBe("killed");
  });

  it("detective and doctor killed the same night still acted that night", () => {
    // Mafia kills the detective; the detective's finding stays.
    let m = table(SIX);
    m = move(m, "p1", night(m, "mafia", "p2"));
    m = pass(m);
    expect(m.phase).toBe("detective");
    m = move(m, "p2", night(m, "detective", "p1"), m.phaseStartedAt + 1000);
    m = pass(m);
    expect(m.phase).toBe("doctor");
    m = pass(m);
    expect(m.phase).toBe("dawn");
    expect(m.dawn).toMatchObject({ outcome: "killed", victimId: "p2", role: "detective" });
    expect(m.investigations).toEqual([{ round: 1, targetId: "p1", role: "mafia" }]);

    // Mafia targets the doctor, who protected themselves: saved.
    let d = table(SIX);
    d = move(d, "p1", night(d, "mafia", "p3"));
    d = { ...d, phase: "doctor" };
    d = move(d, "p3", night(d, "doctor", "p3"));
    expect(resolveNight(d, first).dawn!.outcome).toBe("saved");
  });

  it("still runs the phase of a role that is out (or a doctor with nobody to protect), for a plausible time", () => {
    let m = table(SIX, "verdict");
    m = { ...m, players: m.players.map((p) => (p.id === "p2" ? { ...p, alive: false } : p)) };
    m = pass(m); // → nightfall
    m = pass(m); // → mafia
    expect(m.phase).toBe("mafia");
    for (const rng of [first, last]) {
      const d = pass(m, rng);
      expect(d.phase).toBe("detective"); // the detective is out, but nobody can tell
      const secs = (d.deadline! - d.phaseStartedAt) / 1000;
      expect(secs).toBeGreaterThanOrEqual(IDLE_NIGHT_SECONDS[0]);
      expect(secs).toBeLessThanOrEqual(IDLE_NIGHT_SECONDS[1]);
      // Nothing closes it early, and it moves on at its deadline.
      expect(advance(d, d.deadline! - 1).phase).toBe("detective");
      expect(pass(d).phase).toBe("doctor");
    }

    let n = table(["mafia", "detective", "doctor", "citizen"], "detective");
    n = { ...n, doctorHistory: ["p1", "p2", "p3", "p4"] };
    n = pass(n);
    expect(n.phase).toBe("doctor");
    expect(buildMafiaGuestView(snapshotOf(n), n, "p3")!.secret!.task!.targets).toEqual([]);
    n = pass(n);
    expect(n.phase).toBe("dawn");
  });

  it("closes a night phase early once everyone acted and settled, never mid-change", () => {
    let m = table(SIX);
    m = move(m, "p1", night(m, "mafia", "p4"), T0 + 3000);
    expect(advance(m, T0 + 3000 + SETTLE_MS - 1).phase).toBe("mafia");
    expect(advance(m, T0 + 3000 + SETTLE_MS).phase).toBe("detective");
  });

  it("checks victory only after the doctor, and announces the dawn before the end", () => {
    // 4 players: mafia + 2 others alive after the kill → not over; mafia 1 vs 1 → over.
    let m = table(["mafia", "detective", "doctor", "citizen"], "mafia");
    m = { ...m, players: m.players.map((p) => (p.id === "p4" ? { ...p, alive: false } : p)) };
    m = move(m, "p1", night(m, "mafia", "p2"));
    m = pass(m); // detective
    m = pass(m); // doctor
    expect(m.phase).toBe("doctor");
    expect(m.winner).toBeNull();
    m = pass(m);
    expect(m.phase).toBe("dawn");
    expect(m.winner?.team).toBe("mafia");
    m = pass(m);
    expect(m.phase).toBe("gameOver");
    expect(advance(m, m.phaseStartedAt + 3_600_000)).toBe(m);
  });
});

describe("day", () => {
  function day(roles: Role[] = SIX): MafiaMatch {
    return table(roles, "voting");
  }

  it("discussion lasts exactly 90 seconds", () => {
    const m = { ...table(SIX, "discussion"), deadline: T0 + SECONDS.discussion * 1000 };
    expect(advance(m, T0 + 89_999).phase).toBe("discussion");
    expect(advance(m, T0 + 90_000).phase).toBe("voting");
  });

  it("closes the vote as soon as every living player voted", () => {
    let m = day();
    for (const id of ["p2", "p3", "p4", "p5", "p6"]) m = advance(move(m, id, { type: "vote", round: 1, choice: "p1" }), T0 + 1000);
    expect(m.phase).toBe("voting");
    m = advance(move(m, "p1", { type: "vote", round: 1, choice: "skip" }), T0 + 1000);
    expect(m.phase).toBe("verdict");
    expect(m.verdict).toMatchObject({ outcome: "eliminated", targetId: "p1", role: "mafia" });
    expect(m.winner?.team).toBe("citizens");
    m = pass(m);
    expect(m.phase).toBe("gameOver");
  });

  it("counts missing votes as skip on timeout", () => {
    let m = day();
    m = move(m, "p2", { type: "vote", round: 1, choice: "p4" });
    m = move(m, "p3", { type: "vote", round: 1, choice: "p4" });
    m = pass(m);
    expect(m.verdict).toMatchObject({ outcome: "skip", targetId: null });
    expect(m.verdict!.tally[0]).toEqual({ option: "skip", count: 4 });
    expect(m.players.every((p) => p.alive)).toBe(true);
  });

  it("a tie for the most votes eliminates nobody (including a tie with skip)", () => {
    let m = day();
    for (const [v, c] of [["p1", "p4"], ["p2", "p4"], ["p3", "p5"], ["p4", "p5"], ["p5", "skip"], ["p6", "skip"]] as const) {
      m = move(m, v, { type: "vote", round: 1, choice: c });
    }
    m = advance(m, T0 + 1000);
    expect(m.verdict!.outcome).toBe("tie");
    expect(m.players.every((p) => p.alive)).toBe(true);
  });

  it("refuses self-votes, votes from players who are out, and votes for them", () => {
    let m = day();
    expect(applyPlayerMove(m, "p4", { type: "vote", round: 1, choice: "p4" }, T0 + 1000).error).toBe("MF_TARGET");
    m = { ...m, players: m.players.map((p) => (p.id === "p5" ? { ...p, alive: false } : p)) };
    expect(applyPlayerMove(m, "p5", { type: "vote", round: 1, choice: "p4" }, T0 + 1000).error).toBe("MF_DEAD");
    expect(applyPlayerMove(m, "p4", { type: "vote", round: 1, choice: "p5" }, T0 + 1000).error).toBe("MF_TARGET");
  });

  it("after a verdict without a winner, the next night starts fresh", () => {
    let m = day();
    m = pass(m); // all skip
    m = pass(m);
    expect(m.phase).toBe("nightfall");
    expect(m.round).toBe(2);
    expect(m.night).toEqual({ mafiaVotes: {}, detectiveTargetId: null, doctorTargetId: null });
    expect(m.votes).toEqual({});
  });
});

describe("host pause", () => {
  it("freezes the clock and refuses moves until resumed", () => {
    let m = table(SIX); // 30s mafia phase from T0
    m = applyHostMove(m, { type: "pause" }, T0 + 10_000).state!;
    expect(m.deadline).toBeNull();
    expect(m.paused).toEqual({ remaining: 20_000 });
    expect(advance(m, T0 + 600_000)).toBe(m);
    expect(applyPlayerMove(m, "p1", night(m, "mafia", "p4"), T0 + 11_000).error).toBe("MF_PAUSED");
    m = applyHostMove(m, { type: "resume" }, T0 + 100_000).state!;
    expect(m.deadline).toBe(T0 + 120_000);
    expect(advance(m, T0 + 119_999).phase).toBe("mafia");
    expect(advance(m, T0 + 120_000).phase).toBe("detective");
  });
});

/* ------------------------------------------------------------------ */
/* Secret isolation                                                    */
/* ------------------------------------------------------------------ */

function snapshotOf(m: MafiaMatch): Snapshot {
  return {
    now: new Date(T0).toISOString(),
    session: {
      id: "s1",
      code: "1234",
      status: "QUESTION",
      current_index: -1,
      total_questions: 0,
      host_token_hash: "h",
      game_id: null,
      config: {} as Snapshot["session"]["config"],
      created_at: new Date(T0).toISOString(),
      kind: "mafia",
      match: m,
      match_version: 3,
    },
    players: m.players.map((p) => ({ id: p.id, display_name: p.name, person_id: null, token_hash: `t-${p.id}` })),
    rounds: [],
    answers: [],
  };
}

describe("views never leak secrets", () => {
  // 7 players: p1, p2 mafia; p3 detective; p4 doctor; p5–p7 citizens.
  const SEVEN: Role[] = ["mafia", "mafia", "detective", "doctor", "citizen", "citizen", "citizen"];
  let m = table(SEVEN);
  m = move(m, "p1", night(m, "mafia", "p5"));
  m = { ...m, investigations: [{ round: 1, targetId: "p2", role: "mafia" }], night: { ...m.night, detectiveTargetId: "p2", doctorTargetId: "p6" }, doctorHistory: ["p7"] };
  const snap = snapshotOf(m);

  it("the TV sees no living player's role, no night picks, no ballots", () => {
    const view = buildMafiaHostView(snap, m);
    expect(view.match!.players.every((p) => p.role === null)).toBe(true);
    const json = JSON.stringify(view);
    for (const secret of ['"mafiaVotes"', '"investigations"', '"doctorHistory"', '"detectiveTargetId"', '"doctorTargetId"', '"votes"', '"roleSeen"']) {
      expect(json).not.toContain(secret);
    }
    expect(json).not.toContain('"role":"mafia"');
  });

  it("a citizen gets only their own role", () => {
    const v = buildMafiaGuestView(snap, m, "p6")!;
    expect(v.secret).toMatchObject({ role: "citizen", teammates: [], investigations: [], task: null });
    expect(v.match!.players.every((p) => p.role === null)).toBe(true);
    expect(JSON.stringify(v)).not.toContain('"role":"mafia"');
  });

  it("the mafia see their teammates and their picks; the detective and doctor see only their own", () => {
    const mafia = buildMafiaGuestView(snap, m, "p2")!;
    expect(mafia.secret!.teammates).toEqual([{ id: "p1", name: "لاعب 1", alive: true }]);
    expect(mafia.secret!.task!.team).toEqual([{ playerId: "p1", name: "لاعب 1", targetId: "p5" }]);
    expect(mafia.secret!.task!.targets.map((t) => t.id)).not.toContain("p1");

    const det = buildMafiaGuestView(snap, m, "p3")!;
    expect(det.secret!.investigations).toEqual([{ round: 1, targetId: "p2", name: "لاعب 2", role: "mafia" }]);
    expect(det.secret!.teammates).toEqual([]);
    expect(det.secret!.task).toBeNull(); // not the detective's phase

    const doctorPhase = { ...m, phase: "doctor" as const };
    const doc = buildMafiaGuestView(snapshotOf(doctorPhase), doctorPhase, "p4")!;
    expect(doc.secret!.task!.blocked.map((b) => b.id)).toEqual(["p7"]);
    expect(doc.secret!.task!.choice).toBe("p6");
    expect(JSON.stringify(doc)).not.toContain('"mafiaVotes"');
  });

  it("never reveals the role of a player voted out (until the end)", () => {
    let v = table(SEVEN, "voting");
    for (const id of ["p2", "p3", "p4", "p5", "p6", "p7"]) v = move(v, id, { type: "vote", round: 1, choice: "p1" });
    v = pass(v); // p1's missing vote counts as skip
    expect(v.verdict).toMatchObject({ outcome: "eliminated", targetId: "p1" });
    expect(v.phase).toBe("verdict");
    for (const view of [buildMafiaHostView(snapshotOf(v), v), buildMafiaGuestView(snapshotOf(v), v, "p5")!]) {
      expect(view.match!.verdict!.role).toBeNull();
      expect(view.match!.players.find((p) => p.id === "p1")!.role).toBeNull();
      expect(JSON.stringify(view.match)).not.toContain('"role":"mafia"');
    }
    expect(cue("verdict_eliminated", "فهد").text).not.toMatch(/قاتل|مواطن|الطبيب|الشايب/);
    // The player themself still knows.
    expect(buildMafiaGuestView(snapshotOf(v), v, "p1")!.secret!.role).toBe("mafia");
  });

  // SEVEN: p1, p2 mafia; p3 detective; p4 doctor.
  for (const [victim, role] of [["p3", "detective"], ["p4", "doctor"], ["p5", "citizen"]] as const) {
    it(`never reveals the role of a ${role} killed at night (until the end)`, () => {
      let n = table(SEVEN, "mafia");
      n = move(n, "p1", night(n, "mafia", victim));
      n = move(n, "p2", night(n, "mafia", victim));
      n = pass(n); // detective
      n = pass(n); // doctor
      n = pass(n); // dawn
      expect(n.phase).toBe("dawn");
      expect(n.dawn).toEqual({ outcome: "killed", victimId: victim, role }); // the engine still knows
      for (const view of [buildMafiaHostView(snapshotOf(n), n), buildMafiaGuestView(snapshotOf(n), n, "p6")!]) {
        expect(view.match!.dawn).toEqual({ outcome: "killed", victimId: victim, role: null });
        expect(view.match!.players.every((p) => p.role === null)).toBe(true);
        expect(JSON.stringify(view.match)).not.toMatch(/"role":"(mafia|detective|doctor|citizen)"/);
      }
      expect(cue("dawn_killed", "فهد").text).not.toMatch(/قاتل|مواطن|الطبيب|الشايب/);
    });
  }

  it("never reveals the role of a mafia member who is out, and keeps the victory count right", () => {
    // p1 (mafia) voted out on day 1, p2 (mafia) still in: the game goes on.
    let v = table(SEVEN, "voting");
    for (const id of ["p2", "p3", "p4", "p5", "p6", "p7"]) v = move(v, id, { type: "vote", round: 1, choice: "p1" });
    v = pass(v);
    expect(v.winner).toBeNull();
    const tv = buildMafiaHostView(snapshotOf(v), v);
    expect(JSON.stringify(tv)).not.toMatch(/"role":"(mafia|detective|doctor|citizen)"/);
    // p2 voted out next: no mafia left, the city wins, and only now every role shows.
    v = { ...v, phase: "voting", votes: {} };
    for (const id of ["p3", "p4", "p5", "p6", "p7"]) v = move(v, id, { type: "vote", round: 1, choice: "p2" });
    v = pass(v);
    expect(v.winner?.team).toBe("citizens");
    expect(buildMafiaHostView(snapshotOf(v), v).match!.verdict!.role).toBeNull();
    v = pass(v);
    expect(v.phase).toBe("gameOver");
    const end = buildMafiaHostView(snapshotOf(v), v).match!;
    expect(end.players.map((p) => p.role)).toEqual(SEVEN);
    expect(end.verdict!.role).toBe("mafia");
    expect(end.winner?.team).toBe("citizens");
  });

  it("reveals every role at the end only", () => {
    const out = { ...m, players: m.players.map((p) => (p.id === "p5" ? { ...p, alive: false, out: { round: 1, by: "night" as const } } : p)) };
    const tv = buildMafiaHostView(snapshotOf(out), out);
    expect(tv.match!.players.every((p) => p.role === null)).toBe(true);
    const over = { ...out, phase: "gameOver" as const };
    expect(buildMafiaHostView(snapshotOf(over), over).match!.players.map((p) => p.role)).toEqual(SEVEN);
  });

  it("voting progress is a count, never who voted for whom", () => {
    let v = table(SEVEN, "voting");
    v = move(v, "p5", { type: "vote", round: 1, choice: "p1" });
    const tv = buildMafiaHostView(snapshotOf(v), v);
    expect(tv.match!.votedCount).toBe(1);
    expect(JSON.stringify(tv)).not.toContain('"p5":"p1"');
    const p6 = buildMafiaGuestView(snapshotOf(v), v, "p6")!;
    expect(p6.secret!.task!.choice).toBeNull();
    expect(p6.secret!.task!.targets.map((t) => t.id)).not.toContain("p6");
  });
});

describe("narration", () => {
  it("names the player where the moment calls for it, never a role", () => {
    expect(cue("dawn_killed", "فهد").text).toBe("القتلة اختاروا فهد... وللأسف، انتهت لعبته.");
    expect(cue("dawn_saved", "فهد").text).toBe("القتلة حاولوا يتخلصون من فهد... لكن المحاولة فشلت.");
    expect(cue("verdict_eliminated", "خالد").text).toBe("تم استبعاد خالد من اللعبة.");
    expect(cue("dawn_quiet").text).toBe("عدّت الليلة على خير... وما فقدنا أحد.");
    expect(cue("mafia").text).toBe("الحين دور القتلة... الباقين يغمّضون عيونهم.");
    expect(cue("detective").text).toBe("الحين دور الشايب... الباقين يغمّضون عيونهم.");
    expect(cue("doctor").text).toBe("الحين دور الطبيب... الباقين يغمّضون عيونهم.");
    expect(cue("night").text).toBe("حلّ الليل... والكل يغمّض عيونه.");
    expect(cue("dawn").text).toBe("طلع الصبح... افتحوا عيونكم.");
    expect(cue("discussion").text).toBe("الحين عندكم دقيقة ونص تتناقشون... حاولوا تعرفون مين القاتل.");
    expect(cue("voting").text).toBe("انتهى وقت النقاش... الحين وقت التصويت.");
    // A name on a line that has none is ignored.
    expect(cue("mafia", "فهد").text).not.toContain("فهد");
  });
});
