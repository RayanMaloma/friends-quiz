import { rpc } from "@/lib/server/db";
import { notifyGame } from "@/lib/server/broadcast";
import { fail, getSnapshot, handleError, ok, readBody, type RpcResult } from "@/lib/server/game";
import { hashToken, isTokenShaped, isUuid, newToken } from "@/lib/server/tokens";
import { buildGuestView } from "@/lib/game/views";
import { isKnownPerson } from "@/lib/people";

export const dynamic = "force-dynamic";

/** Trim, collapse spaces, strip control chars; 1–24 characters. */
function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return name.length >= 1 && [...name].length <= 24 ? name : null;
}

function isRoomCode(v: unknown): v is string {
  return typeof v === "string" && /^[0-9]{4}$/.test(v);
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const action = body.action;

    if (action === "lookup") {
      if (!isRoomCode(body.code)) return fail("GAME_NOT_FOUND", 404);
      const res = await rpc<RpcResult>("fq_lookup_game", { p_code: body.code });
      if (!res.ok) return fail(res.error, 404);
      return ok({ sessionId: res.session_id, status: res.status, takenPersonIds: res.taken_person_ids });
    }

    if (action === "join") {
      if (!isRoomCode(body.code)) return fail("GAME_NOT_FOUND", 404);
      const name = cleanName(body.name);
      if (!name) return fail("BAD_NAME");
      // Optional link to a fact owner (people.json id). null = regular player.
      const personId = body.personId ?? null;
      if (personId !== null && !isKnownPerson(personId)) return fail("BAD_REQUEST");
      const playerToken = newToken();
      const res = await rpc<RpcResult>("fq_join_game", {
        p_code: body.code,
        p_display_name: name,
        p_person_id: personId,
        p_token_hash: hashToken(playerToken),
      });
      if (!res.ok) {
        const status = res.error === "GAME_NOT_FOUND" ? 404 : res.error === "BAD_NAME" ? 400 : 409;
        return fail(res.error, status);
      }
      await notifyGame(res.session_id as string);
      return ok({
        sessionId: res.session_id,
        playerToken,
        name: res.display_name,
        personId: res.person_id ?? null,
      });
    }

    const { sessionId, playerToken } = body;
    if (!isUuid(sessionId)) return fail("GAME_NOT_FOUND", 404);
    if (!isTokenShaped(playerToken)) return fail("NOT_A_PLAYER", 401);
    const tokenHash = hashToken(playerToken);

    const respondWithState = async () => {
      const snapshot = await getSnapshot(sessionId);
      if (!snapshot) return fail("GAME_NOT_FOUND", 404);
      const player = snapshot.players.find((p) => p.token_hash === tokenHash);
      const view = player ? buildGuestView(snapshot, player.id) : null;
      if (!view) return fail("NOT_A_PLAYER", 401);
      return ok({ view });
    };

    if (action === "state") return await respondWithState();

    if (action === "answer") {
      const { roundIndex, personId } = body;
      if (typeof roundIndex !== "number" || !Number.isInteger(roundIndex) || !isKnownPerson(personId)) {
        return fail("BAD_REQUEST");
      }
      const res = await rpc<RpcResult>("fq_submit_answer", {
        p_session_id: sessionId,
        p_token_hash: tokenHash,
        p_round_index: roundIndex,
        p_chosen_person_id: personId,
      });
      if (!res.ok) {
        // ROUND_CLOSED etc: the client just resyncs to the authoritative state.
        const status = res.error === "NOT_A_PLAYER" ? 401 : 409;
        return fail(res.error, status);
      }
      if (!res.already_submitted) await notifyGame(sessionId);
      return await respondWithState();
    }

    if (action === "leave") {
      const res = await rpc<RpcResult>("fq_leave_game", {
        p_session_id: sessionId,
        p_token_hash: tokenHash,
      });
      if (!res.ok) return fail(res.error, 409);
      await notifyGame(sessionId);
      return ok({});
    }

    return fail("BAD_REQUEST");
  } catch (err) {
    return handleError(err);
  }
}
