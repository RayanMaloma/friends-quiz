import "server-only";
import { rpc } from "@/lib/server/db";
import { hasAdminPasswordCookie } from "@/lib/server/admin";
import { currentUser, type SessionUser } from "@/lib/server/auth/session";
import { BUILTINS, type CatalogEntry, type Visibility } from "@/lib/catalog";
import type { Accent } from "@/lib/types";

/**
 * Who is asking, for game catalog / room creation checks (all server-side).
 * - a signed-in account (role from the database);
 * - or the shared dashboard password (GM), which acts like the super admin.
 * Players who joined a room by QR are neither: they only hold a player token
 * for that room and never reach these checks.
 */
export interface Actor {
  user: SessionUser | null;
  /** Super admin or dashboard password: every game, private ones included. */
  privileged: boolean;
}

export async function getActor(): Promise<Actor | null> {
  const user = await currentUser({ refresh: true });
  const gm = await hasAdminPasswordCookie();
  if (!user && !gm) return null;
  return { user, privileged: gm || user?.role === "super_admin" };
}

interface RawCatalog {
  ok: true;
  builtin: Record<string, Visibility>;
  games: {
    id: string;
    kind: string;
    status: string;
    visibility: Visibility;
    title: string | null;
    emoji: string | null;
    accent: string | null;
    question_count: number;
    min_players: number | null;
    max_players: number | null;
  }[];
}

/** Every built-in and non-archived authored game, with its visibility. */
export async function loadCatalog(): Promise<CatalogEntry[]> {
  const raw = await rpc<RawCatalog>("fq_catalog_list", {});
  const builtins = (Object.keys(BUILTINS) as (keyof typeof BUILTINS)[]).map((key) => ({
    ...BUILTINS[key],
    visibility: raw.builtin[key] === "public" ? "public" : "private",
  })) as CatalogEntry[];
  const games: CatalogEntry[] = raw.games.map((g) => ({
    key: g.id,
    kind: g.kind === "deduction" ? "deduction" : "quiz",
    builtin: false,
    title: g.title ?? "",
    emoji: g.emoji ?? "🎉",
    accent: (g.accent as Accent) ?? "sun",
    visibility: g.visibility === "public" ? "public" : "private",
    status: g.status === "published" ? "published" : "draft",
    minPlayers: typeof g.min_players === "number" ? g.min_players : null,
    maxPlayers: typeof g.max_players === "number" ? g.max_players : null,
    questionCount: g.kind === "deduction" ? null : Number(g.question_count ?? 0),
  }));
  return [...builtins, ...games];
}

export function canSee(entry: CatalogEntry, actor: Actor): boolean {
  return actor.privileged || (entry.visibility === "public" && entry.status === "published");
}

/** What this actor may open, in catalog order. */
export async function visibleCatalog(actor: Actor): Promise<CatalogEntry[]> {
  return (await loadCatalog()).filter((e) => canSee(e, actor));
}

/**
 * The single gate in front of every "create a room" endpoint: signed in, and
 * the game is visible to them (a private game reads as missing).
 */
export async function authorizeCreate(key: string): Promise<{ actor: Actor } | { error: string; status: number }> {
  const actor = await getActor();
  if (!actor) return { error: "AUTH_REQUIRED", status: 401 };
  if (actor.privileged) return { actor };
  const entry = (await loadCatalog()).find((e) => e.key === key);
  if (!entry || !canSee(entry, actor)) return { error: "GAME_MISSING", status: 404 };
  return { actor };
}

/** Records the creator of a room that was just opened (accounts only; GM rooms stay ownerless). */
export async function claimSession(sessionId: string, actor: Actor) {
  if (!actor.user) return;
  await rpc("fq_claim_session", { p_session_id: sessionId, p_owner_id: actor.user.id });
}

