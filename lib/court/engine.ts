/**
 * «المحكمة» game engine: a pure state machine, run only on the server (same
 * model as the other built-in games).
 *
 * - Clients never pick roles, cases or verdicts, count votes or end timers.
 *   They send moves; the server checks them here against the sender's role,
 *   the phase and the case, then saves with an optimistic lock.
 * - Time moves on lazily: every request first runs `advance(...)`, which steps
 *   through every phase whose time ran out, ends the vote once every juror
 *   voted, and pauses the clock while a key role (accused, lawyer,
 *   prosecutor) is away — resuming by itself when they are back.
 * - A case: announce → opening (prosecutor, lawyer) → evidence (one objection
 *   may pause it for the prosecutor's 15 s) → cross-examination (prosecutor,
 *   lawyer) → closing (prosecutor, lawyer) → vote → verdict → standings.
 * - A case is scored exactly once, by the vote → verdict transition.
 * - The truth, the secrets, unpresented exhibits and every classification
 *   stay on the server until the verdict (see views.ts).
 */

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 12;
/** A later case can still run if a player left: three roles and one juror. */
export const MIN_CASE_PLAYERS = 4;
export const DEFAULT_CASES = 3;
export const MAX_CASES = 5;

export const POINTS = { accused: 200, lawyer: 150, prosecutor: 150, juror: 100 } as const;

/** A phone unseen for this long is away. */
export const PRESENCE_MS = 20000;
/** How long the court waits for a key role before the host is offered a way out. */
export const GRACE_MS = 15000;

export type Phase =
  | "announce"
  | "opening_p"
  | "opening_l"
  | "evidence"
  | "objection"
  | "cross_p"
  | "cross_l"
  | "closing_p"
  | "closing_l"
  | "vote"
  | "verdict"
  | "standings"
  | "final";

export const PHASE_MS: Record<Phase, number | null> = {
  announce: 30000,
  opening_p: 60000,
  opening_l: 60000,
  evidence: 105000,
  objection: 15000,
  cross_p: 60000,
  cross_l: 30000,
  closing_p: 30000,
  closing_l: 30000,
  vote: 20000,
  verdict: null,
  standings: null,
  final: null,
};

const ORDER: Phase[] = ["announce", "opening_p", "opening_l", "evidence", "cross_p", "cross_l", "closing_p", "closing_l", "vote", "verdict", "standings"];

/** Phases in which the key roles must be there (the clock waits for them). */
export const HEARING: ReadonlySet<Phase> = new Set(["announce", "opening_p", "opening_l", "evidence", "objection", "cross_p", "cross_l", "closing_p", "closing_l"]);

export type KeyRole = "accused" | "lawyer" | "prosecutor";
export type Role = KeyRole | "juror";
export type Vote = "guilty" | "innocent";
export type EvidenceKind = "true" | "misleading" | "inconclusive";

export interface Exhibit {
  text: string;
  kind: EvidenceKind;
  /** One line shown with the classification at the verdict. */
  why: string;
  /** Upheld objection: this note goes on screen. null = overruled. Fixed in the case data. */
  challenge: string | null;
}

export interface CourtCase {
  id: string;
  title: string;
  summary: string;
  /** The truth. */
  guilty: boolean;
  accusedSecret: string;
  lawyerInfo: string;
  prosecutorInfo: string;
  evidence: readonly [Exhibit, Exhibit, Exhibit];
  explanation: string;
}

export interface CourtSettings {
  cases: number;
}

export interface Verdict {
  guilty: boolean;
  guiltyVotes: number;
  innocentVotes: number;
  /** Nobody voted: not guilty by default. */
  noVotes: boolean;
}

export interface CaseState {
  /** 0-based, within the match. */
  index: number;
  caseId: string;
  accused: string;
  lawyer: string;
  prosecutor: string;
  jurors: string[];
  /** Replaced key roles: they sit this case out (no vote, no points). */
  benched: string[];
  /** Exhibit indexes in the order they were presented. */
  presented: number[];
  /** The one objection: which exhibit, and the evidence time left when it was raised. */
  objection: { exhibit: number; resumeMs: number } | null;
  votes: Record<string, Vote>;
  verdict: Verdict | null;
  /** Set once, at the verdict: playerId → points. */
  gained: Record<string, number> | null;
  /** The host cancelled the case: no verdict, no points. */
  voided: boolean;
  /** Key roles the host chose to go on without: no auto-pause for them until they are back. */
  waived: string[];
}

export interface RoleCount {
  accused: number;
  lawyer: number;
  prosecutor: number;
}

export interface CourtGame {
  /** New for every match. */
  id: string;
  /** Seated players (latecomers are seated at the next case). */
  players: { id: string; name: string }[];
  scores: Record<string, number>;
  /** Key roles each player has held this match (rotation). */
  history: Record<string, RoleCount>;
  /** The cases of this match, in order, no repeats. */
  caseIds: string[];
  case: CaseState;
  phase: Phase;
  phaseStartedAt: number;
  /** Length of the current phase (null = waits for the host). */
  phaseMs: number | null;
  /** Server ms the clock stopped at (null = running). */
  pausedAt: number | null;
  pause: null | "host" | "absent";
  endedEarly: boolean;
}

/** game_sessions.match of a room. `game` null = lobby. */
export interface CourtDoc {
  v: 1;
  court: true;
  settings: CourtSettings;
  /** Cases played in earlier matches of this room (a rematch prefers new ones). */
  played: string[];
  game: CourtGame | null;
}

/** A player in the room: whether their seat is held by a device, and whether that device is around. */
export interface RosterEntry {
  id: string;
  name: string;
  /** The seat is held (not freed by the host). */
  active: boolean;
  /** Seen recently. */
  present: boolean;
}

export type PlayerMove =
  | { type: "present"; case: number; exhibit: number }
  | { type: "object"; case: number; exhibit: number }
  | { type: "vote"; case: number; vote: Vote };

export type HostMove =
  /** `phase`/`case`: what the host was looking at, so a double click acts once. */
  | { type: "next"; phase: Phase; case: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "replace"; role: KeyRole; case: number }
  | { type: "void"; case: number }
  | { type: "end" };

export type EngineResult = { doc: CourtDoc; error?: undefined } | { doc?: undefined; error: string };

export type Rng = () => number;

/** Uniform [0, 1) from the platform CSPRNG (roles and cases must not be guessable). */
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

export const DEFAULT_SETTINGS: CourtSettings = { cases: DEFAULT_CASES };

export const isCaseCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_CASES;

export function newDoc(settings: CourtSettings = DEFAULT_SETTINGS): CourtDoc {
  return { v: 1, court: true, settings: { ...settings }, played: [], game: null };
}

export function applySettings(doc: CourtDoc, patch: Partial<CourtSettings>): EngineResult {
  if (doc.game) return { error: "GAME_ALREADY_STARTED" };
  if (patch.cases === undefined) return { doc };
  if (!isCaseCount(patch.cases)) return { error: "BAD_REQUEST" };
  return { doc: { ...doc, settings: { ...doc.settings, cases: patch.cases } } };
}

/* ------------------------------------------------------------------ */
/* Clock and queries                                                   */
/* ------------------------------------------------------------------ */

export function remainingMs(g: CourtGame, now: number): number | null {
  if (g.phaseMs === null) return null;
  return Math.max(0, g.phaseStartedAt + g.phaseMs - (g.pausedAt ?? now));
}

export const isSeated = (g: CourtGame, id: string) => g.players.some((p) => p.id === id);

export function roleOf(c: CaseState, id: string): Role | "benched" | null {
  if (c.accused === id) return "accused";
  if (c.lawyer === id) return "lawyer";
  if (c.prosecutor === id) return "prosecutor";
  if (c.benched.includes(id)) return "benched";
  if (c.jurors.includes(id)) return "juror";
  return null;
}

export const keyIds = (c: CaseState) => [c.accused, c.lawyer, c.prosecutor];

/** Key roles the hearing is waiting for. */
export function absentKeys(g: CourtGame, roster: readonly RosterEntry[]): string[] {
  const here = new Set(roster.filter((r) => r.active && r.present).map((r) => r.id));
  return keyIds(g.case).filter((id) => !here.has(id) && !g.case.waived.includes(id));
}

/** Jurors who may still vote: seated, holding their seat. */
export function voters(g: CourtGame, roster: readonly RosterEntry[]): string[] {
  const active = new Set(roster.filter((r) => r.active).map((r) => r.id));
  return g.case.jurors.filter((id) => active.has(id) || id in g.case.votes);
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

const ZERO: RoleCount = { accused: 0, lawyer: 0, prosecutor: 0 };
const total = (r: RoleCount | undefined) => (r ? r.accused + r.lawyer + r.prosecutor : 0);

/**
 * The fairest candidate for `role`: fewest key roles so far, then fewest of
 * this role, then not a key role in the previous case; random among equals.
 */
function pick(candidates: string[], role: KeyRole, history: Record<string, RoleCount>, previous: readonly string[], rng: Rng): string {
  const ranked = shuffle(candidates, rng).map((id) => ({
    id,
    key: [total(history[id]), (history[id] ?? ZERO)[role], previous.includes(id) ? 1 : 0],
  }));
  ranked.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
  return ranked[0].id;
}

function count(history: Record<string, RoleCount>, id: string, role: KeyRole): Record<string, RoleCount> {
  const r = history[id] ?? ZERO;
  return { ...history, [id]: { ...r, [role]: r[role] + 1 } };
}

/** Deals a case: three key roles by rotation, everyone else seated is a juror. */
function deal(
  index: number,
  caseId: string,
  players: { id: string; name: string }[],
  roster: readonly RosterEntry[],
  history: Record<string, RoleCount>,
  previous: readonly string[],
  rng: Rng,
): { case: CaseState; history: Record<string, RoleCount> } | null {
  const active = roster.filter((r) => r.active && players.some((p) => p.id === r.id));
  if (active.length < MIN_CASE_PLAYERS) return null;
  // Key roles go to phones that are here; if too few are, to any held seat.
  const here = active.filter((r) => r.present).map((r) => r.id);
  const pool = here.length >= 3 ? here : active.map((r) => r.id);
  let h = history;
  const chosen: Partial<Record<KeyRole, string>> = {};
  // Who is picked first changes nothing about fairness; vary it anyway.
  for (const role of shuffle<KeyRole>(["accused", "prosecutor", "lawyer"], rng)) {
    const left = pool.filter((id) => !Object.values(chosen).includes(id));
    const id = pick(left, role, h, previous, rng);
    chosen[role] = id;
    h = count(h, id, role);
  }
  const keys = Object.values(chosen);
  return {
    history: h,
    case: {
      index,
      caseId,
      accused: chosen.accused!,
      lawyer: chosen.lawyer!,
      prosecutor: chosen.prosecutor!,
      jurors: active.map((r) => r.id).filter((id) => !keys.includes(id)),
      benched: [],
      presented: [],
      objection: null,
      votes: {},
      verdict: null,
      gained: null,
      voided: false,
      waived: [],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

function enter(g: CourtGame, phase: Phase, at: number, patch: Partial<CourtGame> = {}): CourtGame {
  return { ...g, ...patch, phase, phaseStartedAt: at, phaseMs: PHASE_MS[phase], pausedAt: null, pause: null };
}

/** Counts the votes and scores the case. Called once per case (entering the verdict). */
export function decide(g: CourtGame, bank: readonly CourtCase[]): CourtGame {
  const c = g.case;
  const truth = bank.find((x) => x.id === c.caseId)?.guilty ?? false;
  let guiltyVotes = 0;
  let innocentVotes = 0;
  for (const id of c.jurors) {
    if (c.votes[id] === "guilty") guiltyVotes++;
    else if (c.votes[id] === "innocent") innocentVotes++;
  }
  // A tie, or no votes at all, is not guilty.
  const verdict: Verdict = { guilty: guiltyVotes > innocentVotes, guiltyVotes, innocentVotes, noVotes: guiltyVotes + innocentVotes === 0 };
  const gained: Record<string, number> = Object.fromEntries(g.players.map((p) => [p.id, 0]));
  if (verdict.guilty !== truth) gained[c.accused] = POINTS.accused;
  if (!verdict.guilty) gained[c.lawyer] = POINTS.lawyer;
  if (verdict.guilty) gained[c.prosecutor] = POINTS.prosecutor;
  const right: Vote = truth ? "guilty" : "innocent";
  for (const id of c.jurors) if (c.votes[id] === right) gained[id] = POINTS.juror;
  const scores = { ...g.scores };
  for (const [id, pts] of Object.entries(gained)) scores[id] = (scores[id] ?? 0) + pts;
  return { ...g, scores, case: { ...c, verdict, gained } };
}

/** The next case (latecomers take a seat), or the final results after the last one. */
function nextCase(g: CourtGame, at: number, roster: readonly RosterEntry[], rng: Rng): CourtGame | { error: string } {
  const index = g.case.index + 1;
  if (index >= g.caseIds.length) return enter(g, "final", at);
  const players = g.players.slice();
  const scores = { ...g.scores };
  for (const r of roster) {
    if (!r.active || players.length >= MAX_PLAYERS || players.some((p) => p.id === r.id)) continue;
    players.push({ id: r.id, name: r.name });
    scores[r.id] = 0;
  }
  const dealt = deal(index, g.caseIds[index], players, roster, g.history, keyIds(g.case), rng);
  if (!dealt) return { error: `يحتاج ${MIN_CASE_PLAYERS} لاعبين على الأقل` };
  return enter({ ...g, players, scores, history: dealt.history, case: dealt.case }, "announce", at);
}

/** The phase after the current one, entered at `at` (its time ran out, or the host moved on). */
function next(g: CourtGame, at: number, roster: readonly RosterEntry[], bank: readonly CourtCase[], rng: Rng): CourtGame | { error: string } {
  switch (g.phase) {
    case "objection": {
      // Back to the evidence, with the time it had left.
      const full = PHASE_MS.evidence!;
      const left = g.case.objection?.resumeMs ?? 0;
      return { ...enter(g, "evidence", at), phaseStartedAt: at - (full - left) };
    }
    case "vote":
      return enter(decide(g, bank), "verdict", at);
    case "standings":
      return nextCase(g, at, roster, rng);
    case "final":
      return g;
    default:
      return enter(g, ORDER[ORDER.indexOf(g.phase) + 1], at);
  }
}

const pauseAt = (g: CourtGame, at: number, why: "host" | "absent"): CourtGame => ({ ...g, pausedAt: at, pause: why });

function resume(g: CourtGame, at: number): CourtGame {
  if (g.pausedAt === null) return g;
  return { ...g, phaseStartedAt: g.phaseStartedAt + (at - g.pausedAt), pausedAt: null, pause: null };
}

/**
 * Moves the match on to `now`: expired phases, a finished vote, and the
 * absence pause (on when a key role is away during the hearing, off when
 * they are back). Returns `doc` itself when nothing changed.
 */
export function advance(doc: CourtDoc, now: number, roster: readonly RosterEntry[], bank: readonly CourtCase[], rng: Rng = secureRandom): CourtDoc {
  let g = doc.game;
  if (!g) return doc;
  // A waived key role who is back is waited for again if they drop later.
  const back = g.case.waived.filter((id) => roster.some((r) => r.id === id && r.active && r.present));
  if (back.length) g = { ...g, case: { ...g.case, waived: g.case.waived.filter((id) => !back.includes(id)) } };

  for (let step = 0; step < 50; step++) {
    if (g.phaseMs === null) break;
    const away = HEARING.has(g.phase) ? absentKeys(g, roster) : [];
    if (g.pausedAt !== null) {
      if (g.pause === "absent" && away.length === 0) {
        g = resume(g, now);
        continue;
      }
      break;
    }
    const end = g.phaseStartedAt + g.phaseMs;
    if (now >= end) {
      const moved = next(g, end, roster, bank, rng);
      if ("error" in moved) break;
      g = moved;
      continue;
    }
    if (away.length > 0) {
      g = pauseAt(g, now, "absent");
      break;
    }
    if (g.phase === "vote") {
      const who = voters(g, roster);
      if (who.length > 0 && who.every((id) => id in g!.case.votes)) {
        g = enter(decide(g, bank), "verdict", now);
        continue;
      }
    }
    break;
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

/** A fresh match: the cases picked at random (new ones first), the first case dealt, scores at zero. */
export function startGame(doc: CourtDoc, roster: readonly RosterEntry[], now: number, bank: readonly CourtCase[], rng: Rng = secureRandom): EngineResult {
  const seated = roster.filter((r) => r.active);
  const issue = setupIssue(seated.length);
  if (issue) return { error: issue };
  if (bank.length === 0) return { error: "BAD_REQUEST" };
  const fresh = shuffle(bank.filter((c) => !doc.played.includes(c.id)), rng);
  const seen = shuffle(bank.filter((c) => doc.played.includes(c.id)), rng);
  const caseIds = [...fresh, ...seen].slice(0, Math.min(doc.settings.cases, bank.length)).map((c) => c.id);
  const players = seated.map((r) => ({ id: r.id, name: r.name }));
  const dealt = deal(0, caseIds[0], players, roster, {}, [], rng)!;
  const game: CourtGame = {
    id: randomId(rng),
    players,
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    history: dealt.history,
    caseIds,
    case: dealt.case,
    phase: "announce",
    phaseStartedAt: now,
    phaseMs: PHASE_MS.announce,
    pausedAt: null,
    pause: null,
    endedEarly: false,
  };
  const played = [...doc.played.filter((id) => !caseIds.includes(id)), ...caseIds];
  return { doc: { ...doc, played, game } };
}

/* ------------------------------------------------------------------ */
/* Moves (always applied to an already-advanced doc)                   */
/* ------------------------------------------------------------------ */

export function applyPlayerMove(doc: CourtDoc, playerId: string, move: PlayerMove, now: number): EngineResult {
  const g = doc.game;
  if (!g) return { error: "NOT_STARTED" };
  if (!isSeated(g, playerId)) return { error: "CT_NOT_SEATED" };
  const c = g.case;
  if (move.case !== c.index) return { error: "CT_CLOSED" };
  const role = roleOf(c, playerId);

  switch (move.type) {
    case "present": {
      if (role !== "prosecutor") return { error: "CT_NOT_ALLOWED" };
      if (!Number.isInteger(move.exhibit) || move.exhibit < 0 || move.exhibit > 2) return { error: "BAD_REQUEST" };
      if (c.presented.includes(move.exhibit)) return { error: "CT_DUPLICATE" };
      if (g.phase !== "evidence") return { error: "CT_CLOSED" };
      if (g.pausedAt !== null) return { error: "CT_PAUSED" };
      return { doc: { ...doc, game: { ...g, case: { ...c, presented: [...c.presented, move.exhibit] } } } };
    }
    case "object": {
      if (role !== "lawyer") return { error: "CT_NOT_ALLOWED" };
      if (c.objection) return { error: "CT_OBJECTED" };
      if (g.phase !== "evidence") return { error: "CT_CLOSED" };
      if (g.pausedAt !== null) return { error: "CT_PAUSED" };
      if (!c.presented.includes(move.exhibit)) return { error: "CT_NOT_PRESENTED" };
      const resumeMs = remainingMs(g, now) ?? 0;
      return { doc: { ...doc, game: enter({ ...g, case: { ...c, objection: { exhibit: move.exhibit, resumeMs } } }, "objection", now) } };
    }
    case "vote": {
      if (role !== "juror") return { error: "CT_NOT_JUROR" };
      const prev = c.votes[playerId];
      // A retry of the same ballot is fine; a second, different one is not.
      if (prev) return prev === move.vote ? { doc } : { error: "CT_VOTED" };
      if (g.phase !== "vote") return { error: "CT_CLOSED" };
      if (g.pausedAt !== null) return { error: "CT_PAUSED" };
      return { doc: { ...doc, game: { ...g, case: { ...c, votes: { ...c.votes, [playerId]: move.vote } } } } };
    }
  }
}

export function applyHostMove(doc: CourtDoc, move: HostMove, now: number, roster: readonly RosterEntry[], bank: readonly CourtCase[], rng: Rng = secureRandom): EngineResult {
  const g = doc.game;
  if (!g) return { error: "NOT_STARTED" };
  if (g.phase === "final") return move.type === "end" ? { doc } : { error: "GAME_OVER" };
  const c = g.case;
  const set = (game: CourtGame): EngineResult => ({ doc: { ...doc, game } });

  switch (move.type) {
    case "next": {
      // Already moved on (double click, or the clock beat the click): nothing to do.
      if (move.phase !== g.phase || move.case !== c.index) return { doc };
      const moved = next(g, now, roster, bank, rng);
      return "error" in moved ? { error: moved.error } : set(moved);
    }
    case "pause":
      if (g.phaseMs === null || g.pausedAt !== null) return { doc };
      return set(pauseAt(g, now, "host"));
    case "resume": {
      if (g.pausedAt === null) return { doc };
      // Going on without whoever is away: stop waiting for them (until they are back).
      const away = HEARING.has(g.phase) ? absentKeys(g, roster) : [];
      return set(resume({ ...g, case: { ...c, waived: [...c.waived, ...away] } }, now));
    }
    case "replace": {
      if (move.case !== c.index) return { doc };
      if (!HEARING.has(g.phase)) return { error: "CT_CLOSED" };
      const out = c[move.role];
      const active = new Set(roster.filter((r) => r.active).map((r) => r.id));
      const here = new Set(roster.filter((r) => r.active && r.present).map((r) => r.id));
      const candidates = c.jurors.filter((id) => here.has(id));
      const pool = candidates.length ? candidates : c.jurors.filter((id) => active.has(id));
      if (pool.length < 2) return { error: "CT_NO_JUROR" };
      const id = pick(pool, move.role, g.history, [], rng);
      const history = count(g.history, id, move.role);
      return set({
        ...g,
        history,
        case: {
          ...c,
          [move.role]: id,
          jurors: c.jurors.filter((j) => j !== id),
          benched: [...c.benched, out],
          waived: c.waived.filter((w) => w !== out),
        },
      });
    }
    case "void": {
      if (move.case !== c.index) return { doc };
      if (g.phase === "verdict" || g.phase === "standings") return { doc };
      const gained = Object.fromEntries(g.players.map((p) => [p.id, 0]));
      return set(enter({ ...g, case: { ...c, voided: true, gained } }, "standings", now));
    }
    case "end":
      return set({ ...enter(g, "final", now), endedEarly: true });
  }
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export interface Standing {
  playerId: string;
  name: string;
  score: number;
  /** Points from the latest scored case (0 before any). */
  gained: number;
  /** Competition ranking: tied players share a rank (1, 1, 3). */
  rank: number;
}

export function standings(g: CourtGame): Standing[] {
  const gained = g.case.gained ?? {};
  const rows = g.players
    .map((p) => ({ playerId: p.id, name: p.name, score: g.scores[p.id] ?? 0, gained: gained[p.id] ?? 0, rank: 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ar"));
  rows.forEach((r, i) => {
    r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

/** Everyone tied for the top score. Nobody, if nobody scored. */
export function winners(g: CourtGame): string[] {
  return standings(g)
    .filter((r) => r.rank === 1 && r.score > 0)
    .map((r) => r.playerId);
}
