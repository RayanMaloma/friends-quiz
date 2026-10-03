import { rpc } from "@/lib/server/db";
import { notifyGame } from "@/lib/server/broadcast";
import { getFacts } from "@/lib/server/facts";
import { fail, getSnapshot, handleError, ok, readBody, type RpcResult } from "@/lib/server/game";
import { hashToken, isTokenShaped, isUuid, newToken } from "@/lib/server/tokens";
import { balancedShuffle } from "@/lib/game/shuffle";
import { buildHostView } from "@/lib/game/views";

export const dynamic = "force-dynamic";

const TRANSITIONS = new Set(["reveal", "leaderboard", "next", "finish"]);

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const action = body.action;

    if (action === "create") {
      const hostToken = newToken();
      const res = await rpc<RpcResult>("fq_create_game", { p_host_token_hash: hashToken(hostToken) });
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
      const order = balancedShuffle(getFacts(), (f) => f.personId);
      const rounds = order.map((f) => ({
        fact_id: f.id,
        fact_text: f.text,
        owner_person_id: f.personId,
      }));
      const res = await rpc<RpcResult>("fq_start_game", {
        p_session_id: sessionId,
        p_host_token_hash: hostHash,
        p_rounds: rounds,
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
