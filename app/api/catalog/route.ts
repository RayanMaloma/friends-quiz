import { rpc } from "@/lib/server/db";
import { fail, handleError, ok, readBody, type RpcResult } from "@/lib/server/game";
import { isSameOriginRequest } from "@/lib/server/admin";
import { getActor, visibleCatalog } from "@/lib/server/access";
import { hashToken, isUuid, newToken } from "@/lib/server/tokens";

export const dynamic = "force-dynamic";

/**
 * Game selection for signed-in hosts: the games this account may open
 * (regular users: public ones only — private games are filtered here, on the
 * server, and refused again by every create endpoint), and its own open rooms.
 */
export async function POST(req: Request) {
  try {
    if (!isSameOriginRequest(req)) return fail("FORBIDDEN", 403);
    const body = await readBody(req);
    const actor = await getActor();
    if (!actor) return fail("AUTH_REQUIRED", 401);

    switch (body.action) {
      case "list": {
        const games = (await visibleCatalog(actor)).map((g) => ({
          key: g.key,
          kind: g.kind,
          title: g.title,
          emoji: g.emoji,
          accent: g.accent,
          minPlayers: g.minPlayers,
          maxPlayers: g.maxPlayers,
          questionCount: g.questionCount,
          // Only privileged viewers see what is private or still a draft.
          ...(actor.privileged ? { visibility: g.visibility, status: g.status } : {}),
        }));
        return ok({ games, privileged: actor.privileged });
      }

      case "mySessions": {
        if (!actor.user) return ok({ sessions: [] });
        const res = await rpc<{ ok: true; sessions: unknown[] }>("fq_my_sessions", { p_owner_id: actor.user.id });
        return ok({ sessions: res.sessions });
      }

      // Take back the host screen of one of your own rooms on this device.
      case "resume": {
        if (!actor.user || !isUuid(body.sessionId)) return fail("GAME_NOT_FOUND", 404);
        const hostToken = newToken();
        const res = await rpc<RpcResult>("fq_owner_resume", {
          p_session_id: body.sessionId,
          p_owner_id: actor.user.id,
          p_host_token_hash: hashToken(hostToken),
        });
        if (!res.ok) return fail(res.error, 404);
        return ok({ sessionId: body.sessionId, code: res.code, kind: res.kind, hostToken });
      }
    }
    return fail("BAD_REQUEST");
  } catch (err) {
    return handleError(err);
  }
}
