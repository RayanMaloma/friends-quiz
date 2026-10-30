import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migratedDb } from "./helpers/db";

// Accounts, roles, catalog visibility, session ownership, the activity log and
// the RLS policies — on the real migrations, with Supabase's API roles and
// auth.uid() recreated locally (supabase/local/auth_stub.sql).

let pg: PGlite;

type R = { ok: boolean; error?: string; [k: string]: unknown };

async function call<T = R>(fn: string, params: Record<string, unknown>): Promise<T> {
  const keys = Object.keys(params);
  const args = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
  const values = keys.map((k) => {
    const v = params[k];
    return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  });
  const res = await pg.query<{ result: T }>(`select public.${fn}(${args}) as result`, values);
  return res.rows[0].result;
}

async function signUp(email: string, appMeta: Record<string, unknown> = {}): Promise<string> {
  const r = await pg.query<{ id: string }>(
    "insert into auth.users (email, raw_app_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify(appMeta)],
  );
  return r.rows[0].id;
}

/** Runs `sql` as a client holding this user's JWT (PostgREST's `authenticated` role), or as `anon`. */
async function asUser<T>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await pg.exec("begin");
  try {
    await pg.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
    await pg.exec(`set local role ${userId ? "authenticated" : "anon"}`);
    const res = await pg.query<T>(sql, params);
    return res.rows;
  } finally {
    await pg.exec("rollback");
  }
}

async function denied(userId: string | null, sql: string): Promise<string> {
  try {
    await asUser(userId, sql);
    return "allowed";
  } catch (err) {
    return (err as Error).message;
  }
}

async function activity(sessionId: string) {
  const r = await pg.query<{ kind: string; user_id: string | null; data: Record<string, unknown> }>(
    "select kind, user_id, data from public.fq_activity where session_id = $1 order by id",
    [sessionId],
  );
  return r.rows;
}

async function mafiaRoom(owner: string | null) {
  const res = await call<R & { session_id: string; code: string }>("fq_mafia_create_session", {
    p_host_token_hash: `h-${Math.random()}`,
    p_config: { kind: "mafia", title: "المافيا", emoji: "🌒", accent: "grape", settings: { lateJoin: false }, people: [] },
  });
  expect(res.ok).toBe(true);
  if (owner) expect((await call("fq_claim_session", { p_session_id: res.session_id, p_owner_id: owner })).ok).toBe(true);
  return res.session_id;
}

let alice: string;
let bob: string;
let admin: string;

beforeAll(async () => {
  pg = await migratedDb();
  alice = await signUp("alice@example.com");
  bob = await signUp("bob@example.com");
  admin = await signUp("rayanomaireeni@gmail.com", { fq_provisioned: "true" });
});

describe("accounts and roles", () => {
  it("is schema version 7", async () => {
    expect(await call<number>("fq_schema_version", {})).toBe(7);
  });

  it("every new account gets the 'user' role and one registration event", async () => {
    const r = await pg.query<{ role: string }>("select role from public.fq_profiles where id = $1", [alice]);
    expect(r.rows[0].role).toBe("user");
    expect(await call("fq_auth_profile", { p_user_id: alice })).toEqual({ ok: true, role: "user" });
    const ev = await pg.query("select 1 from public.fq_activity where kind = 'user_registered' and user_id = $1", [alice]);
    expect(ev.rows).toHaveLength(1);
  });

  it("nobody can sign up with the reserved super-admin email (only an admin-provisioned user may use it)", async () => {
    await expect(signUp("RayanOmaireeni@gmail.com")).rejects.toThrow(/EMAIL_RESERVED/);
    // Changing an existing account's email to it is refused too.
    await expect(pg.query("update auth.users set email = 'rayanomaireeni@gmail.com' where id = $1", [bob])).rejects.toThrow(/EMAIL_RESERVED/);
  });

  it("provisioning opens a one-time ticket: Supabase inserts the user before its app_metadata", async () => {
    await pg.query("insert into public.fq_reserved_emails (email) values ('second-admin@example.com')");
    // No ticket: refused, even for the service role.
    await expect(signUp("second-admin@example.com")).rejects.toThrow(/EMAIL_RESERVED/);
    expect((await call("fq_open_provision_ticket", { p_email: "alice@example.com" })).error).toBe("NOT_RESERVED");
    // An expired ticket doesn't count.
    expect((await call("fq_open_provision_ticket", { p_email: "Second-Admin@example.com" })).ok).toBe(true);
    await pg.query("update public.fq_provision_tickets set expires_at = now() - interval '1 second'");
    await expect(signUp("second-admin@example.com")).rejects.toThrow(/EMAIL_RESERVED/);
    // An open ticket admits exactly one insert, without the flag in app_metadata.
    await call("fq_open_provision_ticket", { p_email: "second-admin@example.com" });
    const id = await signUp("second-admin@example.com");
    expect((await call("fq_auth_profile", { p_user_id: id })).role).toBe("user");
    await pg.query("delete from auth.users where id = $1", [id]);
    await expect(signUp("second-admin@example.com")).rejects.toThrow(/EMAIL_RESERVED/);
    expect(await denied(alice, "select public.fq_open_provision_ticket('second-admin@example.com')")).toMatch(/permission denied/);
  });

  it("the server RPCs that read auth.users work as the service role (no SELECT on auth.users on Supabase)", async () => {
    await pg.exec("begin");
    try {
      await pg.exec("set local role service_role");
      await pg.exec("savepoint direct");
      await expect(pg.query("select 1 from auth.users")).rejects.toThrow(/permission denied/);
      await pg.exec("rollback to savepoint direct");
      const one = async (sql: string) => (await pg.query<{ r: R }>(`select ${sql} as r`)).rows[0].r;
      expect((await one(`public.fq_auth_profile('${alice}')`)).ok).toBe(true);
      expect((await one(`public.fq_set_super_admin('rayanomaireeni@gmail.com')`)).ok).toBe(true);
      expect((await one("public.fq_admin_activity_overview()")).ok).toBe(true);
      expect((await one("public.fq_admin_list_accounts(10)")).ok).toBe(true);
      expect((await one(`public.fq_admin_list_activity_sessions('{}'::jsonb, 10)`)).ok).toBe(true);
      expect((await one(`public.fq_admin_session_detail('${crypto.randomUUID()}')`)).ok).toBe(false);
    } finally {
      await pg.exec("rollback");
    }
  });

  it("the super admin is granted by provisioning only, and there is only one", async () => {
    expect((await call("fq_auth_profile", { p_user_id: admin })).role).toBe("user");
    expect((await call("fq_set_super_admin", { p_email: "RAYANOMAIREENI@gmail.com" })).ok).toBe(true);
    expect((await call("fq_auth_profile", { p_user_id: admin })).role).toBe("super_admin");
    expect((await call("fq_set_super_admin", { p_email: "nobody@example.com" })).error).toBe("NOT_FOUND");
    await expect(pg.query("update public.fq_profiles set role = 'super_admin' where id = $1", [alice])).rejects.toThrow(/unique/i);
    const supers = await pg.query("select id from public.fq_profiles where role = 'super_admin'");
    expect(supers.rows).toEqual([{ id: admin }]);
  });
});

describe("row level security (a client holding a user JWT)", () => {
  it("users read only their own profile and can't change any role", async () => {
    expect(await asUser(alice, "select id, role from public.fq_profiles")).toEqual([{ id: alice, role: "user" }]);
    expect(await denied(alice, `update public.fq_profiles set role = 'super_admin' where id = '${alice}'`)).toMatch(/permission denied/);
    expect(await denied(alice, `insert into public.fq_profiles (id, role) values (gen_random_uuid(), 'super_admin')`)).toMatch(/permission denied/);
    expect((await asUser(admin, "select id from public.fq_profiles")).length).toBe(3);
  });

  it("anon and users can't call the server's functions or read emails", async () => {
    expect(await denied(alice, "select public.fq_set_super_admin('alice@example.com')")).toMatch(/permission denied/);
    expect(await denied(alice, "select public.fq_admin_list_accounts(10)")).toMatch(/permission denied/);
    expect(await denied(null, "select public.fq_catalog_list()")).toMatch(/permission denied/);
    expect(await denied(alice, "select email from auth.users")).toMatch(/permission denied/);
    expect(await denied(null, "select * from public.fq_profiles")).toMatch(/permission denied/);
  });

  it("sessions: own rows only, never the host token, config or match", async () => {
    const mine = await mafiaRoom(alice);
    await mafiaRoom(bob);
    const rows = await asUser<{ id: string }>(alice, "select id, code, status from public.game_sessions");
    expect(rows.map((r) => r.id)).toEqual([mine]);
    expect(await denied(alice, "select host_token_hash from public.game_sessions")).toMatch(/permission denied/);
    expect(await denied(alice, "select match from public.game_sessions")).toMatch(/permission denied/);
    expect(await denied(alice, "select config from public.game_sessions")).toMatch(/permission denied/);
    expect(await denied(alice, `update public.game_sessions set owner_id = '${alice}'`)).toMatch(/permission denied/);
    expect(await denied(alice, "select * from public.game_players")).toMatch(/permission denied/);
    expect((await asUser(admin, "select id from public.game_sessions")).length).toBeGreaterThanOrEqual(2);
  });

  it("games and catalog: users see public published games only; activity is the super admin's", async () => {
    const save = async (visibility: string, status: string) => {
      const res = await call<R & { game: { id: string } }>("fq_admin_save_game", {
        p_id: null, p_doc: { title: `${visibility}-${status}` }, p_expected_version: null, p_status: status,
      });
      await call("fq_admin_set_visibility", { p_key: res.game.id, p_visibility: visibility });
      return res.game.id;
    };
    const pub = await save("public", "published");
    await save("private", "published");
    await save("public", "draft");
    expect((await asUser<{ id: string }>(alice, "select id from public.games")).map((g) => g.id)).toEqual([pub]);
    expect((await asUser(admin, "select id from public.games")).length).toBeGreaterThanOrEqual(3);
    expect((await asUser<{ key: string }>(alice, "select key from public.fq_catalog order by key")).map((c) => c.key)).toEqual(["invent", "mafia"]);
    expect(await asUser(alice, "select id from public.fq_activity")).toEqual([]);
    expect((await asUser(admin, "select id from public.fq_activity")).length).toBeGreaterThan(0);
  });
});

describe("catalog", () => {
  it("defaults: Mafia and «اخترع إجابتك» public, the Ahaji questions private; the admin can change it", async () => {
    let cat = await call<R & { builtin: Record<string, string> }>("fq_catalog_list", {});
    expect(cat.builtin).toEqual({ mafia: "public", invent: "public", invent_ahaji: "private" });
    expect((await call("fq_admin_set_visibility", { p_key: "mafia", p_visibility: "private" })).ok).toBe(true);
    cat = await call("fq_catalog_list", {});
    expect(cat.builtin.mafia).toBe("private");
    await call("fq_admin_set_visibility", { p_key: "mafia", p_visibility: "public" });
    expect((await call("fq_admin_set_visibility", { p_key: "mafia", p_visibility: "everyone" })).error).toBe("BAD_REQUEST");
    expect((await call("fq_admin_set_visibility", { p_key: "chess", p_visibility: "public" })).error).toBe("NOT_FOUND");
  });
});

describe("session ownership and lifecycle activity", () => {
  it("records creation, owner, start, completion once each — whatever the retries", async () => {
    const id = await mafiaRoom(alice);
    expect((await call("fq_claim_session", { p_session_id: id, p_owner_id: bob })).error).toBe("NOT_FOUND"); // owner set once
    const save = (match: unknown, status: string, version: number) =>
      call("fq_mafia_save_match", { p_session_id: id, p_expected_version: version, p_match: match, p_status: status });
    expect((await save({ round: 1, winner: null }, "PLAYING", 0)).ok).toBe(true);
    expect((await save({ round: 2, winner: null }, "PLAYING", 1)).ok).toBe(true);
    expect((await save({ round: 3, winner: { team: "citizens", reason: "x" } }, "PLAYING", 2)).ok).toBe(true);
    expect((await save({ round: 3, winner: { team: "citizens", reason: "x" } }, "FINISHED", 3)).ok).toBe(true);

    const ev = await activity(id);
    expect(ev.map((e) => e.kind)).toEqual(["session_created", "session_started", "session_completed"]);
    expect(ev.every((e) => e.user_id === alice)).toBe(true);
    const row = await pg.query<Record<string, unknown>>(
      "select owner_id, game_key, started_at, completed_at, end_reason from public.game_sessions where id = $1", [id],
    );
    expect(row.rows[0]).toMatchObject({ owner_id: alice, game_key: "mafia", end_reason: "completed" });
    expect(row.rows[0].started_at).not.toBeNull();
    expect(row.rows[0].completed_at).not.toBeNull();
  });

  it("a room closed before its end is a cancellation (dashboard end too)", async () => {
    const id = await mafiaRoom(bob);
    await call("fq_admin_end_session", { p_id: id });
    await call("fq_admin_end_session", { p_id: id });
    const ev = await activity(id);
    expect(ev.map((e) => e.kind)).toEqual(["session_created", "session_cancelled"]);
    expect(ev[1].data).toMatchObject({ reason: "cancelled" });
  });

  it("«اخترع إجابتك»: final results complete a room; ending early doesn't", async () => {
    const make = async (questionSet?: string) =>
      (await call<R & { session_id: string }>("fq_invent_create_session", {
        p_host_token_hash: `h-${Math.random()}`,
        p_config: { kind: "invent", title: "x", ...(questionSet ? { questionSet, questions: [{ id: "c001", text: "س؟" }] } : {}) },
        p_match: { v: 1, settings: {}, game: null },
      })).session_id;
    const done = await make("custom");
    await call("fq_invent_save_match", { p_session_id: done, p_expected_version: 0, p_match: { v: 1, game: { phase: "answering" } }, p_status: "PLAYING" });
    await call("fq_invent_save_match", { p_session_id: done, p_expected_version: 1, p_match: { v: 1, game: { phase: "final", endedEarly: false } }, p_status: "PLAYING" });
    expect((await activity(done)).map((e) => e.kind)).toEqual(["session_created", "session_started", "session_completed"]);

    const early = await make();
    await call("fq_invent_save_match", { p_session_id: early, p_expected_version: 0, p_match: { v: 1, game: { phase: "answering" } }, p_status: "PLAYING" });
    await call("fq_invent_save_match", { p_session_id: early, p_expected_version: 1, p_match: { v: 1, game: { phase: "final", endedEarly: true } }, p_status: "FINISHED" });
    expect((await activity(early)).map((e) => e.kind)).toEqual(["session_created", "session_started", "session_cancelled"]);
    const keys = await pg.query<{ id: string; game_key: string }>("select id, game_key from public.game_sessions where id in ($1, $2)", [done, early]);
    expect(Object.fromEntries(keys.rows.map((r) => [r.id, r.game_key]))).toEqual({ [done]: "invent", [early]: "invent_ahaji" });
  });

  it("the owner (and only the owner) can take the host screen back with a new token", async () => {
    const id = await mafiaRoom(alice);
    expect((await call("fq_owner_resume", { p_session_id: id, p_owner_id: bob, p_host_token_hash: "stolen" })).error).toBe("GAME_NOT_FOUND");
    expect((await call("fq_owner_resume", { p_session_id: id, p_owner_id: alice, p_host_token_hash: "new-hash" })).ok).toBe(true);
    const r = await pg.query<{ host_token_hash: string }>("select host_token_hash from public.game_sessions where id = $1", [id]);
    expect(r.rows[0].host_token_hash).toBe("new-hash");
    const mine = await call<R & { sessions: { id: string }[] }>("fq_my_sessions", { p_owner_id: alice });
    expect(mine.sessions.map((s) => s.id)).toContain(id);
    const theirs = await call<R & { sessions: { id: string }[] }>("fq_my_sessions", { p_owner_id: bob });
    expect(theirs.sessions.map((s) => s.id)).not.toContain(id);
  });
});

describe("activity dashboard queries", () => {
  it("overview, accounts and filtered sessions come from the stored records", async () => {
    const ov = await call<R & Record<string, number>>("fq_admin_activity_overview", {});
    const total = (await pg.query<{ n: number }>("select count(*)::int as n from public.game_sessions")).rows[0].n;
    expect(ov).toMatchObject({ ok: true, users: 3, sessions: total });
    expect(ov.completed).toBeGreaterThanOrEqual(2);

    const acc = await call<R & { accounts: { email: string; session_count: number; role: string }[] }>("fq_admin_list_accounts", { p_limit: 10 });
    const a = acc.accounts.find((x) => x.email === "alice@example.com")!;
    expect(a.session_count).toBe(3);
    expect(acc.accounts.find((x) => x.role === "super_admin")!.email).toBe("rayanomaireeni@gmail.com");
    expect(Object.keys(acc.accounts[0]).sort()).toEqual(["created_at", "email", "id", "last_sign_in_at", "role", "session_count"]);

    const list = async (filters: Record<string, string>) =>
      (await call<R & { sessions: { owner_email: string | null; state: string; game_key: string }[] }>("fq_admin_list_activity_sessions", { p_filters: filters, p_limit: 100 })).sessions;
    expect((await list({ owner: alice })).every((s) => s.owner_email === "alice@example.com")).toBe(true);
    expect((await list({ owner: alice })).length).toBe(3);
    expect((await list({ state: "completed" })).every((s) => s.state === "completed")).toBe(true);
    expect((await list({ game_key: "invent" })).every((s) => s.game_key === "invent")).toBe(true);
    expect(await list({ from: "2999-01-01" })).toEqual([]);
    expect((await list({ to: "2999-01-01" })).length).toBe(total);
  });

  it("session details include the room's own questions and its event log", async () => {
    const r = await pg.query<{ id: string }>("select id from public.game_sessions where game_key = 'invent' limit 1");
    const d = await call<R & { session: { config: { questions: unknown[] }; state: string }; events: unknown[] }>("fq_admin_session_detail", { p_id: r.rows[0].id });
    expect(d.session.config.questions).toEqual([{ id: "c001", text: "س؟" }]);
    expect(d.session.state).toBe("completed");
    expect(d.events.length).toBe(3);
  });

  it("retention: old activity can be purged (never less than 30 days)", async () => {
    await pg.query("update public.fq_activity set created_at = now() - interval '400 days' where kind = 'user_registered'");
    const res = await call<R & { deleted: number }>("fq_purge_activity", { p_days: 1 });
    expect(res.deleted).toBe(4); // 3 accounts + the provisioning test's deleted one
  });
});
