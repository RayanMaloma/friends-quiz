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
  normalizeAnswer,
  truthOf,
  remainingMs,
  standings,
  startGame,
  winners,
  type InventDoc,
  type InventGame,
} from "@/lib/invent/engine";

// The «اخترع إجابتك» engine: question bank (with real answers), timers (live
// edits, pauses), fake answers, voting among them and the real one, scoring
// once, standings and joint winners.

const PLAYERS = ["الدحام", "أبو قاسم", "العمري", "خالد", "مشعل", "ريان"].map((name, i) => ({ id: `p${i}`, name }));
const ALL = new Set(PLAYERS.map((p) => p.id));
/** The question bank (the engine takes any pool). */
const POOL = QUESTION_BANK;

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
  const d = ok(startGame(newDoc(settings), players, 0, POOL, seeded()));
  expect(game(d).phase).toBe("answering");
  expect(remainingMs(d, 0)).toBe(settings.answerSeconds * 1000);
  return d;
}

function answerAll(d: InventDoc, at: number, who = PLAYERS) {
  for (const p of who) d = ok(applyPlayerMove(d, p.id, { type: "answer", round: game(d).round.index, text: `جواب ${p.name}` }, at));
  return d;
}

const answerIdOf = (d: InventDoc, playerId: string) => game(d).round.answers.find((a) => a.authorId === playerId)!.id;
const truthIdOf = (d: InventDoc) => game(d).round.truthId!;

describe("question bank", () => {
  it("has exactly 25 unique questions with stable ids, each with one real answer", () => {
    expect(QUESTION_BANK).toHaveLength(25);
    expect(new Set(QUESTION_BANK.map((q) => q.id)).size).toBe(25);
    expect(new Set(QUESTION_BANK.map((q) => q.text)).size).toBe(25);
    expect(QUESTION_BANK.map((q) => q.id)).toEqual(Array.from({ length: 25 }, (_, i) => `q${String(i + 1).padStart(2, "0")}`));
    for (const q of QUESTION_BANK) {
      expect(Object.keys(q).sort()).toEqual(["answer", "id", "text"]);
      expect(cleanAnswer(q.answer)).toBe(q.answer);
    }
  });

  it("keeps the approved wording exactly", () => {
    expect(questionById("q01")).toEqual({ id: "q01", text: "ما اسم الرقصة الحجازية التي تُؤدى بالعصي؟", answer: "المزمار" });
    expect(questionById("q09")).toMatchObject({ text: "أي لاعب ظهر على غلاف FIFA 18؟", answer: "كريستيانو رونالدو" });
    expect(questionById("q21")).toMatchObject({ text: "ما اسم الطبقة البيضاء الخارجية للعين؟", answer: "الصُّلبة" });
    expect(questionById("q24")).toMatchObject({ answer: "O موجب" });
    expect(questionById("q25")).toMatchObject({ text: "ما اسم حرب لانكستر ويورك الإنجليزية؟", answer: "حرب الوردتين" });
    // Fingerprint of the whole bank: any edit to any question or answer fails this test.
    const digest = createHash("sha256").update(QUESTION_BANK.map((q) => `${q.id}|${q.text}|${q.answer}`).join("\n")).digest("hex");
    expect(digest).toBe(BANK_DIGEST);
  });
});

// sha256 of the approved list as installed; change only if the approved bank itself changes.
const BANK_DIGEST = "119e10c8df7c24565696c84c3595c5cf69e82c3d528faec9b682f808ddecb58f";

describe("match setup", () => {
  it("defaults to all 25 questions, 60s answers, 30s votes", () => {
    expect(DEFAULT_SETTINGS).toEqual({ rounds: 25, answerSeconds: 60, voteSeconds: 30 });
    const d = ok(startGame(newDoc(), PLAYERS, 0, POOL));
    expect(game(d).questionIds).toHaveLength(25);
    // The match keeps each picked question with its real answer.
    for (const q of game(d).questions!) expect(q).toEqual(questionById(q.id));
  });

  it("picks N random questions without repeats, for any N from 1 to 25", () => {
    for (const rounds of [1, 7, 25]) {
      const d = ok(startGame(newDoc({ ...DEFAULT_SETTINGS, rounds }), PLAYERS, 0, POOL));
      const ids = game(d).questionIds;
      expect(ids).toHaveLength(rounds);
      expect(new Set(ids).size).toBe(rounds);
      for (const id of ids) expect(questionById(id)).toBeDefined();
    }
    const a = game(ok(startGame(newDoc(), PLAYERS, 0, POOL, seeded(1)))).questionIds;
    const b = game(ok(startGame(newDoc(), PLAYERS, 0, POOL, seeded(2)))).questionIds;
    expect(a).not.toEqual(b);
  });

  it("validates settings: 1–25 questions, any positive whole seconds", () => {
    expect(ok(applySettings(newDoc(), { rounds: 12, answerSeconds: 24, voteSeconds: 17 }, POOL.length)).settings).toEqual({ rounds: 12, answerSeconds: 24, voteSeconds: 17 });
    expect(ok(applySettings(newDoc(), { rounds: 25 }, POOL.length)).settings.rounds).toBe(25);
    expect(applySettings(newDoc(), { rounds: 26 }, POOL.length).error).toBe("BAD_REQUEST");
    expect(applySettings(newDoc(), { rounds: 0 }, POOL.length).error).toBe("BAD_REQUEST");
    expect(applySettings(newDoc(), { answerSeconds: 0 }, POOL.length).error).toBe("BAD_REQUEST");
    expect(applySettings(newDoc(), { voteSeconds: 2.5 }, POOL.length).error).toBe("BAD_REQUEST");
  });

  it("needs 3 to 16 players", () => {
    expect(startGame(newDoc(), PLAYERS.slice(0, 2), 0, POOL).error).toMatch(/3/);
    expect(startGame(newDoc(), PLAYERS.slice(0, 3), 0, POOL).doc).toBeDefined();
    const many = Array.from({ length: 17 }, (_, i) => ({ id: `x${i}`, name: `x${i}` }));
    expect(startGame(newDoc(), many, 0, POOL).error).toMatch(/16/);
    expect(startGame(newDoc(), many.slice(0, 16), 0, POOL).doc).toBeDefined();
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
    const d = ok(startGame(newDoc(), PLAYERS, 0, POOL));
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

  it("moves to voting as soon as everyone answered, the real answer shuffled in under a random id", () => {
    let d = answerAll(answering(), 10000);
    expect(game(d).round.truthId).toBeNull();
    d = advance(d, 10000, ALL);
    expect(game(d).phase).toBe("voting");
    expect(game(d).phaseStartedAt).toBe(10000);
    const { order, answers, truthId } = game(d).round;
    expect(truthId).toMatch(/^[a-z0-9]{12}$/);
    expect(answers.map((a) => a.id)).not.toContain(truthId);
    expect([...order].sort()).toEqual([...answers.map((a) => a.id), truthId].sort());
    // Its place in the order is random, not fixed.
    const places = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
        const r = game(advance(answerAll(ok(startGame(newDoc(), PLAYERS, 0, POOL, seeded(seed))), 1), 1, ALL, seeded(seed * 7))).round;
        return r.order.indexOf(r.truthId!);
      }),
    );
    expect(places.size).toBeGreaterThan(1);
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

  it("gives 100 points per fooled player to the author, nothing for a wrong pick, exactly once", () => {
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

  it("no fake answers: straight to the reveal of the real one, zero points", () => {
    const none = advance(answering(), 60000, ALL);
    const g = game(none);
    expect(g.phase).toBe("reveal");
    expect(g.round.answers).toHaveLength(0);
    expect(g.round.votingSkipped).toBe(true);
    expect(g.round.order).toEqual([g.round.truthId]);
    expect(Object.values(g.scores).every((s) => s === 0)).toBe(true);
  });

  it("one fake answer is still a choice: its author can only pick the real one", () => {
    let d = answerAll(answering(), 6000, PLAYERS.slice(0, 1));
    d = advance(d, 60000, ALL);
    expect(game(d).phase).toBe("voting");
    expect(game(d).round.order).toHaveLength(2);
    expect(applyPlayerMove(d, "p0", { type: "vote", round: 0, answerId: answerIdOf(d, "p0") }, 61000).error).toBe("IV_OWN_ANSWER");
    d = ok(applyPlayerMove(d, "p0", { type: "vote", round: 0, answerId: truthIdOf(d) }, 61000));
    d = ok(applyPlayerMove(d, "p1", { type: "vote", round: 0, answerId: answerIdOf(d, "p0") }, 61000));
    d = advance(d, 61000 + 30000, ALL);
    expect(game(d).scores).toMatchObject({ p0: 200, p1: 0 });
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

describe("the real answer", () => {
  /** A one-question pool, so the real answer is known. */
  const ONE = [{ id: "t1", text: "ما اسم الرقصة الحجازية التي تُؤدى بالعصي؟", answer: "المزمار" }];
  const start = () => ok(startGame(newDoc({ ...DEFAULT_SETTINGS, rounds: 1 }), PLAYERS, 0, ONE, seeded()));
  const answer = (d: InventDoc, who: string, text: string) => applyPlayerMove(d, who, { type: "answer", round: 0, text }, 1000);

  it("normalizes spelling: diacritics, tatweel, alef/hamza, ى/ي, ة/ه, «ال», spaces, punctuation, case, digits", () => {
    const same = (a: string, b: string) => expect(normalizeAnswer(a)).toBe(normalizeAnswer(b));
    same("المزمار", "مزمار");
    same("المَزْمَار", "المزمار");
    same("المـــزمار", "المزمار");
    same("  المزمار!!  ", "المزمار");
    same("أحمد", "احمد");
    same("إسلام", "اسلام");
    same("آمنة", "امنه");
    same("مستشفى", "مستشفي");
    same("الصُّلبة", "صلبه");
    same("فيتامين K", "فيتامين k");
    same("فيتامين  K", "فيتامينk");
    same("O موجب", "o موجب");
    same("FIFA ١٨", "fifa 18");
    same("كريستيانو رونالدو", "كريستيانو-رونالدو");
    expect(normalizeAnswer("المزمار")).not.toBe(normalizeAnswer("المزمر"));
    expect(normalizeAnswer("الوردتين")).not.toBe(normalizeAnswer("الوردة"));
  });

  it("refuses a fake answer that is the real one, however it is spelled", () => {
    const d = start();
    expect(truthOf(game(d))).toBe("المزمار");
    for (const text of ["المزمار", "مزمار", "المَزمار", " ال‍مزمار ", "المزمار.", "المـزمار"]) {
      expect(answer(d, "p0", text).error, text).toBe("IV_TRUTH");
    }
    expect(answer(d, "p0", "المزمار الحجازي").doc).toBeDefined();
    expect(answer(d, "p0", "الخطوة").doc).toBeDefined();
  });

  it("refuses a fake answer another player already wrote (after normalizing)", () => {
    let d = start();
    d = ok(answer(d, "p0", "الخطوة"));
    expect(answer(d, "p1", "خطوه").error).toBe("IV_TAKEN");
    expect(answer(d, "p1", "  الخَطوة! ").error).toBe("IV_TAKEN");
    // The same player resending is still a harmless retry.
    expect(answer(d, "p0", "الخطوة").doc).toBe(d);
    expect(answer(d, "p1", "العرضة").doc).toBeDefined();
  });

  it("scores 100 for picking the real answer and 100 per player fooled (the 400-point example)", () => {
    let d = start();
    // أبو قاسم (p1) writes a fake answer that fools three players, and picks the real answer himself.
    d = answerAll(d, 1000);
    d = advance(d, 1000, ALL);
    expect(game(d).phase).toBe("voting");
    const truth = truthIdOf(d);
    const plan: [string, string][] = [["p0", "p1"], ["p2", "p1"], ["p3", "p1"], ["p1", "truth"], ["p4", "truth"], ["p5", "p0"]];
    for (const [voter, target] of plan) {
      d = ok(applyPlayerMove(d, voter, { type: "vote", round: 0, answerId: target === "truth" ? truth : answerIdOf(d, target) }, 2000));
    }
    d = advance(d, 2000, ALL);
    const g = game(d);
    expect(g.phase).toBe("reveal");
    expect(g.round.gained).toEqual({ p0: 100, p1: 400, p2: 0, p3: 0, p4: 100, p5: 0 });
    expect(g.round.tally![truth]).toBe(2);
    expect(g.round.tally![answerIdOf(d, "p1")]).toBe(3);
    expect(g.scores).toEqual(g.round.gained);
    // Scored once: more clock runs and late votes change nothing.
    expect(game(advance(d, 9000, ALL)).scores).toEqual(g.scores);
    expect(applyPlayerMove(d, "p5", { type: "vote", round: 0, answerId: truth }, 2001).error).toBe("IV_VOTED");
  });

  it("everyone can vote while there is a real answer; one vote each", () => {
    let d = start();
    d = advance(answerAll(d, 1000, PLAYERS.slice(0, 2)), 60000, ALL);
    const truth = truthIdOf(d);
    for (const p of PLAYERS) {
      if (game(d).phase !== "voting") break;
      d = ok(applyPlayerMove(d, p.id, { type: "vote", round: 0, answerId: truth }, 61000));
      expect(applyPlayerMove(d, p.id, { type: "vote", round: 0, answerId: answerIdOf(d, p.id === "p0" ? "p1" : "p0") }, 61000).error).toBe("IV_VOTED");
      d = advance(d, 61000, ALL);
    }
    expect(game(d).phase).toBe("reveal");
    expect(Object.values(game(d).scores)).toEqual([100, 100, 100, 100, 100, 100]);
  });

  it("a vote for the real answer is checked against this round's id only", () => {
    let d = start();
    d = advance(answerAll(d, 1000), 1000, ALL);
    expect(applyPlayerMove(d, "p0", { type: "vote", round: 0, answerId: "aaaaaaaaaaaa" }, 1500).error).toBe("IV_BAD_CHOICE");
    expect(applyPlayerMove(d, "p0", { type: "vote", round: 1, answerId: truthIdOf(d) }, 1500).error).toBe("IV_CLOSED");
  });

  it("older matches without real answers keep the old rules", () => {
    let d = ok(startGame(newDoc(), PLAYERS, 0, [{ id: "c001", text: "سؤال؟" }]));
    expect(truthOf(game(d))).toBeUndefined();
    d = advance(answerAll(d, 1000), 1000, ALL);
    expect(game(d).round.truthId).toBeNull();
    expect(game(d).round.order).toHaveLength(PLAYERS.length);
    d = ok(applyPlayerMove(d, "p0", { type: "vote", round: 0, answerId: answerIdOf(d, "p1") }, 1500));
    expect(applyPlayerMove(d, "p1", { type: "vote", round: 0, answerId: answerIdOf(d, "p1") }, 1500).error).toBe("IV_OWN_ANSWER");
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
    let d = ok(startGame(newDoc({ rounds: 3, answerSeconds: 20, voteSeconds: 10 }), PLAYERS.slice(0, 3), 0, POOL, seeded(5)));
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
    const g = { ...game(ok(startGame(newDoc(), PLAYERS.slice(0, 4), 0, POOL))), scores: { p0: 300, p1: 300, p2: 100, p3: 0 } };
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
