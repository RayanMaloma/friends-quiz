import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { QUESTION_BANK, questionById } from "@/lib/invent/questions";
import {
  advance,
  applyHostMove,
  applyPlayerMove,
  applySettings,
  cleanAnswer,
  DEFAULT_SETTINGS,
  newDoc,
  remainingMs,
  standings,
  startGame,
  winners,
  type InventDoc,
  type InventGame,
} from "@/lib/invent/engine";

// The «اخترع إجابتك» engine: question bank, timers (live edits, pauses),
// answers, voting, scoring once, standings and joint winners.

const PLAYERS = ["الدحام", "أبو قاسم", "العمري", "خالد", "مشعل", "ريان"].map((name, i) => ({ id: `p${i}`, name }));
const ALL = new Set(PLAYERS.map((p) => p.id));

/** Deterministic rng for reproducible shuffles. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

function ok(res: { doc?: InventDoc; error?: string }): InventDoc {
  if (!res.doc) throw new Error(`engine refused: ${res.error}`);
  return res.doc;
}

const game = (d: InventDoc): InventGame => d.game!;

/** A match started at t=0: rounds open straight into answering. */
function answering(settings = DEFAULT_SETTINGS, players = PLAYERS) {
  const d = ok(startGame(newDoc(settings), players, 0, seeded()));
  expect(game(d).phase).toBe("answering");
  expect(remainingMs(d, 0)).toBe(settings.answerSeconds * 1000);
  return d;
}

function answerAll(d: InventDoc, at: number, who = PLAYERS) {
  for (const p of who) d = ok(applyPlayerMove(d, p.id, { type: "answer", round: game(d).round.index, text: `جواب ${p.name}` }, at));
  return d;
}

const answerIdOf = (d: InventDoc, playerId: string) => game(d).round.answers.find((a) => a.authorId === playerId)!.id;

describe("question bank", () => {
  it("has exactly 46 unique questions with stable ids", () => {
    expect(QUESTION_BANK).toHaveLength(46);
    expect(new Set(QUESTION_BANK.map((q) => q.id)).size).toBe(46);
    expect(new Set(QUESTION_BANK.map((q) => q.text)).size).toBe(46);
    expect(QUESTION_BANK.map((q) => q.id)).toEqual(Array.from({ length: 46 }, (_, i) => `q${String(i + 1).padStart(2, "0")}`));
  });

  it("keeps the approved wording exactly", () => {
    expect(questionById("q02")!.text).toBe("أبو قاسم عطب فاتورة للمرة الـ100، وش كان عذره هالمرة؟");
    expect(questionById("q23")!.text).toBe("أحد الزباين طلب مقابلة مدير أحاجي بعد تجربة الغرفة، وش  الشكوى اللي قدمها؟");
    expect(questionById("q46")!.text).toBe("في آخر يوم لأحاجي قبل إغلاقه للأبد، ترك أحد الموظفين رسالة غامضة على الجدار. وش كان مكتوب فيها؟");
    // Fingerprint of the whole bank: any edit to any question fails this test.
    const digest = createHash("sha256").update(QUESTION_BANK.map((q) => `${q.id}|${q.text}`).join("\n")).digest("hex");
    expect(digest).toBe(BANK_DIGEST);
  });

  it("has no answer field (there are no right answers)", () => {
    for (const q of QUESTION_BANK) expect(Object.keys(q).sort()).toEqual(["id", "text"]);
  });
});

// sha256 of the approved list as installed; change only if the approved bank itself changes.
const BANK_DIGEST = "ed01e049d142f53bcb02ff908c643cbaa3726fda79c5c98fd7feec38acc42dd5";

describe("match setup", () => {
  it("defaults to 36 questions, 60s answers, 30s votes", () => {
    expect(DEFAULT_SETTINGS).toEqual({ rounds: 36, answerSeconds: 60, voteSeconds: 30 });
    const d = ok(startGame(newDoc(), PLAYERS, 0));
    expect(game(d).questionIds).toHaveLength(36);
  });

  it("picks N random questions without repeats, for any N from 1 to 46", () => {
    for (const rounds of [1, 7, 36, 46]) {
      const d = ok(startGame(newDoc({ ...DEFAULT_SETTINGS, rounds }), PLAYERS, 0));
      const ids = game(d).questionIds;
      expect(ids).toHaveLength(rounds);
      expect(new Set(ids).size).toBe(rounds);
      for (const id of ids) expect(questionById(id)).toBeDefined();
    }
    const a = game(ok(startGame(newDoc(), PLAYERS, 0, seeded(1)))).questionIds;
    const b = game(ok(startGame(newDoc(), PLAYERS, 0, seeded(2)))).questionIds;
    expect(a).not.toEqual(b);
  });

  it("validates settings: 1–46 questions, any positive whole seconds", () => {
    expect(ok(applySettings(newDoc(), { rounds: 12, answerSeconds: 24, voteSeconds: 17 })).settings).toEqual({ rounds: 12, answerSeconds: 24, voteSeconds: 17 });
    expect(applySettings(newDoc(), { rounds: 47 }).error).toBe("BAD_REQUEST");
    expect(applySettings(newDoc(), { rounds: 0 }).error).toBe("BAD_REQUEST");
    expect(applySettings(newDoc(), { answerSeconds: 0 }).error).toBe("BAD_REQUEST");
    expect(applySettings(newDoc(), { voteSeconds: 2.5 }).error).toBe("BAD_REQUEST");
  });

  it("needs 3 to 16 players", () => {
    expect(startGame(newDoc(), PLAYERS.slice(0, 2), 0).error).toMatch(/3/);
    expect(startGame(newDoc(), PLAYERS.slice(0, 3), 0).doc).toBeDefined();
    const many = Array.from({ length: 17 }, (_, i) => ({ id: `x${i}`, name: `x${i}` }));
    expect(startGame(newDoc(), many, 0).error).toMatch(/16/);
    expect(startGame(newDoc(), many.slice(0, 16), 0).doc).toBeDefined();
  });
});

describe("answers", () => {
  it("cleans text, rejects empty and too long", () => {
    expect(cleanAnswer("  قال   الفاتورة\nتحتاج تحديث  ")).toBe("قال الفاتورة تحتاج تحديث");
    expect(cleanAnswer("   ")).toBeNull();
    expect(cleanAnswer("ا".repeat(200))).toHaveLength(200);
    expect(cleanAnswer("ا".repeat(201))).toBeNull();
  });

  it("one answer per player, locked once sent; retries are harmless", () => {
    let d = answering();
    d = ok(applyPlayerMove(d, "p0", { type: "answer", round: 0, text: "أول" }, 5000));
    expect(applyPlayerMove(d, "p0", { type: "answer", round: 0, text: "أول" }, 5001).doc).toBe(d);
    expect(applyPlayerMove(d, "p0", { type: "answer", round: 0, text: "ثاني" }, 5002).error).toBe("IV_ANSWERED");
    expect(applyPlayerMove(d, "p1", { type: "answer", round: 0, text: "  " }, 5002).error).toBe("IV_EMPTY");
    expect(applyPlayerMove(d, "stranger", { type: "answer", round: 0, text: "x" }, 5002).error).toBe("IV_NOT_SEATED");
    expect(applyPlayerMove(d, "p1", { type: "answer", round: 3, text: "x" }, 5002).error).toBe("IV_CLOSED");
    expect(game(d).round.answers).toHaveLength(1);
  });

  it("opens the answer box the moment the round starts (no question-only intro)", () => {
    const d = ok(startGame(newDoc(), PLAYERS, 0));
    expect(game(d).phase).toBe("answering");
    expect(applyPlayerMove(d, "p0", { type: "answer", round: 0, text: "فورًا" }, 0).doc).toBeDefined();
  });

  it("refuses answers outside the answering phase", () => {
    let d = advance(answerAll(answering(), 1000), 1000, ALL);
    expect(game(d).phase).toBe("voting");
    d = ok(applyPlayerMove(d, "p0", { type: "vote", round: 0, answerId: answerIdOf(d, "p1") }, 1000));
    expect(applyPlayerMove(d, "late", { type: "answer", round: 0, text: "متأخر" }, 1000).error).toBe("IV_NOT_SEATED");
    const fresh = advance(answering(), 60000, ALL); // no answers → reveal
    expect(applyPlayerMove(fresh, "p0", { type: "answer", round: 0, text: "متأخر" }, 60000).error).toBe("IV_CLOSED");
  });

  it("carries a room saved mid-intro (old format) straight into answering", () => {
    const d = answering();
    const legacy = { ...d, game: { ...game(d), phase: "question" as never } };
    expect(game(advance(legacy, 1000, ALL)).phase).toBe("answering");
  });

  it("moves to voting as soon as everyone answered, with one shuffled order", () => {
    let d = answerAll(answering(), 10000);
    d = advance(d, 10000, ALL);
    expect(game(d).phase).toBe("voting");
    expect(game(d).phaseStartedAt).toBe(10000);
    expect([...game(d).round.order].sort()).toEqual(game(d).round.answers.map((a) => a.id).sort());
  });

  it("moves on at the deadline with the answers that arrived (no fake answers)", () => {
    let d = answering();
    d = answerAll(d, 6000, PLAYERS.slice(0, 3));
    d = advance(d, 60000 + 1, ALL);
    expect(game(d).phase).toBe("voting");
    expect(game(d).round.answers).toHaveLength(3);
  });

  it("released players no longer hold the room up", () => {
    let d = answerAll(answering(), 6000, PLAYERS.slice(0, 5));
    expect(game(advance(d, 7000, ALL)).phase).toBe("answering");
    const active = new Set(PLAYERS.slice(0, 5).map((p) => p.id));
    d = advance(d, 7000, active);
    expect(game(d).phase).toBe("voting");
  });
});

describe("voting and scoring", () => {
  function voting() {
    const d = advance(answerAll(answering(), 6000), 6000, ALL);
    expect(game(d).phase).toBe("voting");
    return d;
  }

  it("rejects self votes, unknown answers and second votes", () => {
    let d = voting();
    expect(applyPlayerMove(d, "p0", { type: "vote", round: 0, answerId: answerIdOf(d, "p0") }, 7000).error).toBe("IV_OWN_ANSWER");
    expect(applyPlayerMove(d, "p0", { type: "vote", round: 0, answerId: "nope" }, 7000).error).toBe("IV_BAD_CHOICE");
    d = ok(applyPlayerMove(d, "p0", { type: "vote", round: 0, answerId: answerIdOf(d, "p1") }, 7000));
    expect(applyPlayerMove(d, "p0", { type: "vote", round: 0, answerId: answerIdOf(d, "p1") }, 7001).doc).toBe(d);
    expect(applyPlayerMove(d, "p0", { type: "vote", round: 0, answerId: answerIdOf(d, "p2") }, 7001).error).toBe("IV_VOTED");
  });

  it("gives 100 points per vote to the author, nothing to voters, exactly once", () => {
    let d = voting();
    // الدحام's answer gets 3 votes, أبو قاسم's 2, العمري's 1.
    const plan: [string, string][] = [["p1", "p0"], ["p2", "p0"], ["p3", "p0"], ["p0", "p1"], ["p4", "p1"], ["p5", "p2"]];
    for (const [voter, author] of plan) d = ok(applyPlayerMove(d, voter, { type: "vote", round: 0, answerId: answerIdOf(d, author) }, 8000));
    d = advance(d, 8000, ALL);
    const g = game(d);
    expect(g.phase).toBe("reveal");
    expect(g.scores).toEqual({ p0: 300, p1: 200, p2: 100, p3: 0, p4: 0, p5: 0 });
    expect(g.round.gained).toEqual(g.scores);
    expect(g.round.tally![answerIdOf(d, "p0")]).toBe(3);
    // Re-running the clock (a refresh, a retry) never scores again.
    const again = advance(d, 8500, ALL);
    expect(game(again).scores).toEqual(g.scores);
    // A different vote after the round closed is refused.
    expect(applyPlayerMove(d, "p5", { type: "vote", round: 0, answerId: answerIdOf(d, "p3") }, 8600).error).toBe("IV_VOTED");
  });

  it("closes voting at the deadline with the votes that arrived", () => {
    let d = voting();
    d = ok(applyPlayerMove(d, "p1", { type: "vote", round: 0, answerId: answerIdOf(d, "p0") }, 7000));
    d = advance(d, 6000 + 30000 + 5, ALL);
    expect(game(d).phase).toBe("reveal");
    expect(game(d).scores.p0).toBe(100);
    // A vote that arrives after the deadline is refused and scores nothing.
    expect(applyPlayerMove(d, "p2", { type: "vote", round: 0, answerId: answerIdOf(d, "p0") }, 36010).error).toBe("IV_CLOSED");
  });

  it("skips voting with fewer than two answers (zero points)", () => {
    let d = answerAll(answering(), 6000, PLAYERS.slice(0, 1));
    d = advance(d, 60000, ALL);
    expect(game(d).phase).toBe("reveal");
    expect(game(d).round.votingSkipped).toBe(true);
    expect(Object.values(game(d).scores).every((s) => s === 0)).toBe(true);

    let none = answering();
    none = advance(none, 60000, ALL);
    expect(game(none).phase).toBe("reveal");
    expect(game(none).round.answers).toHaveLength(0);
  });

  it("a player without an answer can still vote; voting ends once every possible voter voted", () => {
    let d = answerAll(answering(), 6000, PLAYERS.slice(0, 2));
    d = advance(d, 60000, ALL);
    expect(game(d).phase).toBe("voting");
    // p0 and p1 can vote for each other; p2..p5 for either.
    for (const p of PLAYERS) {
      if (game(d).phase !== "voting") break;
      const target = p.id === "p0" ? "p1" : "p0";
      d = ok(applyPlayerMove(d, p.id, { type: "vote", round: 0, answerId: answerIdOf(d, target) }, 65000));
      d = advance(d, 65000, ALL);
    }
    expect(game(d).phase).toBe("reveal");
    expect(game(d).scores).toMatchObject({ p0: 500, p1: 100 });
  });
});

describe("timers", () => {
  it("shortening the running phase keeps elapsed time: 60s → 24s after 10s leaves 14s", () => {
    let d = answering();
    expect(remainingMs(d, 10000)).toBe(50000);
    d = ok(applyHostMove(d, { type: "timers", answerSeconds: 24 }, 10000));
    expect(remainingMs(d, 10000)).toBe(14000);
    expect(d.settings.answerSeconds).toBe(24);
    expect(game(advance(d, 23999, ALL)).phase).toBe("answering");
    // No answers: the round closes at exactly 24s (straight to the reveal).
    const closed = game(advance(d, 26000, ALL));
    expect(closed.phase).toBe("reveal");
    expect(closed.phaseStartedAt).toBe(24000);
  });

  it("lengthening adds time; shortening below elapsed closes the phase at once", () => {
    let d = answering();
    d = ok(applyHostMove(d, { type: "timers", answerSeconds: 90 }, 10000));
    expect(remainingMs(d, 10000)).toBe(80000);
    const answers = answerAll(d, 15000, PLAYERS.slice(0, 2));
    const cut = ok(applyHostMove(answers, { type: "timers", answerSeconds: 5 }, 20000));
    const after = advance(cut, 20000, ALL);
    expect(game(after).phase).toBe("voting");
    expect(game(after).round.answers).toHaveLength(2);
    expect(game(after).round.index).toBe(0);
  });

  it("the new duration also applies to the following rounds", () => {
    let d = ok(applyHostMove(answering(), { type: "timers", voteSeconds: 15 }, 5000));
    d = advance(answerAll(d, 6000), 6000, ALL);
    expect(remainingMs(d, 6000)).toBe(15000);
  });

  it("pause freezes the clock, blocks timer transitions, and resume continues", () => {
    let d = answering();
    d = ok(applyHostMove(d, { type: "pause" }, 10000));
    expect(remainingMs(d, 100000)).toBe(50000);
    expect(game(advance(d, 500000, ALL)).phase).toBe("answering");
    // Editing while paused uses no paused time.
    d = ok(applyHostMove(d, { type: "timers", answerSeconds: 30 }, 200000));
    expect(remainingMs(d, 200000)).toBe(20000);
    d = ok(applyHostMove(d, { type: "resume" }, 300000));
    expect(remainingMs(d, 305000)).toBe(15000);
    const closed = game(advance(d, 325000, ALL));
    expect(closed.phase).toBe("reveal");
    expect(closed.phaseStartedAt).toBe(320000);
  });

  it("skip moves on once (a double click is ignored) and keeps submissions", () => {
    let d = answerAll(answering(), 6000, PLAYERS.slice(0, 3));
    d = ok(applyHostMove(d, { type: "skip", phase: "answering", round: 0 }, 7000));
    expect(game(d).phase).toBe("voting");
    expect(game(d).round.answers).toHaveLength(3);
    expect(applyHostMove(d, { type: "skip", phase: "answering", round: 0 }, 7001).doc).toBe(d);
  });
});

describe("full match", () => {
  it("runs 3 rounds to the final results, accumulating scores", () => {
    let d = ok(startGame(newDoc({ rounds: 3, answerSeconds: 20, voteSeconds: 10 }), PLAYERS.slice(0, 3), 0, seeded(5)));
    const all = new Set(["p0", "p1", "p2"]);
    let t = 0;
    for (let round = 0; round < 3; round++) {
      expect(game(d).phase).toBe("answering");
      expect(game(d).round.index).toBe(round);
      d = answerAll(d, t, PLAYERS.slice(0, 3));
      d = advance(d, t, all);
      // Everyone votes for p0, p0 votes for p1.
      for (const v of ["p1", "p2"]) d = ok(applyPlayerMove(d, v, { type: "vote", round, answerId: answerIdOf(d, "p0") }, t));
      d = ok(applyPlayerMove(d, "p0", { type: "vote", round, answerId: answerIdOf(d, "p1") }, t));
      d = advance(d, t, all);
      expect(game(d).phase).toBe("reveal");
      t += 10000 + 8000;
      d = advance(d, t, all);
    }
    const g = game(d);
    expect(g.phase).toBe("final");
    expect(g.scores).toEqual({ p0: 600, p1: 300, p2: 0 });
    expect(winners(g)).toEqual(["p0"]);
    // Final results do not move or accept moves.
    expect(advance(d, t + 1e9, all)).toBe(d);
    expect(applyPlayerMove(d, "p0", { type: "vote", round: 2, answerId: answerIdOf(d, "p2") }, t).error).toBe("IV_VOTED");
    expect(applyPlayerMove(d, "p1", { type: "answer", round: 2, text: "متأخر" }, t).error).toBe("IV_ANSWERED");
  });

  it("ties share the rank and the win", () => {
    const g = { ...game(ok(startGame(newDoc(), PLAYERS.slice(0, 4), 0))), scores: { p0: 300, p1: 300, p2: 100, p3: 0 } };
    expect(standings(g).map((r) => r.rank)).toEqual([1, 1, 3, 4]);
    expect(winners(g).sort()).toEqual(["p0", "p1"]);
    // Nobody scored: no winner (not a joint win for everyone).
    expect(winners({ ...g, scores: { p0: 0, p1: 0, p2: 0, p3: 0 } })).toEqual([]);
  });

  it("ending early goes to the final results and stops the clock", () => {
    let d = answering();
    d = ok(applyHostMove(d, { type: "end" }, 9000));
    expect(game(d).phase).toBe("final");
    expect(game(d).endedEarly).toBe(true);
    expect(remainingMs(d, 9000)).toBeNull();
    expect(applyHostMove(d, { type: "pause" }, 9001).error).toBe("GAME_OVER");
  });
});
