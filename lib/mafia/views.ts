/**
 * What each device may see of a Mafia room.
 *
 * - The TV (and the public part of every phone) never gets a living
 *   player's role, the mafia's picks, the detective's or doctor's choice, or
 *   who voted for whom. A role becomes public when its player is killed at
 *   night. A player voted out keeps their role secret; every role is shown
 *   at the end.
 * - A phone gets, on top of that, only its own secrets: its role, its mafia
 *   teammates (and their picks during the mafia phase), its own
 *   investigations, its own protections and its own vote.
 */
import type { Snapshot } from "@/lib/types";
import { checkWinner, nightTargets, playerById, voters } from "./engine";
import { MAX_PLAYERS, MIN_PLAYERS, roleCounts, type Role, type Team } from "./rules";
import type { DawnResult, MafiaMatch, Phase, TimelineEntry, Verdict } from "./types";

/** game_sessions.config of a Mafia room. */
export interface MafiaSessionConfig {
  kind: "mafia";
  title: string;
  emoji: string;
  accent: "grape";
  settings: { lateJoin: false; askPersonOnJoin: false };
  people: [];
}

export type MafiaStatus = "LOBBY" | "PLAYING" | "FINISHED";

export interface MafiaLobbyPlayer {
  id: string;
  name: string;
  /** false = released by the host (can rejoin by name). */
  active: boolean;
}

export interface MafiaPublicPlayer {
  id: string;
  name: string;
  alive: boolean;
  /** Only for players killed at night, and for everyone once the game is over (never for a vote-out before the end). */
  role: Role | null;
  out: { round: number; by: "night" | "vote" } | null;
}

export interface MafiaPublicMatch {
  round: number;
  phase: Phase;
  phaseStartedAt: number;
  deadline: number | null;
  paused: boolean;
  pausedRemaining: number | null;
  players: MafiaPublicPlayer[];
  counts: Record<Role, number>;
  /** Role reveal: who has looked at their card. */
  seenIds: string[];
  dawn: DawnResult | null;
  verdict: Verdict | null;
  /** Voting progress (counts only — never who voted for whom). */
  votedCount: number;
  voterCount: number;
  winner: { team: Team; reason: string } | null;
  /** The story of the match, at the end only. */
  timeline: TimelineEntry[];
}

export interface MafiaTask {
  kind: "mafia" | "detective" | "doctor" | "vote";
  targets: { id: string; name: string }[];
  /** Doctor: players already protected once this match. */
  blocked: { id: string; name: string }[];
  choice: string | null;
  /** Mafia: what each teammate picked so far. */
  team: { playerId: string; name: string; targetId: string | null }[];
  /** Detective: the choice is final once made. */
  locked: boolean;
}

export interface MafiaSecret {
  role: Role;
  alive: boolean;
  seen: boolean;
  /** Mafia only. */
  teammates: { id: string; name: string; alive: boolean }[];
  task: MafiaTask | null;
  /** Detective only. */
  investigations: { round: number; targetId: string; name: string; role: Role }[];
}

interface MafiaBaseView {
  kind: "mafia";
  serverNow: string;
  sessionId: string;
  code: string;
  status: MafiaStatus;
  version: number;
  minPlayers: number;
  maxPlayers: number;
  lobby: MafiaLobbyPlayer[];
  match: MafiaPublicMatch | null;
}

export interface MafiaHostView extends MafiaBaseView {
  role: "host";
}

export interface MafiaGuestView extends MafiaBaseView {
  role: "guest";
  me: { playerId: string; name: string };
  /** False if this player joined after the match was dealt. */
  seated: boolean;
  secret: MafiaSecret | null;
}

export function mafiaMatchOf(snapshot: Snapshot): MafiaMatch | null {
  const m = snapshot.session.match;
  return m && typeof m === "object" && (m as MafiaMatch).v === 1 ? (m as MafiaMatch) : null;
}

export function publicMatch(m: MafiaMatch): MafiaPublicMatch {
  const over = m.phase === "gameOver";
  const living = voters(m);
  return {
    round: m.round,
    phase: m.phase,
    phaseStartedAt: m.phaseStartedAt,
    deadline: m.deadline,
    paused: !!m.paused,
    pausedRemaining: m.paused?.remaining ?? null,
    players: m.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      role: over || (!p.alive && p.out?.by === "night") ? p.role : null,
      out: p.out,
    })),
    counts: roleCounts(m.players.length)!,
    seenIds: m.phase === "intro" || m.phase === "roleReveal" ? m.roleSeen : [],
    dawn: m.dawn,
    // The verdict names who left, not what they were.
    verdict: m.verdict && !over ? { ...m.verdict, role: null } : m.verdict,
    votedCount: m.phase === "voting" ? living.filter((p) => p.id in m.votes).length : 0,
    voterCount: living.length,
    winner: m.winner ?? (over ? checkWinner(m.players) : null),
    timeline: over ? m.timeline : [],
  };
}

function secretFor(m: MafiaMatch, playerId: string): MafiaSecret | null {
  const me = playerById(m, playerId);
  if (!me) return null;
  const nameOf = (id: string) => playerById(m, id)?.name ?? "";
  let task: MafiaTask | null = null;

  if (me.alive && m.phase === me.role && (m.phase === "mafia" || m.phase === "detective" || m.phase === "doctor")) {
    const phase = m.phase;
    const targets = nightTargets(m, phase, me.id).map((p) => ({ id: p.id, name: p.name }));
    const choice =
      phase === "mafia" ? m.night.mafiaVotes[me.id] ?? null : phase === "detective" ? m.night.detectiveTargetId : m.night.doctorTargetId;
    task = {
      kind: phase,
      targets,
      blocked:
        phase === "doctor"
          ? m.players.filter((p) => p.alive && m.doctorHistory.includes(p.id)).map((p) => ({ id: p.id, name: p.name }))
          : [],
      choice,
      team:
        phase === "mafia"
          ? m.players
              .filter((p) => p.alive && p.role === "mafia" && p.id !== me.id)
              .map((p) => ({ playerId: p.id, name: p.name, targetId: m.night.mafiaVotes[p.id] ?? null }))
          : [],
      locked: phase === "detective" && choice !== null,
    };
  } else if (me.alive && m.phase === "voting") {
    task = {
      kind: "vote",
      targets: voters(m).filter((p) => p.id !== me.id).map((p) => ({ id: p.id, name: p.name })),
      blocked: [],
      choice: m.votes[me.id] ?? null,
      team: [],
      locked: false,
    };
  }

  return {
    role: me.role,
    alive: me.alive,
    seen: m.roleSeen.includes(me.id),
    teammates:
      me.role === "mafia"
        ? m.players.filter((p) => p.role === "mafia" && p.id !== me.id).map((p) => ({ id: p.id, name: p.name, alive: p.alive }))
        : [],
    task,
    investigations:
      me.role === "detective"
        ? m.investigations.map((i) => ({ round: i.round, targetId: i.targetId, name: nameOf(i.targetId), role: i.role }))
        : [],
  };
}

function base(snapshot: Snapshot, m: MafiaMatch | null) {
  const s = snapshot.session;
  return {
    kind: "mafia" as const,
    serverNow: snapshot.now,
    sessionId: s.id,
    code: s.code,
    status: (s.status === "LOBBY" || s.status === "FINISHED" ? s.status : "PLAYING") as MafiaStatus,
    version: s.match_version ?? 0,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    lobby: snapshot.players.map((p) => ({ id: p.id, name: p.display_name, active: p.token_hash !== null })),
    match: m ? publicMatch(m) : null,
  };
}

/** `m` is the match after `advance` (it may be newer than the snapshot's). */
export function buildMafiaHostView(snapshot: Snapshot, m: MafiaMatch | null): MafiaHostView {
  return { ...base(snapshot, m), role: "host" };
}

export function buildMafiaGuestView(snapshot: Snapshot, m: MafiaMatch | null, playerId: string): MafiaGuestView | null {
  const player = snapshot.players.find((p) => p.id === playerId);
  if (!player) return null;
  const seated = !!m?.players.some((p) => p.id === playerId);
  return {
    ...base(snapshot, m),
    role: "guest",
    me: { playerId, name: player.display_name },
    seated,
    // Nothing secret during the opening sequence: roles arrive with the role reveal.
    secret: m && seated && m.phase !== "intro" ? secretFor(m, playerId) : null,
  };
}
