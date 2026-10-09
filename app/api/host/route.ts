import { rpc } from "@/lib/server/db";
import { notifyGame } from "@/lib/server/broadcast";
import { fail, getSnapshot, handleError, ok, readBody, type RpcResult } from "@/lib/server/game";
import { hashToken, isTokenShaped, isUuid, newToken } from "@/lib/server/tokens";
import { isAdmin } from "@/lib/server/admin";
import { getGame } from "@/lib/server/games";
import { buildRounds, buildSessionConfig } from "@/lib/game/rounds";
import { buildHostView } from "@/lib/game/views";

export const dynamic = "force-dynamic";

const TRANSITIONS = new Set(["reveal", "leaderboard", "next", "finish", "end"]);

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const action = body.action;

    // Starting a session of a game is an admin action (the TV laptop logs in once).
    if (action === "create") {
      if (!(await isAdmin())) return fail("ADMIN_REQUIRED", 401);
      if (!isUuid(body.gameId)) return fail("GAME_MISSING", 404);
      const game = await getGame(body.gameId);
      if (!game || game.status === "archived") return fail("GAME_MISSING", 404);
      const rounds = buildRounds(game.doc);
      if (rounds.length === 0) return fail("NO_QUESTIONS");

      const hostToken = newToken();
      const res = await rpc<RpcResult>("fq_create_session", {
        p_host_token_hash: hashToken(hostToken),
        p_game_id: game.id,
        p_config: buildSessionConfig(game.doc),
        p_rounds: rounds,
      });
      if (!res.ok) return fail(res.error);
      return ok({ sessionId: res.session_id, code: res.code, hostToken });
    }

    const { sessionId, hostToken } = body;
    if (!isUuid(sessionId)) return fail("GAME_NOT_FOUND", 404);
    if (!isTokenShaped(hostToken)) return fail("FORBIDDEN", 403);
    const hostHash = hashToken(hostToken);

    const respondWithState = async () => {
      const snapshot = await getSnapshot(sessionId);
      if (!snapshot) return fail("GAME_NOT_FOUND", 404);
      if (snapshot.session.host_token_hash !== hostHash) return fail("FORBIDDEN", 403);
      return ok({ view: buildHostView(snapshot) });
    };

    if (action === "state") return await respondWithState();

    if (action === "start") {
      const res = await rpc<RpcResult>("fq_start_game", {
        p_session_id: sessionId,
        p_host_token_hash: hostHash,
      });
      if (!res.ok) return fail(res.error, res.error === "FORBIDDEN" ? 403 : 400);
      if (res.changed) await notifyGame(sessionId);
      return await respondWithState();
    }

    if (typeof action === "string" && TRANSITIONS.has(action)) {
      const expectedIndex = body.expectedIndex;
      if (typeof expectedIndex !== "number" || !Number.isInteger(expectedIndex)) {
        return fail("BAD_REQUEST");
      }
      const res = await rpc<RpcResult>("fq_host_transition", {
        p_session_id: sessionId,
        p_host_token_hash: hostHash,
        p_action: action,
        p_expected_index: expectedIndex,
      });
      if (!res.ok) return fail(res.error, res.error === "FORBIDDEN" ? 403 : 400);
      if (res.changed) await notifyGame(sessionId);
      return await respondWithState();
    }

    if (action === "release") {
      if (!isUuid(body.playerId)) return fail("BAD_REQUEST");
      const res = await rpc<RpcResult>("fq_release_player", {
        p_session_id: sessionId,
        p_host_token_hash: hostHash,
        p_player_id: body.playerId,
      });
      if (!res.ok) return fail(res.error, res.error === "FORBIDDEN" ? 403 : 400);
      await notifyGame(sessionId);
      return await respondWithState();
    }

    return fail("BAD_REQUEST");
  } catch (err) {
    return handleError(err);
  }
}
