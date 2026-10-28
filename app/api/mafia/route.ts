import { rpc } from "@/lib/server/db";
import { notifyGame } from "@/lib/server/broadcast";
import { fail, getSnapshot, handleError, ok, readBody, type RpcResult } from "@/lib/server/game";
import { hashToken, isTokenShaped, isUuid, newToken } from "@/lib/server/tokens";
import { isAdmin } from "@/lib/server/admin";
import { advance, applyHostMove, applyPlayerMove, createMatch } from "@/lib/mafia/engine";
import {
  buildMafiaGuestView,
  buildMafiaHostView,
  mafiaMatchOf,
  type MafiaSessionConfig,
} from "@/lib/mafia/views";
import type { EngineResult, HostMove, MafiaMatch, NightPhase, PlayerMove } from "@/lib/mafia/types";
import { NIGHT_PHASES } from "@/lib/mafia/types";
import type { Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Mafia endpoint, for the TV (`as: "host"`, host token) and the phones
 * (`as: "guest"`, player token). Joining still goes through /api/guest.
 *
 * Every request: load the room → identify the sender → let the clock move
 * the match on (deadlines that passed) → apply the sender's move, checked
 * against its role, the phase and the round → save with an optimistic lock
 * (two phones voting at once: the loser retries on the new state) → answer
 * with the sender's own view only.
 */

const MAX_ATTEMPTS = 6;

type Actor = { kind: "host" } | { kind: "player"; id: string };
type Identified = { snapshot: Snapshot; actor: Actor } | { error: Response };

async function identify(body: Record<string, unknown>): Promise<Identified> {
  if (!isUuid(body.sessionId)) return { error: fail("GAME_NOT_FOUND", 404) };
  const snapshot = await getSnapshot(body.sessionId);
  if (!snapshot || snapshot.session.kind !== "mafia") return { error: fail("GAME_NOT_FOUND", 404) };
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

function viewFor(snapshot: Snapshot, m: MafiaMatch | null, actor: Actor) {
  return actor.kind === "host" ? buildMafiaHostView(snapshot, m) : buildMafiaGuestView(snapshot, m, actor.id);
}

const isStr = (v: unknown, max = 64): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isRound = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 100;

function parsePlayerMove(raw: unknown): PlayerMove | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case "seeRole":
      return { type: "seeRole" };
    case "night":
      return NIGHT_PHASES.includes(a.phase as never) && isRound(a.round) && isStr(a.targetId)
        ? { type: "night", phase: a.phase as NightPhase, round: a.round, targetId: a.targetId }
        : null;
    case "vote":
      return isRound(a.round) && isStr(a.choice) ? { type: "vote", round: a.round, choice: a.choice } : null;
    default:
      return null;
  }
}

function parseHostMove(raw: unknown): HostMove | null {
  if (!raw || typeof raw !== "object") return null;
  const t = (raw as Record<string, unknown>).type;
  return t === "pause" || t === "resume" || t === "skipReveal" ? { type: t } : null;
}

type Change =
  | { kind: "match"; run: (m: MafiaMatch, now: number) => EngineResult }
  | { kind: "lobby" }
  | { kind: "close" };

/**
 * Runs `change` (or just the clock when null) on the latest state and saves
 * it. Retries when another device saved first. Returns the sender's view.
 */
async function commit(body: Record<string, unknown>, first: Identified, change: Change | null): Promise<Response> {
  let who = first;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) who = await identify(body);
    if ("error" in who) return who.error;
    const { snapshot, actor } = who;
    const now = Date.parse(snapshot.now);
    const current = mafiaMatchOf(snapshot);

    let next: MafiaMatch | null = current;
    let status: "LOBBY" | "PLAYING" | "FINISHED" = snapshot.session.status === "LOBBY" ? "LOBBY" : "PLAYING";
    if (snapshot.session.status === "FINISHED") return ok({ view: viewFor(snapshot, current, actor) });

    if (change?.kind === "lobby") {
      next = null;
      status = "LOBBY";
    } else if (change?.kind === "close") {
      status = "FINISHED";
    } else if (current) {
      next = advance(current, now);
      if (change?.kind === "match") {
        const res = change.run(next, now);
        if (res.error) {
          // Still save the clock's progress, then report the refusal.
          if (next !== current) await save(snapshot, next, status);
          return fail(res.error, res.error === "NOT_A_PLAYER" ? 401 : 409);
        }
        next = advance(res.state, now);
      }
    } else if (change?.kind === "match") {
      return fail("NOT_STARTED", 409);
    }

    const unchanged = next === current && status === snapshot.session.status;
    if (unchanged) return ok({ view: viewFor(snapshot, current, actor) });

    const saved = await save(snapshot, next, status);
    if (saved === "ok") {
      const fresh = await getSnapshot(snapshot.session.id);
      return fresh ? ok({ view: viewFor(fresh, mafiaMatchOf(fresh), actor) }) : fail("GAME_NOT_FOUND", 404);
    }
    if (saved !== "STALE_STATE") return fail(saved, 409);
    // Someone else saved first: run again on their state.
  }
  return fail("BUSY", 503);
}

async function save(snapshot: Snapshot, m: MafiaMatch | null, status: string): Promise<string> {
  const res = await rpc<RpcResult>("fq_mafia_save_match", {
    p_session_id: snapshot.session.id,
    p_expected_version: snapshot.session.match_version ?? 0,
    p_match: m,
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

    // Opening a room is an admin action (the TV laptop logs in once).
    if (action === "create") {
      if (!(await isAdmin())) return fail("ADMIN_REQUIRED", 401);
      const config: MafiaSessionConfig = {
        kind: "mafia",
        title: "المافيا",
        emoji: "🌒",
        accent: "grape",
        settings: { lateJoin: false, askPersonOnJoin: false },
        people: [],
      };
      const hostToken = newToken();
      const res = await rpc<RpcResult>("fq_mafia_create_session", {
        p_host_token_hash: hashToken(hostToken),
        p_config: config,
      });
      if (!res.ok) return fail(res.error);
      return ok({ sessionId: res.session_id, code: res.code, hostToken });
    }

    const who = await identify(body);
    if ("error" in who) return who.error;
    const { snapshot, actor } = who;

    // Reading the state also lets the clock move the match on.
    if (action === "state") return await commit(body, who, null);

    if (actor.kind === "host") {
      if (action === "start") {
        if (snapshot.session.status !== "LOBBY" || mafiaMatchOf(snapshot)) return await commit(body, who, null);
        // Released devices (token cleared) are not dealt in.
        const seated = snapshot.players.filter((p) => p.token_hash !== null).map((p) => ({ id: p.id, name: p.display_name }));
        const created = createMatch(seated, Date.parse(snapshot.now));
        if (created.error) return Response.json({ ok: false, error: "RULE", message: created.error }, { status: 409 });
        const res = await rpc<RpcResult>("fq_mafia_save_match", {
          p_session_id: snapshot.session.id,
          p_expected_version: snapshot.session.match_version ?? 0,
          p_match: created.state,
          p_status: "PLAYING",
        });
        if (res.ok) await notifyGame(snapshot.session.id);
        const fresh = await getSnapshot(snapshot.session.id);
        return fresh ? ok({ view: buildMafiaHostView(fresh, mafiaMatchOf(fresh)) }) : fail("GAME_NOT_FOUND", 404);
      }

      if (action === "host") {
        const move = parseHostMove(body.move);
        if (!move) return fail("BAD_REQUEST");
        return await commit(body, who, { kind: "match", run: (m, now) => applyHostMove(m, move, now) });
      }

      // Back to the lobby for a rematch (same room, same players, new roles).
      if (action === "lobby") return await commit(body, who, { kind: "lobby" });

      if (action === "close") return await commit(body, who, { kind: "close" });

      if (action === "release") {
        if (!isUuid(body.playerId)) return fail("BAD_REQUEST");
        const res = await rpc<RpcResult>("fq_release_player", {
          p_session_id: snapshot.session.id,
          p_host_token_hash: snapshot.session.host_token_hash,
          p_player_id: body.playerId,
        });
        if (!res.ok) return fail(res.error, res.error === "FORBIDDEN" ? 403 : 400);
        await notifyGame(snapshot.session.id);
        return await commit(body, await identify(body), null);
      }
      return fail("BAD_REQUEST");
    }

    if (action === "act") {
      const move = parsePlayerMove(body.move);
      if (!move) return fail("BAD_REQUEST");
      const playerId = actor.id;
      return await commit(body, who, { kind: "match", run: (m, now) => applyPlayerMove(m, playerId, move, now) });
    }

    return fail("BAD_REQUEST");
  } catch (err) {
    return handleError(err);
  }
}
