import { rpc } from "@/lib/server/db";
import { notifyGame } from "@/lib/server/broadcast";
import { fail, getSnapshot, handleError, ok, readBody, type RpcResult } from "@/lib/server/game";
import { hashToken, isTokenShaped, isUuid, newToken } from "@/lib/server/tokens";
import { authorizeCreate, claimSession } from "@/lib/server/access";
import { CASES } from "@/lib/court/cases";
import {
  advance,
  applyHostMove,
  applyPlayerMove,
  applySettings,
  DEFAULT_SETTINGS,
  isCaseCount,
  newDoc,
  PRESENCE_MS,
  startGame,
  type CourtDoc,
  type EngineResult,
  type HostMove,
  type KeyRole,
  type Phase,
  type PlayerMove,
  type RosterEntry,
} from "@/lib/court/engine";
import { buildCourtGuestView, buildCourtHostView, courtDocOf, rosterOf, type CourtSessionConfig } from "@/lib/court/views";
import type { Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * «المحكمة» endpoint, for the host screen (`as: "host"`, host token) and the
 * phones (`as: "guest"`, player token). Joining goes through /api/guest.
 *
 * Every request: load the room → identify the sender (a phone also stamps
 * itself as present) → let the clock move the case on → apply the sender's
 * move, checked against their role, the phase and the case → save with an
 * optimistic lock (jurors voting at once: the loser retries on the new
 * state, so nothing is lost and a case is scored once) → answer with the
 * sender's own view only.
 */

/** Up to 12 phones can write at the same instant (a vote); each loser retries on the new state. */
const MAX_ATTEMPTS = 24;
const PHASES: Phase[] = ["announce", "opening_p", "opening_l", "evidence", "objection", "cross_p", "cross_l", "closing_p", "closing_l", "vote", "verdict", "standings", "final"];
const KEY_ROLES: KeyRole[] = ["accused", "lawyer", "prosecutor"];

type Actor = { kind: "host" } | { kind: "player"; id: string };
type Identified = { snapshot: Snapshot; actor: Actor } | { error: Response };

async function identify(body: Record<string, unknown>): Promise<Identified> {
  if (!isUuid(body.sessionId)) return { error: fail("GAME_NOT_FOUND", 404) };
  const snapshot = await getSnapshot(body.sessionId);
  if (!snapshot || snapshot.session.kind !== "court" || !courtDocOf(snapshot)) return { error: fail("GAME_NOT_FOUND", 404) };
  if (body.as === "host") {
    if (!isTokenShaped(body.hostToken) || snapshot.session.host_token_hash !== hashToken(body.hostToken)) {
      return { error: fail("FORBIDDEN", 403) };
    }
    return { snapshot, actor: { kind: "host" } };
  }
  if (!isTokenShaped(body.playerToken)) return { error: fail("NOT_A_PLAYER", 401) };
  const hash = hashToken(body.playerToken);
  const player = snapshot.players.find((p) => p.token_hash === hash);
  if (!player) return { error: fail("NOT_A_PLAYER", 401) };
  return { snapshot, actor: { kind: "player", id: player.id } };
}

/** Stamps a phone as present (the host screen only reads) and returns when everyone was last seen. */
async function presence(sessionId: string, actor: Actor): Promise<Record<string, number>> {
  const res = await rpc<{ ok: boolean; seen?: Record<string, number> }>("fq_court_touch", {
    p_session_id: sessionId,
    p_player_id: actor.kind === "player" ? actor.id : null,
  });
  return res.ok && res.seen ? res.seen : {};
}

function viewFor(snapshot: Snapshot, doc: CourtDoc, actor: Actor, roster: RosterEntry[]) {
  return actor.kind === "host"
    ? buildCourtHostView(snapshot, doc, roster, CASES)
    : buildCourtGuestView(snapshot, doc, actor.id, roster, CASES);
}

const isCase = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 100;
const isExhibit = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2;

function parsePlayerMove(raw: unknown): PlayerMove | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (!isCase(a.case)) return null;
  if ((a.type === "present" || a.type === "object") && isExhibit(a.exhibit)) return { type: a.type, case: a.case, exhibit: a.exhibit };
  if (a.type === "vote" && (a.vote === "guilty" || a.vote === "innocent")) return { type: "vote", case: a.case, vote: a.vote };
  return null;
}

function parseHostMove(raw: unknown): HostMove | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case "end":
    case "pause":
    case "resume":
      return { type: a.type };
    case "next":
      return PHASES.includes(a.phase as Phase) && isCase(a.case) ? { type: "next", phase: a.phase as Phase, case: a.case } : null;
    case "replace":
      return KEY_ROLES.includes(a.role as KeyRole) && isCase(a.case) ? { type: "replace", role: a.role as KeyRole, case: a.case } : null;
    case "void":
      return isCase(a.case) ? { type: "void", case: a.case } : null;
    default:
      return null;
  }
}

type Status = "LOBBY" | "PLAYING" | "FINISHED";
type Change =
  | { kind: "doc"; run: (doc: CourtDoc, now: number, snapshot: Snapshot, roster: RosterEntry[]) => EngineResult }
  | { kind: "lobby" }
  | { kind: "close" };

const statusOf = (doc: CourtDoc): Status => (doc.game ? "PLAYING" : "LOBBY");

/**
 * Runs `change` (or just the clock when null) on the latest state and saves
 * it. Retries when another device saved first. Returns the sender's view.
 */
async function commit(body: Record<string, unknown>, first: Identified, change: Change | null): Promise<Response> {
  if ("error" in first) return first.error;
  const seen = await presence(first.snapshot.session.id, first.actor);
  let who: Identified = first;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // A little jitter so a burst of simultaneous writers spreads out.
      await new Promise((r) => setTimeout(r, Math.random() * 15 * Math.min(attempt, 4)));
      who = await identify(body);
    }
    if ("error" in who) return who.error;
    const { snapshot, actor } = who;
    const now = Date.parse(snapshot.now);
    const roster = rosterOf(snapshot, seen, PRESENCE_MS);
    // This request itself proves the sender is here.
    if (actor.kind === "player") for (const r of roster) if (r.id === actor.id) r.present = r.active;
    const current = courtDocOf(snapshot)!;
    if (snapshot.session.status === "FINISHED") return ok({ view: viewFor(snapshot, current, actor, roster) });

    const clocked = advance(current, now, roster, CASES);
    let next = clocked;

    if (change?.kind === "lobby") {
      next = { ...next, game: null };
    } else if (change?.kind === "doc") {
      const res = change.run(next, now, snapshot, roster);
      if (!res.doc) {
        // Still save the clock's progress, then report the refusal.
        if (next !== current) await save(snapshot, next, statusOf(next));
        const rule = !/^[A-Z_]+$/.test(res.error);
        return rule
          ? Response.json({ ok: false, error: "RULE", message: res.error }, { status: 409 })
          : fail(res.error, res.error === "BAD_REQUEST" ? 400 : 409);
      }
      next = advance(res.doc, now, roster, CASES);
    }
    const status: Status = change?.kind === "close" ? "FINISHED" : statusOf(next);

    if (next === current && status === snapshot.session.status) return ok({ view: viewFor(snapshot, current, actor, roster) });

    const saved = await save(snapshot, next, status);
    if (saved === "ok") {
      const fresh = await getSnapshot(snapshot.session.id);
      const doc = fresh && courtDocOf(fresh);
      if (!fresh || !doc) return fail("GAME_NOT_FOUND", 404);
      const freshRoster = rosterOf(fresh, seen, PRESENCE_MS);
      if (actor.kind === "player") for (const r of freshRoster) if (r.id === actor.id) r.present = r.active;
      return ok({ view: viewFor(fresh, doc, actor, freshRoster) });
    }
    if (saved !== "STALE_STATE") return fail(saved, 409);
    // Someone else saved first: run again on their state.
  }
  return fail("BUSY", 503);
}

async function save(snapshot: Snapshot, doc: CourtDoc, status: Status): Promise<string> {
  const res = await rpc<RpcResult>("fq_court_save_match", {
    p_session_id: snapshot.session.id,
    p_expected_version: snapshot.session.match_version ?? 0,
    p_match: doc,
    p_status: status,
  });
  if (!res.ok) return res.error;
  await notifyGame(snapshot.session.id);
  return "ok";
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const action = body.action;

    // Opening a room needs an account, and the game visible to it.
    if (action === "create") {
      const auth = await authorizeCreate("court");
      if ("error" in auth) return fail(auth.error, auth.status);
      const lobby = applySettings(newDoc(DEFAULT_SETTINGS), { cases: isCaseCount(body.cases) ? body.cases : undefined });
      const config: CourtSessionConfig = {
        kind: "court",
        title: "المحكمة",
        emoji: "⚖️",
        accent: "orange",
        settings: { lateJoin: true, askPersonOnJoin: false },
        people: [],
      };
      const hostToken = newToken();
      const res = await rpc<RpcResult>("fq_court_create_session", {
        p_host_token_hash: hashToken(hostToken),
        p_config: config,
        p_match: lobby.doc,
      });
      if (!res.ok) return fail(res.error);
      await claimSession(res.session_id as string, auth.actor);
      return ok({ sessionId: res.session_id, code: res.code, hostToken });
    }

    const who = await identify(body);
    if ("error" in who) return who.error;
    const { actor } = who;

    // Reading the state also lets the clock move the case on.
    if (action === "state") return await commit(body, who, null);

    if (actor.kind === "host") {
      if (action === "settings") {
        const cases = body.cases;
        return await commit(body, who, { kind: "doc", run: (doc) => applySettings(doc, { cases: cases as number | undefined }) });
      }

      // Start from the lobby, or a new match straight from the final results
      // (same room, same players). A second click finds a match running and
      // changes nothing.
      if (action === "start" || action === "rematch") {
        return await commit(body, who, {
          kind: "doc",
          run: (doc, now, snapshot, roster) => {
            const lobby = snapshot.session.status === "LOBBY" && !doc.game;
            const over = doc.game?.phase === "final";
            if (action === "start" ? !lobby : !over) return { doc };
            return startGame(doc, roster, now, CASES);
          },
        });
      }

      if (action === "host") {
        const move = parseHostMove(body.move);
        if (!move) return fail("BAD_REQUEST");
        return await commit(body, who, { kind: "doc", run: (doc, now, _s, roster) => applyHostMove(doc, move, now, roster, CASES) });
      }

      // Back to the lobby (settings can change).
      if (action === "lobby") return await commit(body, who, { kind: "lobby" });

      // Close the room for good (its code stops working).
      if (action === "close") return await commit(body, who, { kind: "close" });

      // Lobby: removes the player. During a match: frees the seat (the player
      // comes back by typing the same name, keeping role and points).
      if (action === "release") {
        if (!isUuid(body.playerId)) return fail("BAD_REQUEST");
        const res = await rpc<RpcResult>("fq_release_player", {
          p_session_id: who.snapshot.session.id,
          p_host_token_hash: who.snapshot.session.host_token_hash,
          p_player_id: body.playerId,
        });
        if (!res.ok) return fail(res.error, res.error === "FORBIDDEN" ? 403 : 400);
        await notifyGame(who.snapshot.session.id);
        return await commit(body, await identify(body), null);
      }
      return fail("BAD_REQUEST");
    }

    if (action === "act") {
      const move = parsePlayerMove(body.move);
      if (!move) return fail("BAD_REQUEST");
      const playerId = actor.id;
      return await commit(body, who, { kind: "doc", run: (doc, now) => applyPlayerMove(doc, playerId, move, now) });
    }

    return fail("BAD_REQUEST");
  } catch (err) {
    return handleError(err);
  }
}
