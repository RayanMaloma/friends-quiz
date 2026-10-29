import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

/** An in-memory Postgres with the local Supabase Auth stub and every real migration, in order. */
export async function migratedDb(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(readFileSync(path.join(ROOT, "supabase/local/auth_stub.sql"), "utf8"));
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  }
  return pg;
}
