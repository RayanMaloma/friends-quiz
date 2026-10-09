import { rpc, isSupabaseConfigured } from "@/lib/server/db";
import { notifyGame } from "@/lib/server/broadcast";
import { fail, getSnapshot, handleError, ok, readBody, type RpcResult } from "@/lib/server/game";
import {
  checkPassword,
  clearAdminCookie,
  clientIp,
  isAdmin,
  isAdminConfigured,
  isDevPassword,
  isSameOriginRequest,
  loginAllowed,
  recordFailedLogin,
  setAdminCookie,
} from "@/lib/server/admin";
import { getGame, listGames, saveGame } from "@/lib/server/games";
import { legacyGameDoc } from "@/lib/server/legacy";
import { isUuid } from "@/lib/server/tokens";
import { normalizeGameDoc, TEMPLATES, validateGameDoc } from "@/lib/game/doc";
import { buildLeaderboard } from "@/lib/game/views";
import type { GameRecordStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: GameRecordStatus[] = ["draft", "published", "archived"];

export async function POST(req: Request) {
  try {
    if (!isSameOriginRequest(req)) return fail("FORBIDDEN", 403);
    const body = await readBody(req);
    const action = body.action;

    // ---- Public: login / status ----------------------------------------
    if (action === "login") {
      if (!isAdminConfigured()) return fail("ADMIN_NOT_CONFIGURED", 503);
      const ip = clientIp(req);
      if (!loginAllowed(ip)) return fail("TOO_MANY_ATTEMPTS", 429);
      if (!checkPassword(body.password)) {
        recordFailedLogin(ip);
        return fail("WRONG_PASSWORD", 401);
      }
      await setAdminCookie();
      return ok({});
    }

    if (action === "logout") {
      await clearAdminCookie();
      return ok({});
    }

    if (!(await isAdmin())) return fail("ADMIN_REQUIRED", 401);

    // ---- Admin only -------------------------------------------------------
    switch (action) {
      case "status": {
        let schemaVersion = 0;
        try {
          schemaVersion = await rpc<number>("fq_schema_version", {});
        } catch {
          schemaVersion = 0;
        }
        return ok({
          devPassword: isDevPassword(),
          storage: isSupabaseConfigured ? "supabase" : "local",
          schemaVersion,
        });
      }

      case "listGames":
        return ok({ games: await listGames() });

      case "getGame": {
        if (!isUuid(body.id)) return fail("NOT_FOUND", 404);
        const game = await getGame(body.id);
        if (!game) return fail("NOT_FOUND", 404);
        return ok({ game, issues: validateGameDoc(game.doc) });
      }

      case "createGame": {
        const template = TEMPLATES.find((t) => t.id === body.template) ?? TEMPLATES[TEMPLATES.length - 1];
        const doc = template.build();
        const res = await saveGame(null, doc, null, "draft");
        if (!res.ok) return fail(res.error);
        return ok({ game: res.game });
      }

      case "importGame": {
        // Accepts an exported file ({ doc } or the doc itself).
        const raw = body.doc && typeof body.doc === "object" && "doc" in (body.doc as object)
          ? (body.doc as { doc: unknown }).doc
          : body.doc;
        const doc = normalizeGameDoc(raw);
        const res = await saveGame(null, doc, null, "draft");
        if (!res.ok) return fail(res.error);
        return ok({ game: res.game });
      }

      case "importLegacy": {
        const res = await saveGame(null, legacyGameDoc(), null, "published");
        if (!res.ok) return fail(res.error);
        return ok({ game: res.game });
      }

      case "duplicateGame": {
        if (!isUuid(body.id)) return fail("NOT_FOUND", 404);
        const game = await getGame(body.id);
        if (!game) return fail("NOT_FOUND", 404);
        const doc = { ...game.doc, title: `${game.doc.title} (نسخة)`.slice(0, 60) };
        const res = await saveGame(null, normalizeGameDoc(doc), null, "draft");
        if (!res.ok) return fail(res.error);
        return ok({ game: res.game });
      }

      case "saveGame": {
        if (!isUuid(body.id)) return fail("NOT_FOUND", 404);
        const version = typeof body.version === "number" ? body.version : null;
        const doc = normalizeGameDoc(body.doc);
        const issues = validateGameDoc(doc);
        // A published game must stay playable; saving one with problems turns it back into a draft.
        const current = await getGame(body.id);
        if (!current) return fail("NOT_FOUND", 404);
        const status = current.status === "published" && issues.length > 0 ? "draft" : null;
        const res = await saveGame(body.id, doc, version, status);
        if (!res.ok) {
          if (res.error === "VERSION_CONFLICT") return Response.json(res, { status: 409 });
          return fail(res.error, res.error === "NOT_FOUND" ? 404 : 400);
        }
        return ok({ game: res.game, issues });
      }

      case "setStatus": {
        if (!isUuid(body.id)) return fail("NOT_FOUND", 404);
        const status = body.status as GameRecordStatus;
        if (!STATUSES.includes(status)) return fail("BAD_REQUEST");
        if (status === "published") {
          const game = await getGame(body.id);
          if (!game) return fail("NOT_FOUND", 404);
          const issues = validateGameDoc(game.doc);
          if (issues.length > 0) return Response.json({ ok: false, error: "PUBLISH_BLOCKED", issues }, { status: 400 });
        }
        const res = await rpc<RpcResult>("fq_admin_set_game_status", { p_id: body.id, p_status: status });
        if (!res.ok) return fail(res.error, 404);
        return ok({ status: res.status, version: res.version });
      }

      case "deleteGame": {
        if (!isUuid(body.id)) return fail("NOT_FOUND", 404);
        await rpc("fq_admin_delete_game", { p_id: body.id });
        return ok({});
      }

      case "listSessions": {
        const res = await rpc<{ ok: true; sessions: unknown[] }>("fq_admin_list_sessions", { p_limit: 100 });
        return ok({ sessions: res.sessions });
      }

      case "sessionResults": {
        if (!isUuid(body.id)) return fail("NOT_FOUND", 404);
        const snapshot = await getSnapshot(body.id);
        if (!snapshot) return fail("NOT_FOUND", 404);
        return ok({ leaderboard: buildLeaderboard(snapshot) });
      }

      case "endSession": {
        if (!isUuid(body.id)) return fail("NOT_FOUND", 404);
        await rpc("fq_admin_end_session", { p_id: body.id });
        await notifyGame(body.id);
        return ok({});
      }

      case "deleteSession": {
        if (!isUuid(body.id)) return fail("NOT_FOUND", 404);
        await rpc("fq_admin_delete_session", { p_id: body.id });
        return ok({});
      }
    }

    return fail("BAD_REQUEST");
  } catch (err) {
    return handleError(err);
  }
}
