/**
 * «انقطاع الاتصال» — the match engine: a pure state machine run only on the
 * server (same model as the other built-in games).
 *
 * - One JSON document per room (`game_sessions.match`), saved by the route
 *   with the `match_version` optimistic lock: two commands sent at the same
 *   instant are applied one after the other on the latest state, never both
 *   on the same old one.
 * - The clock: the match's active time (pauses and crew holds excluded) is
 *   measured by the server only, and the station moves in whole one-second
 *   ticks. `advance(doc, now)` runs every tick that has elapsed since the last
 *   request, so the result never depends on how often devices poll.
 * - Commands are applied at the tick they arrive, after the clock caught up.
 *   A command is accepted only from the player currently holding its panel.
 * - Missions start on a schedule (one after another, or overlapping in the
 *   harder levels), and complete only when their stable state holds.
 * - Scoring is computed once, when the match ends.
 */
import { act, initialSim, log, step, type Command, type Physics, type SectionId, type Sim } from "./sim";
import { MISSIONS, type Ctx, type MissionId, type MissionParams } from "./missions";
import { baseAssignment, panelOf, redistribute, type Assignment } from "./roles";

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

export type Difficulty = "easy" | "medium" | "hard";
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

export interface Level {
  missions: number;
  seconds: number;
  ph: Physics;
  /** Next mission may start this many seconds after the previous one started, even if unsolved. */
  overlap: number | null;
  /** Mission indexes that may overlap (null = all from the second). */
  overlapAt: number[] | null;
  cipher: boolean;
  /** How many code missions also get a fake message (in mission order). */
  decoys: number;
  drift: boolean;
  blackout: { first: number; every: number; seconds: number; count: number } | null;
  /** Comms mission window, seconds. */
  window: number;
  backupWarm: number;
  /** Missions after the first (always the reactor); shuffled, then `last` appended. */
  pool: MissionId[];
  last: MissionId | null;
}

export const LEVELS: Record<Difficulty, Level> = {
  easy: {
    missions: 3,
    seconds: 12 * 60,
    ph: { heat: 0.35, o2Use: 0.25, leak: 0.8, backupHeat: 0.6, meltdownGrace: 30, blackoutLimit: 75, diagnosisForMaintenance: true },
    overlap: null,
    overlapAt: null,
    cipher: false,
    decoys: 0,
    drift: false,
    blackout: null,
    window: 300,
    backupWarm: 45,
    pool: ["oxygen", "leak"],
    last: null,
  },
  medium: {
    missions: 5,
    seconds: 10 * 60,
    ph: { heat: 0.45, o2Use: 0.3, leak: 1.0, backupHeat: 1.0, meltdownGrace: 20, blackoutLimit: 60, diagnosisForMaintenance: false },
    overlap: 45,
    overlapAt: [3],
    cipher: true,
    decoys: 1,
    drift: false,
    blackout: { first: 110, every: 190, seconds: 20, count: 2 },
    window: 200,
    backupWarm: 65,
    pool: ["oxygen", "generator", "leak", "comms"],
    last: null,
  },
  hard: {
    missions: 7,
    seconds: 8 * 60,
    ph: { heat: 0.6, o2Use: 0.35, leak: 1.2, backupHeat: 1.4, meltdownGrace: 20, blackoutLimit: 45, diagnosisForMaintenance: false },
    overlap: 40,
    // Never during the opening reactor fault; from then on, faults may stack.
    overlapAt: [2, 3, 4, 5, 6],
    cipher: true,
    decoys: 9,
    drift: true,
    blackout: { first: 60, every: 85, seconds: 25, count: 5 },
    window: 150,
    backupWarm: 75,
    pool: ["oxygen", "generator", "leak", "comms", "security"],
    last: "dual",
  },
};

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
/** Seconds between a mission ending and the next one starting (no overlap). */
export const MISSION_GAP = 6;
export const FIRST_MISSION_AT = 3;
/** A player not heard from for this long is shown offline… */
export const OFFLINE_MS = 25_000;
/** …and after this grace their panels go to the others. */
export const REASSIGN_MS = 45_000;
/** Phones re-report presence at most this often (quiet saves). */
export const SEEN_EVERY_MS = 10_000;
/** No more than two faults run at once (the dual fault counts as one). */
export const MAX_ACTIVE = 2;

export const POINTS = { mission: 1000, second: 10, error: 150, clean: 500 } as const;
/** Grade thresholds, as a share of the level's maximum possible score. */
export const GRADES: { grade: "S" | "A" | "B"; min: number }[] = [
  { grade: "S", min: 0.68 },
  { grade: "A", min: 0.58 },
  { grade: "B", min: 0.48 },
];

/* ------------------------------------------------------------------ */
/* Document                                                            */
/* ------------------------------------------------------------------ */

export interface OutageSettings {
  difficulty: Difficulty;
}

export interface MissionRun {
  id: MissionId;
  status: "waiting" | "active" | "done";
  startTick: number | null;
  doneTick: number | null;
  /** Consecutive stable seconds. */
  held: number;
  params: MissionParams;
}

export interface Blackout {
  playerId: string;
  from: number;
  to: number;
}

export interface ScoreCard {
  completed: number;
  total: number;
  remaining: number;
  errors: number;
  collapses: number;
  points: { missions: number; time: number; errors: number; clean: number };
  score: number;
  max: number;
  grade: "S" | "A" | "B" | "C" | "F";
}

export type Outcome = "success" | "failed" | "aborted";

export interface OutageGame {
  id: string;
  seed: number;
  difficulty: Difficulty;
  /** Seated players, in seat order. */
  players: { id: string; name: string }[];
  base: Assignment;
  assignment: Assignment;
  startedAt: number;
  /** Active time = (frozenAt ?? now) − startedAt − frozenMs. */
  frozenAt: number | null;
  frozenMs: number;
  paused: boolean;
  /** Fewer than two engineers connected: the station waits for them. */
  held: boolean;
  totalTicks: number;
  sim: Sim;
  missions: MissionRun[];
  blackouts: Blackout[];
  blackoutOrder: string[];
  blackoutTicks: number[];
  seen: Record<string, number>;
  msgSeq: number;
  outcome: Outcome | null;
  endTick: number | null;
  reason: string | null;
  score: ScoreCard | null;
}

/** game_sessions.match of a room. `game` null = lobby. */
export interface OutageDoc {
  v: 1;
  kind: "outage";
  settings: OutageSettings;
  game: OutageGame | null;
}

export interface RosterEntry {
  id: string;
  name: string;
  active: boolean;
}

export type EngineResult = { doc: OutageDoc; error?: string; quiet?: boolean };

export const DEFAULT_SETTINGS: OutageSettings = { difficulty: "easy" };

export const newDoc = (settings: OutageSettings = DEFAULT_SETTINGS): OutageDoc => ({ v: 1, kind: "outage", settings, game: null });

export const isDifficulty = (v: unknown): v is Difficulty => DIFFICULTIES.includes(v as Difficulty);

/* ------------------------------------------------------------------ */
/* Random (seeded, reproducible)                                       */
/* ------------------------------------------------------------------ */

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const digits = (n: number) => Array.from({ length: n }, () => String(int(0, 9))).join("");
  return { next, int, shuffle, digits };
}

const SIGS = ["K7", "R2", "M4", "T9", "Z3", "H6", "N8", "Q5"];

/* ------------------------------------------------------------------ */
/* Lobby & start                                                       */
/* ------------------------------------------------------------------ */

export function applySettings(doc: OutageDoc, patch: Partial<OutageSettings>): EngineResult {
  if (doc.game) return { doc, error: "اللعبة بدأت" };
  if (patch.difficulty !== undefined && !isDifficulty(patch.difficulty)) return { doc, error: "BAD_REQUEST" };
  return { doc: { ...doc, settings: { ...doc.settings, ...patch } } };
}

/** Starts a match for the seated players (3–8). `seed` makes everything reproducible. */
export function startGame(doc: OutageDoc, players: { id: string; name: string }[], now: number, seed: number): EngineResult {
  if (players.length < MIN_PLAYERS) return { doc, error: `يلزم ${MIN_PLAYERS} لاعبين على الأقل` };
  if (players.length > MAX_PLAYERS) return { doc, error: `الحد الأقصى ${MAX_PLAYERS} لاعبين` };
  const difficulty = doc.settings.difficulty;
  const level = LEVELS[difficulty];
  const r = rng(seed);

  const seats = r.shuffle(players);
  const base = baseAssignment(seats.map((p) => p.id));

  const order: MissionId[] = (["reactor"] as MissionId[]).concat(r.shuffle(level.pool)).slice(0, level.missions - (level.last ? 1 : 0));
  if (level.last) order.push(level.last);

  const sim = initialSim();
  const [sig, ...otherSigs] = r.shuffle(SIGS);
  sim.comms.sig = sig;
  sim.comms.key = level.cipher ? r.int(1, 9) : 0;

  const faultCodes = r.shuffle(Array.from({ length: 80 }, (_, i) => `E-${i + 12}`));
  let decoysLeft = level.decoys;
  const missions: MissionRun[] = order.map((id, i) => {
    const code = r.digits(4);
    const usesCode = id === "reactor" || id === "oxygen" || id === "security";
    const decoys: MissionParams["decoys"] = [];
    if (usesCode && decoysLeft > 0) {
      decoysLeft -= 1;
      let fake = r.digits(4);
      while (fake === code) fake = r.digits(4);
      decoys.push({ sig: otherSigs[i % otherSigs.length], code: fake });
    }
    const sections = r.shuffle(["A", "B", "C"] as SectionId[]);
    let peak = r.int(10, 90);
    while (Math.abs(peak - sim.comms.peak) < 10) peak = r.int(10, 90);
    return {
      id,
      status: "waiting",
      startTick: null,
      doneTick: null,
      held: 0,
      params: {
        code,
        split: difficulty === "hard" && id === "security",
        section: sections[0],
        decoySection: level.drift ? sections[1] : null,
        peak,
        handshake: r.digits(3),
        faultCode: faultCodes[i * 2],
        faultCode2: faultCodes[i * 2 + 1],
        decoys,
      },
    };
  });

  const blackoutTicks: number[] = [];
  const totalTicks = level.seconds;
  if (level.blackout) {
    for (let k = 0; k < level.blackout.count; k++) {
      const at = level.blackout.first + k * level.blackout.every;
      if (at + level.blackout.seconds < totalTicks - 15) blackoutTicks.push(at);
    }
  }

  const game: OutageGame = {
    id: `${seed.toString(36)}-${now.toString(36)}`,
    seed,
    difficulty,
    players: seats,
    base,
    assignment: { ...base },
    startedAt: now,
    frozenAt: null,
    frozenMs: 0,
    paused: false,
    held: false,
    totalTicks,
    sim,
    missions,
    blackouts: [],
    blackoutOrder: r.shuffle(seats.map((p) => p.id)),
    blackoutTicks,
    seen: Object.fromEntries(seats.map((p) => [p.id, now])),
    msgSeq: 0,
    outcome: null,
    endTick: null,
    reason: null,
    score: null,
  };
  return { doc: { ...doc, game } };
}

/* ------------------------------------------------------------------ */
/* Clock                                                               */
/* ------------------------------------------------------------------ */

export const activeMs = (g: OutageGame, now: number) => Math.max(0, (g.frozenAt ?? now) - g.startedAt - g.frozenMs);

/** Seconds left on the mission clock. */
export const secondsLeft = (g: OutageGame) => Math.max(0, g.totalTicks - g.sim.t);

function setFrozen(g: OutageGame, now: number, kind: "paused" | "held", on: boolean) {
  const before = g.paused || g.held;
  g[kind] = on;
  const after = g.paused || g.held;
  if (!before && after) g.frozenAt = now;
  if (before && !after && g.frozenAt !== null) {
    g.frozenMs += now - g.frozenAt;
    g.frozenAt = null;
  }
}

const ctxOf = (level: Level): Ctx => ({ ph: level.ph, cipher: level.cipher, window: level.window, backupWarm: level.backupWarm });

/** Who is connected now (seen recently and still holding their seat). */
export function onlineIds(g: OutageGame, roster: readonly RosterEntry[], now: number): Set<string> {
  const active = new Set(roster.filter((p) => p.active).map((p) => p.id));
  return new Set(g.players.filter((p) => active.has(p.id) && now - (g.seen[p.id] ?? 0) < OFFLINE_MS).map((p) => p.id));
}

/** Still counted on: connected, or offline for less than the grace period (a released seat is gone at once). */
function presentIds(g: OutageGame, roster: readonly RosterEntry[], now: number): Set<string> {
  const active = new Set(roster.filter((p) => p.active).map((p) => p.id));
  return new Set(g.players.filter((p) => active.has(p.id) && now - (g.seen[p.id] ?? 0) < REASSIGN_MS).map((p) => p.id));
}

/**
 * Brings the match up to `now`: runs every elapsed second, then updates
 * presence (crew hold, panel redistribution). Returns the same object when
 * nothing changed.
 */
export function advance(doc: OutageDoc, now: number, roster: readonly RosterEntry[]): OutageDoc {
  const g0 = doc.game;
  if (!g0 || g0.outcome) return doc;
  const target = Math.min(g0.totalTicks, Math.floor(activeMs(g0, now) / 1000));
  const online = onlineIds(g0, roster, now);
  const present = presentIds(g0, roster, now);
  const assignment = redistribute(g0.base, g0.players.map((p) => p.id), present);
  const held = online.size < 2;
  const sameAssignment = Object.keys(assignment).every((k) => assignment[k as keyof Assignment] === g0.assignment[k as keyof Assignment]);
  if (target <= g0.sim.t && held === g0.held && sameAssignment) return doc;

  const g: OutageGame = structuredClone(g0);
  const level = LEVELS[g.difficulty];
  const ctx = ctxOf(level);
  while (g.sim.t < target && !g.outcome) tick(g, level, ctx, online);
  if (!g.outcome) {
    setFrozen(g, now, "held", held);
    if (!sameAssignment) {
      g.assignment = assignment;
      log(g.sim, "إعادة توزيع المهام");
    }
  }
  return { ...doc, game: g };
}

/** One second of the match. Mutates `g`. */
function tick(g: OutageGame, level: Level, ctx: Ctx, online: ReadonlySet<string>) {
  const s = g.sim;
  step(s, level.ph);

  // Running missions: specific failures, then stability.
  for (const m of g.missions) {
    if (m.status !== "active") continue;
    const def = MISSIONS[m.id];
    const reason = def.failure?.(s, m.params, ctx, s.t - (m.startTick ?? s.t));
    if (reason) return end(g, "failed", reason);
    m.held = def.stable(s, m.params) ? m.held + 1 : 0;
    if (m.held >= def.hold) {
      m.status = "done";
      m.doneTick = s.t;
      log(s, `تم: ${def.title}`);
    }
  }

  // Station-wide failures.
  if (s.reactor.temp >= 150 || s.reactor.critical >= level.ph.meltdownGrace) return end(g, "failed", "انصهار المفاعل");
  if (s.life.o2 <= 15) return end(g, "failed", "انهار مستوى الأكسجين");

  if (g.missions.every((m) => m.status === "done")) return end(g, "success", null);

  schedule(g, level, ctx);

  // In-game blackouts (social rule only: nothing is cut on the device).
  if (level.blackout) {
    if (g.blackoutTicks.includes(s.t)) {
      const eligible = g.blackoutOrder.filter((id) => online.has(id));
      if (eligible.length >= 3) {
        const done = g.blackouts.length;
        const who = eligible[done % eligible.length];
        g.blackouts.push({ playerId: who, from: s.t, to: s.t + level.blackout.seconds });
      }
    }
  }

  if (s.t >= g.totalTicks) return end(g, "failed", "انتهى الوقت");
}

function schedule(g: OutageGame, level: Level, ctx: Ctx) {
  const s = g.sim;
  const i = g.missions.findIndex((m) => m.status === "waiting");
  if (i < 0) return;
  let ready: boolean;
  if (i === 0) {
    ready = s.t >= FIRST_MISSION_AT;
  } else {
    const prev = g.missions[i - 1];
    const afterPrev = prev.status === "done" && s.t >= (prev.doneTick ?? 0) + MISSION_GAP;
    const active = g.missions.filter((m) => m.status === "active").length;
    const overlapOk = level.overlap !== null && (level.overlapAt === null || level.overlapAt.includes(i)) && prev.startTick !== null && s.t >= prev.startTick + level.overlap && active < MAX_ACTIVE;
    ready = afterPrev || (overlapOk && prev.status === "active");
  }
  if (!ready) return;
  const m = g.missions[i];
  m.status = "active";
  m.startTick = s.t;
  MISSIONS[m.id].setup(s, m.params, ctx, (msg) => {
    g.msgSeq += 1;
    s.messages.push({ ...msg, id: `m${g.msgSeq}`, got: null, decoded: null });
  });
  log(s, `عطل: ${MISSIONS[m.id].title}`);
}

function end(g: OutageGame, outcome: Outcome, reason: string | null) {
  g.outcome = outcome;
  g.endTick = g.sim.t;
  g.reason = reason;
  g.paused = false;
  g.held = false;
  g.frozenAt = null;
  g.blackouts = g.blackouts.map((b) => ({ ...b, to: Math.min(b.to, g.sim.t) }));
  g.score = scoreOf(g);
}

/* ------------------------------------------------------------------ */
/* Score                                                               */
/* ------------------------------------------------------------------ */

export function maxScore(level: Level): number {
  return level.missions * POINTS.mission + level.seconds * POINTS.second + POINTS.clean;
}

export function scoreOf(g: OutageGame): ScoreCard {
  const level = LEVELS[g.difficulty];
  const completed = g.missions.filter((m) => m.status === "done").length;
  const success = g.outcome === "success";
  const remaining = success ? Math.max(0, g.totalTicks - g.sim.t) : 0;
  const points = {
    missions: completed * POINTS.mission,
    time: remaining * POINTS.second,
    errors: -g.sim.errors * POINTS.error,
    clean: success && g.sim.collapses === 0 ? POINTS.clean : 0,
  };
  const score = Math.max(0, points.missions + points.time + points.errors + points.clean);
  const max = maxScore(level);
  const grade = success ? (GRADES.find((x) => score >= x.min * max)?.grade ?? "C") : "F";
  return { completed, total: g.missions.length, remaining, errors: g.sim.errors, collapses: g.sim.collapses, points, score, max, grade };
}

/* ------------------------------------------------------------------ */
/* Moves                                                               */
/* ------------------------------------------------------------------ */

/** A player's command. `doc` is already advanced to `now`. */
export function applyCommand(doc: OutageDoc, playerId: string, cmd: Command, now: number): EngineResult {
  const g0 = doc.game;
  if (!g0) return { doc, error: "لم تبدأ المهمة" };
  if (!g0.players.some((p) => p.id === playerId)) return { doc, error: "NOT_SEATED" };
  if (g0.outcome) return { doc, error: "انتهت المهمة" };
  if (g0.paused) return { doc, error: "اللعبة متوقفة" };
  if (g0.held) return { doc, error: "بانتظار المهندسين" };
  if (g0.assignment[panelOf(cmd)] !== playerId) return { doc, error: "ليست من صلاحياتك" };
  const g: OutageGame = structuredClone(g0);
  g.seen[playerId] = now;
  const res = act(g.sim, cmd);
  return res === null ? { doc: { ...doc, game: g } } : { doc: { ...doc, game: g }, error: res };
}

/** Records that a player's device is here (saved quietly, at most every SEEN_EVERY_MS). */
export function touch(doc: OutageDoc, playerId: string, now: number): OutageDoc {
  const g = doc.game;
  if (!g || g.outcome || !g.players.some((p) => p.id === playerId)) return doc;
  if (now - (g.seen[playerId] ?? 0) < SEEN_EVERY_MS) return doc;
  return { ...doc, game: { ...g, seen: { ...g.seen, [playerId]: now } } };
}

export type HostMove = { type: "pause" } | { type: "resume" } | { type: "end" };

export function applyHostMove(doc: OutageDoc, move: HostMove, now: number): EngineResult {
  const g0 = doc.game;
  if (!g0) return { doc, error: "لم تبدأ المهمة" };
  if (g0.outcome) return { doc };
  const g: OutageGame = structuredClone(g0);
  if (move.type === "pause") setFrozen(g, now, "paused", true);
  else if (move.type === "resume") setFrozen(g, now, "paused", false);
  else end(g, "aborted", "أنهى المضيف المهمة");
  return { doc: { ...doc, game: g } };
}

/** Active blackout of a player at the current tick. */
export const blackoutOf = (g: OutageGame, playerId: string) =>
  g.outcome ? null : (g.blackouts.find((b) => b.playerId === playerId && b.from <= g.sim.t && g.sim.t < b.to) ?? null);

export const activeBlackouts = (g: OutageGame) => (g.outcome ? [] : g.blackouts.filter((b) => b.from <= g.sim.t && g.sim.t < b.to));
