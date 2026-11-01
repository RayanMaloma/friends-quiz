/**
 * «اخترع إجابتك» game engine: a pure state machine, run only on the server.
 *
 * - Clients never pick questions, shuffle cards, count votes or end timers.
 *   They send moves; the server checks them here against the phase, the
 *   round and the clock, then saves with an optimistic lock.
 * - Time moves on lazily: every request first runs `advance(doc, now)`,
 *   which steps through every phase whose time ran out (or that every
 *   expected player finished early). Clients only knock when a timer is due.
 * - Timers count *active* time: `remaining = max(0, duration − elapsed)`,
 *   where `elapsed` excludes pauses and `duration` is read live from the
 *   settings, so the host can shorten or lengthen the running phase.
 * - Every question has one real answer. Players write fake ones; voting
 *   shows the real answer shuffled in among them, and the reveal shows
 *   which one it was. The real answer never leaves the server before then.
 * - A round is scored exactly once, by the voting → reveal transition:
 *   100 points for picking the real answer, and 100 to a fake answer's
 *   author for every player it fooled.
 * - Questions come from the pool the server passes in (the question bank).
 *   The match keeps the picked questions, so nothing else is needed to show them.
 */

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

export const POINTS_PER_VOTE = 100;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 16;
export const DEFAULT_ROUNDS = 25;
export const DEFAULT_ANSWER_SECONDS = 60;
export const DEFAULT_VOTE_SECONDS = 30;
export const MAX_TIMER_SECONDS = 3600;
export const MAX_ANSWER_LENGTH = 200;
/** Size of the question bank (its questions and answers stay on the server: lib/invent/questions.ts). */
export const QUESTION_BANK_SIZE = 25;
export const REVEAL_MS = 10000;
export const LEADERBOARD_MS = 8000;

/** A round opens straight into answering: the question and the answer box arrive together. */
export type Phase = "answering" | "voting" | "reveal" | "leaderboard" | "final";

export interface InventQuestion {
  id: string;
  text: string;
  /** The real answer: server only until the reveal. Missing in matches saved before real answers existed. */
  answer?: string;
}

export interface InventSettings {
  rounds: number;
  answerSeconds: number;
  voteSeconds: number;
}

export interface InventAnswer {
  /** Random: never derived from the author. */
  id: string;
  authorId: string;
  text: string;
  at: number;
}

export interface InventRound {
  index: number;
  questionId: string;
  /** In submission order (server only). */
  answers: InventAnswer[];
  /** Card ids (the fake answers and the real one) in the one shuffled order the whole room sees (set when voting opens). */
  order: string[];
  /** The real answer's card id: random like the others, set when voting opens. null before (and in older matches). */
  truthId?: string | null;
  /** voterId → card id. */
  votes: Record<string, string>;
  /** Set once, when the round is scored: card id → votes received. */
  tally: Record<string, number> | null;
  /** Set once, with `tally`: playerId → points earned this round. */
  gained: Record<string, number> | null;
  /** Nothing to choose between (no fake answers): straight to the reveal, zero points. */
  votingSkipped: boolean;
}

export interface InventGame {
  /** New for every match (a rematch is a new id). */
  id: string;
  questionIds: string[];
  /** The picked questions, in play order (same order as questionIds). Missing in matches saved before pools existed. */
  questions?: InventQuestion[];
  /** Seated when the match started, in join order. */
  players: { id: string; name: string }[];
  scores: Record<string, number>;
  phase: Phase;
  phaseStartedAt: number;
  /** Active time spent in the phase before `runningSince`; `runningSince` null = paused. */
  clock: { elapsedMs: number; runningSince: number | null };
  round: InventRound;
  endedEarly: boolean;
}

/** game_sessions.match of a room. `game` null = lobby. */
export interface InventDoc {
  v: 1;
  settings: InventSettings;
  game: InventGame | null;
}

export type PlayerMove =
  | { type: "answer"; round: number; text: string }
  | { type: "vote"; round: number; answerId: string };

export type HostMove =
  | { type: "pause" }
  | { type: "resume" }
  /** `phase`/`round`: what the host was looking at, so a double click skips once. */
  | { type: "skip"; phase: Phase; round: number }
  | { type: "timers"; answerSeconds?: number; voteSeconds?: number }
  | { type: "end" };

export type EngineResult = { doc: InventDoc; error?: undefined } | { doc?: undefined; error: string };

export type Rng = () => number;

/** Uniform [0, 1) from the platform CSPRNG (question picks and card order must not be guessable). */
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
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const DEFAULT_SETTINGS: InventSettings = {
  rounds: DEFAULT_ROUNDS,
  answerSeconds: DEFAULT_ANSWER_SECONDS,
  voteSeconds: DEFAULT_VOTE_SECONDS,
};

export const isTimerSeconds = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_TIMER_SECONDS;

/** A match length the room's pool can fill. */
export const isRoundCount = (v: unknown, poolSize: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= poolSize;

export function newDoc(settings: InventSettings = DEFAULT_SETTINGS): InventDoc {
  return { v: 1, settings: { ...settings }, game: null };
}

/**
 * For comparing answers: no diacritics, tatweel, invisible marks,
 * punctuation or spaces; the alef/hamza forms, ى/ي and ة/ه folded together;
 * a leading «ال» dropped from each word; Latin lower-cased; Arabic-Indic
 * digits as 0–9. So «المَزمار», «مزمار» and «المزمار!» all compare equal.
 */
export function normalizeAnswer(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed\u0640]|\p{Cf}/gu, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىی]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .replace(/ک/g, "ك")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.startsWith("ال") ? w.slice(2) : w))
    .join("");
}

/** Trim, collapse whitespace, strip control characters. null = empty or too long. */
export function cleanAnswer(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/[\u0000-\u001f\u007f\u200b\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  const length = [...text].length;
  return length >= 1 && length <= MAX_ANSWER_LENGTH ? text : null;
}

/* ------------------------------------------------------------------ */
/* Clock                                                               */
/* ------------------------------------------------------------------ */

/** How long the current phase lasts (live: follows the settings). null = no timer. */
export function phaseDurationMs(doc: InventDoc, phase: Phase): number | null {
  switch (phase) {
    case "answering":
      return doc.settings.answerSeconds * 1000;
    case "voting":
      return doc.settings.voteSeconds * 1000;
    case "reveal":
      return REVEAL_MS;
    case "leaderboard":
      return LEADERBOARD_MS;
    case "final":
      return null;
  }
}

export const isPaused = (g: InventGame) => g.phase !== "final" && g.clock.runningSince === null;

export function elapsedMs(g: InventGame, now: number): number {
  return g.clock.elapsedMs + (g.clock.runningSince === null ? 0 : Math.max(0, now - g.clock.runningSince));
}

export function remainingMs(doc: InventDoc, now: number): number | null {
  const g = doc.game;
  if (!g) return null;
  const duration = phaseDurationMs(doc, g.phase);
  return duration === null ? null : Math.max(0, duration - elapsedMs(g, now));
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export const isSeated = (g: InventGame, playerId: string) => g.players.some((p) => p.id === playerId);

export const answerOf = (r: InventRound, playerId: string) => r.answers.find((a) => a.authorId === playerId) ?? null;

/** A player can vote when there is a card that is not theirs (the real answer always is). */
export const canVote = (r: InventRound, playerId: string) => !!r.truthId || r.answers.some((a) => a.authorId !== playerId);

/** The real answer of the round being played (undefined in older matches). */
export const truthOf = (g: InventGame): string | undefined => g.questions?.[g.round.index]?.answer || undefined;

/**
 * Everyone expected has acted, so the phase can close before its timer.
 * `active`: seated players whose device is still in the room (the host can
 * free a seat; a freed player no longer holds the room up). With nobody
 * active the timer alone decides.
 */
export function phaseComplete(g: InventGame, active: ReadonlySet<string>): boolean {
  const expected = g.players.filter((p) => active.has(p.id));
  if (g.phase === "answering") {
    return expected.length > 0 && expected.every((p) => answerOf(g.round, p.id));
  }
  if (g.phase === "voting") {
    const voters = expected.filter((p) => canVote(g.round, p.id));
    return voters.length > 0 && voters.every((p) => p.id in g.round.votes);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

function newRound(index: number, questionId: string): InventRound {
  return { index, questionId, answers: [], order: [], truthId: null, votes: {}, tally: null, gained: null, votingSkipped: false };
}

/** Enters `phase` at time `at`, keeping the paused/running state. */
function enter(g: InventGame, phase: Phase, at: number, patch: Partial<InventGame> = {}): InventGame {
  const running = g.clock.runningSince !== null;
  return {
    ...g,
    ...patch,
    phase,
    phaseStartedAt: at,
    clock: { elapsedMs: 0, runningSince: running && phase !== "final" ? at : null },
  };
}

/**
 * Counts the votes and adds the points. Only ever called once per round:
 * picking the real answer earns the voter 100; a fake answer earns its
 * author 100 for every other player who picked it.
 */
function score(g: InventGame, round: InventRound, votingSkipped: boolean): Pick<InventGame, "round" | "scores"> {
  const truthId = round.truthId ?? null;
  const tally: Record<string, number> = Object.fromEntries(round.answers.map((a) => [a.id, 0]));
  if (truthId) tally[truthId] = 0;
  const gained: Record<string, number> = Object.fromEntries(g.players.map((p) => [p.id, 0]));
  const authorOf = new Map(round.answers.map((a) => [a.id, a.authorId]));
  for (const [voterId, cardId] of Object.entries(round.votes)) {
    // Checked when the vote came in; checked again here so a bad record can never score.
    if (!isSeated(g, voterId)) continue;
    if (cardId === truthId) {
      tally[cardId] += 1;
      gained[voterId] = (gained[voterId] ?? 0) + POINTS_PER_VOTE;
      continue;
    }
    const author = authorOf.get(cardId);
    if (!author || author === voterId) continue;
    tally[cardId] += 1;
    gained[author] = (gained[author] ?? 0) + POINTS_PER_VOTE;
  }
  const scores = { ...g.scores };
  for (const [id, pts] of Object.entries(gained)) scores[id] = (scores[id] ?? 0) + pts;
  return { round: { ...round, tally, gained, votingSkipped }, scores };
}

/** A card id no answer of the round has. */
function freshCardId(r: InventRound, rng: Rng): string {
  for (;;) {
    const id = randomId(rng);
    if (!r.answers.some((a) => a.id === id)) return id;
  }
}

/** The phase after the current one, entered at `at`. */
function next(g: InventGame, at: number, rng: Rng): InventGame {
  switch (g.phase) {
    case "answering": {
      const ids = g.round.answers.map((a) => a.id);
      if (truthOf(g)) {
        // The real answer joins the fake ones under a random id, in a random place.
        const truthId = freshCardId(g.round, rng);
        const round = { ...g.round, truthId, order: shuffle([...ids, truthId], rng) };
        // No fake answers: nothing to choose between. Round scores zero.
        if (ids.length === 0) return enter(g, "reveal", at, score(g, round, true));
        return enter(g, "voting", at, { round });
      }
      // Older matches (no real answers): fewer than two answers means nobody can vote for someone else's.
      if (ids.length < 2) return enter(g, "reveal", at, score(g, g.round, true));
      return enter(g, "voting", at, { round: { ...g.round, order: shuffle(ids, rng) } });
    }
    case "voting":
      return enter(g, "reveal", at, score(g, g.round, false));
    case "reveal":
      return enter(g, "leaderboard", at);
    case "leaderboard": {
      const index = g.round.index + 1;
      if (index >= g.questionIds.length) return enter(g, "final", at);
      return enter(g, "answering", at, { round: newRound(index, g.questionIds[index]) });
    }
    case "final":
      return g;
  }
}

/**
 * Steps through every phase that is over at `now`. Returns `doc` itself when
 * nothing changed (callers compare by reference to skip a save).
 */
export function advance(doc: InventDoc, now: number, active: ReadonlySet<string>, rng: Rng = secureRandom): InventDoc {
  let g = doc.game;
  if (!g) return doc;
  // A match saved while rounds still opened with a question-only intro: that intro is now answering time.
  if ((g.phase as string) === "question") g = { ...g, phase: "answering" };
  for (let step = 0; step < 500; step++) {
    if (g.phase === "final" || g.clock.runningSince === null) break;
    const duration = phaseDurationMs(doc, g.phase)!;
    const elapsed = elapsedMs(g, now);
    if (elapsed >= duration) {
      // The moment the timer ran out (never before the phase's current run began).
      const at = Math.max(g.clock.runningSince, g.clock.runningSince + duration - g.clock.elapsedMs);
      g = next(g, Math.min(at, now), rng);
    } else if (phaseComplete(g, active)) {
      g = next(g, now, rng);
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

/** A fresh match: new random questions from the room's pool, scores at zero. */
export function startGame(
  doc: InventDoc,
  players: { id: string; name: string }[],
  now: number,
  pool: readonly InventQuestion[],
  rng: Rng = secureRandom,
): EngineResult {
  const issue = setupIssue(players.length);
  if (issue) return { error: issue };
  if (pool.length === 0) return { error: "NO_QUESTIONS" };
  // Never more rounds than questions, even if the pool shrank since the setting was saved.
  const rounds = Math.min(doc.settings.rounds, pool.length);
  const questions = shuffle(pool, rng)
    .slice(0, rounds)
    .map((q) => ({ id: q.id, text: q.text, ...(q.answer ? { answer: q.answer } : {}) }));
  const questionIds = questions.map((q) => q.id);
  const game: InventGame = {
    id: randomId(rng),
    questionIds,
    questions,
    players: players.map((p) => ({ id: p.id, name: p.name })),
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    phase: "answering",
    phaseStartedAt: now,
    clock: { elapsedMs: 0, runningSince: now },
    round: newRound(0, questionIds[0]),
    endedEarly: false,
  };
  return { doc: { ...doc, game } };
}

/** Lobby only: the match length (at most the pool size) and timers. */
export function applySettings(doc: InventDoc, patch: Partial<InventSettings>, poolSize: number): EngineResult {
  if (doc.game) return { error: "GAME_ALREADY_STARTED" };
  const settings = { ...doc.settings };
  if (patch.rounds !== undefined) {
    if (!isRoundCount(patch.rounds, poolSize)) return { error: "BAD_REQUEST" };
    settings.rounds = patch.rounds;
  }
  if (patch.answerSeconds !== undefined) {
    if (!isTimerSeconds(patch.answerSeconds)) return { error: "BAD_REQUEST" };
    settings.answerSeconds = patch.answerSeconds;
  }
  if (patch.voteSeconds !== undefined) {
    if (!isTimerSeconds(patch.voteSeconds)) return { error: "BAD_REQUEST" };
    settings.voteSeconds = patch.voteSeconds;
  }
  return { doc: { ...doc, settings } };
}

/* ------------------------------------------------------------------ */
/* Moves (always applied to an already-advanced doc)                   */
/* ------------------------------------------------------------------ */

export function applyPlayerMove(doc: InventDoc, playerId: string, move: PlayerMove, now: number): EngineResult {
  const g = doc.game;
  if (!g) return { error: "NOT_STARTED" };
  if (!isSeated(g, playerId)) return { error: "IV_NOT_SEATED" };
  if (move.round !== g.round.index) return { error: "IV_CLOSED" };

  if (move.type === "answer") {
    const text = cleanAnswer(move.text);
    const existing = answerOf(g.round, playerId);
    // A retry of the same request is fine (even one that lands after the
    // phase moved on, e.g. from a second tab); a different answer is not.
    if (existing) return existing.text === text ? { doc } : { error: "IV_ANSWERED" };
    if (g.phase !== "answering") return { error: "IV_CLOSED" };
    if (!text) return { error: "IV_EMPTY" };
    // The real answer (however it is spelled) and another player's answer are taken.
    const key = normalizeAnswer(text);
    const truth = truthOf(g);
    if (truth && key === normalizeAnswer(truth)) return { error: "IV_TRUTH" };
    if (g.round.answers.some((a) => normalizeAnswer(a.text) === key)) return { error: "IV_TAKEN" };
    const answer: InventAnswer = { id: uniqueAnswerId(g.round), authorId: playerId, text, at: now };
    return { doc: { ...doc, game: { ...g, round: { ...g.round, answers: [...g.round.answers, answer] } } } };
  }

  const previous = g.round.votes[playerId];
  if (previous) return previous === move.answerId ? { doc } : { error: "IV_VOTED" };
  if (g.phase !== "voting") return { error: "IV_CLOSED" };
  if (!g.round.truthId || move.answerId !== g.round.truthId) {
    const target = g.round.answers.find((a) => a.id === move.answerId);
    if (!target) return { error: "IV_BAD_CHOICE" };
    if (target.authorId === playerId) return { error: "IV_OWN_ANSWER" };
  }
  return { doc: { ...doc, game: { ...g, round: { ...g.round, votes: { ...g.round.votes, [playerId]: move.answerId } } } } };
}

function uniqueAnswerId(r: InventRound): string {
  for (;;) {
    const id = randomId(secureRandom);
    if (!r.answers.some((a) => a.id === id)) return id;
  }
}

export function applyHostMove(doc: InventDoc, move: HostMove, now: number, rng: Rng = secureRandom): EngineResult {
  if (move.type === "timers") {
    const settings = { ...doc.settings };
    if (move.answerSeconds !== undefined) {
      if (!isTimerSeconds(move.answerSeconds)) return { error: "BAD_REQUEST" };
      settings.answerSeconds = move.answerSeconds;
    }
    if (move.voteSeconds !== undefined) {
      if (!isTimerSeconds(move.voteSeconds)) return { error: "BAD_REQUEST" };
      settings.voteSeconds = move.voteSeconds;
    }
    // Only the duration changes: elapsed time, answers and votes stay. The
    // caller's `advance` then closes the phase if it is now over.
    return { doc: { ...doc, settings } };
  }

  const g = doc.game;
  if (!g) return { error: "NOT_STARTED" };
  if (g.phase === "final") return move.type === "end" ? { doc } : { error: "GAME_OVER" };

  switch (move.type) {
    case "pause":
      if (g.clock.runningSince === null) return { doc };
      return { doc: { ...doc, game: { ...g, clock: { elapsedMs: elapsedMs(g, now), runningSince: null } } } };
    case "resume":
      if (g.clock.runningSince !== null) return { doc };
      return { doc: { ...doc, game: { ...g, clock: { ...g.clock, runningSince: now } } } };
    case "skip":
      // Already moved on (double click, or the timer beat the click): nothing to skip.
      if (move.phase !== g.phase || move.round !== g.round.index) return { doc };
      return { doc: { ...doc, game: next(g, now, rng) } };
    case "end":
      return { doc: { ...doc, game: { ...enter(g, "final", now), endedEarly: true } } };
  }
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export interface Standing {
  playerId: string;
  name: string;
  score: number;
  /** Points from the latest scored round (0 before any). */
  gained: number;
  /** Competition ranking: tied players share a rank (1, 1, 3). */
  rank: number;
}

export function standings(g: InventGame): Standing[] {
  const gained = g.round.gained ?? {};
  const rows = g.players
    .map((p) => ({ playerId: p.id, name: p.name, score: g.scores[p.id] ?? 0, gained: gained[p.id] ?? 0, rank: 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ar"));
  rows.forEach((r, i) => {
    r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

/** Everyone tied for the top score (joint winners). Nobody, if nobody scored. */
export function winners(g: InventGame): string[] {
  const rows = standings(g);
  return rows.filter((r) => r.rank === 1 && r.score > 0).map((r) => r.playerId);
}
