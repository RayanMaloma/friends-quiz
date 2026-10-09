import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Admin access = one shared password (ADMIN_PASSWORD). Logging in sets an
 * httpOnly cookie "<expiry>.<hmac>" signed with a key derived from the
 * password, so changing the password signs everyone out.
 *
 * Local development without ADMIN_PASSWORD falls back to "admin" (with a
 * warning in the dashboard). In production the dashboard stays locked until
 * the variable is set.
 */

export const ADMIN_COOKIE = "fq_admin";
const SESSION_DAYS = 30;
const DEV_PASSWORD = "admin";

function configuredPassword(): string | null {
  const p = process.env.ADMIN_PASSWORD;
  if (p && p.length > 0) return p;
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) return DEV_PASSWORD;
  return null;
}

export function isAdminConfigured(): boolean {
  return configuredPassword() !== null;
}

/** True when running on the insecure development default. */
export function isDevPassword(): boolean {
  return !process.env.ADMIN_PASSWORD && isAdminConfigured();
}

function signingKey(password: string): Buffer {
  return createHash("sha256").update(`fq-admin-v1:${password}`).digest();
}

function sign(expiry: number, password: string): string {
  return createHmac("sha256", signingKey(password)).update(String(expiry)).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPassword(input: unknown): boolean {
  const password = configuredPassword();
  if (!password || typeof input !== "string") return false;
  return safeEqual(input, password);
}

export function createSessionCookie(): { value: string; maxAge: number } {
  const password = configuredPassword()!;
  const maxAge = SESSION_DAYS * 24 * 3600;
  const expiry = Math.floor(Date.now() / 1000) + maxAge;
  return { value: `${expiry}.${sign(expiry, password)}`, maxAge };
}

export function verifySessionValue(value: string | undefined): boolean {
  const password = configuredPassword();
  if (!password || !value) return false;
  const [exp, mac] = value.split(".");
  const expiry = Number(exp);
  if (!Number.isInteger(expiry) || expiry < Date.now() / 1000 || !mac) return false;
  return safeEqual(mac, sign(expiry, password));
}

/** For Server Components and Route Handlers. */
export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifySessionValue(store.get(ADMIN_COOKIE)?.value);
}

export async function setAdminCookie() {
  const { value, maxAge } = createSessionCookie();
  const store = await cookies();
  store.set(ADMIN_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function clearAdminCookie() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
}

// ---------------------------------------------------------------------------
// Login throttling (per server instance; good enough to stop guessing loops)
// ---------------------------------------------------------------------------

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginAllowed(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) return true;
  return entry.count < MAX_ATTEMPTS;
}

export function recordFailedLogin(ip: string) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
  if (attempts.size > 5000) attempts.clear();
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip"))?.trim() || "local";
}

/**
 * Admin endpoints only accept JSON (or multipart for uploads). Browsers can't
 * send those cross-site without a CORS preflight, which we never grant — so a
 * SameSite=Lax cookie plus this check stops CSRF.
 */
export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}
