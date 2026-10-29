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
import { getDxGame, getGame, getGameKind, listGames, saveDxGame, saveGame } from "@/lib/server/games";
import { isDxDoc, newDxDoc, normalizeDxDoc, validateDxDoc } from "@/lib/dx/doc";
import { legacyGameDoc } from "@/lib/server/legacy";
import { isUuid } from "@/lib/server/tokens";
import { normalizeGameDoc, TEMPLATES, validateGameDoc } from "@/lib/game/doc";
import { buildLeaderboard } from "@/lib/game/views";
import type { GameRecordStatus } from "@/lib/types";
import { loadCatalog } from "@/lib/server/access";
import { isBuiltinKey } from "@/lib/catalog";
import { QUESTION_BANK } from "@/lib/invent/questions";
import { publicCopy } from "@/lib/dx/publicCopy";
import { summarizeSession } from "@/lib/server/activity";

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

    if (!(await isAdmin({ refresh: true }))) return fail("ADMIN_REQUIRED", 401);

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
          const kind = await getGameKind(body.id);
          if (!kind) return fail("NOT_FOUND", 404);
          const issues =
            kind === "deduction"
              ? validateDxDoc((await getDxGame(body.id))!.doc)
              : validateGameDoc((await getGame(body.id))!.doc);
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

      // ---- Deduction games ---------------------------------------------
      case "dxCreate": {
        const res = await saveDxGame(null, newDxDoc(String(body.template ?? "classic")), null, "draft");
        if (!res.ok) return fail(res.error);
        return ok({ game: res.game });
      }

      case "dxGet": {
        if (!isUuid(body.id)) return fail("NOT_FOUND", 404);
        const game = await getDxGame(body.id);
        if (!game) return fail("NOT_FOUND", 404);
        return ok({ game, issues: validateDxDoc(game.doc) });
      }

      case "dxSave": {
        if (!isUuid(body.id)) return fail("NOT_FOUND", 404);
        const version = typeof body.version === "number" ? body.version : null;
        const { doc, errors } = normalizeDxDoc(body.doc);
        if (!doc) return Response.json({ ok: false, error: "DX_INVALID", errors }, { status: 400 });
        const current = await getDxGame(body.id);
        if (!current) return fail("NOT_FOUND", 404);
        const issues = validateDxDoc(doc);
        const status = current.status === "published" && issues.length > 0 ? "draft" : null;
        const res = await saveDxGame(body.id, doc, version, status);
        if (!res.ok) {
          if (res.error === "VERSION_CONFLICT") return Response.json(res, { status: 409 });
          return fail(res.error, res.error === "NOT_FOUND" ? 404 : 400);
        }
        return ok({ game: res.game, issues });
      }

      case "dxImport": {
        // Accepts an exported file ({ doc } or the doc itself).
        const raw = body.doc && typeof body.doc === "object" && "doc" in (body.doc as object)
          ? (body.doc as { doc: unknown }).doc
          : body.doc;
        if (!isDxDoc(raw)) return fail("DX_INVALID");
        const { doc, errors } = normalizeDxDoc(raw);
        if (!doc) return Response.json({ ok: false, error: "DX_INVALID", errors }, { status: 400 });
        const res = await saveDxGame(null, doc, null, "draft");
        if (!res.ok) return fail(res.error);
        return ok({ game: res.game });
      }

      case "dxDuplicate": {
        if (!isUuid(body.id)) return fail("NOT_FOUND", 404);
        const game = await getDxGame(body.id);
        if (!game) return fail("NOT_FOUND", 404);
        const copy = structuredClone(game.doc);
        copy.config.identity.name = `${copy.config.identity.name} (نسخة)`.slice(0, 60);
        const { doc } = normalizeDxDoc(copy);
        if (!doc) return fail("DX_INVALID");
        const res = await saveDxGame(null, doc, null, "draft");
        if (!res.ok) return fail(res.error);
        return ok({ game: res.game });
      }

      // ---- Catalog: who can open what ---------------------------------
      case "catalog":
        return ok({ catalog: await loadCatalog() });

      case "setVisibility": {
        const key = String(body.key ?? "");
        if (!isBuiltinKey(key) && !isUuid(key)) return fail("NOT_FOUND", 404);
        if (body.visibility !== "public" && body.visibility !== "private") return fail("BAD_REQUEST");
        const res = await rpc<RpcResult>("fq_admin_set_visibility", { p_key: key, p_visibility: body.visibility });
        if (!res.ok) return fail(res.error, 404);
        return ok({});
      }

      // The fixed Ahaji question set, read-only (its wording is approved and never edited here).
      case "inventAhajiQuestions":
        return ok({ questions: QUESTION_BANK });

      // A public, group-neutral copy of a private hidden-role game (names and photos removed).
      case "dxPublicCopy": {
        if (!isUuid(body.id)) return fail("NOT_FOUND", 404);
        const game = await getDxGame(body.id);
        if (!game) return fail("NOT_FOUND", 404);
        const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 60) : `${game.doc.title} (عامة)`;
        const { doc: copy, removedNames } = publicCopy(game.doc, title);
        const { doc, errors } = normalizeDxDoc(copy);
        if (!doc) return Response.json({ ok: false, error: "DX_INVALID", errors }, { status: 400 });
        const playable = validateDxDoc(doc).length === 0;
        const res = await saveDxGame(null, doc, null, playable ? "published" : "draft");
        if (!res.ok) return fail(res.error);
        await rpc("fq_admin_set_visibility", { p_key: res.game.id, p_visibility: "public" });
        return ok({ game: res.game, removedNames });
      }

      // ---- Activity ------------------------------------------------------
      case "activityOverview":
        return ok({ overview: await rpc("fq_admin_activity_overview", {}) });

      case "listAccounts": {
        const res = await rpc<{ ok: true; accounts: unknown[] }>("fq_admin_list_accounts", { p_limit: 500 });
        return ok({ accounts: res.accounts });
      }

      case "listActivitySessions": {
        const f = (body.filters ?? {}) as Record<string, unknown>;
        const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
        const to = day(f.to);
        const filters = {
          game_key: typeof f.gameKey === "string" && f.gameKey.length <= 64 ? f.gameKey : "",
          state: ["lobby", "playing", "completed", "cancelled", "expired"].includes(String(f.state)) ? String(f.state) : "",
          from: day(f.from),
          // Inclusive end date.
          to: to ? new Date(Date.parse(`${to}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : "",
          owner: f.owner === "none" || isUuid(f.owner) ? String(f.owner) : "",
        };
        const res = await rpc<{ ok: true; sessions: unknown[] }>("fq_admin_list_activity_sessions", { p_filters: filters, p_limit: 500 });
        return ok({ sessions: res.sessions });
      }

      case "sessionDetail": {
        if (!isUuid(body.id)) return fail("NOT_FOUND", 404);
        const res = await rpc<RpcResult>("fq_admin_session_detail", { p_id: body.id });
        if (!res.ok) return fail(res.error, 404);
        const detail = summarizeSession(res);
        // Quiz scores are derived from the answers, never stored: compute the standings.
        if (detail.kind === "quiz" && detail.state === "completed") {
          const snapshot = await getSnapshot(body.id);
          const top = snapshot ? buildLeaderboard(snapshot).filter((e) => e.rank === 1 && e.score > 0) : [];
          if (top.length) detail.result = `الفائز: ${top.map((e) => e.name).join("، ")} (${top[0].score})`;
        }
        return ok({ detail });
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
