import { describe, expect, it } from "vitest";
import { WORD_BANK } from "@/lib/draw/words";
import { editDistance, isCorrectGuess, knownWords, squash } from "@/lib/draw/answers";
import {
  advance,
  applyHostMove,
  applyPlayerMove,
  applySettings,
  cleanStrokes,
  DEFAULT_SETTINGS,
  INTRO_MS,
  LATE_SUBMIT_MS,
  MAX_ATTEMPTS,
  newDoc,
  REVEAL_MS,
  standings,
  startGame,
  totalTurns,
  winners,
  type DrawDoc,
  type DrawGame,
  type RosterEntry,
  type Stroke,
} from "@/lib/draw/engine";

// «وزارة المقيمين للفنون والرسم»: the word bank, the answer checker, and the
// engine (turn order, timers, drawings, guesses, scoring once, latecomers,
// drawers who leave, host controls, results).

const KNOWN = knownWords(WORD_BANK);
const word = (w: string) => WORD_BANK.find((x) => x.word === w)!;
const correct = (guess: string, w: string) => isCorrectGuess(guess, word(w), KNOWN);

describe("word bank", () => {
  it("has 150 distinct, drawable words with ids and levels", () => {
    expect(WORD_BANK).toHaveLength(150);
    expect(new Set(WORD_BANK.map((w) => w.id)).size).toBe(150);
    expect(new Set(WORD_BANK.map((w) => squash(w.word))).size).toBe(150);
    for (const w of WORD_BANK) {
      expect(w.word.trim()).toBe(w.word);
      expect([1, 2, 3]).toContain(w.level);
    }
  });

  it("no accepted answer belongs to two words", () => {
    const owner = new Map<string, string>();
    for (const w of WORD_BANK) {
      for (const a of new Set([w.word, ...w.also].map(squash))) {
        expect(owner.get(a), `${a}: ${owner.get(a)} / ${w.word}`).toBeUndefined();
        owner.set(a, w.word);
      }
    }
  });

  it("no word's answers pass as another word (typos included)", () => {
    for (const w of WORD_BANK) {
      for (const other of WORD_BANK) {
        if (other === w) continue;
        for (const a of [other.word, ...other.also]) {
          expect(isCorrectGuess(a, w, KNOWN), `«${a}» (${other.word}) accepted for ${w.word}`).toBe(false);
        }
      }
    }
  });

  it("every word and synonym is accepted for its own word", () => {
    for (const w of WORD_BANK) for (const a of [w.word, ...w.also]) expect(isCorrectGuess(a, w, KNOWN), a).toBe(true);
  });
});

describe("answer checking", () => {
  it("accepts the word, synonyms, «ال», spelling forms and small typos", () => {
    for (const g of ["حصان", "الحصان", "خيل", "فرس", "حصانن", "حصاان", "  حِصَان! ", "الخيل"]) expect(correct(g, "حصان"), g).toBe(true);
    expect(correct("طائره", "طيارة")).toBe(true);
    expect(correct("سلحفاه", "سلحفاة")).toBe(true);
    expect(correct("آيس كريم", "آيسكريم")).toBe(true);
    expect(correct("ايسكرييم", "آيسكريم")).toBe(true);
    expect(correct("زرافه", "زرافة")).toBe(true);
    expect(correct("ظفدع", "ضفدع")).toBe(true);
    expect(correct("سعبان", "ثعبان")).toBe(true);
    expect(correct("شوكلاته", "شوكولاتة")).toBe(true);
    expect(correct("هلكوبتير", "هليكوبتر")).toBe(true);
    expect(correct("كرة القدم", "كرة قدم")).toBe(true);
  });

  it("rejects other animals, related things and look-alike words", () => {
    for (const g of ["حمار", "جمل", "بقرة", "إسطبل", "حصار", "بغل", "حصانين وحمار", "ح", ""]) expect(correct(g, "حصان"), g).toBe(false);
    expect(correct("طيار", "طيارة")).toBe(false);
    expect(correct("قطار", "قطة")).toBe(false);
    expect(correct("علم", "قلم")).toBe(false);
    expect(correct("سمك", "قرش")).toBe(false);
  });

  it("edit distance counts swaps as one and stops early", () => {
    expect(editDistance("abcd", "abdc")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("aaaaaaa", "bbbbbbb", 1)).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

const NAMES = ["الدحام", "أبو قاسم", "العمري", "خالد"];
const PLAYERS = NAMES.map((name, i) => ({ id: `p${i}`, name }));
const ROSTER: RosterEntry[] = PLAYERS.map((p) => ({ ...p, active: true }));

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

function ok(res: { doc?: DrawDoc; error?: string }): DrawDoc {
  expect(res.error).toBeUndefined();
  return res.doc!;
}

const LINE: Stroke[] = [{ c: 1, w: 1, p: [100, 100, 900, 900] }];
const T0 = 1_000_000;

function started(laps = 1, rng = seeded()) {
  const lobby = ok(applySettings(newDoc(), { laps }));
  return ok(startGame(lobby, PLAYERS, T0, WORD_BANK, rng));
}

const game = (d: DrawDoc) => d.game as DrawGame;
const wordOfTurn = (d: DrawDoc) => WORD_BANK.find((w) => w.id === game(d).turn.wordId)!;

/** Intro over, drawing started at T0 + INTRO_MS. */
function toDrawing(d: DrawDoc, roster = ROSTER) {
  const g = game(d);
  return advance(d, g.phaseStartedAt + INTRO_MS, roster, WORD_BANK, seeded(2));
}

function toGuessing(d: DrawDoc) {
  d = toDrawing(d);
  const g = game(d);
  return ok(applyPlayerMove(d, g.turn.drawerId, { type: "submit", turn: g.turn.index, strokes: LINE }, g.phaseStartedAt + 1000, WORD_BANK, KNOWN));
}

const guess = (d: DrawDoc, id: string, text: string, at: number) =>
  applyPlayerMove(d, id, { type: "guess", turn: game(d).turn.index, text }, at, WORD_BANK, KNOWN);

describe("engine", () => {
  it("starts in the intro with a drawer and a word; settings are checked", () => {
    const d = started();
    const g = game(d);
    expect(g.phase).toBe("intro");
    expect(PLAYERS.map((p) => p.id)).toContain(g.turn.drawerId);
    expect(g.queue).toHaveLength(3);
    expect(g.queue).not.toContain(g.turn.drawerId);
    expect(totalTurns(g, new Set(PLAYERS.map((p) => p.id)))).toBe(4);
    expect(applySettings(newDoc(), { laps: 6 }).error).toBe("BAD_REQUEST");
    expect(applySettings(newDoc(), { drawSeconds: 4 }).error).toBe("BAD_REQUEST");
    expect(startGame(newDoc(), PLAYERS.slice(0, 2), T0, WORD_BANK).error).toMatch(/3/);
    expect(DEFAULT_SETTINGS).toEqual({ laps: 1, drawSeconds: 60, guessSeconds: 30 });
  });

  it("drawing: only the drawer drafts and approves; an empty canvas cannot be approved", () => {
    let d = toDrawing(started());
    const g = game(d);
    const other = PLAYERS.find((p) => p.id !== g.turn.drawerId)!.id;
    const at = g.phaseStartedAt + 500;
    expect(applyPlayerMove(d, other, { type: "submit", turn: 0, strokes: LINE }, at, WORD_BANK, KNOWN).error).toBe("DR_NOT_DRAWER");
    expect(applyPlayerMove(d, g.turn.drawerId, { type: "submit", turn: 0, strokes: [] }, at, WORD_BANK, KNOWN).error).toBe("DR_EMPTY");
    expect(applyPlayerMove(d, g.turn.drawerId, { type: "submit", turn: 0, strokes: [{ c: 99, w: 0, p: [1, 2] }] }, at, WORD_BANK, KNOWN).error).toBe("DR_BAD_DRAWING");
    // Guessing is closed while drawing.
    expect(guess(d, other, wordOfTurn(d).word, at).error).toBe("DR_CLOSED");
    const draft = applyPlayerMove(d, g.turn.drawerId, { type: "draft", turn: 0, strokes: LINE }, at, WORD_BANK, KNOWN);
    expect(draft.quiet).toBe(true);
    d = ok(draft);
    expect(game(d).turn.draft).toEqual(LINE);
    expect(game(d).turn.drawing).toBeNull();
    d = ok(applyPlayerMove(d, g.turn.drawerId, { type: "submit", turn: 0, strokes: LINE }, at + 100, WORD_BANK, KNOWN));
    expect(game(d).phase).toBe("guessing");
    expect(game(d).turn.drawing).toEqual(LINE);
    expect(game(d).turn.rev).toBe(1);
    // A retry of the same approval is fine; a new drawing after guesses started is not.
    expect(applyPlayerMove(d, g.turn.drawerId, { type: "submit", turn: 0, strokes: LINE }, at + 200, WORD_BANK, KNOWN).doc).toBe(d);
  });

  it("the timer approves the last autosave; nothing drawn skips the turn", () => {
    let d = toDrawing(started());
    const g = game(d);
    d = ok(applyPlayerMove(d, g.turn.drawerId, { type: "draft", turn: 0, strokes: LINE }, g.phaseStartedAt + 100, WORD_BANK, KNOWN));
    const timed = advance(d, g.phaseStartedAt + 60_000, ROSTER, WORD_BANK);
    expect(game(timed).phase).toBe("guessing");
    expect(game(timed).turn.drawing).toEqual(LINE);
    expect(game(timed).phaseStartedAt).toBe(g.phaseStartedAt + 60_000);

    const blank = advance(toDrawing(started()), g.phaseStartedAt + 60_000, ROSTER, WORD_BANK);
    expect(game(blank).phase).toBe("reveal");
    expect(game(blank).turn.skipped).toBe("blank");
    expect(Object.values(game(blank).scores).every((s) => s === 0)).toBe(true);
  });

  it("an approval that lands just after the timer still replaces the autosave", () => {
    let d = toDrawing(started());
    const g = game(d);
    const end = g.phaseStartedAt + 60_000;
    d = ok(applyPlayerMove(d, g.turn.drawerId, { type: "draft", turn: 0, strokes: LINE }, end - 2000, WORD_BANK, KNOWN));
    d = advance(d, end + 500, ROSTER, WORD_BANK);
    const better: Stroke[] = [...LINE, { c: 2, w: 2, p: [500, 500] }];
    d = ok(applyPlayerMove(d, g.turn.drawerId, { type: "submit", turn: 0, strokes: better }, end + 1000, WORD_BANK, KNOWN));
    expect(game(d).turn.drawing).toEqual(better);
    expect(game(d).turn.rev).toBe(2);
    expect(applyPlayerMove(d, g.turn.drawerId, { type: "submit", turn: 0, strokes: LINE }, end + LATE_SUBMIT_MS + 1, WORD_BANK, KNOWN).error).toBe("DR_CLOSED");
  });

  it("scores correct guesses in server order (150/125/100) and the drawer 50 each, once", () => {
    let d = toGuessing(started());
    const g = game(d);
    const w = wordOfTurn(d);
    const [a, b, c] = PLAYERS.filter((p) => p.id !== g.turn.drawerId).map((p) => p.id);
    const t = g.phaseStartedAt;
    // The drawer cannot guess; wrong guesses are quiet and counted.
    expect(guess(d, g.turn.drawerId, w.word, t + 1).error).toBe("DR_DRAWER");
    const wrong = guess(d, b, "إسطبل", t + 2);
    expect(wrong.quiet).toBe(true);
    d = ok(wrong);
    expect(game(d).turn.attempts[b]).toBe(1);
    d = ok(guess(d, b, w.word, t + 3));
    d = ok(guess(d, a, `ال${w.word}`, t + 4));
    // Same player again: no change, no second entry.
    expect(guess(d, b, w.word, t + 5).doc).toBe(d);
    expect(game(d).phase).toBe("guessing");
    d = ok(guess(d, c, w.word, t + 6));
    // Everyone got it → reveal right away (advance after the move).
    d = advance(d, t + 6, ROSTER, WORD_BANK);
    const r = game(d);
    expect(r.phase).toBe("reveal");
    expect(r.turn.correct.map((x) => x.id)).toEqual([b, a, c]);
    expect(r.turn.gained).toMatchObject({ [b]: 150, [a]: 125, [c]: 100, [g.turn.drawerId]: 150 });
    expect(Object.values(r.scores).reduce((s, v) => s + v, 0)).toBe(525);
    // Scored once: guesses after the phase are refused, advancing again changes nothing.
    expect(guess(d, a, w.word, t + 7).doc).toBe(d);
    expect(advance(d, t + 8, ROSTER, WORD_BANK)).toBe(d);
  });

  it("caps wrong guesses", () => {
    let d = toGuessing(started());
    const g = game(d);
    const a = PLAYERS.find((p) => p.id !== g.turn.drawerId)!.id;
    for (let i = 0; i < MAX_ATTEMPTS; i++) d = ok(guess(d, a, "إسطبل", g.phaseStartedAt + i));
    expect(guess(d, a, wordOfTurn(d).word, g.phaseStartedAt + 100).error).toBe("DR_LIMIT");
  });

  it("plays every turn once per lap, nobody twice in a lap, no word twice, then final", () => {
    for (const laps of [1, 2, 3]) {
      let d = started(laps, seeded(laps * 7));
      const drawers: string[] = [];
      const words: string[] = [];
      let guard = 0;
      while (game(d).phase !== "final" && guard++ < 200) {
        const g = game(d);
        if (g.phase === "intro") {
          drawers.push(g.turn.drawerId);
          words.push(g.turn.wordId);
        }
        d = ok(applyHostMove(d, { type: "skip", phase: g.phase, turn: g.turn.index }, g.phaseStartedAt + 10, ROSTER, WORD_BANK, seeded(guard)));
      }
      expect(game(d).phase).toBe("final");
      expect(drawers).toHaveLength(4 * laps);
      for (let lap = 0; lap < laps; lap++) expect(new Set(drawers.slice(lap * 4, lap * 4 + 4)).size).toBe(4);
      for (let i = 1; i < drawers.length; i++) expect(drawers[i]).not.toBe(drawers[i - 1]);
      expect(new Set(words).size).toBe(words.length);
      expect(game(d).turnsDone).toBe(4 * laps);
    }
  });

  it("a skip names the phase it meant: a double click skips once", () => {
    const d = started();
    const g = game(d);
    const once = ok(applyHostMove(d, { type: "skip", phase: "intro", turn: 0 }, T0 + 10, ROSTER, WORD_BANK));
    expect(game(once).phase).toBe("drawing");
    expect(applyHostMove(once, { type: "skip", phase: "intro", turn: 0 }, T0 + 20, ROSTER, WORD_BANK).doc).toBe(once);
    expect(g.phase).toBe("intro");
  });

  it("timer edits apply from the next phase", () => {
    let d = toDrawing(started());
    const start = game(d).phaseStartedAt;
    d = ok(applyHostMove(d, { type: "timers", drawSeconds: 20, guessSeconds: 10 }, start + 1000, ROSTER, WORD_BANK));
    expect(game(d).phaseMs).toBe(60_000);
    expect(game(advance(d, start + 30_000, ROSTER, WORD_BANK)).phase).toBe("drawing");
    d = ok(applyPlayerMove(d, game(d).turn.drawerId, { type: "submit", turn: 0, strokes: LINE }, start + 2000, WORD_BANK, KNOWN));
    expect(game(d).phaseMs).toBe(10_000);
    expect(applyHostMove(d, { type: "timers", drawSeconds: 2 }, start, ROSTER, WORD_BANK).error).toBe("BAD_REQUEST");
  });

  it("a drawer who leaves: their sketch goes up, or the turn passes; they are skipped next lap", () => {
    let d = toDrawing(started(2));
    const g = game(d);
    const gone = ROSTER.map((r) => (r.id === g.turn.drawerId ? { ...r, active: false } : r));
    const passed = advance(d, g.phaseStartedAt + 100, gone, WORD_BANK);
    expect(game(passed).phase).toBe("reveal");
    expect(game(passed).turn.skipped).toBe("absent");

    d = ok(applyPlayerMove(d, g.turn.drawerId, { type: "draft", turn: 0, strokes: LINE }, g.phaseStartedAt + 50, WORD_BANK, KNOWN));
    const shown = advance(d, g.phaseStartedAt + 100, gone, WORD_BANK);
    expect(game(shown).phase).toBe("guessing");
    expect(game(shown).turn.drawing).toEqual(LINE);

    // Play the rest: the absent player never draws again.
    let rest = shown;
    const drawers: string[] = [];
    let guard = 0;
    while (game(rest).phase !== "final" && guard++ < 100) {
      const h = game(rest);
      if (h.phase === "intro") drawers.push(h.turn.drawerId);
      rest = ok(applyHostMove(rest, { type: "skip", phase: h.phase, turn: h.turn.index }, h.phaseStartedAt + 10, gone, WORD_BANK, seeded(guard)));
    }
    expect(drawers).not.toContain(g.turn.drawerId);
    expect(drawers).toHaveLength(3 + 3);
  });

  it("guessing ends early only when every guesser still in the room got it", () => {
    let d = toGuessing(started());
    const g = game(d);
    const [a, b, c] = PLAYERS.filter((p) => p.id !== g.turn.drawerId).map((p) => p.id);
    const roster = ROSTER.map((r) => (r.id === c ? { ...r, active: false } : r));
    d = ok(guess(d, a, wordOfTurn(d).word, g.phaseStartedAt + 1));
    expect(game(advance(d, g.phaseStartedAt + 2, roster, WORD_BANK)).phase).toBe("guessing");
    d = ok(guess(d, b, wordOfTurn(d).word, g.phaseStartedAt + 3));
    expect(game(advance(d, g.phaseStartedAt + 4, roster, WORD_BANK)).phase).toBe("reveal");
    // With c still in, it waits for c (or the timer).
    expect(game(advance(d, g.phaseStartedAt + 4, ROSTER, WORD_BANK)).phase).toBe("guessing");
    expect(game(advance(d, g.phaseStartedAt + 30_000, ROSTER, WORD_BANK)).phase).toBe("reveal");
  });

  it("latecomers take a seat at the next turn and draw before the lap ends", () => {
    let d = toGuessing(started());
    const late = { id: "p9", name: "ريان", active: true };
    const roster = [...ROSTER, late];
    expect(guess(d, late.id, "شي", game(d).phaseStartedAt + 1).error).toBe("DR_NOT_SEATED");
    d = advance(d, game(d).phaseStartedAt + 30_000 + REVEAL_MS, roster, WORD_BANK);
    const g = game(d);
    expect(g.phase).toBe("intro");
    expect(g.players.map((p) => p.id)).toContain(late.id);
    expect(g.scores[late.id]).toBe(0);
    expect([g.turn.drawerId, ...g.queue]).toContain(late.id);
    expect(totalTurns(g, new Set(roster.map((r) => r.id)))).toBe(5);
  });

  it("end: final with the current scores; standings rank ties together", () => {
    let d = toGuessing(started());
    const g = game(d);
    const [a, b] = PLAYERS.filter((p) => p.id !== g.turn.drawerId).map((p) => p.id);
    d = ok(guess(d, a, wordOfTurn(d).word, g.phaseStartedAt + 1));
    d = ok(guess(d, b, wordOfTurn(d).word, g.phaseStartedAt + 2));
    d = ok(applyHostMove(d, { type: "skip", phase: "guessing", turn: 0 }, g.phaseStartedAt + 3, ROSTER, WORD_BANK));
    d = ok(applyHostMove(d, { type: "end" }, g.phaseStartedAt + 4, ROSTER, WORD_BANK));
    const f = game(d);
    expect(f.phase).toBe("final");
    expect(f.endedEarly).toBe(true);
    const rows = standings(f);
    expect(rows[0]).toMatchObject({ playerId: a, score: 150, rank: 1 });
    expect(rows.find((r) => r.playerId === g.turn.drawerId)).toMatchObject({ score: 100, rank: 3 });
    expect(rows.find((r) => r.playerId === b)).toMatchObject({ score: 125, rank: 2 });
    expect(winners(f)).toEqual([a]);
    expect(applyHostMove(d, { type: "skip", phase: "final", turn: 0 }, 0, ROSTER, WORD_BANK).error).toBe("GAME_OVER");
  });

  it("checks drawings shape by shape", () => {
    expect(cleanStrokes(LINE)).toEqual(LINE);
    expect(cleanStrokes([{ c: 1, w: 1, p: [1, 2, 3] }])).toBeNull();
    expect(cleanStrokes([{ c: 1, w: 9, p: [1, 2] }])).toBeNull();
    expect(cleanStrokes([{ c: 1, w: 1, p: [1, 1001] }])).toBeNull();
    expect(cleanStrokes([{ c: 1, w: 1, p: [1.5, 2] }])).toBeNull();
    expect(cleanStrokes("x")).toBeNull();
    expect(cleanStrokes(Array.from({ length: 9 }, () => ({ c: 0, w: 0, p: Array(4000).fill(5) })))).toBeNull();
  });
});
