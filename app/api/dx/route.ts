import { rpc } from "@/lib/server/db";
import { notifyGame } from "@/lib/server/broadcast";
import { fail, getSnapshot, handleError, ok, readBody, type RpcResult } from "@/lib/server/game";
import { hashToken, isTokenShaped, isUuid, newToken } from "@/lib/server/tokens";
import { authorizeCreate, claimSession } from "@/lib/server/access";
import { getDxGame } from "@/lib/server/games";
import { validateDxDoc } from "@/lib/dx/doc";
import { createMatch, reduce } from "@/lib/dx/engine/engine";
import { authorize, parseAction, type Actor } from "@/lib/dx/actions";
import { buildDxGuestView, buildDxHostView, matchOf, type DxSessionConfig } from "@/lib/dx/views";
import type { Snapshot } from "@/lib/types";
import type { MatchState } from "@/lib/dx/types/match";

export const dynamic = "force-dynamic";

/**
 * Deduction game endpoint, for the TV (`as: "host"`, host token) and the
 * phones (`as: "guest"`, player token). Joining a room still goes through
 * /api/guest (same room codes for every kind of game).
 *
 * Every action: load the session → identify the sender → check the sender may
 * do it (lib/dx/actions.ts) → run the engine → save with an optimistic lock.
 * If two phones act at the same moment (votes), the loser retries on the new
 * state, so no vote is ever lost.
 */

const MAX_ATTEMPTS = 6;

type Identified = { snapshot: Snapshot; actor: Actor } | { error: Response };

async function identify(body: Record<string, unknown>): Promise<Identified> {
  const { sessionId } = body;
  if (!isUuid(sessionId)) return { error: fail("GAME_NOT_FOUND", 404) };
  const snapshot = await getSnapshot(sessionId);
  if (!snapshot || snapshot.session.kind !== "deduction") return { error: fail("GAME_NOT_FOUND", 404) };
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

function viewFor(snapshot: Snapshot, actor: Actor) {
  if (actor.kind === "host") return buildDxHostView(snapshot);
  return buildDxGuestView(snapshot, actor.id);
}

function saveStatus(m: MatchState) {
  return m.phase === "gameOver" ? "FINISHED" : "PLAYING";
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const action = body.action;

    // Opening a room needs an account.
    if (action === "create") {
      if (!isUuid(body.gameId)) return fail("GAME_MISSING", 404);
      // Signed in, and the game is public (or the viewer is the super admin): private games read as missing.
      const auth = await authorizeCreate(body.gameId);
      if ("error" in auth) return fail(auth.error, auth.status);
      const game = await getDxGame(body.gameId);
      if (!game || game.status === "archived") return fail("GAME_MISSING", 404);
      if (validateDxDoc(game.doc).length > 0) return fail("DX_GAME_BROKEN");
      const config: DxSessionConfig = {
        kind: "deduction",
        title: game.doc.title,
        emoji: game.doc.emoji,
        accent: game.doc.accent,
        settings: { lateJoin: false, askPersonOnJoin: false },
        people: [],
        game: game.doc.config,
        assets: game.doc.assets,
      };
      const hostToken = newToken();
      const res = await rpc<RpcResult>("fq_dx_create_session", {
        p_host_token_hash: hashToken(hostToken),
        p_game_id: game.id,
        p_config: config,
      });
      if (!res.ok) return fail(res.error);
      await claimSession(res.session_id as string, auth.actor);
      return ok({ sessionId: res.session_id, code: res.code, hostToken });
    }

    let who = await identify(body);
    if ("error" in who) return who.error;

    if (action === "state") {
      const view = viewFor(who.snapshot, who.actor);
      return view ? ok({ view }) : fail("NOT_A_PLAYER", 401);
    }

    // The frozen design of this session (sent once per device).
    if (action === "config") {
      const config = who.snapshot.session.config as unknown as DxSessionConfig;
      return ok({ game: config.game, assets: config.assets });
    }

    if (who.actor.kind === "host" && action === "start") {
      const { snapshot } = who;
      if (snapshot.session.status !== "LOBBY" || matchOf(snapshot)) return ok({ view: buildDxHostView(snapshot) });
      const config = snapshot.session.config as unknown as DxSessionConfig;
      // Seat order = turn order, as arranged on the TV (falls back to join order).
      const byId = new Map(snapshot.players.map((p) => [p.id, p]));
      const order = Array.isArray(body.order) ? body.order.filter((id): id is string => typeof id === "string") : [];
      const seated = [...new Set(order)].map((id) => byId.get(id)).filter((p) => !!p);
      for (const p of snapshot.players) if (!seated.includes(p)) seated.push(p);
      const created = createMatch(config.game, {
        players: seated.map((p) => ({ id: p.id, name: p.display_name })),
      });
      if (created.error) return Response.json({ ok: false, error: "RULE", message: created.error }, { status: 409 });
      const res = await rpc<RpcResult>("fq_dx_save_match", {
        p_session_id: snapshot.session.id,
        p_expected_version: snapshot.session.match_version ?? 0,
        p_match: created.state,
        p_status: "PLAYING",
      });
      if (res.ok) await notifyGame(snapshot.session.id);
      const fresh = await getSnapshot(snapshot.session.id);
      return fresh ? ok({ view: buildDxHostView(fresh) }) : fail("GAME_NOT_FOUND", 404);
    }

    if (who.actor.kind === "host" && action === "release") {
      if (!isUuid(body.playerId)) return fail("BAD_REQUEST");
      const res = await rpc<RpcResult>("fq_release_player", {
        p_session_id: who.snapshot.session.id,
        p_host_token_hash: who.snapshot.session.host_token_hash,
        p_player_id: body.playerId,
      });
      if (!res.ok) return fail(res.error, res.error === "FORBIDDEN" ? 403 : 400);
      await notifyGame(who.snapshot.session.id);
      const fresh = await getSnapshot(who.snapshot.session.id);
      return fresh ? ok({ view: buildDxHostView(fresh) }) : fail("GAME_NOT_FOUND", 404);
    }

    if (action === "act") {
      const parsed = parseAction(body.move);
      if (!parsed) return fail("BAD_REQUEST");
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          who = await identify(body);
          if ("error" in who) return who.error;
        }
        const { snapshot, actor } = who;
        const m = matchOf(snapshot);
        if (!m) return fail("NOT_STARTED", 409);
        const move = authorize(m, actor, parsed);
        if (!move) return fail("NOT_YOUR_TURN", 403);
        const result = reduce(m, move);
        if (result.error) return Response.json({ ok: false, error: "RULE", message: result.error }, { status: 409 });
        if (result.state === m) return ok({ view: viewFor(snapshot, actor) });
        const res = await rpc<RpcResult>("fq_dx_save_match", {
          p_session_id: snapshot.session.id,
          p_expected_version: snapshot.session.match_version ?? 0,
          p_match: result.state,
          p_status: saveStatus(result.state),
        });
        if (res.ok) {
          await notifyGame(snapshot.session.id);
          const fresh = await getSnapshot(snapshot.session.id);
          return fresh ? ok({ view: viewFor(fresh, actor) }) : fail("GAME_NOT_FOUND", 404);
        }
        if (res.error !== "STALE_STATE") return fail(res.error, 409);
        // Someone else acted first: retry on the new state.
      }
      return fail("BUSY", 503);
    }

    return fail("BAD_REQUEST");
  } catch (err) {
    return handleError(err);
  }
}
