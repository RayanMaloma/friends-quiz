import { describe, expect, it } from "vitest";
import { CASES } from "@/lib/court/cases";
import {
  advance,
  applyHostMove,
  applyPlayerMove,
  applySettings,
  GRACE_MS,
  newDoc,
  PHASE_MS,
  POINTS,
  startGame,
  standings,
  winners,
  type CourtDoc,
  type CourtGame,
  type Phase,
  type RosterEntry,
  type Rng,
} from "@/lib/court/engine";
import { buildCourtGuestView, buildCourtHostView, fill } from "@/lib/court/views";
import type { Snapshot } from "@/lib/types";

/** Deterministic random numbers (mulberry32). */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const roster = (n: number): RosterEntry[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `لاعب ${i}`, active: true, present: true }));

function started(n = 5, cases = 3, seed = 1): { doc: CourtDoc; r: RosterEntry[] } {
  const r = roster(n);
  const lobby = applySettings(newDoc(), { cases }).doc!;
  const res = startGame(lobby, r, 0, CASES, seeded(seed));
  expect(res.error).toBeUndefined();
  return { doc: res.doc!, r };
}

const game = (d: CourtDoc) => d.game as CourtGame;

/** Runs the clock to the start of `phase` (no votes). */
function runTo(doc: CourtDoc, r: RosterEntry[], phase: Phase, rng: Rng = seeded(9)): CourtDoc {
  let d = doc;
  for (let i = 0; i < 30 && game(d).phase !== phase; i++) {
    const g = game(d);
    if (g.phaseMs === null) {
      const res = applyHostMove(d, { type: "next", phase: g.phase, case: g.case.index }, g.phaseStartedAt + 1, r, CASES, rng);
      d = res.doc!;
    } else {
      d = advance(d, g.phaseStartedAt + g.phaseMs, r, CASES, rng);
    }
  }
  expect(game(d).phase).toBe(phase);
  return d;
}

const caseData = (d: CourtDoc) => CASES.find((c) => c.id === game(d).case.caseId)!;

describe("case content", () => {
  it("has five complete, distinct cases mixing guilty and innocent", () => {
    expect(CASES).toHaveLength(5);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(5);
    expect(new Set(CASES.map((c) => c.title)).size).toBe(5);
    const guilty = CASES.filter((c) => c.guilty).length;
    expect(guilty).toBeGreaterThanOrEqual(2);
    expect(5 - guilty).toBeGreaterThanOrEqual(2);
    for (const c of CASES) {
      for (const s of [c.title, c.summary, c.accusedSecret, c.lawyerInfo, c.prosecutorInfo, c.explanation]) expect(s.trim().length).toBeGreaterThan(3);
      expect(c.summary).toContain("{accused}");
      expect(c.evidence).toHaveLength(3);
      // Each case has one exhibit of each class, at least one objection that holds and one that does not.
      expect(new Set(c.evidence.map((e) => e.kind))).toEqual(new Set(["true", "misleading", "inconclusive"]));
      expect(c.evidence.some((e) => e.challenge === null)).toBe(true);
      expect(c.evidence.some((e) => e.challenge !== null)).toBe(true);
      for (const e of c.evidence) {
        expect(e.text.length).toBeGreaterThan(5);
        expect(e.why.length).toBeGreaterThan(5);
      }
      // Only the one placeholder is used.
      const all = [c.summary, c.accusedSecret, c.lawyerInfo, c.prosecutorInfo, c.explanation, ...c.evidence.flatMap((e) => [e.text, e.why, e.challenge ?? ""])].join(" ");
      expect(fill(all, "X")).not.toMatch(/[{}]/);
    }
  });
});

describe("lobby and start", () => {
  it("needs 5–12 players and 1–5 cases", () => {
    expect(startGame(newDoc(), roster(4), 0, CASES).error).toMatch(/5/);
    expect(startGame(newDoc(), roster(13), 0, CASES).error).toMatch(/12/);
    expect(startGame(newDoc(), roster(12), 0, CASES).doc).toBeTruthy();
    expect(applySettings(newDoc(), { cases: 0 }).error).toBe("BAD_REQUEST");
    expect(applySettings(newDoc(), { cases: 6 }).error).toBe("BAD_REQUEST");
    expect(applySettings(newDoc(), { cases: 5 }).doc!.settings.cases).toBe(5);
  });

  it("released seats are not dealt in", () => {
    const r = roster(6);
    r[0].active = false;
    const g = game(startGame(newDoc(), r, 0, CASES, seeded(3)).doc!);
    expect(g.players.map((p) => p.id)).not.toContain("p0");
  });

  it("deals one accused, one lawyer, one prosecutor and the rest as jurors", () => {
    for (const n of [5, 8, 12]) {
      const g = game(started(n).doc);
      const c = g.case;
      const keys = [c.accused, c.lawyer, c.prosecutor];
      expect(new Set(keys).size).toBe(3);
      expect(c.jurors).toHaveLength(n - 3);
      expect(c.jurors.some((j) => keys.includes(j))).toBe(false);
      expect(g.phase).toBe("announce");
      expect(g.phaseMs).toBe(30000);
    }
  });

  it("picks the cases at random, without repeats, new ones first on a rematch", () => {
    const { doc } = started(5, 5);
    expect(new Set(game(doc).caseIds).size).toBe(5);
    const firstTwo = startGame(applySettings(newDoc(), { cases: 2 }).doc!, roster(5), 0, CASES, seeded(5)).doc!;
    const again = startGame({ ...firstTwo, game: null }, roster(5), 0, CASES, seeded(6)).doc!;
    expect(game(again).caseIds.some((id) => game(firstTwo).caseIds.includes(id))).toBe(false);
  });
});

describe("phases and timers", () => {
  it("runs announce → openings → evidence → cross → closings → vote with the right lengths", () => {
    const { doc, r } = started();
    const seen: [Phase, number | null][] = [];
    let d = doc;
    for (let i = 0; i < 9; i++) {
      seen.push([game(d).phase, game(d).phaseMs]);
      d = advance(d, game(d).phaseStartedAt + game(d).phaseMs!, r, CASES);
    }
    expect(seen).toEqual([
      ["announce", 30000],
      ["opening_p", 60000],
      ["opening_l", 60000],
      ["evidence", 105000],
      ["cross_p", 60000],
      ["cross_l", 30000],
      ["closing_p", 30000],
      ["closing_l", 30000],
      ["vote", 20000],
    ]);
    // Nobody voted: the vote ends with the clock, verdict not guilty, then it waits for the host.
    expect(game(d).phase).toBe("verdict");
    expect(game(d).case.verdict).toEqual({ guilty: false, guiltyVotes: 0, innocentVotes: 0, noVotes: true });
    expect(game(d).phaseMs).toBeNull();
    expect(advance(d, 10 ** 9, r, CASES)).toBe(d);
  });

  it("catches up across several expired phases in one request", () => {
    const { doc, r } = started();
    const d = advance(doc, 30000 + 60000 + 60000 + 1000, r, CASES);
    expect(game(d).phase).toBe("evidence");
    expect(game(d).phaseStartedAt).toBe(150000);
  });

  it("host pause stops the clock and resume continues where it was", () => {
    const { doc, r } = started();
    const paused = applyHostMove(doc, { type: "pause" }, 10000, r, CASES).doc!;
    expect(advance(paused, 10 ** 6, r, CASES)).toBe(paused);
    const resumed = applyHostMove(paused, { type: "resume" }, 500000, r, CASES).doc!;
    expect(game(resumed).pausedAt).toBeNull();
    expect(game(advance(resumed, 500000 + 19999, r, CASES)).phase).toBe("announce");
    expect(game(advance(resumed, 500000 + 20000, r, CASES)).phase).toBe("opening_p");
  });

  it("next skips once, even on a double click", () => {
    const { doc, r } = started();
    const once = applyHostMove(doc, { type: "next", phase: "announce", case: 0 }, 100, r, CASES).doc!;
    expect(game(once).phase).toBe("opening_p");
    const twice = applyHostMove(once, { type: "next", phase: "announce", case: 0 }, 120, r, CASES).doc!;
    expect(twice).toBe(once);
  });
});

describe("evidence and objection", () => {
  it("only the prosecutor presents, during the evidence, each exhibit once", () => {
    const { doc, r } = started();
    const c = game(doc).case;
    expect(applyPlayerMove(doc, c.prosecutor, { type: "present", case: 0, exhibit: 0 }, 1).error).toBe("CT_CLOSED");
    const d = runTo(doc, r, "evidence");
    const at = game(d).phaseStartedAt + 1;
    expect(applyPlayerMove(d, c.lawyer, { type: "present", case: 0, exhibit: 0 }, at).error).toBe("CT_NOT_ALLOWED");
    expect(applyPlayerMove(d, c.jurors[0], { type: "present", case: 0, exhibit: 0 }, at).error).toBe("CT_NOT_ALLOWED");
    expect(applyPlayerMove(d, c.prosecutor, { type: "present", case: 1, exhibit: 0 }, at).error).toBe("CT_CLOSED");
    const one = applyPlayerMove(d, c.prosecutor, { type: "present", case: 0, exhibit: 2 }, at).doc!;
    expect(game(one).case.presented).toEqual([2]);
    expect(applyPlayerMove(one, c.prosecutor, { type: "present", case: 0, exhibit: 2 }, at).error).toBe("CT_DUPLICATE");
    expect(applyPlayerMove(one, c.prosecutor, { type: "present", case: 0, exhibit: 3 }, at).error).toBe("BAD_REQUEST");
  });

  it("one objection: pauses the evidence clock for the prosecutor's 15 s, then the evidence resumes with its time", () => {
    const { doc, r } = started();
    const c = game(doc).case;
    let d = runTo(doc, r, "evidence");
    const t0 = game(d).phaseStartedAt;
    // Nothing presented yet: nothing to object to.
    expect(applyPlayerMove(d, c.lawyer, { type: "object", case: 0, exhibit: 0 }, t0 + 1).error).toBe("CT_NOT_PRESENTED");
    d = applyPlayerMove(d, c.prosecutor, { type: "present", case: 0, exhibit: 1 }, t0 + 1000).doc!;
    expect(applyPlayerMove(d, c.prosecutor, { type: "object", case: 0, exhibit: 1 }, t0 + 2000).error).toBe("CT_NOT_ALLOWED");
    d = applyPlayerMove(d, c.lawyer, { type: "object", case: 0, exhibit: 1 }, t0 + 40000).doc!;
    expect(game(d).phase).toBe("objection");
    expect(game(d).phaseMs).toBe(15000);
    expect(game(d).case.objection).toEqual({ exhibit: 1, resumeMs: 65000 });
    // The prosecutor cannot present during the objection.
    expect(applyPlayerMove(d, c.prosecutor, { type: "present", case: 0, exhibit: 0 }, t0 + 41000).error).toBe("CT_CLOSED");
    d = advance(d, t0 + 55000, r, CASES);
    expect(game(d).phase).toBe("evidence");
    // 65 s were left when the objection came; 65 s are left now.
    expect(game(d).phaseStartedAt + game(d).phaseMs! - (t0 + 55000)).toBe(65000);
    expect(game(d).case.presented).toEqual([1]);
    expect(applyPlayerMove(d, c.lawyer, { type: "object", case: 0, exhibit: 1 }, t0 + 56000).error).toBe("CT_OBJECTED");
  });

  it("the objection outcome comes from the case data, after the 15 s", () => {
    const { doc, r } = started(5, 3, 11);
    const c = game(doc).case;
    const data = caseData(doc);
    const held = data.evidence.findIndex((e) => e.challenge !== null);
    let d = runTo(doc, r, "evidence");
    const t0 = game(d).phaseStartedAt;
    d = applyPlayerMove(d, c.prosecutor, { type: "present", case: 0, exhibit: held }, t0 + 1).doc!;
    d = applyPlayerMove(d, c.lawyer, { type: "object", case: 0, exhibit: held }, t0 + 2).doc!;
    const snap = snapshot(r, t0 + 3);
    expect(buildCourtHostView(snap, d, r, CASES).game!.objection!.outcome).toBeNull();
    d = advance(d, t0 + 2 + 15000, r, CASES);
    const outcome = buildCourtHostView(snapshot(r, t0 + 15003), d, r, CASES).game!.objection!.outcome!;
    expect(outcome.upheld).toBe(true);
    expect(outcome.note).toBe(fill(data.evidence[held].challenge!, r.find((x) => x.id === c.accused)!.name));
  });
});

describe("voting and verdict", () => {
  function atVote(n = 7, seed = 2) {
    const { doc, r } = started(n, 3, seed);
    return { d: runTo(doc, r, "vote"), r };
  }

  it("only jurors vote, once, only during the vote", () => {
    const { d, r } = atVote();
    const c = game(d).case;
    const at = game(d).phaseStartedAt + 1;
    expect(applyPlayerMove(d, c.accused, { type: "vote", case: 0, vote: "innocent" }, at).error).toBe("CT_NOT_JUROR");
    expect(applyPlayerMove(d, c.lawyer, { type: "vote", case: 0, vote: "innocent" }, at).error).toBe("CT_NOT_JUROR");
    const one = applyPlayerMove(d, c.jurors[0], { type: "vote", case: 0, vote: "guilty" }, at).doc!;
    expect(applyPlayerMove(one, c.jurors[0], { type: "vote", case: 0, vote: "innocent" }, at).error).toBe("CT_VOTED");
    // A retry of the same ballot changes nothing.
    expect(applyPlayerMove(one, c.jurors[0], { type: "vote", case: 0, vote: "guilty" }, at).doc).toBe(one);
    const before = runTo(started(7, 3, 2).doc, r, "closing_l");
    expect(applyPlayerMove(before, c.jurors[0], { type: "vote", case: 0, vote: "guilty" }, 1).error).toBe("CT_CLOSED");
  });

  it("ends as soon as every juror voted, and scores by the table", () => {
    const { d, r } = atVote(7, 4);
    const g0 = game(d);
    const c = g0.case;
    const truth = caseData(d).guilty;
    const right = truth ? "guilty" : "innocent";
    const wrong = truth ? "innocent" : "guilty";
    // 4 jurors: 3 right, 1 wrong → the verdict matches the truth.
    let x = d;
    c.jurors.forEach((j, i) => {
      x = applyPlayerMove(x, j, { type: "vote", case: 0, vote: i === 0 ? wrong : right }, g0.phaseStartedAt + 10).doc!;
      x = advance(x, g0.phaseStartedAt + 10, r, CASES);
    });
    const g = game(x);
    expect(g.phase).toBe("verdict");
    expect(g.case.verdict!.guilty).toBe(truth);
    expect(g.scores[c.accused]).toBe(0);
    expect(g.scores[c.prosecutor]).toBe(truth ? POINTS.prosecutor : 0);
    expect(g.scores[c.lawyer]).toBe(truth ? 0 : POINTS.lawyer);
    expect(g.scores[c.jurors[0]]).toBe(0);
    for (const j of c.jurors.slice(1)) expect(g.scores[j]).toBe(POINTS.juror);
  });

  it("a tie is not guilty; the accused scores when the verdict misses the truth", () => {
    // Find a seed whose first case is guilty, so a tie (not guilty) is wrong.
    let seed = 1;
    while (caseData(started(7, 1, seed).doc).guilty !== true) seed++;
    const { d, r } = atVote(7, seed);
    const c = game(d).case;
    let x = d;
    const at = game(d).phaseStartedAt + 5;
    ["guilty", "innocent", "guilty", "innocent"].forEach((v, i) => {
      x = applyPlayerMove(x, c.jurors[i], { type: "vote", case: 0, vote: v as "guilty" | "innocent" }, at).doc!;
    });
    x = advance(x, at, r, CASES);
    const g = game(x);
    expect(g.case.verdict).toEqual({ guilty: false, guiltyVotes: 2, innocentVotes: 2, noVotes: false });
    expect(g.scores[c.accused]).toBe(POINTS.accused);
    expect(g.scores[c.lawyer]).toBe(POINTS.lawyer);
    expect(g.scores[c.prosecutor]).toBe(0);
    expect(g.scores[c.jurors[0]]).toBe(POINTS.juror);
    expect(g.scores[c.jurors[1]]).toBe(0);
  });

  it("only some jurors voting: the clock closes the vote and counts what came in", () => {
    const { d, r } = atVote(7, 8);
    const c = game(d).case;
    const at = game(d).phaseStartedAt + 1;
    let x = applyPlayerMove(d, c.jurors[0], { type: "vote", case: 0, vote: "guilty" }, at).doc!;
    x = advance(x, at, r, CASES);
    expect(game(x).phase).toBe("vote");
    x = advance(x, game(d).phaseStartedAt + PHASE_MS.vote!, r, CASES);
    expect(game(x).case.verdict).toEqual({ guilty: true, guiltyVotes: 1, innocentVotes: 0, noVotes: false });
  });

  it("does not wait for a juror whose seat was freed", () => {
    const { d, r } = atVote(6, 3);
    const c = game(d).case;
    const freed = r.map((x) => (x.id === c.jurors[2] ? { ...x, active: false, present: false } : x));
    let x = d;
    const at = game(d).phaseStartedAt + 1;
    x = applyPlayerMove(x, c.jurors[0], { type: "vote", case: 0, vote: "innocent" }, at).doc!;
    x = applyPlayerMove(x, c.jurors[1], { type: "vote", case: 0, vote: "innocent" }, at).doc!;
    expect(game(advance(x, at, freed, CASES)).phase).toBe("verdict");
  });

  it("scores once: the verdict never re-counts", () => {
    const { d, r } = atVote(5, 6);
    const v = advance(d, game(d).phaseStartedAt + PHASE_MS.vote!, r, CASES);
    const scores = { ...game(v).scores };
    const again = advance(v, 10 ** 9, r, CASES);
    expect(game(again).scores).toEqual(scores);
  });
});

describe("rotation", () => {
  it("spreads the key roles evenly over a session (5 and 12 players)", () => {
    for (const [n, seed] of [[5, 1], [5, 77], [12, 3]] as const) {
      let { doc: d } = started(n, 5, seed);
      const r = roster(n);
      const history: string[][] = [];
      for (let k = 0; k < 5; k++) {
        const c = game(d).case;
        history.push([c.accused, c.lawyer, c.prosecutor]);
        expect(c.jurors.length + 3).toBe(n);
        d = runTo(d, r, "standings", seeded(seed + k));
        const g = game(d);
        d = applyHostMove(d, { type: "next", phase: "standings", case: g.case.index }, g.phaseStartedAt + 1, r, CASES, seeded(seed + 100 + k)).doc!;
      }
      expect(game(d).phase).toBe("final");
      const counts = new Map<string, number>();
      for (const ids of history) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      const values = r.map((p) => counts.get(p.id) ?? 0);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
      // Nobody is accused twice before everyone has been accused once (5 players, 5 cases).
      if (n === 5) expect(new Set(history.map((h) => h[0])).size).toBe(5);
      // Consecutive cases do not reuse the same accused.
      for (let k = 1; k < history.length; k++) expect(history[k][0]).not.toBe(history[k - 1][0]);
    }
  });

  it("seats a latecomer as a juror at the next case", () => {
    const { doc, r } = started(5, 2);
    const late = [...r, { id: "late", name: "متأخر", active: true, present: true }];
    let d = runTo(doc, late, "standings");
    expect(game(d).players).toHaveLength(5);
    const g = game(d);
    d = applyHostMove(d, { type: "next", phase: "standings", case: 0 }, g.phaseStartedAt + 1, late, CASES, seeded(4)).doc!;
    expect(game(d).players.map((p) => p.id)).toContain("late");
    expect(game(d).scores.late).toBe(0);
  });
});

describe("absent key roles", () => {
  it("pauses the hearing while a key role is away and resumes when they are back", () => {
    const { doc, r } = started(6);
    const c = game(doc).case;
    const away = r.map((x) => (x.id === c.lawyer ? { ...x, present: false } : x));
    const p = advance(doc, 5000, away, CASES);
    expect(game(p).pausedAt).toBe(5000);
    expect(game(p).pause).toBe("absent");
    // Time does not run while paused.
    expect(advance(p, 500000, away, CASES)).toBe(p);
    const back = advance(p, 600000, r, CASES);
    expect(game(back).pausedAt).toBeNull();
    expect(game(back).phaseStartedAt + game(back).phaseMs! - 600000).toBe(25000);
  });

  it("a juror being away never pauses the hearing", () => {
    const { doc, r } = started(6);
    const j = game(doc).case.jurors[0];
    const away = r.map((x) => (x.id === j ? { ...x, present: false } : x));
    expect(game(advance(doc, 5000, away, CASES)).pausedAt).toBeNull();
  });

  it("the host may go on without them (no re-pause until they are back and gone again)", () => {
    const { doc, r } = started(6);
    const c = game(doc).case;
    const away = r.map((x) => (x.id === c.accused ? { ...x, present: false } : x));
    let d = advance(doc, 5000, away, CASES);
    d = applyHostMove(d, { type: "resume" }, 5000 + GRACE_MS, away, CASES).doc!;
    d = advance(d, 5000 + GRACE_MS + 1, away, CASES);
    expect(game(d).pausedAt).toBeNull();
    // Back, then gone again: the court waits again.
    d = advance(d, 5000 + GRACE_MS + 2, r, CASES);
    expect(game(d).case.waived).toEqual([]);
    d = advance(d, 5000 + GRACE_MS + 3, away, CASES);
    expect(game(d).pause).toBe("absent");
  });

  it("the host may replace an absent key role with a juror; the replaced player sits the case out", () => {
    const { doc, r } = started(6, 3, 21);
    const c = game(doc).case;
    const away = r.map((x) => (x.id === c.prosecutor ? { ...x, present: false } : x));
    let d = advance(doc, 1000, away, CASES);
    d = applyHostMove(d, { type: "replace", role: "prosecutor", case: 0 }, 2000, away, CASES, seeded(1)).doc!;
    const c2 = game(d).case;
    expect(c2.prosecutor).not.toBe(c.prosecutor);
    expect(c.jurors).toContain(c2.prosecutor);
    expect(c2.jurors).not.toContain(c2.prosecutor);
    expect(c2.benched).toEqual([c.prosecutor]);
    // The new prosecutor is here: the hearing goes on by itself.
    d = advance(d, 2001, away, CASES);
    expect(game(d).pausedAt).toBeNull();
    // The benched player can neither act nor vote.
    expect(applyPlayerMove(d, c.prosecutor, { type: "present", case: 0, exhibit: 0 }, 2002).error).toBe("CT_NOT_ALLOWED");
  });

  it("the host may void the case: no points, on to the standings", () => {
    const { doc, r } = started(5);
    const d = applyHostMove(doc, { type: "void", case: 0 }, 100, r, CASES).doc!;
    expect(game(d).phase).toBe("standings");
    expect(game(d).case.voided).toBe(true);
    expect(Object.values(game(d).scores).every((s) => s === 0)).toBe(true);
  });
});

describe("results", () => {
  it("ranks with ties and names every tied winner", () => {
    const { doc } = started(5);
    const g = { ...game(doc), scores: { p0: 300, p1: 300, p2: 100, p3: 0, p4: 0 } };
    const s = standings(g);
    expect(s.map((x) => x.rank)).toEqual([1, 1, 3, 4, 4]);
    expect(winners(g).sort()).toEqual(["p0", "p1"]);
    expect(winners({ ...g, scores: {} })).toEqual([]);
  });

  it("ending early goes to the final results", () => {
    const { doc, r } = started(5);
    const d = applyHostMove(doc, { type: "end" }, 10, r, CASES).doc!;
    expect(game(d).phase).toBe("final");
    expect(game(d).endedEarly).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function snapshot(r: RosterEntry[], now: number): Snapshot {
  return {
    now: new Date(now).toISOString(),
    session: { id: "s", code: "1234", status: "PLAYING", match_version: 1 },
    players: r.map((x) => ({ id: x.id, display_name: x.name, token_hash: x.active ? "h" : null, person_id: null })),
  } as unknown as Snapshot;
}

describe("views keep secrets", () => {
  it("the TV and jurors never get the truth, secrets or unpresented exhibits before the verdict", () => {
    const { doc, r } = started(6, 3, 5);
    const c = game(doc).case;
    const data = caseData(doc);
    const name = r.find((x) => x.id === c.accused)!.name;
    let d = runTo(doc, r, "evidence");
    d = applyPlayerMove(d, c.prosecutor, { type: "present", case: 0, exhibit: 0 }, game(d).phaseStartedAt + 1).doc!;
    const snap = snapshot(r, game(d).phaseStartedAt + 2);
    const host = JSON.stringify(buildCourtHostView(snap, d, r, CASES));
    const juror = JSON.stringify(buildCourtGuestView(snap, d, c.jurors[0], r, CASES));
    const lawyer = buildCourtGuestView(snap, d, c.lawyer, r, CASES)!;
    for (const leak of [data.accusedSecret, data.lawyerInfo, data.prosecutorInfo, data.explanation, data.evidence[1].text, data.evidence[2].text].map((t) => fill(t, name))) {
      expect(host).not.toContain(leak);
      expect(juror).not.toContain(leak);
    }
    for (const word of ['"kind":"true"', '"misleading"', '"inconclusive"', '"truth"', '"guilty":true']) {
      expect(host).not.toContain(word);
      expect(juror).not.toContain(word);
    }
    expect(host).toContain(fill(data.evidence[0].text, name));
    expect(lawyer.secret).toEqual({ role: "lawyer", text: fill(data.lawyerInfo, name), objectionUsed: false });
    expect(JSON.stringify(lawyer)).not.toContain(fill(data.accusedSecret, name));
    const acc = buildCourtGuestView(snap, d, c.accused, r, CASES)!;
    expect(acc.secret).toEqual({ role: "accused", guilty: data.guilty, text: fill(data.accusedSecret, name) });
    const pro = buildCourtGuestView(snap, d, c.prosecutor, r, CASES)!;
    expect(pro.secret!.role).toBe("prosecutor");
    if (pro.secret!.role === "prosecutor") expect(pro.secret!.exhibits.map((e) => e.presented)).toEqual([true, false, false]);
    expect(JSON.stringify(pro)).not.toContain(fill(data.accusedSecret, name));
  });

  it("the vote shows counts only; the verdict reveals the truth and the classes", () => {
    const { doc, r } = started(6, 3, 9);
    const c = game(doc).case;
    let d = runTo(doc, r, "vote");
    const at = game(d).phaseStartedAt + 1;
    d = applyPlayerMove(d, c.jurors[0], { type: "vote", case: 0, vote: "guilty" }, at).doc!;
    const view = buildCourtHostView(snapshot(r, at), d, r, CASES);
    expect(view.game!.votes).toEqual({ cast: 1, total: 3 });
    expect(JSON.stringify(view)).not.toMatch(/"guilty"(?!Votes)/);
    expect(buildCourtGuestView(snapshot(r, at), d, c.jurors[0], r, CASES)!.myVote).toBe("guilty");
    expect(buildCourtGuestView(snapshot(r, at), d, c.jurors[1], r, CASES)!.myVote).toBeNull();
    d = advance(d, game(d).phaseStartedAt + PHASE_MS.vote!, r, CASES);
    const v = buildCourtHostView(snapshot(r, at + 30000), d, r, CASES).game!.verdict!;
    expect(v.truth).toBe(caseData(d).guilty);
    expect(v.exhibits.map((e) => e.kind).sort()).toEqual(["inconclusive", "misleading", "true"]);
    expect(v.guiltyVotes).toBe(1);
  });
});
