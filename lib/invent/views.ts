/**
 * What each device may see of a «اخترع إجابتك» room.
 *
 * - While answering, nobody sees anyone's answer (a phone sees only its own).
 * - While voting, the cards carry the text and a random id only: no author,
 *   no votes. A phone learns which card is its own (to grey it out).
 * - Authors, vote counts and points arrive for every card at once, with the
 *   reveal. Who voted for whom is never sent to anyone.
 */
import type { Snapshot } from "@/lib/types";
import {
  AHAJI_QUESTION_COUNT,
  answerOf,
  canVote,
  isPaused,
  MAX_ANSWER_LENGTH,
  MAX_PLAYERS,
  MAX_TIMER_SECONDS,
  MIN_PLAYERS,
  phaseDurationMs,
  remainingMs,
  standings,
  winners,
  type InventDoc,
  type InventQuestion,
  type InventSettings,
  type Phase,
  type Standing,
} from "./engine";
/** game_sessions.config of a room. */
export interface InventSessionConfig {
  kind: "invent";
  title: string;
  emoji: string;
  accent: "sun";
  settings: { lateJoin: false; askPersonOnJoin: false };
  people: [];
  /**
   * "custom": a public room playing its host's own `questions`.
   * Missing / "ahaji": the private Ahaji set (rooms created before public rooms existed too).
   */
  questionSet?: "custom" | "ahaji";
  questions?: InventQuestion[];
}

/** How many questions this room can draw from. */
export function inventPoolSize(config: unknown): number {
  const c = (config ?? {}) as Partial<InventSessionConfig>;
  return c.questionSet === "custom" ? (Array.isArray(c.questions) ? c.questions.length : 0) : AHAJI_QUESTION_COUNT;
}

export type InventStatus = "LOBBY" | "PLAYING" | "FINISHED";

export interface InventCard {
  id: string;
  text: string;
  /** Phones only: this is the viewer's own answer. */
  mine: boolean;
  /** From the reveal on. */
  author: { id: string; name: string } | null;
  votes: number | null;
  points: number | null;
}

export interface InventTimer {
  durationMs: number;
  remainingMs: number;
  /** Server epoch ms when it runs out (null while paused). */
  deadline: number | null;
}

export interface InventPublicGame {
  matchId: string;
  phase: Phase;
  /** 0-based. */
  roundIndex: number;
  totalRounds: number;
  question: { id: string; text: string };
  paused: boolean;
  timer: InventTimer | null;
  answeredCount: number;
  /** Seated players still in the room. */
  playerCount: number;
  votedCount: number;
  voterCount: number;
  votingSkipped: boolean;
  /** From voting on, in the room's one shuffled order. */
  cards: InventCard[] | null;
  standings: Standing[];
  /** Final only: everyone tied for first. */
  winners: string[];
  endedEarly: boolean;
}

interface InventBaseView {
  kind: "invent";
  serverNow: string;
  sessionId: string;
  code: string;
  status: InventStatus;
  version: number;
  settings: InventSettings;
  limits: { minPlayers: number; maxPlayers: number; questions: number; maxSeconds: number; maxAnswer: number };
  lobby: { id: string; name: string; active: boolean }[];
  game: InventPublicGame | null;
}

export interface InventHostView extends InventBaseView {
  role: "host";
  /** Who still has to act (names only, never what they wrote or picked). */
  progress: { id: string; name: string; active: boolean; answered: boolean; voted: boolean }[];
}

export interface InventGuestView extends InventBaseView {
  role: "guest";
  me: { playerId: string; name: string };
  /** False if this player joined after the match started (watches only). */
  seated: boolean;
  myAnswer: string | null;
  myVote: string | null;
  canVote: boolean;
}

export function inventDocOf(snapshot: Snapshot): InventDoc | null {
  const m = snapshot.session.match;
  return m && typeof m === "object" && (m as InventDoc).v === 1 && "settings" in (m as object) ? (m as InventDoc) : null;
}

export const activeIds = (snapshot: Snapshot) =>
  new Set(snapshot.players.filter((p) => p.token_hash !== null).map((p) => p.id));

function publicGame(doc: InventDoc, now: number, active: Set<string>, viewerId: string | null): InventPublicGame | null {
  const g = doc.game;
  if (!g) return null;
  const r = g.round;
  const revealed = r.tally !== null;
  const nameOf = new Map(g.players.map((p) => [p.id, p.name]));
  const duration = phaseDurationMs(doc, g.phase);
  const remaining = remainingMs(doc, now);
  const paused = isPaused(g);
  const showCards = g.phase === "voting" || g.phase === "reveal";
  const seatedActive = g.players.filter((p) => active.has(p.id));
  const voters = seatedActive.filter((p) => canVote(r, p.id));

  return {
    matchId: g.id,
    phase: g.phase,
    roundIndex: r.index,
    totalRounds: g.questionIds.length,
    question: { id: r.questionId, text: g.questions?.[r.index]?.text ?? "" },
    paused,
    timer:
      duration === null || remaining === null
        ? null
        : { durationMs: duration, remainingMs: remaining, deadline: paused ? null : now + remaining },
    answeredCount: r.answers.length,
    playerCount: seatedActive.length,
    votedCount: Object.keys(r.votes).length,
    voterCount: voters.length,
    votingSkipped: r.votingSkipped,
    cards: showCards
      ? (revealed && r.order.length === 0 ? r.answers.map((a) => a.id) : r.order).map((id) => {
          const a = r.answers.find((x) => x.id === id)!;
          return {
            id: a.id,
            text: a.text,
            mine: viewerId !== null && a.authorId === viewerId,
            author: revealed ? { id: a.authorId, name: nameOf.get(a.authorId) ?? "" } : null,
            votes: revealed ? (r.tally![a.id] ?? 0) : null,
            points: revealed ? (r.gained![a.authorId] ?? 0) : null,
          };
        })
      : null,
    standings: standings(g),
    winners: g.phase === "final" ? winners(g) : [],
    endedEarly: g.endedEarly,
  };
}

function base(snapshot: Snapshot, doc: InventDoc, viewerId: string | null): InventBaseView {
  const s = snapshot.session;
  const now = Date.parse(snapshot.now);
  return {
    kind: "invent",
    serverNow: snapshot.now,
    sessionId: s.id,
    code: s.code,
    status: (s.status === "LOBBY" || s.status === "FINISHED" ? s.status : "PLAYING") as InventStatus,
    version: s.match_version ?? 0,
    settings: doc.settings,
    limits: {
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      questions: inventPoolSize(s.config),
      maxSeconds: MAX_TIMER_SECONDS,
      maxAnswer: MAX_ANSWER_LENGTH,
    },
    lobby: snapshot.players.map((p) => ({ id: p.id, name: p.display_name, active: p.token_hash !== null })),
    game: publicGame(doc, now, activeIds(snapshot), viewerId),
  };
}

/** `doc` is the state after `advance` (it may be newer than the snapshot's). */
export function buildInventHostView(snapshot: Snapshot, doc: InventDoc): InventHostView {
  const g = doc.game;
  const active = activeIds(snapshot);
  return {
    ...base(snapshot, doc, null),
    role: "host",
    progress: g
      ? g.players.map((p) => ({
          id: p.id,
          name: p.name,
          active: active.has(p.id),
          answered: !!answerOf(g.round, p.id),
          voted: p.id in g.round.votes,
        }))
      : [],
  };
}

export function buildInventGuestView(snapshot: Snapshot, doc: InventDoc, playerId: string): InventGuestView | null {
  const player = snapshot.players.find((p) => p.id === playerId);
  if (!player) return null;
  const g = doc.game;
  const seated = !!g?.players.some((p) => p.id === playerId);
  return {
    ...base(snapshot, doc, playerId),
    role: "guest",
    me: { playerId, name: player.display_name },
    seated,
    myAnswer: g && seated ? (answerOf(g.round, playerId)?.text ?? null) : null,
    myVote: g && seated ? (g.round.votes[playerId] ?? null) : null,
    canVote: !!g && seated && canVote(g.round, playerId),
  };
}
