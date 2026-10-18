import type { Accent, Snapshot } from "@/lib/types";
import type { Asset, GameConfig, ID } from "@/lib/dx/types/config";
import type { MatchState } from "@/lib/dx/types/match";
import { redactFor, validateSetup } from "@/lib/dx/engine/engine";
import { eligibleNominees, knownPlayers, powerTargets, voters } from "@/lib/dx/engine/helpers";

/**
 * Role-specific views of a deduction session.
 *
 * - The TV gets redactFor('public'): nobody's role, no hands, no ballots
 *   before the reveal, no investigation/peek results.
 * - A phone gets redactFor(itself): its own role, its hand when it is the one
 *   legislating, its own ballot, and power results when it is the leader.
 * - The design (GameConfig + images) is frozen for the session and sent once
 *   ("config" action), so views stay small.
 */

/** The session snapshot config of a deduction session (game_sessions.config). */
export interface DxSessionConfig {
  kind: "deduction";
  title: string;
  emoji: string;
  accent: Accent;
  settings: { lateJoin: false; askPersonOnJoin: false };
  people: [];
  game: GameConfig;
  assets: Asset[];
}

/** A match as a device sees it: redacted, without the (large) frozen config. */
export type DxMatchView = Omit<MatchState, "config">;

export type DxStatus = "LOBBY" | "PLAYING" | "FINISHED";

export interface DxLobbyPlayer {
  id: string;
  name: string;
  /** false = the host released this device; the player can rejoin by name. */
  active: boolean;
}

interface DxBaseView {
  kind: "deduction";
  serverNow: string;
  sessionId: string;
  code: string;
  status: DxStatus;
  title: string;
  emoji: string;
  /** Bumps on every state change. */
  version: number;
  players: DxLobbyPlayer[];
  match: DxMatchView | null;
}

export interface DxHostView extends DxBaseView {
  role: "host";
  minPlayers: number;
  maxPlayers: number;
  /** Why the game can't start with the players in the lobby (empty = ready). */
  startIssues: string[];
  /** Players the leader may nominate right now. */
  eligibleNomineeIds: ID[];
  /** Players the current power may target. */
  powerTargetIds: ID[];
  /** Who still has to act on their phone in this phase. */
  waitingForIds: ID[];
}

export interface DxGuestView extends DxBaseView {
  role: "guest";
  me: { playerId: string; name: string };
  /** False if this player joined but is not seated in the running match. */
  seated: boolean;
  /** Players this player learned about at the start (with their roles). */
  known: { playerId: ID; name: string; roleId: ID }[];
}

function stripConfig(m: MatchState): DxMatchView {
  const { config: _config, ...rest } = m;
  void _config;
  return rest;
}

function base(snapshot: Snapshot) {
  const s = snapshot.session;
  const config = s.config as unknown as DxSessionConfig;
  return {
    kind: "deduction" as const,
    serverNow: snapshot.now,
    sessionId: s.id,
    code: s.code,
    status: (s.status === "LOBBY" || s.status === "FINISHED" ? s.status : "PLAYING") as DxStatus,
    title: config.title,
    emoji: config.emoji,
    version: s.match_version ?? 0,
    players: snapshot.players.map((p) => ({ id: p.id, name: p.display_name, active: p.token_hash !== null })),
  };
}

export function matchOf(snapshot: Snapshot): MatchState | null {
  const m = snapshot.session.match;
  return m && typeof m === "object" ? (m as MatchState) : null;
}

/** Who has to do something on their own phone before the game can move on. */
export function waitingFor(m: MatchState): ID[] {
  switch (m.phase) {
    case "roleReveal":
      return m.players.filter((p) => !m.roleSeen.includes(p.id)).map((p) => p.id);
    case "vote":
      return voters(m).filter((p) => !m.votes[p.id]).map((p) => p.id);
    case "leaderLegislate":
    case "vetoResponse":
      return [m.leaderId];
    case "nomineeLegislate":
      return m.nomineeId ? [m.nomineeId] : [];
    case "power": {
      const pp = m.pendingPower;
      if (pp && (pp.kind === "peek" || (pp.kind === "investigate" && pp.result))) return [m.leaderId];
      return [];
    }
    default:
      return [];
  }
}

export function buildDxHostView(snapshot: Snapshot): DxHostView {
  const config = snapshot.session.config as unknown as DxSessionConfig;
  const m = matchOf(snapshot);
  const { minPlayers, maxPlayers } = config.game.mechanics;
  const lobbyCount = snapshot.players.length;
  return {
    ...base(snapshot),
    role: "host",
    minPlayers,
    maxPlayers,
    startIssues: m ? [] : validateSetup(config.game, lobbyCount),
    match: m ? stripConfig(redactFor(m, "public")) : null,
    eligibleNomineeIds: m && m.phase === "nominate" ? eligibleNominees(m).map((p) => p.id) : [],
    powerTargetIds: m && m.phase === "power" ? powerTargets(m).map((p) => p.id) : [],
    waitingForIds: m ? waitingFor(m) : [],
  };
}

export function buildDxGuestView(snapshot: Snapshot, playerId: string): DxGuestView | null {
  const player = snapshot.players.find((p) => p.id === playerId);
  if (!player) return null;
  const m = matchOf(snapshot);
  const seated = !!m?.players.some((p) => p.id === playerId);
  return {
    ...base(snapshot),
    role: "guest",
    me: { playerId, name: player.display_name },
    seated,
    match: m ? stripConfig(redactFor(m, seated ? playerId : "public")) : null,
    known: m && seated
      ? knownPlayers(m, playerId).map((k) => ({ playerId: k.player.id, name: k.player.name, roleId: k.roleId }))
      : [],
  };
}
