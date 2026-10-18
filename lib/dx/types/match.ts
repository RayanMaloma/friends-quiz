/**
 * MATCH STATE MODEL
 * ------------------------------------------------------------------
 * The live state of one game in progress. Kept completely separate
 * from GameConfig: starting, playing or abandoning a match never
 * changes the saved game design. A match keeps a frozen snapshot of
 * the config it was started with, so editing the design mid-game
 * cannot corrupt a running game.
 *
 * Online play: the server stores this document (game_sessions.match),
 * runs the engine on it, and sends each device only redactFor() of it.
 */
import type { GameConfig, ID, PowerKind } from './config';

export interface Player {
  /** The game_players row id, so a phone's token maps straight to a seat. */
  id: ID;
  name: string;
  seat: number;
  roleId: ID;
  alive: boolean;
  investigated: boolean;
}

export type Phase =
  | 'roleReveal'
  | 'nominate'
  | 'vote'
  | 'voteReveal'
  | 'leaderLegislate'
  | 'nomineeLegislate'
  | 'vetoResponse'
  | 'power'
  | 'gameOver';

export interface PendingPower {
  kind: PowerKind;
  source: string; // e.g. track name / card name
  text?: string;
  /** Investigation result, only visible to the leader. */
  result?: { targetId: ID; factionId: ID };
  peek?: ID[];
}

export interface LogEntry {
  id: string;
  round: number;
  kind: 'info' | 'election' | 'policy' | 'power' | 'chaos' | 'win' | 'admin' | 'warning';
  text: string;
}

export interface Winner { factionId: ID; reason: string; ruleId?: ID }

export interface Reminder { ruleId: ID; text: string }

export interface MatchState {
  id: ID;
  version: 1;
  createdAt: number;
  /** Frozen copy of the configuration used for this match. */
  config: GameConfig;
  players: Player[];
  phase: Phase;
  round: number;
  /** Players who confirmed on their phone that they have seen their role. */
  roleSeen: ID[];
  leaderId: ID;
  /** Seat the regular rotation continues from (after special elections). */
  rotationAnchorId: ID;
  /** Set when a special election chooses the next leader. */
  specialNextLeaderId?: ID;
  /** Leader is acting in a special-election round; rotation resumes from anchor. */
  inSpecialRound: boolean;
  nomineeId?: ID;
  lastElected: { leaderId?: ID; nomineeId?: ID };
  votes: Record<ID, 'yes' | 'no'>;
  /** Result of the last revealed vote (kept even when individual ballots are secret). */
  tally?: { yes: number; no: number; total: number; pct: number; passed: boolean };
  drawPile: ID[];
  discardPile: ID[];
  hand: ID[];
  tracks: Record<ID, number>;
  electionTracker: number;
  enacted: { cardId: ID; round: number; chaos: boolean }[];
  pendingPower?: PendingPower;
  vetoDeclined: boolean;
  winner?: Winner;
  reminders: Reminder[];
  log: LogEntry[];
  /** Round summaries: who governed and what happened. */
  rounds: { round: number; leaderId: ID; nomineeId?: ID; result: string }[];
}

export type Action =
  | { type: 'SEE_ROLE'; playerId: ID }
  | { type: 'NOMINATE'; nomineeId: ID }
  | { type: 'CAST_VOTE'; playerId: ID; vote: 'yes' | 'no' }
  | { type: 'REVEAL_VOTES' }
  | { type: 'RESOLVE_VOTE' }
  | { type: 'LEADER_DISCARD'; index: number }
  | { type: 'NOMINEE_ENACT'; index: number }
  | { type: 'REQUEST_VETO' }
  | { type: 'VETO_RESPONSE'; accept: boolean }
  | { type: 'POWER_TARGET'; targetId: ID }
  | { type: 'POWER_DONE' }
  // host overrides
  | { type: 'ADMIN_END_REVEAL' }
  | { type: 'ADMIN_DECLARE_WINNER'; factionId: ID; reason: string }
  | { type: 'ADMIN_SKIP_POWER' }
  | { type: 'ADMIN_SET_LEADER'; playerId: ID }
  | { type: 'ADMIN_ADJUST_TRACK'; trackId: ID; delta: number }
  | { type: 'ADMIN_ADJUST_TRACKER'; delta: number }
  | { type: 'ADMIN_TOGGLE_ALIVE'; playerId: ID }
  | { type: 'ADMIN_SKIP_TURN' }
  | { type: 'DISMISS_REMINDER'; ruleId: ID };

export type ActionType = Action['type'];

export interface EngineResult {
  state: MatchState;
  error?: string;
}
