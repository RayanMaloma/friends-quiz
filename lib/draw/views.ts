/**
 * What each device may see of a «وزارة المقيمين للفنون والرسم» room.
 *
 * - The word: the drawer's phone from the intro on; everyone else (TV
 *   included) only at the reveal. Accepted answers are never sent.
 * - The drawing: only once approved (guessing and reveal), and never inside
 *   the view itself — the view carries a revision number and screens fetch
 *   the strokes once per revision (`action: "drawing"`). The drawer can also
 *   fetch their own draft, to get it back after a refresh.
 * - Guesses: nobody sees anyone's guesses. While guessing, screens get only
 *   how many got it; who got it arrives with the reveal.
 */
import type { Snapshot } from "@/lib/types";
import {
  COLORS,
  guessers,
  hasSolved,
  MAX_ATTEMPTS,
  MAX_GUESS_LENGTH,
  MAX_LAPS,
  MAX_PLAYERS,
  MAX_TIMER_SECONDS,
  MIN_PLAYERS,
  MIN_TIMER_SECONDS,
  remainingMs,
  SIZES,
  standings,
  totalTurns,
  winners,
  type DrawDoc,
  type DrawSettings,
  type Phase,
  type RosterEntry,
  type Standing,
} from "./engine";

/** game_sessions.config of a room. */
export interface DrawSessionConfig {
  kind: "draw";
  title: string;
  emoji: string;
  accent: "mint";
  /** Latecomers may join: they take a seat at the next turn. */
  settings: { lateJoin: true; askPersonOnJoin: false };
  people: [];
}

export type DrawStatus = "LOBBY" | "PLAYING" | "FINISHED";

export interface DrawTimer {
  durationMs: number;
  remainingMs: number;
  /** Server epoch ms when it runs out. */
  deadline: number;
}

export interface DrawPublicGame {
  matchId: string;
  phase: Phase;
  /** 1-based turn number and the planned total. */
  turnNumber: number;
  totalTurns: number;
  /** 0-based turn index (sent back with moves). */
  turn: number;
  drawer: { id: string; name: string };
  timer: DrawTimer | null;
  /** Set once the drawing is approved (guessing, reveal): fetch the strokes when it changes. */
  drawingRev: number | null;
  solvedCount: number;
  guesserCount: number;
  /** Reveal only. */
  reveal: {
    word: string;
    skipped: null | "absent" | "blank";
    /** In the order they got it. */
    correct: { id: string; name: string; points: number }[];
    drawerPoints: number;
  } | null;
  standings: Standing[];
  winners: string[];
  endedEarly: boolean;
}

interface DrawBaseView {
  kind: "draw";
  serverNow: string;
  sessionId: string;
  code: string;
  status: DrawStatus;
  version: number;
  settings: DrawSettings;
  limits: {
    minPlayers: number;
    maxPlayers: number;
    maxLaps: number;
    minSeconds: number;
    maxSeconds: number;
    maxGuess: number;
    colors: readonly string[];
    sizes: readonly number[];
  };
  lobby: { id: string; name: string; active: boolean }[];
  game: DrawPublicGame | null;
}

export interface DrawHostView extends DrawBaseView {
  role: "host";
}

export interface DrawGuestView extends DrawBaseView {
  role: "guest";
  me: { playerId: string; name: string };
  /** False if this player joined after the match started (seated at the next turn). */
  seated: boolean;
  isDrawer: boolean;
  /** The drawer's word (intro → guessing). Everyone gets it in `reveal`. */
  word: string | null;
  solved: boolean;
  /** Wrong guesses this turn, and the cap. */
  attempts: number;
  maxAttempts: number;
}

export function drawDocOf(snapshot: Snapshot): DrawDoc | null {
  const m = snapshot.session.match;
  return m && typeof m === "object" && (m as DrawDoc).v === 1 && "settings" in (m as object) ? (m as DrawDoc) : null;
}

export const rosterOf = (snapshot: Snapshot): RosterEntry[] =>
  snapshot.players.map((p) => ({ id: p.id, name: p.display_name, active: p.token_hash !== null }));

const activeIds = (snapshot: Snapshot) => new Set(snapshot.players.filter((p) => p.token_hash !== null).map((p) => p.id));

function publicGame(doc: DrawDoc, now: number, active: Set<string>, wordOf: (id: string) => string): DrawPublicGame | null {
  const g = doc.game;
  if (!g) return null;
  const t = g.turn;
  const remaining = remainingMs(g, now);
  const nameOf = new Map(g.players.map((p) => [p.id, p.name]));
  const shown = g.phase === "guessing" || g.phase === "reveal";
  const revealed = g.phase === "reveal" && t.gained !== null;
  return {
    matchId: g.id,
    phase: g.phase,
    turnNumber: Math.min(t.index + 1, totalTurns(g, active)),
    totalTurns: totalTurns(g, active),
    turn: t.index,
    drawer: { id: t.drawerId, name: nameOf.get(t.drawerId) ?? "" },
    timer: g.phaseMs === null || remaining === null ? null : { durationMs: g.phaseMs, remainingMs: remaining, deadline: now + remaining },
    drawingRev: shown && t.drawing ? t.rev : null,
    solvedCount: t.correct.length,
    guesserCount: guessers(g, active).length,
    reveal: revealed
      ? {
          word: wordOf(t.wordId),
          skipped: t.skipped,
          correct: t.correct.map((c) => ({ id: c.id, name: nameOf.get(c.id) ?? "", points: t.gained![c.id] ?? 0 })),
          drawerPoints: t.gained![t.drawerId] ?? 0,
        }
      : null,
    standings: standings(g),
    winners: g.phase === "final" ? winners(g) : [],
    endedEarly: g.endedEarly,
  };
}

function base(snapshot: Snapshot, doc: DrawDoc, wordOf: (id: string) => string): DrawBaseView {
  const s = snapshot.session;
  const now = Date.parse(snapshot.now);
  return {
    kind: "draw",
    serverNow: snapshot.now,
    sessionId: s.id,
    code: s.code,
    status: (s.status === "LOBBY" || s.status === "FINISHED" ? s.status : "PLAYING") as DrawStatus,
    version: s.match_version ?? 0,
    settings: doc.settings,
    limits: {
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      maxLaps: MAX_LAPS,
      minSeconds: MIN_TIMER_SECONDS,
      maxSeconds: MAX_TIMER_SECONDS,
      maxGuess: MAX_GUESS_LENGTH,
      colors: COLORS,
      sizes: SIZES,
    },
    lobby: snapshot.players.map((p) => ({ id: p.id, name: p.display_name, active: p.token_hash !== null })),
    game: publicGame(doc, now, activeIds(snapshot), wordOf),
  };
}

/** `doc` is the state after `advance`. `wordOf`: word id → the word (server-side bank). */
export function buildDrawHostView(snapshot: Snapshot, doc: DrawDoc, wordOf: (id: string) => string): DrawHostView {
  return { ...base(snapshot, doc, wordOf), role: "host" };
}

export function buildDrawGuestView(snapshot: Snapshot, doc: DrawDoc, playerId: string, wordOf: (id: string) => string): DrawGuestView | null {
  const player = snapshot.players.find((p) => p.id === playerId);
  if (!player) return null;
  const g = doc.game;
  const seated = !!g?.players.some((p) => p.id === playerId);
  const isDrawer = !!g && seated && g.phase !== "final" && g.turn.drawerId === playerId;
  return {
    ...base(snapshot, doc, wordOf),
    role: "guest",
    me: { playerId, name: player.display_name },
    seated,
    isDrawer,
    word: isDrawer && g!.phase !== "reveal" ? wordOf(g!.turn.wordId) : null,
    solved: !!g && hasSolved(g.turn, playerId),
    attempts: g?.turn.attempts[playerId] ?? 0,
    maxAttempts: MAX_ATTEMPTS,
  };
}

