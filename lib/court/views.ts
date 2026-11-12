/**
 * What each device may see of a «المحكمة» room.
 *
 * - The truth, the explanation and every exhibit's class: nobody before the
 *   verdict (the accused alone knows the truth, as their secret).
 * - Secrets: each key role sees only its own (accused: the truth; lawyer and
 *   prosecutor: their hint). Jurors get none.
 * - Exhibits: the prosecutor sees all three; everyone else only the ones
 *   presented. An objection's outcome appears once the prosecutor's 15 s
 *   are over.
 * - Ballots: never who voted what; screens get how many voted. A juror sees
 *   their own ballot.
 */
import type { Snapshot } from "@/lib/types";
import {
  absentKeys,
  GRACE_MS,
  HEARING,
  MAX_CASES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  remainingMs,
  roleOf,
  standings,
  voters,
  winners,
  type CourtCase,
  type CourtDoc,
  type CourtSettings,
  type EvidenceKind,
  type KeyRole,
  type Phase,
  type Role,
  type RosterEntry,
  type Standing,
  type Vote,
} from "./engine";

/** game_sessions.config of a room. */
export interface CourtSessionConfig {
  kind: "court";
  title: string;
  emoji: string;
  accent: "orange";
  /** Latecomers may join: they take a seat at the next case. */
  settings: { lateJoin: true; askPersonOnJoin: false };
  people: [];
}

export type CourtStatus = "LOBBY" | "PLAYING" | "FINISHED";

export interface CourtTimer {
  durationMs: number;
  remainingMs: number;
  /** Server epoch ms when it runs out (null while paused). */
  deadline: number | null;
}

export interface Person {
  id: string;
  name: string;
}

export interface CourtPublicGame {
  matchId: string;
  phase: Phase;
  /** 0-based (sent back with moves) and 1-based for display. */
  caseIndex: number;
  caseNumber: number;
  totalCases: number;
  timer: CourtTimer | null;
  paused: null | {
    reason: "host" | "absent";
    /** Key roles the court is waiting for. */
    waitingFor: (Person & { role: KeyRole })[];
    /** Server ms when the grace period ends (absence only). */
    graceEnds: number | null;
  };
  title: string;
  summary: string;
  roles: Record<KeyRole, Person>;
  jurors: Person[];
  benched: Person[];
  /** Presented exhibits, in order. */
  evidence: { index: number; text: string }[];
  objection: null | {
    exhibit: number;
    lawyer: string;
    /** After the prosecutor's 15 s: upheld with a note, or overruled. */
    outcome: null | { upheld: boolean; note: string | null };
  };
  votes: { cast: number; total: number };
  verdict: null | {
    voided: boolean;
    guilty: boolean;
    guiltyVotes: number;
    innocentVotes: number;
    noVotes: boolean;
    truth: boolean;
    explanation: string;
    exhibits: { text: string; kind: EvidenceKind; why: string; presented: boolean }[];
    gained: (Person & { role: Role; points: number })[];
  };
  standings: Standing[];
  winners: string[];
  endedEarly: boolean;
}

interface CourtBaseView {
  kind: "court";
  serverNow: string;
  sessionId: string;
  code: string;
  status: CourtStatus;
  version: number;
  settings: CourtSettings;
  limits: { minPlayers: number; maxPlayers: number; maxCases: number };
  /** `here`: the phone was seen recently. */
  lobby: { id: string; name: string; active: boolean; here: boolean }[];
  game: CourtPublicGame | null;
}

export interface CourtHostView extends CourtBaseView {
  role: "host";
}

export interface CourtGuestView extends CourtBaseView {
  role: "guest";
  me: { playerId: string; name: string };
  /** False if this player joined during a case (seated at the next one). */
  seated: boolean;
  myRole: Role | "benched" | null;
  secret:
    | null
    | { role: "accused"; guilty: boolean; text: string }
    | { role: "lawyer"; text: string; objectionUsed: boolean }
    | { role: "prosecutor"; text: string; exhibits: { index: number; text: string; presented: boolean }[] };
  myVote: Vote | null;
}

export function courtDocOf(snapshot: Snapshot): CourtDoc | null {
  const m = snapshot.session.match;
  return m && typeof m === "object" && (m as CourtDoc).v === 1 && (m as CourtDoc).court === true ? (m as CourtDoc) : null;
}

/** `seen`: playerId → server ms of their phone's last request. */
export function rosterOf(snapshot: Snapshot, seen: Record<string, number>, presenceMs: number): RosterEntry[] {
  const now = Date.parse(snapshot.now);
  return snapshot.players.map((p) => ({
    id: p.id,
    name: p.display_name,
    active: p.token_hash !== null,
    present: p.token_hash !== null && now - (seen[p.id] ?? 0) <= presenceMs,
  }));
}

/** `{accused}` → the accused's name. */
export const fill = (text: string, accused: string) => text.replaceAll("{accused}", accused);

function publicGame(doc: CourtDoc, now: number, roster: RosterEntry[], bank: readonly CourtCase[]): CourtPublicGame | null {
  const g = doc.game;
  if (!g) return null;
  const c = g.case;
  const data = bank.find((x) => x.id === c.caseId);
  const nameOf = new Map(g.players.map((p) => [p.id, p.name]));
  const person = (id: string): Person => ({ id, name: nameOf.get(id) ?? "" });
  const accused = nameOf.get(c.accused) ?? "";
  const f = (t: string) => fill(t, accused);
  const remaining = remainingMs(g, now);
  const decided = (g.phase === "verdict" || g.phase === "standings" || g.phase === "final") && c.gained !== null;
  const ex = data?.evidence;
  const objected = c.objection && ex ? ex[c.objection.exhibit] : null;

  return {
    matchId: g.id,
    phase: g.phase,
    caseIndex: c.index,
    caseNumber: c.index + 1,
    totalCases: g.caseIds.length,
    timer:
      g.phaseMs === null || remaining === null
        ? null
        : { durationMs: g.phaseMs, remainingMs: remaining, deadline: g.pausedAt === null ? now + remaining : null },
    paused:
      g.pausedAt === null
        ? null
        : {
            reason: g.pause ?? "host",
            waitingFor:
              g.pause === "absent" && HEARING.has(g.phase)
                ? absentKeys(g, roster).map((id) => ({ ...person(id), role: roleOf(c, id) as KeyRole }))
                : [],
            graceEnds: g.pause === "absent" ? g.pausedAt + GRACE_MS : null,
          },
    title: data?.title ?? "",
    summary: data ? f(data.summary) : "",
    roles: { accused: person(c.accused), lawyer: person(c.lawyer), prosecutor: person(c.prosecutor) },
    jurors: c.jurors.map(person),
    benched: c.benched.map(person),
    evidence: ex ? c.presented.map((i) => ({ index: i, text: f(ex[i].text) })) : [],
    objection:
      c.objection && objected
        ? {
            exhibit: c.objection.exhibit,
            lawyer: nameOf.get(c.lawyer) ?? "",
            outcome:
              g.phase === "objection"
                ? null
                : { upheld: objected.challenge !== null, note: objected.challenge === null ? null : f(objected.challenge) },
          }
        : null,
    votes: { cast: Object.keys(c.votes).length, total: voters(g, roster).length },
    verdict:
      decided && data
        ? {
            voided: c.voided,
            guilty: c.verdict?.guilty ?? false,
            guiltyVotes: c.verdict?.guiltyVotes ?? 0,
            innocentVotes: c.verdict?.innocentVotes ?? 0,
            noVotes: c.verdict?.noVotes ?? true,
            truth: data.guilty,
            explanation: f(data.explanation),
            exhibits: data.evidence.map((e, i) => ({ text: f(e.text), kind: e.kind, why: f(e.why), presented: c.presented.includes(i) })),
            gained: [c.accused, c.prosecutor, c.lawyer, ...c.jurors]
              .map((id) => ({ ...person(id), role: roleOf(c, id) as Role, points: c.gained?.[id] ?? 0 })),
          }
        : null,
    standings: standings(g),
    winners: g.phase === "final" ? winners(g) : [],
    endedEarly: g.endedEarly,
  };
}

function base(snapshot: Snapshot, doc: CourtDoc, roster: RosterEntry[], bank: readonly CourtCase[]): CourtBaseView {
  const s = snapshot.session;
  return {
    kind: "court",
    serverNow: snapshot.now,
    sessionId: s.id,
    code: s.code,
    status: (s.status === "LOBBY" || s.status === "FINISHED" ? s.status : "PLAYING") as CourtStatus,
    version: s.match_version ?? 0,
    settings: doc.settings,
    limits: { minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, maxCases: Math.min(MAX_CASES, bank.length) },
    lobby: roster.map((r) => ({ id: r.id, name: r.name, active: r.active, here: r.present })),
    game: publicGame(doc, Date.parse(snapshot.now), roster, bank),
  };
}

/** `doc` is the state after `advance`. */
export function buildCourtHostView(snapshot: Snapshot, doc: CourtDoc, roster: RosterEntry[], bank: readonly CourtCase[]): CourtHostView {
  return { ...base(snapshot, doc, roster, bank), role: "host" };
}

export function buildCourtGuestView(
  snapshot: Snapshot,
  doc: CourtDoc,
  playerId: string,
  roster: RosterEntry[],
  bank: readonly CourtCase[],
): CourtGuestView | null {
  const player = snapshot.players.find((p) => p.id === playerId);
  if (!player) return null;
  const g = doc.game;
  const seated = !!g?.players.some((p) => p.id === playerId);
  const c = g?.case;
  const myRole = g && c && seated ? roleOf(c, playerId) : null;
  const data = c ? bank.find((x) => x.id === c.caseId) : undefined;
  const accused = g && c ? (g.players.find((p) => p.id === c.accused)?.name ?? "") : "";
  const f = (t: string) => fill(t, accused);
  let secret: CourtGuestView["secret"] = null;
  if (data && c) {
    if (myRole === "accused") secret = { role: "accused", guilty: data.guilty, text: f(data.accusedSecret) };
    else if (myRole === "lawyer") secret = { role: "lawyer", text: f(data.lawyerInfo), objectionUsed: c.objection !== null };
    else if (myRole === "prosecutor") {
      secret = {
        role: "prosecutor",
        text: f(data.prosecutorInfo),
        exhibits: data.evidence.map((e, i) => ({ index: i, text: f(e.text), presented: c.presented.includes(i) })),
      };
    }
  }
  return {
    ...base(snapshot, doc, roster, bank),
    role: "guest",
    me: { playerId, name: player.display_name },
    seated,
    myRole,
    secret,
    myVote: c?.votes[playerId] ?? null,
  };
}
