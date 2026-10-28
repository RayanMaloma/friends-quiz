/**
 * Mafia match state. The server stores this document in
 * game_sessions.match, runs lib/mafia/engine.ts on it and sends each device
 * only its own view (lib/mafia/views.ts). Times are epoch milliseconds on the
 * database clock.
 */
import type { Role, Team } from "./rules";

export type Phase =
  | "intro"
  | "roleReveal"
  | "nightfall"
  | "mafia"
  | "detective"
  | "doctor"
  | "dawn"
  | "discussion"
  | "voting"
  | "verdict"
  | "gameOver";

export type NightPhase = "mafia" | "detective" | "doctor";

export const NIGHT_PHASES: NightPhase[] = ["mafia", "detective", "doctor"];

export interface MafiaPlayer {
  /** The game_players row id. */
  id: string;
  name: string;
  role: Role;
  alive: boolean;
  /** When and how this player left the game. */
  out: { round: number; by: "night" | "vote" } | null;
}

export interface NightState {
  /** Living mafia member id → target id. */
  mafiaVotes: Record<string, string>;
  /** The detective investigates once per night (locked once chosen). */
  detectiveTargetId: string | null;
  doctorTargetId: string | null;
}

export interface DawnResult {
  outcome: "killed" | "saved" | "quiet";
  /** The victim (killed) or the intended victim (saved). */
  victimId: string | null;
  /** Role of a killed player: kept for the engine, public only once the game is over. */
  role: Role | null;
}

export interface Verdict {
  outcome: "eliminated" | "skip" | "tie";
  targetId: string | null;
  role: Role | null;
  /** Votes per option ("skip" or a player id), most first. Missing votes count as skip. */
  tally: { option: string; count: number }[];
}

export interface Investigation {
  round: number;
  targetId: string;
  role: Role;
}

export interface TimelineEntry {
  round: number;
  kind: "night" | "vote";
  outcome: DawnResult["outcome"] | Verdict["outcome"];
  playerId: string | null;
}

export interface MafiaMatch {
  v: 1;
  /** Night number (1 = first night). The day after night N is also N. */
  round: number;
  phase: Phase;
  phaseStartedAt: number;
  /** When the phase ends. null = no timer, or paused. */
  deadline: number | null;
  /** Host pause: the time that was left on the clock. */
  paused: { remaining: number | null } | null;
  /** Last change by an actor in this phase (night phases and role reveal close early after SETTLE_MS). */
  lastActionAt: number | null;
  players: MafiaPlayer[];
  roleSeen: string[];
  night: NightState;
  /** Everyone the doctor has protected this match (each at most once). */
  doctorHistory: string[];
  investigations: Investigation[];
  dawn: DawnResult | null;
  /** Voter id → target id or "skip". */
  votes: Record<string, string>;
  verdict: Verdict | null;
  winner: { team: Team; reason: string } | null;
  timeline: TimelineEntry[];
}

export type PlayerMove =
  | { type: "seeRole" }
  | { type: "night"; phase: NightPhase; round: number; targetId: string }
  | { type: "vote"; round: number; choice: string };

export type HostMove = { type: "pause" } | { type: "resume" } | { type: "skipReveal" };

export type EngineError =
  | "MF_PAUSED"
  | "MF_CLOSED"
  | "MF_DEAD"
  | "MF_NOT_YOURS"
  | "MF_TARGET"
  | "MF_LOCKED"
  | "MF_INTRO"
  | "NOT_A_PLAYER";

export type EngineResult = { state: MafiaMatch; error?: undefined } | { state?: undefined; error: EngineError };
