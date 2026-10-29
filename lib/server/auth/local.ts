import "server-only";
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { localDataDir, localQuery } from "@/lib/server/db";
import type { AuthProvider, AuthResult, AuthTokens, AuthUser } from "./provider";

/**
 * LOCAL DEVELOPMENT ONLY — the stand-in for Supabase Auth on the embedded
 * database (see supabase/local/auth_stub.sql). Same behavior as the project
 * is configured in Supabase: email + password, no email confirmation,
 * duplicate emails refused, 1h access tokens, 30-day refresh tokens.
 * Passwords are stored as scrypt hashes in auth.users.encrypted_password.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const ACCESS_SECONDS = 3600;
const REFRESH_SECONDS = 30 * 24 * 3600;

let secretPromise: Promise<Buffer> | null = null;

/** A random signing key kept next to the local database (never committed: .local-db is ignored). */
function secret(): Promise<Buffer> {
  secretPromise ??= (async () => {
    const file = path.join(localDataDir(), "auth-secret");
    try {
      return Buffer.from((await readFile(file, "utf8")).trim(), "base64url");
    } catch {
      const key = randomBytes(32);
      await mkdir(localDataDir(), { recursive: true });
      await writeFile(file, key.toString("base64url"), { mode: 0o600 });
      return key;
    }
  })();
  return secretPromise;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

async function checkPassword(password: string, stored: string | null): Promise<boolean> {
  const [scheme, salt, hash] = (stored ?? "").split("$");
  if (scheme !== "scrypt" || !salt || !hash) {
    await scrypt(password, randomBytes(16), 32); // same timing either way
    return false;
  }
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(expected, actual);
}

async function sign(kind: "a" | "r", userId: string, seconds: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  const body = `${kind}.${userId}.${exp}.${randomBytes(8).toString("base64url")}`;
  const mac = createHmac("sha256", await secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

async function verify(kind: "a" | "r", token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== kind) return null;
  const body = parts.slice(0, 4).join(".");
  const mac = Buffer.from(parts[4], "base64url");
  const expected = createHmac("sha256", await secret()).update(body).digest();
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  if (Number(parts[2]) < Date.now() / 1000) return null;
  return parts[1];
}

async function issue(user: AuthUser): Promise<AuthResult> {
  const tokens: AuthTokens = {
    accessToken: await sign("a", user.id, ACCESS_SECONDS),
    refreshToken: await sign("r", user.id, REFRESH_SECONDS),
    expiresAt: Math.floor(Date.now() / 1000) + ACCESS_SECONDS,
  };
  return { ok: true, user, tokens };
}

async function userById(id: string): Promise<AuthUser | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await localQuery<{ id: string; email: string }>("select id, email from auth.users where id = $1", [id]);
  return rows[0] ?? null;
}

export const localAuth: AuthProvider = {
  async signUp(email, password) {
    try {
      const rows = await localQuery<{ id: string; email: string }>(
        `insert into auth.users (email, encrypted_password, email_confirmed_at, last_sign_in_at)
         values ($1, $2, now(), now()) returning id, email`,
        [email, await hashPassword(password)],
      );
      return issue(rows[0]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/EMAIL_RESERVED/.test(msg)) return { ok: false, error: "EMAIL_RESERVED" };
      if (/duplicate key|unique/i.test(msg)) return { ok: false, error: "EMAIL_TAKEN" };
      throw err;
    }
  },

  async signIn(email, password) {
    const rows = await localQuery<{ id: string; email: string; encrypted_password: string | null }>(
      "select id, email, encrypted_password from auth.users where lower(email) = lower($1)",
      [email],
    );
    const ok = await checkPassword(password, rows[0]?.encrypted_password ?? null);
    if (!rows[0] || !ok) return { ok: false, error: "INVALID_CREDENTIALS" };
    await localQuery("update auth.users set last_sign_in_at = now() where id = $1", [rows[0].id]);
    return issue({ id: rows[0].id, email: rows[0].email });
  },

  async refresh(refreshToken) {
    const id = await verify("r", refreshToken);
    const user = id ? await userById(id) : null;
    return user ? issue(user) : { ok: false, error: "INVALID_CREDENTIALS" };
  },

  async getUser(accessToken) {
    const id = await verify("a", accessToken);
    return id ? userById(id) : null;
  },

  async signOut() {
    // Stateless tokens: signing out clears the cookies.
  },
};
