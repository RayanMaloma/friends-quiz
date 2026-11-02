/**
 * «وزارة المقيمين للفنون والرسم» game engine: a pure state machine, run only
 * on the server (same model as «اخترع إجابتك»).
 *
 * - Clients never pick drawers or words, check guesses, count points or end
 *   timers. They send moves; the server checks them here against the phase,
 *   the turn and the clock, then saves with an optimistic lock.
 * - Time moves on lazily: every request first runs `advance(doc, now, roster)`,
 *   which steps through every phase whose time ran out (or that ended early:
 *   everyone guessed, or the drawer left).
 * - A turn: intro (who draws) → drawing (the word on the drawer's phone only;
 *   the sketch is saved as a server-only draft while drawn) → guessing (the
 *   approved drawing on every screen; typed guesses checked here) → reveal.
 *   Each player draws once per lap; the host picks how many laps.
 * - A phase's length is fixed when it starts: timer edits apply from the next one.
 * - A turn is scored exactly once, by the guessing → reveal transition, in the
 *   order the server received the correct guesses: 150, 125, then 100 each,
 *   and 50 to the drawer per player who got it.
 * - The word and its accepted answers never leave the server before the
 *   reveal, except to the drawer.
 */
import { isCorrectGuess } from "./answers";

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 16;
export const DEFAULT_LAPS = 1;
export const MAX_LAPS = 5;
export const DEFAULT_DRAW_SECONDS = 60;
export const DEFAULT_GUESS_SECONDS = 30;
export const MIN_TIMER_SECONDS = 5;
export const MAX_TIMER_SECONDS = 600;
export const INTRO_MS = 4000;
export const REVEAL_MS = 9000;
/** Points for the 1st, 2nd and every later correct guess. */
export const GUESS_POINTS = [150, 125, 100] as const;
export const DRAWER_POINTS = 50;
export const MAX_GUESS_LENGTH = 40;
export const MAX_ATTEMPTS = 30;
/** A drawer's own "approve" that lands just after the timer approved the draft still counts (nobody has guessed yet). */
export const LATE_SUBMIT_MS = 3000;

/** Drawing limits (the canvas is 1000 × 1000 units). */
export const CANVAS = 1000;
export const COLORS = ["#ffffff", "#14181c", "#d64545", "#f0b429", "#2f9e5b", "#2f6fdb", "#8b5cf6", "#8a5a3c"] as const;
/** Brush widths in canvas units. */
export const SIZES = [6, 14, 28, 56] as const;
export const MAX_STROKES = 800;
export const MAX_POINTS = 16000;
export const MAX_STROKE_POINTS = 4000;

export type Phase = "intro" | "drawing" | "guessing" | "reveal" | "final";

export interface DrawWord {
  id: string;
  word: string;
  /** Other accepted names. */
  also: readonly string[];
  /** 1 easy … 3 harder (internal). */
  level: 1 | 2 | 3;
}

export interface DrawSettings {
  /** Times every player draws. */
  laps: number;
  drawSeconds: number;
  guessSeconds: number;
}

/** One pen stroke: colour index (0 = white, the eraser), size index, points as flat x,y pairs (0–1000). */
export interface Stroke {
  c: number;
  w: number;
  p: number[];
}

export interface DrawTurn {
  /** 0-based, across the whole match. */
  index: number;
  drawerId: string;
  wordId: string;
  /** The approved drawing (null until approved). */
  drawing: Stroke[] | null;
  /** Latest autosave while drawing (server and drawer only). */
  draft: Stroke[];
  /** Bumped whenever `drawing` changes (screens fetch it once per rev). */
  rev: number;
  /** In the order the server received them. */
  correct: { id: string; at: number }[];
  /** Wrong guesses per player (capped). */
  attempts: Record<string, number>;
  /** Set once, when the turn is scored: playerId → points. */
  gained: Record<string, number> | null;
  /** Why the turn had no guessing: the drawer left, or never drew anything. */
  skipped: null | "absent" | "blank";
}

export interface DrawGame {
  /** New for every match. */
  id: string;
  /** Seated players, in seating order (latecomers are seated at the next turn). */
  players: { id: string; name: string }[];
  scores: Record<string, number>;
  phase: Phase;
  phaseStartedAt: number;
  /** Length of the current phase, fixed when it started (null = final). */
  phaseMs: number | null;
  laps: number;
  /** 0-based. */
  lap: number;
  /** Who still draws this lap, in order (the current drawer is not in it). */
  queue: string[];
  turnsDone: number;
  usedWords: string[];
  turn: DrawTurn;
  endedEarly: boolean;
}

/** game_sessions.match of a room. `game` null = lobby. */
export interface DrawDoc {
  v: 1;
  settings: DrawSettings;
  game: DrawGame | null;
}

/** A player in the room: seated or not, and whether their device is still in (the host can free a seat). */
export interface RosterEntry {
  id: string;
  name: string;
  active: boolean;
}

export type PlayerMove =
  | { type: "draft"; turn: number; strokes: Stroke[] }
  | { type: "submit"; turn: number; strokes: Stroke[] }
  | { type: "guess"; turn: number; text: string };

export type HostMove =
  /** `phase`/`turn`: what the host was looking at, so a double click skips once. */
  | { type: "skip"; phase: Phase; turn: number }
  | { type: "timers"; drawSeconds?: number; guessSeconds?: number }
  | { type: "end" };

/** `quiet`: nothing anyone else sees changed (a draft, a wrong guess): save without pinging the room. */
export type EngineResult = { doc: DrawDoc; quiet?: boolean; error?: undefined } | { doc?: undefined; quiet?: undefined; error: string };

export type Rng = () => number;

/** Uniform [0, 1) from the platform CSPRNG (drawer order and words must not be guessable). */
export const secureRandom: Rng = () => {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
};

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomId(rng: Rng): string {
  let s = "";
  for (let i = 0; i < 12; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rng() * 36)];
  return s;
}

/* ------------------------------------------------------------------ */
/* Settings and input                                                  */
/* ------------------------------------------------------------------ */

export const DEFAULT_SETTINGS: DrawSettings = {
  laps: DEFAULT_LAPS,
  drawSeconds: DEFAULT_DRAW_SECONDS,
  guessSeconds: DEFAULT_GUESS_SECONDS,
};

export const isTimerSeconds = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= MIN_TIMER_SECONDS && v <= MAX_TIMER_SECONDS;

export const isLapCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_LAPS;

export function newDoc(settings: DrawSettings = DEFAULT_SETTINGS): DrawDoc {
  return { v: 1, settings: { ...settings }, game: null };
}

/** Trim, collapse whitespace, strip control characters. null = empty or too long. */
export function cleanGuess(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/[\u0000-\u001f\u007f\u200b\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  const length = [...text].length;
  return length >= 1 && length <= MAX_GUESS_LENGTH ? text : null;
}

const isCoord = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= CANVAS;

/** A drawing as sent by a phone, checked shape by shape. null = not a valid drawing. */
export function cleanStrokes(raw: unknown): Stroke[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_STROKES) return null;
  let points = 0;
  const out: Stroke[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") return null;
    const { c, w, p } = s as Record<string, unknown>;
    if (typeof c !== "number" || !Number.isInteger(c) || c < 0 || c >= COLORS.length) return null;
    if (typeof w !== "number" || !Number.isInteger(w) || w < 0 || w >= SIZES.length) return null;
    if (!Array.isArray(p) || p.length < 2 || p.length % 2 !== 0 || p.length > MAX_STROKE_POINTS * 2) return null;
    if (!p.every(isCoord)) return null;
    points += p.length / 2;
    if (points > MAX_POINTS) return null;
    out.push({ c, w, p: p as number[] });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Clock and queries                                                   */
/* ------------------------------------------------------------------ */

export function remainingMs(g: DrawGame, now: number): number | null {
  return g.phaseMs === null ? null : Math.max(0, g.phaseStartedAt + g.phaseMs - now);
}

export const isSeated = (g: DrawGame, playerId: string) => g.players.some((p) => p.id === playerId);

export const hasSolved = (t: DrawTurn, playerId: string) => t.correct.some((c) => c.id === playerId);

/** Who can guess this turn: seated players still in the room, except the drawer. */
export function guessers(g: DrawGame, active: ReadonlySet<string>): string[] {
  return g.players.filter((p) => p.id !== g.turn.drawerId && active.has(p.id)).map((p) => p.id);
}

/** Turns in the whole match, as planned now (latecomers and freed seats move it). */
export function totalTurns(g: DrawGame, active: ReadonlySet<string>): number {
  const seatedActive = g.players.filter((p) => active.has(p.id)).length;
  const current = g.phase === "final" ? 0 : 1;
  return g.turnsDone + current + g.queue.length + Math.max(0, g.laps - g.lap - 1) * seatedActive;
}

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

function phaseLength(settings: DrawSettings, phase: Phase): number | null {
  switch (phase) {
    case "intro":
      return INTRO_MS;
    case "drawing":
      return settings.drawSeconds * 1000;
    case "guessing":
      return settings.guessSeconds * 1000;
    case "reveal":
      return REVEAL_MS;
    case "final":
      return null;
  }
}

function enter(doc: DrawDoc, g: DrawGame, phase: Phase, at: number, patch: Partial<DrawGame> = {}): DrawGame {
  return { ...g, ...patch, phase, phaseStartedAt: at, phaseMs: phaseLength(doc.settings, phase) };
}

/** Easier words come up more often; none twice in a match. */
function pickWord(bank: readonly DrawWord[], used: readonly string[], rng: Rng): DrawWord | null {
  const fresh = bank.filter((w) => !used.includes(w.id));
  const pool = fresh.length > 0 ? fresh : bank;
  if (pool.length === 0) return null;
  const weight = (w: DrawWord) => 4 - w.level;
  let r = rng() * pool.reduce((sum, w) => sum + weight(w), 0);
  for (const w of pool) {
    r -= weight(w);
    if (r < 0) return w;
  }
  return pool[pool.length - 1];
}

function newTurn(index: number, drawerId: string, wordId: string): DrawTurn {
  return { index, drawerId, wordId, drawing: null, draft: [], rev: 0, correct: [], attempts: {}, gained: null, skipped: null };
}

/**
 * Scores the turn. Only ever called once per turn (entering the reveal):
 * correct guesses in server order earn 150 / 125 / 100, the drawer 50 each.
 */
function score(g: DrawGame, turn: DrawTurn): Pick<DrawGame, "turn" | "scores"> {
  const gained: Record<string, number> = Object.fromEntries(g.players.map((p) => [p.id, 0]));
  let rank = 0;
  for (const c of turn.correct) {
    // Checked when the guess came in; checked again so a bad record can never score.
    if (c.id === turn.drawerId || !isSeated(g, c.id)) continue;
    gained[c.id] = GUESS_POINTS[Math.min(rank, GUESS_POINTS.length - 1)];
    rank++;
  }
  if (isSeated(g, turn.drawerId)) gained[turn.drawerId] = (gained[turn.drawerId] ?? 0) + DRAWER_POINTS * rank;
  const scores = { ...g.scores };
  for (const [id, pts] of Object.entries(gained)) scores[id] = (scores[id] ?? 0) + pts;
  return { turn: { ...turn, gained }, scores };
}

/** The reveal of a turn nobody could guess (no points). */
function skipTurn(doc: DrawDoc, g: DrawGame, at: number, why: "absent" | "blank"): DrawGame {
  return enter(doc, g, "reveal", at, score(g, { ...g.turn, correct: [], skipped: why }));
}

/** Drawing is over (timer, approve, skip, or the drawer left): the draft goes on screen if there is one. */
function closeDrawing(doc: DrawDoc, g: DrawGame, at: number, absent: boolean): DrawGame {
  const sketch = g.turn.draft;
  if (sketch.length === 0) return skipTurn(doc, g, at, absent ? "absent" : "blank");
  return enter(doc, g, "guessing", at, { turn: { ...g.turn, drawing: sketch, rev: g.turn.rev + 1 } });
}

/**
 * The next turn: latecomers take a seat (end of this lap's queue), drawers
 * who left are passed over, a new lap starts when the queue runs out, and
 * the match ends after the last lap.
 */
function nextTurn(doc: DrawDoc, g: DrawGame, at: number, roster: readonly RosterEntry[], bank: readonly DrawWord[], rng: Rng): DrawGame {
  const players = g.players.slice();
  const scores = { ...g.scores };
  let queue = g.queue.slice();
  for (const r of roster) {
    if (!r.active || players.length >= MAX_PLAYERS || players.some((p) => p.id === r.id)) continue;
    players.push({ id: r.id, name: r.name });
    scores[r.id] = 0;
    queue.push(r.id);
  }
  const active = new Set(roster.filter((r) => r.active).map((r) => r.id));
  const seated = { ...g, players, scores, turnsDone: g.turnsDone + 1 };
  let lap = g.lap;
  const previous = g.turn.drawerId;
  for (;;) {
    queue = queue.filter((id) => active.has(id) && players.some((p) => p.id === id));
    if (queue.length > 0) break;
    lap++;
    const everyone = players.filter((p) => active.has(p.id)).map((p) => p.id);
    if (lap >= g.laps || everyone.length === 0) return enter(doc, { ...seated, lap: Math.min(lap, g.laps - 1), queue: [] }, "final", at);
    queue = shuffle(everyone, rng);
    // Nobody draws twice in a row across laps.
    if (queue.length > 1 && queue[0] === previous) [queue[0], queue[1]] = [queue[1], queue[0]];
  }
  const [drawerId, ...rest] = queue;
  const word = pickWord(bank, g.usedWords, rng)!;
  return enter(doc, { ...seated, lap, queue: rest, usedWords: [...g.usedWords, word.id] }, "intro", at, {
    turn: newTurn(g.turn.index + 1, drawerId, word.id),
  });
}

/** The phase after the current one, entered at `at` (its timer ran out, or the host skipped). */
function next(doc: DrawDoc, g: DrawGame, at: number, roster: readonly RosterEntry[], bank: readonly DrawWord[], rng: Rng): DrawGame {
  switch (g.phase) {
    case "intro":
      return enter(doc, g, "drawing", at);
    case "drawing":
      return closeDrawing(doc, g, at, false);
    case "guessing":
      return enter(doc, g, "reveal", at, score(g, g.turn));
    case "reveal":
      return nextTurn(doc, g, at, roster, bank, rng);
    case "final":
      return g;
  }
}

/**
 * Steps through every phase that is over at `now`. Returns `doc` itself when
 * nothing changed (callers compare by reference to skip a save).
 */
export function advance(doc: DrawDoc, now: number, roster: readonly RosterEntry[], bank: readonly DrawWord[], rng: Rng = secureRandom): DrawDoc {
  let g = doc.game;
  if (!g) return doc;
  const active = new Set(roster.filter((r) => r.active).map((r) => r.id));
  for (let step = 0; step < 500; step++) {
    if (g.phase === "final" || g.phaseMs === null) break;
    const end = g.phaseStartedAt + g.phaseMs;
    const drawerGone = !active.has(g.turn.drawerId);
    if (now >= end) {
      g = next(doc, g, end, roster, bank, rng);
    } else if (drawerGone && (g.phase === "intro" || g.phase === "drawing")) {
      // The drawer's seat was freed: whatever they drew goes up, or the turn passes.
      g = closeDrawing(doc, g, now, true);
    } else if (g.phase === "guessing") {
      const who = guessers(g, active);
      if (who.length > 0 && who.every((id) => hasSolved(g!.turn, id))) g = enter(doc, g, "reveal", now, score(g, g.turn));
      else break;
    } else {
      break;
    }
  }
  return g === doc.game ? doc : { ...doc, game: g };
}

/* ------------------------------------------------------------------ */
/* Matches                                                             */
/* ------------------------------------------------------------------ */

export function setupIssue(playerCount: number): string | null {
  if (playerCount < MIN_PLAYERS) return `يحتاج ${MIN_PLAYERS} لاعبين على الأقل`;
  if (playerCount > MAX_PLAYERS) return `الحد الأعلى ${MAX_PLAYERS} لاعب`;
  return null;
}

/** A fresh match: everyone draws once per lap, in a random order; scores at zero. */
export function startGame(doc: DrawDoc, players: { id: string; name: string }[], now: number, bank: readonly DrawWord[], rng: Rng = secureRandom): EngineResult {
  const issue = setupIssue(players.length);
  if (issue) return { error: issue };
  const word = pickWord(bank, [], rng);
  if (!word) return { error: "NO_WORDS" };
  const [drawerId, ...queue] = shuffle(players.map((p) => p.id), rng);
  const base: DrawGame = {
    id: randomId(rng),
    players: players.map((p) => ({ id: p.id, name: p.name })),
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    phase: "intro",
    phaseStartedAt: now,
    phaseMs: INTRO_MS,
    laps: doc.settings.laps,
    lap: 0,
    queue,
    turnsDone: 0,
    usedWords: [word.id],
    turn: newTurn(0, drawerId, word.id),
    endedEarly: false,
  };
  return { doc: { ...doc, game: base } };
}

/** Lobby only: laps and timers. */
export function applySettings(doc: DrawDoc, patch: Partial<DrawSettings>): EngineResult {
  if (doc.game) return { error: "GAME_ALREADY_STARTED" };
  const settings = { ...doc.settings };
  if (patch.laps !== undefined) {
    if (!isLapCount(patch.laps)) return { error: "BAD_REQUEST" };
    settings.laps = patch.laps;
  }
  if (patch.drawSeconds !== undefined) {
    if (!isTimerSeconds(patch.drawSeconds)) return { error: "BAD_REQUEST" };
    settings.drawSeconds = patch.drawSeconds;
  }
  if (patch.guessSeconds !== undefined) {
    if (!isTimerSeconds(patch.guessSeconds)) return { error: "BAD_REQUEST" };
    settings.guessSeconds = patch.guessSeconds;
  }
  return { doc: { ...doc, settings } };
}

/* ------------------------------------------------------------------ */
/* Moves (always applied to an already-advanced doc)                   */
/* ------------------------------------------------------------------ */

const sameStrokes = (a: Stroke[] | null, b: Stroke[]) => !!a && JSON.stringify(a) === JSON.stringify(b);

export function applyPlayerMove(doc: DrawDoc, playerId: string, move: PlayerMove, now: number, bank: readonly DrawWord[], known: ReadonlySet<string>): EngineResult {
  const g = doc.game;
  if (!g) return { error: "NOT_STARTED" };
  if (!isSeated(g, playerId)) return { error: "DR_NOT_SEATED" };
  const t = g.turn;
  if (move.turn !== t.index) return { error: "DR_CLOSED" };

  if (move.type === "draft" || move.type === "submit") {
    if (playerId !== t.drawerId) return { error: "DR_NOT_DRAWER" };
    const strokes = cleanStrokes(move.strokes);
    if (!strokes) return { error: "DR_BAD_DRAWING" };
    if (move.type === "draft") {
      // Autosave: only while drawing; a late one changes nothing.
      if (g.phase !== "drawing") return { doc, quiet: true };
      return { doc: { ...doc, game: { ...g, turn: { ...t, draft: strokes } } }, quiet: true };
    }
    if (g.phase === "drawing") {
      if (strokes.length === 0) return { error: "DR_EMPTY" };
      return { doc: { ...doc, game: closeDrawing(doc, { ...g, turn: { ...t, draft: strokes } }, now, false) } };
    }
    // Already approved (a retry, or the timer beat the button by a moment).
    if (g.phase === "guessing") {
      if (sameStrokes(t.drawing, strokes)) return { doc };
      if (strokes.length > 0 && t.correct.length === 0 && now - g.phaseStartedAt <= LATE_SUBMIT_MS) {
        return { doc: { ...doc, game: { ...g, turn: { ...t, draft: strokes, drawing: strokes, rev: t.rev + 1 } } } };
      }
    }
    return { error: "DR_CLOSED" };
  }

  // A guess.
  if (playerId === t.drawerId) return { error: "DR_DRAWER" };
  if (hasSolved(t, playerId)) return { doc };
  if (g.phase !== "guessing") return { error: "DR_CLOSED" };
  const text = cleanGuess(move.text);
  if (!text) return { error: "DR_EMPTY_GUESS" };
  const tries = t.attempts[playerId] ?? 0;
  if (tries >= MAX_ATTEMPTS) return { error: "DR_LIMIT" };
  const word = bank.find((w) => w.id === t.wordId);
  if (word && isCorrectGuess(text, word, known)) {
    return { doc: { ...doc, game: { ...g, turn: { ...t, correct: [...t.correct, { id: playerId, at: now }] } } } };
  }
  return { doc: { ...doc, game: { ...g, turn: { ...t, attempts: { ...t.attempts, [playerId]: tries + 1 } } } }, quiet: true };
}

export function applyHostMove(doc: DrawDoc, move: HostMove, now: number, roster: readonly RosterEntry[], bank: readonly DrawWord[], rng: Rng = secureRandom): EngineResult {
  if (move.type === "timers") {
    const settings = { ...doc.settings };
    if (move.drawSeconds !== undefined) {
      if (!isTimerSeconds(move.drawSeconds)) return { error: "BAD_REQUEST" };
      settings.drawSeconds = move.drawSeconds;
    }
    if (move.guessSeconds !== undefined) {
      if (!isTimerSeconds(move.guessSeconds)) return { error: "BAD_REQUEST" };
      settings.guessSeconds = move.guessSeconds;
    }
    // The running phase keeps its length; the next ones use the new timers.
    return { doc: { ...doc, settings } };
  }

  const g = doc.game;
  if (!g) return { error: "NOT_STARTED" };
  if (g.phase === "final") return move.type === "end" ? { doc } : { error: "GAME_OVER" };

  switch (move.type) {
    case "skip":
      // Already moved on (double click, or the timer beat the click): nothing to skip.
      if (move.phase !== g.phase || move.turn !== g.turn.index) return { doc };
      return { doc: { ...doc, game: next(doc, g, now, roster, bank, rng) } };
    case "end":
      return { doc: { ...doc, game: { ...enter(doc, g, "final", now), queue: [], endedEarly: true } } };
  }
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export interface Standing {
  playerId: string;
  name: string;
  score: number;
  /** Points from the latest scored turn (0 before any). */
  gained: number;
  /** Competition ranking: tied players share a rank (1, 1, 3). */
  rank: number;
}

export function standings(g: DrawGame): Standing[] {
  const gained = g.turn.gained ?? {};
  const rows = g.players
    .map((p) => ({ playerId: p.id, name: p.name, score: g.scores[p.id] ?? 0, gained: gained[p.id] ?? 0, rank: 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ar"));
  rows.forEach((r, i) => {
    r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

/** Everyone tied for the top score. Nobody, if nobody scored. */
export function winners(g: DrawGame): string[] {
  return standings(g)
    .filter((r) => r.rank === 1 && r.score > 0)
    .map((r) => r.playerId);
}
