#!/usr/bin/env node
/**
 * Provisions THE super admin account (run by the operator, never by the app).
 *
 *   npm run provision:super-admin                 # Supabase (from .env.local)
 *   npm run provision:super-admin -- --local      # the embedded dev database (stop `npm run dev` first)
 *
 * Options:
 *   --email <address>     default: rayanomaireeni@gmail.com (the address reserved by the migration)
 *   --reset-password      also set a new password on an existing account (explicit only)
 *   --trust-existing      promote an existing account that was NOT created by this script
 *                         (only if you are sure you created it yourself)
 *   --yes                 skip the "is this your mailbox?" question (new account only)
 *
 * The password is read from the terminal without echo (or from SUPER_ADMIN_PASSWORD
 * for non-interactive runs). It is never printed, logged or written anywhere.
 * If the account exists, it is promoted as is: its password is left untouched
 * unless --reset-password is given.
 *
 * Recovery (forgotten password, no email service): run this again with
 * --reset-password, or set a new password in Supabase → Authentication → Users.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const EMAIL = option("--email", "rayanomaireeni@gmail.com").trim().toLowerCase();
const LOCAL = flag("--local");

function loadEnv() {
  try {
    for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no .env.local
  }
}

/** Reads a line without echoing it. */
function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error("No terminal: set SUPER_ADMIN_PASSWORD instead."));
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        stdout.write("\n");
        process.exit(130);
      } else if (ch === "\u007f" || ch === "\b") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function readLine(prompt) {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(prompt);
  rl.close();
  return answer.trim();
}

async function askPassword() {
  if (process.env.SUPER_ADMIN_PASSWORD) return process.env.SUPER_ADMIN_PASSWORD;
  const first = await readHidden("New password (min 8, hidden): ");
  const second = await readHidden("Repeat: ");
  if (first !== second) throw new Error("The passwords don't match.");
  return first;
}

function checkPassword(p) {
  if (p.length < 8 || p.length > 72) throw new Error("The password must be 8–72 characters.");
}

async function confirmOwnership() {
  if (flag("--yes")) return;
  const answer = await readLine(`Is ${EMAIL} your own mailbox? It will be marked as verified. [y/N] `);
  if (!/^y(es)?$/i.test(answer)) throw new Error("Cancelled.");
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

async function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing (.env.local).");
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let user = null;
  for (let page = 1; !user; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}${error.cause?.code ? ` (${error.cause.code})` : ""} — check the connection to ${new URL(url).host}`);
    user = data.users.find((u) => (u.email ?? "").toLowerCase() === EMAIL) ?? null;
    if (data.users.length < 1000) break;
  }

  if (user) {
    const provisioned = user.app_metadata?.fq_provisioned === "true";
    if (!provisioned && !flag("--trust-existing")) {
      throw new Error(
        `${EMAIL} already exists but was not created by this script. If you created it yourself, re-run with --trust-existing.`,
      );
    }
    const patch = { app_metadata: { ...user.app_metadata, fq_provisioned: "true" } };
    if (flag("--reset-password")) {
      const password = await askPassword();
      checkPassword(password);
      patch.password = password;
    }
    const { error } = await db.auth.admin.updateUserById(user.id, patch);
    if (error) throw new Error(`updateUser: ${error.message}`);
    console.log(`Existing account found${flag("--reset-password") ? " (password changed)" : " (password unchanged)"}.`);
  } else {
    await confirmOwnership();
    const password = await askPassword();
    checkPassword(password);
    // The email is reserved: open a one-time ticket so the database accepts this account.
    const ticket = await db.rpc("fq_open_provision_ticket", { p_email: EMAIL });
    if (ticket.error) throw new Error(`fq_open_provision_ticket: ${ticket.error.message} (is migration 20261030010000_provision_ticket.sql applied?)`);
    if (!ticket.data?.ok) throw new Error(`fq_open_provision_ticket: ${ticket.data?.error}`);
    const { error } = await db.auth.admin.createUser({
      email: EMAIL,
      password,
      email_confirm: true,
      app_metadata: { fq_provisioned: "true" },
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    console.log("Account created.");
  }

  const { data, error } = await db.rpc("fq_set_super_admin", { p_email: EMAIL });
  if (error) throw new Error(`fq_set_super_admin: ${error.message} (is migration 20261030000000_accounts.sql applied?)`);
  if (!data?.ok) throw new Error(`fq_set_super_admin: ${data?.error}`);
  console.log(`${EMAIL} is the super admin.`);
}

// ---------------------------------------------------------------------------
// Local (embedded dev database)
// ---------------------------------------------------------------------------

async function local() {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(path.join(process.cwd(), ".local-db"));
  await pg.waitReady;
  // Same setup as lib/server/db.ts: the auth stand-in, then every migration once.
  const { readdir } = await import("node:fs/promises");
  await pg.exec(readFileSync(path.join(process.cwd(), "supabase", "local", "auth_stub.sql"), "utf8"));
  await pg.exec("create table if not exists _local_migrations (name text primary key)");
  const applied = new Set((await pg.query("select name from _local_migrations")).rows.map((r) => r.name));
  const dir = path.join(process.cwd(), "supabase", "migrations");
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    await pg.exec(readFileSync(path.join(dir, file), "utf8"));
    await pg.query("insert into _local_migrations (name) values ($1)", [file]);
  }

  const existing = await pg.query("select id from auth.users where lower(email) = $1", [EMAIL]);
  const hash = async (password) => {
    const salt = randomBytes(16);
    const key = await promisify(scryptCb)(password, salt, 32);
    return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
  };
  if (existing.rows.length === 0) {
    const password = await askPassword();
    checkPassword(password);
    await pg.query(
      `insert into auth.users (email, encrypted_password, email_confirmed_at, raw_app_meta_data)
       values ($1, $2, now(), '{"fq_provisioned":"true"}')`,
      [EMAIL, await hash(password)],
    );
    console.log("Local account created.");
  } else if (flag("--reset-password")) {
    const password = await askPassword();
    checkPassword(password);
    await pg.query("update auth.users set encrypted_password = $2 where lower(email) = $1", [EMAIL, await hash(password)]);
    console.log("Local password changed.");
  }
  const res = await pg.query("select public.fq_set_super_admin($1) as r", [EMAIL]);
  if (!res.rows[0].r.ok) throw new Error(res.rows[0].r.error);
  await pg.close();
  console.log(`${EMAIL} is the local super admin.`);
}

loadEnv();
(LOCAL ? local() : supabase()).catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
