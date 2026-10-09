import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * All game logic lives in Postgres functions (supabase/migrations). The server
 * calls them through this single `rpc` helper.
 *
 * - With Supabase env vars: uses supabase-js + service role key (production).
 * - Without them (local dev only): runs the same SQL in an embedded PGlite
 *   database stored in ./.local-db, so the game can be tried before Supabase
 *   is configured. Realtime is then replaced by short polling on the client.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
/** NEXT_PUBLIC_FQ_LOCAL_DB=1 forces the local database even if Supabase is configured (dev only). */
const FORCE_LOCAL = process.env.NEXT_PUBLIC_FQ_LOCAL_DB === "1" && !process.env.VERCEL;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SERVICE_KEY) && !FORCE_LOCAL;

export class ConfigError extends Error {}

/** The database exists but doesn't have the latest migration yet. */
export class SchemaError extends Error {}

type Globals = typeof globalThis & {
  __fqAdmin?: SupabaseClient;
  __fqLocalDb?: Promise<LocalDb>;
};
const g = globalThis as Globals;

export function localDataDir(): string {
  return path.join(process.cwd(), ".local-db");
}

export function getAdminClient(): SupabaseClient {
  if (!isSupabaseConfigured) throw new ConfigError("Supabase is not configured");
  g.__fqAdmin ??= createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return g.__fqAdmin;
}

export async function rpc<T = Record<string, unknown>>(
  fn: string,
  params: Record<string, unknown>,
): Promise<T> {
  if (isSupabaseConfigured) {
    const { data, error } = await getAdminClient().rpc(fn, params);
    if (error) {
      // PostgREST: PGRST202 = function not found (migration not applied yet).
      if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
        throw new SchemaError(`rpc ${fn} missing: ${error.message}`);
      }
      throw new Error(`rpc ${fn} failed: ${error.message}`);
    }
    return data as T;
  }
  if (process.env.VERCEL) {
    throw new ConfigError("Supabase env vars are missing on Vercel");
  }
  const db = await getLocalDb();
  return db.call<T>(fn, params);
}

// ---------------------------------------------------------------------------
// Local fallback (development only)
// ---------------------------------------------------------------------------

interface LocalDb {
  call<T>(fn: string, params: Record<string, unknown>): Promise<T>;
}

function getLocalDb(): Promise<LocalDb> {
  g.__fqLocalDb ??= createLocalDb().catch((err) => {
    g.__fqLocalDb = undefined;
    throw err;
  });
  return g.__fqLocalDb;
}

async function createLocalDb(): Promise<LocalDb> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(localDataDir());
  await pg.waitReady;
  // Apply every migration file once, in order (all files are also re-runnable).
  await pg.exec("create table if not exists _local_migrations (name text primary key)");
  const applied = new Set(
    (await pg.query<{ name: string }>("select name from _local_migrations")).rows.map((r) => r.name),
  );
  const dir = path.join(process.cwd(), "supabase", "migrations");
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    await pg.exec(await readFile(path.join(dir, file), "utf8"));
    await pg.query("insert into _local_migrations (name) values ($1)", [file]);
  }
  return {
    async call<T>(fn: string, params: Record<string, unknown>) {
      if (!/^fq_[a-z_]+$/.test(fn)) throw new Error("bad function name");
      const keys = Object.keys(params);
      const args = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
      const values = keys.map((k) => {
        const v = params[k];
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      });
      const res = await pg.query<{ result: T }>(
        `select public.${fn}(${args}) as result`,
        values,
      );
      return res.rows[0].result;
    },
  };
}
