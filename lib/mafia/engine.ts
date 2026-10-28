/**
 * Mafia game engine: a pure state machine, run only on the server.
 *
 * - Clients never assign roles, count votes or end timers. They send moves;
 *   the server checks them here against the current phase, round and clock.
 * - Time moves on lazily: every request first runs `advance(state, now)`,
 *   which steps through every phase whose deadline has passed (or that
 *   closed early). Clients only ask for a refresh when a deadline is due.
 * - The night is collected in full (mafia → detective → doctor) and
 *   resolved once, so a detective or doctor killed that night still acted,
 *   and victory is only checked after the doctor's protection.
 */
import { MAX_PLAYERS, MIN_PLAYERS, roleCounts, SECONDS, SETTLE_MS, type Role } from "./rules";
import {
  NIGHT_PHASES,
  type EngineResult,
  type HostMove,
  type MafiaMatch,
  type MafiaPlayer,
  type NightPhase,
  type NightState,
  type Phase,
  type PlayerMove,
  type Verdict,
} from "./types";

export type Rng = () => number;

/** Uniform [0, 1) from the platform CSPRNG (roles and tie-breaks must not be guessable). */
export const secureRandom: Rng = () => {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
};

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const emptyNight = (): NightState => ({ mafiaVotes: {}, detectiveTargetId: null, doctorTargetId: null });

export function setupIssue(playerCount: number): string | null {
  if (playerCount < MIN_PLAYERS) return `يحتاج ${MIN_PLAYERS} لاعبين على الأقل`;
  if (playerCount > MAX_PLAYERS) return `الحد الأعلى ${MAX_PLAYERS} لاعب`;
  return null;
}

export function createMatch(
  players: { id: string; name: string }[],
  now: number,
  rng: Rng = secureRandom,
): { state: MafiaMatch; error?: undefined } | { state?: undefined; error: string } {
  const issue = setupIssue(players.length);
  if (issue) return { error: issue };
  const counts = roleCounts(players.length)!;
  const roles = shuffle(
    (Object.keys(counts) as Role[]).flatMap((r) => Array<Role>(counts[r]).fill(r)),
    rng,
  );
  const base: MafiaMatch = {
    v: 1,
    round: 1,
    phase: "intro",
    phaseStartedAt: now,
    deadline: null,
    paused: null,
    lastActionAt: null,
    players: players.map((p, i) => ({ id: p.id, name: p.name, role: roles[i], alive: true, out: null })),
    roleSeen: [],
    night: emptyNight(),
    doctorHistory: [],
    investigations: [],
    dawn: null,
    votes: {},
    verdict: null,
    winner: null,
    timeline: [],
  };
  return { state: enter(base, "intro", now) };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export const alive = (m: MafiaMatch) => m.players.filter((p) => p.alive);
export const playerById = (m: MafiaMatch, id: string | null | undefined) => m.players.find((p) => p.id === id);
const aliveWith = (m: MafiaMatch, role: Role) => m.players.filter((p) => p.alive && p.role === role);

/** Who may pick a target in a night phase. */
export function nightActors(m: MafiaMatch, phase: NightPhase): MafiaPlayer[] {
  return aliveWith(m, phase);
}

/** Valid targets for an actor in a night phase. */
export function nightTargets(m: MafiaMatch, phase: NightPhase, actorId: string): MafiaPlayer[] {
  switch (phase) {
    case "mafia":
      return alive(m).filter((p) => p.role !== "mafia");
    case "detective":
      return alive(m).filter((p) => p.id !== actorId);
    case "doctor":
      return alive(m).filter((p) => !m.doctorHistory.includes(p.id));
  }
}

/** A night phase runs only if its role is alive and has someone to act on. */
function nightPhaseRuns(m: MafiaMatch, phase: NightPhase): boolean {
  const actors = nightActors(m, phase);
  return actors.length > 0 && nightTargets(m, phase, actors[0].id).length > 0;
}

function hasActed(m: MafiaMatch, phase: NightPhase, actorId: string): boolean {
  if (phase === "mafia") return actorId in m.night.mafiaVotes;
  if (phase === "detective") return m.night.detectiveTargetId !== null;
  return m.night.doctorTargetId !== null;
}

export function voters(m: MafiaMatch): MafiaPlayer[] {
  return alive(m);
}

export function checkWinner(players: MafiaPlayer[]): MafiaMatch["winner"] {
  const mafia = players.filter((p) => p.alive && p.role === "mafia").length;
  const others = players.filter((p) => p.alive && p.role !== "mafia").length;
  if (mafia === 0) return { team: "citizens", reason: "طلع كل القتلة من المدينة" };
  if (mafia >= others) return { team: "mafia", reason: "صار عدد القتلة يساوي أو أكثر من الباقين" };
  return null;
}

/* ------------------------------------------------------------------ */
/* Phases                                                              */
/* ------------------------------------------------------------------ */

function phaseSeconds(m: MafiaMatch, phase: Phase): number | null {
  switch (phase) {
    case "intro":
      return SECONDS.intro;
    case "roleReveal":
      return SECONDS.roleReveal;
    case "nightfall":
      return SECONDS.nightfall;
    case "mafia":
    case "detective":
    case "doctor":
      return SECONDS[phase];
    case "dawn":
      return m.dawn?.outcome === "killed" ? SECONDS.dawnKilled : m.dawn?.outcome === "saved" ? SECONDS.dawnSaved : SECONDS.dawnQuiet;
    case "discussion":
      return SECONDS.discussion;
    case "voting":
      return SECONDS.voting;
    case "verdict":
      return m.verdict?.outcome === "eliminated" ? SECONDS.verdictEliminated : SECONDS.verdictNone;
    case "gameOver":
      return null;
  }
}

function enter(m: MafiaMatch, phase: Phase, now: number): MafiaMatch {
  const next = { ...m, phase, phaseStartedAt: now, lastActionAt: null, paused: null };
  const secs = phaseSeconds(next, phase);
  return { ...next, deadline: secs === null ? null : now + secs * 1000 };
}

function nextNightPhase(m: MafiaMatch, after: NightPhase | null, now: number, rng: Rng): MafiaMatch {
  const start = after === null ? 0 : NIGHT_PHASES.indexOf(after) + 1;
  for (const phase of NIGHT_PHASES.slice(start)) {
    if (nightPhaseRuns(m, phase)) return enter(m, phase, now);
  }
  return enter(resolveNight(m, rng), "dawn", now);
}

/** Whether the current phase may close before its deadline. */
function closesEarly(m: MafiaMatch, now: number): boolean {
  const settled = m.lastActionAt !== null && now >= m.lastActionAt + SETTLE_MS;
  switch (m.phase) {
    case "roleReveal":
      return settled && m.players.every((p) => m.roleSeen.includes(p.id));
    case "mafia":
    case "detective":
    case "doctor": {
      const phase = m.phase;
      return settled && nightActors(m, phase).every((a) => hasActed(m, phase, a.id));
    }
    case "voting":
      return voters(m).every((p) => p.id in m.votes);
    default:
      return false;
  }
}

function step(m: MafiaMatch, now: number, rng: Rng): MafiaMatch {
  switch (m.phase) {
    case "intro":
      return enter(m, "roleReveal", now);
    case "roleReveal":
      return enter(m, "nightfall", now);
    case "nightfall":
      return nextNightPhase(m, null, now, rng);
    case "mafia":
    case "detective":
    case "doctor":
      return nextNightPhase(m, m.phase, now, rng);
    case "dawn":
      return enter(m, m.winner ? "gameOver" : "discussion", now);
    case "discussion":
      return enter({ ...m, votes: {} }, "voting", now);
    case "voting":
      return enter(tallyVotes(m), "verdict", now);
    case "verdict":
      if (m.winner) return enter(m, "gameOver", now);
      return enter({ ...m, round: m.round + 1, night: emptyNight(), votes: {} }, "nightfall", now);
    case "gameOver":
      return m;
  }
}

/** Runs every phase change that is due at `now`. Returns the same object if nothing changed. */
export function advance(m: MafiaMatch, now: number, rng: Rng = secureRandom): MafiaMatch {
  let s = m;
  for (let i = 0; i < 24; i++) {
    if (s.paused || s.phase === "gameOver") break;
    const due = (s.deadline !== null && now >= s.deadline) || closesEarly(s, now);
    if (!due) break;
    s = step(s, now, rng);
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

/** Most-voted targets (all of them when tied). */
function topOf(counts: Map<string, number>): string[] {
  let max = 0;
  for (const c of counts.values()) max = Math.max(max, c);
  return max === 0 ? [] : [...counts].filter(([, c]) => c === max).map(([k]) => k);
}

export function resolveNight(m: MafiaMatch, rng: Rng = secureRandom): MafiaMatch {
  const counts = new Map<string, number>();
  for (const [voterId, targetId] of Object.entries(m.night.mafiaVotes)) {
    const voter = playerById(m, voterId);
    const target = playerById(m, targetId);
    if (!voter?.alive || voter.role !== "mafia" || !target?.alive || target.role === "mafia") continue;
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }
  const top = topOf(counts);
  // A tie between the mafia's top picks is broken at random.
  const victimId = top.length === 0 ? null : top[Math.floor(rng() * top.length)];
  const protectedId = m.night.doctorTargetId;
  const doctorHistory = protectedId ? [...m.doctorHistory, protectedId] : m.doctorHistory;

  let players = m.players;
  let dawn: MafiaMatch["dawn"];
  if (!victimId) dawn = { outcome: "quiet", victimId: null, role: null };
  else if (protectedId === victimId) dawn = { outcome: "saved", victimId, role: null };
  else {
    players = m.players.map((p) => (p.id === victimId ? { ...p, alive: false, out: { round: m.round, by: "night" as const } } : p));
    dawn = { outcome: "killed", victimId, role: playerById(m, victimId)!.role };
  }
  return {
    ...m,
    players,
    doctorHistory,
    dawn,
    winner: checkWinner(players),
    timeline: [...m.timeline, { round: m.round, kind: "night", outcome: dawn.outcome, playerId: dawn.victimId }],
  };
}

export function tallyVotes(m: MafiaMatch): MafiaMatch {
  const living = voters(m);
  const counts = new Map<string, number>();
  for (const voter of living) {
    const choice = m.votes[voter.id];
    const target = choice && choice !== "skip" ? playerById(m, choice) : undefined;
    // A missing (or no longer valid) vote counts as skip.
    const option = target && target.alive && target.id !== voter.id ? target.id : "skip";
    counts.set(option, (counts.get(option) ?? 0) + 1);
  }
  const tally = [...counts].map(([option, count]) => ({ option, count })).sort((a, b) => b.count - a.count);
  const top = topOf(counts);
  let verdict: Verdict;
  let players = m.players;
  if (top.length !== 1) verdict = { outcome: "tie", targetId: null, role: null, tally };
  else if (top[0] === "skip") verdict = { outcome: "skip", targetId: null, role: null, tally };
  else {
    const targetId = top[0];
    players = m.players.map((p) => (p.id === targetId ? { ...p, alive: false, out: { round: m.round, by: "vote" as const } } : p));
    verdict = { outcome: "eliminated", targetId, role: playerById(m, targetId)!.role, tally };
  }
  return {
    ...m,
    players,
    verdict,
    winner: verdict.outcome === "eliminated" ? checkWinner(players) : m.winner,
    timeline: [...m.timeline, { round: m.round, kind: "vote", outcome: verdict.outcome, playerId: verdict.targetId }],
  };
}

/* ------------------------------------------------------------------ */
/* Moves                                                               */
/* ------------------------------------------------------------------ */

/** A player's move. `now` is the server clock; run `advance` before and after. */
export function applyPlayerMove(m: MafiaMatch, playerId: string, move: PlayerMove, now: number): EngineResult {
  const me = playerById(m, playerId);
  if (!me) return { error: "NOT_A_PLAYER" };

  // The opening sequence runs its full 10 seconds before anyone acts.
  if (m.phase === "intro") return { error: "MF_INTRO" };

  if (move.type === "seeRole") {
    if (m.roleSeen.includes(me.id)) return { state: m };
    return { state: { ...m, roleSeen: [...m.roleSeen, me.id], lastActionAt: m.phase === "roleReveal" ? now : m.lastActionAt } };
  }

  if (m.paused) return { error: "MF_PAUSED" };
  if (move.round !== m.round || (m.deadline !== null && now >= m.deadline)) return { error: "MF_CLOSED" };

  if (move.type === "night") {
    if (move.phase !== m.phase) return { error: "MF_CLOSED" };
    const phase = move.phase;
    if (!me.alive) return { error: "MF_DEAD" };
    if (me.role !== phase) return { error: "MF_NOT_YOURS" };
    if (!nightTargets(m, phase, me.id).some((p) => p.id === move.targetId)) return { error: "MF_TARGET" };
    const night = m.night;
    if (phase === "mafia") {
      if (night.mafiaVotes[me.id] === move.targetId) return { state: m };
      return { state: { ...m, night: { ...night, mafiaVotes: { ...night.mafiaVotes, [me.id]: move.targetId } }, lastActionAt: now } };
    }
    if (phase === "detective") {
      // Seeing a role is instant, so the choice is final for the night.
      if (night.detectiveTargetId === move.targetId) return { state: m };
      if (night.detectiveTargetId !== null) return { error: "MF_LOCKED" };
      const target = playerById(m, move.targetId)!;
      return {
        state: {
          ...m,
          night: { ...night, detectiveTargetId: target.id },
          investigations: [...m.investigations, { round: m.round, targetId: target.id, role: target.role }],
          lastActionAt: now,
        },
      };
    }
    if (night.doctorTargetId === move.targetId) return { state: m };
    return { state: { ...m, night: { ...night, doctorTargetId: move.targetId }, lastActionAt: now } };
  }

  // Day vote.
  if (m.phase !== "voting") return { error: "MF_CLOSED" };
  if (!me.alive) return { error: "MF_DEAD" };
  if (move.choice !== "skip") {
    const target = playerById(m, move.choice);
    if (!target || !target.alive || target.id === me.id) return { error: "MF_TARGET" };
  }
  if (m.votes[me.id] === move.choice) return { state: m };
  return { state: { ...m, votes: { ...m.votes, [me.id]: move.choice } } };
}

export function applyHostMove(m: MafiaMatch, move: HostMove, now: number): EngineResult {
  switch (move.type) {
    case "pause":
      // The intro is a fixed 10 seconds on every screen: it can't be paused.
      if (m.paused || m.phase === "gameOver" || m.phase === "intro") return { state: m };
      return { state: { ...m, paused: { remaining: m.deadline === null ? null : Math.max(0, m.deadline - now) }, deadline: null } };
    case "resume":
      if (!m.paused) return { state: m };
      return {
        state: {
          ...m,
          paused: null,
          deadline: m.paused.remaining === null ? null : now + m.paused.remaining,
          // The settle window starts again, so nobody's last-second change is cut off.
          lastActionAt: m.lastActionAt === null ? null : now,
        },
      };
    case "skipReveal":
      // The host moves the table on from the role cards to the night (the intro can't be skipped).
      if (m.paused || m.phase !== "roleReveal") return { state: m };
      return { state: enter(m, "nightfall", now) };
  }
}
