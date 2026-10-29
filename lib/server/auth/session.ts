import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { rpc } from "@/lib/server/db";
import { authProvider, type AuthTokens } from "./provider";

/**
 * The signed-in account, from two httpOnly cookies:
 * - fq_at: the access token (short-lived, verified with the auth provider);
 * - fq_rt: the refresh token (30 days, renewed on every refresh), so a
 *   returning user stays signed in across browser restarts until the
 *   session expires, is revoked, or they sign out.
 *
 * The role always comes from the database (fq_profiles), never from the
 * client or the email address.
 */

export type Role = "user" | "super_admin";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

const AT_COOKIE = "fq_at";
const RT_COOKIE = "fq_rt";
const REFRESH_MAX_AGE = 30 * 24 * 3600;
const CACHE_MS = 30_000;

const cache = new Map<string, { user: SessionUser | null; until: number }>();

const tokenKey = (token: string) => createHash("sha256").update(token).digest("base64url");

async function userFromAccessToken(accessToken: string): Promise<SessionUser | null> {
  const key = tokenKey(accessToken);
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.user;
  const provider = await authProvider();
  const account = await provider.getUser(accessToken);
  let user: SessionUser | null = null;
  if (account) {
    const profile = await rpc<{ ok: boolean; role?: Role }>("fq_auth_profile", { p_user_id: account.id });
    if (profile.ok) user = { id: account.id, email: account.email, role: profile.role === "super_admin" ? "super_admin" : "user" };
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, { user, until: Date.now() + CACHE_MS });
  return user;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

/** Route Handlers only (cookies can't be written while rendering). */
export async function setSessionCookies(tokens: AuthTokens) {
  const store = await cookies();
  const accessAge = Math.max(60, tokens.expiresAt - Math.floor(Date.now() / 1000));
  store.set(AT_COOKIE, tokens.accessToken, cookieOptions(accessAge));
  store.set(RT_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_MAX_AGE));
}

export async function clearSessionCookies() {
  const store = await cookies();
  const at = store.get(AT_COOKIE)?.value;
  if (at) cache.delete(tokenKey(at));
  store.delete(AT_COOKIE);
  store.delete(RT_COOKIE);
}

/**
 * The signed-in account, or null.
 * `refresh: true` (Route Handlers) renews an expired access token with the
 * refresh token and rewrites the cookies. Server Components pass false: an
 * expired access token then reads as signed out until the page calls
 * /api/auth { action: "me" }, which refreshes.
 */
export async function currentUser({ refresh }: { refresh: boolean }): Promise<SessionUser | null> {
  const store = await cookies();
  const at = store.get(AT_COOKIE)?.value;
  if (at) {
    const user = await userFromAccessToken(at);
    if (user) return user;
  }
  const rt = store.get(RT_COOKIE)?.value;
  if (!refresh || !rt) return null;
  const provider = await authProvider();
  const res = await provider.refresh(rt);
  if (!res.ok) {
    if (res.error === "INVALID_CREDENTIALS") await clearSessionCookies();
    return null;
  }
  await setSessionCookies(res.tokens);
  return userFromAccessToken(res.tokens.accessToken);
}

/** Signs out: revokes the session at the provider and clears the cookies. */
export async function endSession() {
  const store = await cookies();
  const at = store.get(AT_COOKIE)?.value;
  if (at) {
    try {
      await (await authProvider()).signOut(at);
    } catch (err) {
      console.error("[auth] signOut", err instanceof Error ? err.message : err);
    }
  }
  await clearSessionCookies();
}
