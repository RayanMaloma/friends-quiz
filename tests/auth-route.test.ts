import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migratedDb } from "./helpers/db";
import { newDxDoc } from "@/lib/dx/doc";

// Accounts and access end to end, through the real route handlers, on the real
// migrations: register / login / logout / persistent session (refresh), who
// may open which game, guests joining by code without an account, and the
// admin API refusing regular users. Auth runs on the local provider (the
// stand-in for Supabase Auth: same contract, scrypt hashes in auth.users).

let pg: PGlite;
const dataDir = mkdtempSync(path.join(tmpdir(), "fq-auth-"));

async function rpc(fn: string, params: Record<string, unknown>) {
  const keys = Object.keys(params);
  const args = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
  const values = keys.map((k) => {
    const v = params[k];
    return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  });
  const res = await pg.query<{ result: unknown }>(`select public.${fn}(${args}) as result`, values);
  return res.rows[0].result;
}

vi.mock("@/lib/server/db", () => ({
  isSupabaseConfigured: false,
  ConfigError: class extends Error {},
  SchemaError: class extends Error {},
  localDataDir: () => dataDir,
  getAdminClient: () => {
    throw new Error("no supabase in tests");
  },
  rpc: (fn: string, params: Record<string, unknown>) => rpc(fn, params),
  localQuery: async (sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows,
}));
vi.mock("@/lib/server/broadcast", () => ({ notifyGame: async () => {} }));

/** One browser's cookie jar (httpOnly cookies set by the routes). */
let jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const { POST: AUTH } = await import("@/app/api/auth/route");
const { POST: CATALOG } = await import("@/app/api/catalog/route");
const { POST: MAFIA } = await import("@/app/api/mafia/route");
const { POST: INVENT } = await import("@/app/api/invent/route");
const { POST: DX } = await import("@/app/api/dx/route");
const { POST: ADMIN } = await import("@/app/api/admin/route");
const { POST: GUEST } = await import("@/app/api/guest/route");

type Body = { ok: boolean; error?: string; [k: string]: unknown };
async function call(handler: (r: Request) => Promise<Response>, body: Record<string, unknown>, ip = "1.1.1.1") {
  const res = await handler(
    new Request("http://test/api", {
      method: "POST",
      headers: { "Content-Type": "application/json", host: "test", origin: "http://test", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Body };
}

const PASSWORD = "correct horse battery";
const browsers = new Map<string, Map<string, string>>();
/** Switches to another person's browser (their own cookies). */
function as(who: string) {
  if (!browsers.has(who)) browsers.set(who, new Map());
  jar = browsers.get(who)!;
}

let privateDx: string;
let publicDx: string;
let draftDx: string;

beforeAll(async () => {
  pg = await migratedDb();
  const save = async (title: string, status: string, visibility: string) => {
    const doc = { ...newDxDoc("classic"), title };
    const res = (await rpc("fq_admin_save_game", { p_id: null, p_doc: doc, p_expected_version: null, p_status: status })) as { game: { id: string } };
    await rpc("fq_admin_set_visibility", { p_key: res.game.id, p_visibility: visibility });
    return res.game.id;
  };
  privateDx = await save("المقيم السري", "published", "private");
  publicDx = await save("المهرب السري", "published", "public");
  draftDx = await save("مسودة", "draft", "public");
});

beforeEach(() => {
  browsers.delete("anon");
  as("anon");
});

describe("registration and login", () => {
  it("registers with email + password only, as a regular user, signed in right away", async () => {
    as("sara");
    const res = await call(AUTH, { action: "register", email: "  Sara@Example.com ", password: PASSWORD, role: "super_admin" });
    expect(res.body).toEqual({ ok: true, user: { email: "sara@example.com", role: "user" } });
    expect(jar.get("fq_at")).toBeTruthy();
    expect(jar.get("fq_rt")).toBeTruthy();
    const me = await call(AUTH, { action: "me" });
    expect(me.body.user).toEqual({ email: "sara@example.com", role: "user" });
    // The password is stored only as a hash, in the auth table.
    const row = await pg.query<{ encrypted_password: string }>("select encrypted_password from auth.users where email = 'sara@example.com'");
    expect(row.rows[0].encrypted_password).toMatch(/^scrypt\$/);
    expect(row.rows[0].encrypted_password).not.toContain(PASSWORD);
    const reg = await pg.query("select 1 from public.fq_activity a join auth.users u on u.id = a.user_id where u.email = 'sara@example.com' and a.kind = 'user_registered'");
    expect(reg.rows).toHaveLength(1);
  });

  it("refuses duplicate emails, bad emails, short passwords and the reserved email", async () => {
    expect((await call(AUTH, { action: "register", email: "sara@example.com", password: PASSWORD }, "2.2.2.2")).body.error).toBe("EMAIL_TAKEN");
    expect((await call(AUTH, { action: "register", email: "not-an-email", password: PASSWORD }, "2.2.2.2")).body.error).toBe("BAD_EMAIL");
    expect((await call(AUTH, { action: "register", email: "x@example.com", password: "short" }, "2.2.2.2")).body.error).toBe("WEAK_PASSWORD");
    expect((await call(AUTH, { action: "register", email: "rayanomaireeni@gmail.com", password: PASSWORD }, "2.2.2.2")).body.error).toBe("EMAIL_RESERVED");
    expect(jar.size).toBe(0);
  });

  it("logs in with the right password only, and records the login", async () => {
    expect((await call(AUTH, { action: "login", email: "sara@example.com", password: "wrong password" }, "3.3.3.3")).body.error).toBe("INVALID_CREDENTIALS");
    expect((await call(AUTH, { action: "login", email: "nobody@example.com", password: PASSWORD }, "3.3.3.3")).body.error).toBe("INVALID_CREDENTIALS");
    expect(jar.size).toBe(0);
    const ok = await call(AUTH, { action: "login", email: "SARA@example.com", password: PASSWORD }, "3.3.3.3");
    expect(ok.body).toEqual({ ok: true, user: { email: "sara@example.com", role: "user" } });
    const logins = await pg.query("select 1 from public.fq_activity a join auth.users u on u.id = a.user_id where u.email = 'sara@example.com' and a.kind = 'user_login'");
    expect(logins.rows).toHaveLength(1);
    const last = await pg.query<{ last_sign_in_at: string | null }>("select last_sign_in_at from auth.users where email = 'sara@example.com'");
    expect(last.rows[0].last_sign_in_at).not.toBeNull();
  });

  it("stays signed in: an expired access token is renewed with the refresh token", async () => {
    as("sara");
    jar.delete("fq_at"); // the 1h access cookie expired (browser restarted later)
    const me = await call(AUTH, { action: "me" });
    expect(me.body.user).toEqual({ email: "sara@example.com", role: "user" });
    expect(jar.get("fq_at")).toBeTruthy();
    // A forged refresh token is worthless.
    as("mallory");
    jar.set("fq_rt", "r.00000000-0000-0000-0000-000000000000.9999999999.x.forged");
    expect((await call(AUTH, { action: "me" })).body.user).toBeNull();
  });

  it("logs out", async () => {
    as("sara-laptop");
    await call(AUTH, { action: "login", email: "sara@example.com", password: PASSWORD }, "4.4.4.4");
    expect((await call(AUTH, { action: "me" })).body.user).toBeTruthy();
    await call(AUTH, { action: "logout" });
    expect(jar.size).toBe(0);
    expect((await call(AUTH, { action: "me" })).body.user).toBeNull();
  });

  it("throttles password guessing", async () => {
    for (let i = 0; i < 10; i++) await call(AUTH, { action: "login", email: "sara@example.com", password: `guess ${i}` }, "6.6.6.6");
    expect((await call(AUTH, { action: "login", email: "sara@example.com", password: PASSWORD }, "6.6.6.6")).status).toBe(429);
  });

  it("refuses cross-site requests", async () => {
    const res = await AUTH(new Request("http://test/api", { method: "POST", headers: { "Content-Type": "application/json", host: "test", origin: "http://evil" }, body: JSON.stringify({ action: "me" }) }));
    expect(res.status).toBe(403);
  });
});

describe("what a regular user may open", () => {
  it("sees exactly the three public games, never a private or draft one", async () => {
    as("sara");
    const list = await call(CATALOG, { action: "list" });
    const games = list.body.games as { key: string; title: string; visibility?: string }[];
    expect(games.map((g) => g.title)).toEqual(["المافيا", "اخترع إجابتك", "المهرب السري"]);
    expect(games.some((g) => "visibility" in g)).toBe(false);
    expect(list.body.privileged).toBe(false);
  });

  it("creates Mafia, «اخترع إجابتك» (own questions) and «المهرب السري» rooms, owned by them", async () => {
    as("sara");
    const mafia = await call(MAFIA, { action: "create" });
    expect(mafia.body.ok).toBe(true);
    const invent = await call(INVENT, { action: "create", questions: ["سؤال ١؟", "سؤال ٢؟"], rounds: 2 });
    expect(invent.body.ok).toBe(true);
    const dx = await call(DX, { action: "create", gameId: publicDx });
    expect(dx.body.ok).toBe(true);
    const owned = await pg.query<{ game_key: string; email: string }>(
      "select s.game_key, u.email from public.game_sessions s join auth.users u on u.id = s.owner_id where s.id in ($1, $2, $3) order by s.created_at",
      [mafia.body.sessionId, invent.body.sessionId, dx.body.sessionId],
    );
    expect(owned.rows).toEqual([
      { game_key: "mafia", email: "sara@example.com" },
      { game_key: "invent", email: "sara@example.com" },
      { game_key: publicDx, email: "sara@example.com" },
    ]);
    const mine = await call(CATALOG, { action: "mySessions" });
    expect((mine.body.sessions as unknown[]).length).toBe(3);
  });

  it("can't open private games by id, the Ahaji questions, or a draft — they read as missing", async () => {
    as("sara");
    expect((await call(DX, { action: "create", gameId: privateDx })).body.error).toBe("GAME_MISSING");
    expect((await call(DX, { action: "create", gameId: draftDx })).body.error).toBe("GAME_MISSING");
    expect((await call(INVENT, { action: "create", questionSet: "ahaji" })).body.error).toBe("GAME_MISSING");
  });

  it("signed out: no room, no catalog", async () => {
    expect((await call(MAFIA, { action: "create" })).body.error).toBe("AUTH_REQUIRED");
    expect((await call(INVENT, { action: "create", questions: ["س؟"] })).body.error).toBe("AUTH_REQUIRED");
    expect((await call(CATALOG, { action: "list" })).body.error).toBe("AUTH_REQUIRED");
  });

  it("is refused by every admin action (games, accounts, activity, visibility)", async () => {
    as("sara");
    for (const action of ["listGames", "catalog", "listAccounts", "activityOverview", "listActivitySessions", "inventAhajiQuestions"]) {
      expect((await call(ADMIN, { action })).status).toBe(401);
    }
    expect((await call(ADMIN, { action: "setVisibility", key: privateDx, visibility: "public" })).status).toBe(401);
    expect((await call(ADMIN, { action: "dxGet", id: privateDx })).status).toBe(401);
  });

  it("can't take over or see another user's room", async () => {
    as("omar");
    await call(AUTH, { action: "register", email: "omar@example.com", password: PASSWORD }, "7.7.7.7");
    const theirs = await pg.query<{ id: string }>("select s.id from public.game_sessions s join auth.users u on u.id = s.owner_id where u.email = 'sara@example.com' and s.game_key = 'mafia' limit 1");
    expect((await call(CATALOG, { action: "resume", sessionId: theirs.rows[0].id })).body.error).toBe("GAME_NOT_FOUND");
    expect((await call(CATALOG, { action: "mySessions" })).body.sessions).toEqual([]);
    // Host actions need the room's host token, which only its creator's device got.
    expect((await call(MAFIA, { action: "state", as: "host", sessionId: theirs.rows[0].id, hostToken: "x".repeat(32) })).status).toBe(403);
  });
});

describe("players join by QR code without an account", () => {
  it("joins with a nickname and plays; can't act as the host", async () => {
    as("sara");
    const room = await call(MAFIA, { action: "create" });
    as("guest-phone");
    const look = await call(GUEST, { action: "lookup", code: room.body.code });
    expect(look.body).toMatchObject({ ok: true, kind: "mafia", canJoin: true });
    const joined = await call(GUEST, { action: "join", code: room.body.code, name: "ضيف", personId: null });
    expect(joined.body.ok).toBe(true);
    const state = await call(MAFIA, { action: "state", as: "guest", sessionId: room.body.sessionId, playerToken: joined.body.playerToken });
    expect(state.body.ok).toBe(true);
    // A player token is not a host token.
    const hijack = await call(MAFIA, { action: "start", as: "host", sessionId: room.body.sessionId, hostToken: joined.body.playerToken });
    expect(hijack.status).toBe(403);
    expect(jar.size).toBe(0);
  });
});

describe("the super admin", () => {
  it("sees every game, opens private ones, and reads platform activity", async () => {
    // Provisioned by the operator (scripts/provision-super-admin.mjs does this through Supabase Auth).
    as("admin");
    await pg.query("insert into auth.users (email, raw_app_meta_data) values ('rayanomaireeni@gmail.com', '{\"fq_provisioned\":\"true\"}')");
    const { scrypt, randomBytes } = await import("node:crypto");
    const salt = randomBytes(16);
    const hash = await new Promise<Buffer>((ok, ko) => scrypt(PASSWORD, salt, 32, (e, k) => (e ? ko(e) : ok(k))));
    await pg.query("update auth.users set encrypted_password = $1 where email = 'rayanomaireeni@gmail.com'", [`scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`]);
    await rpc("fq_set_super_admin", { p_email: "rayanomaireeni@gmail.com" });

    const login = await call(AUTH, { action: "login", email: "rayanomaireeni@gmail.com", password: PASSWORD }, "8.8.8.8");
    expect(login.body.user).toEqual({ email: "rayanomaireeni@gmail.com", role: "super_admin" });

    const games = (await call(CATALOG, { action: "list" })).body.games as { title: string }[];
    expect(games.map((g) => g.title)).toEqual(expect.arrayContaining(["اخترع إجابتك · أحاجي", "المقيم السري", "مسودة"]));
    expect((await call(INVENT, { action: "create", questionSet: "ahaji" })).body.ok).toBe(true);
    expect((await call(DX, { action: "create", gameId: privateDx })).body.ok).toBe(true);

    const accounts = (await call(ADMIN, { action: "listAccounts" })).body.accounts as { email: string; session_count: number }[];
    expect(accounts.find((a) => a.email === "sara@example.com")!.session_count).toBe(4);
    const sessions = (await call(ADMIN, { action: "listActivitySessions", filters: { gameKey: "invent" } })).body.sessions as { id: string; owner_email: string }[];
    expect(sessions.length).toBe(1);
    expect(sessions[0].owner_email).toBe("sara@example.com");
    const detail = (await call(ADMIN, { action: "sessionDetail", id: sessions[0].id })).body.detail as { questions: string[]; ownerEmail: string };
    expect(detail.questions).toEqual(["سؤال ١؟", "سؤال ٢؟"]);
    expect(detail.ownerEmail).toBe("sara@example.com");
    const ahaji = (await call(ADMIN, { action: "inventAhajiQuestions" })).body.questions as unknown[];
    expect(ahaji).toHaveLength(46);
  });

  it("controls visibility: a private game becomes visible to users, and back", async () => {
    as("admin");
    expect((await call(ADMIN, { action: "setVisibility", key: "invent_ahaji", visibility: "public" })).body.ok).toBe(true);
    as("sara");
    expect(((await call(CATALOG, { action: "list" })).body.games as { key: string }[]).map((g) => g.key)).toContain("invent_ahaji");
    as("admin");
    await call(ADMIN, { action: "setVisibility", key: "invent_ahaji", visibility: "private" });
    as("sara");
    expect(((await call(CATALOG, { action: "list" })).body.games as { key: string }[]).map((g) => g.key)).not.toContain("invent_ahaji");
  });

  it("makes a public, name-free copy of a private hidden-role game", async () => {
    as("admin");
    const res = await call(ADMIN, { action: "dxPublicCopy", id: privateDx, title: "نسخة عامة" });
    expect(res.body.ok).toBe(true);
    const id = (res.body.game as { id: string }).id;
    const row = await pg.query<{ visibility: string; status: string }>("select visibility, status from public.games where id = $1", [id]);
    expect(row.rows[0]).toEqual({ visibility: "public", status: "published" });
    const orig = await pg.query<{ visibility: string }>("select visibility from public.games where id = $1", [privateDx]);
    expect(orig.rows[0].visibility).toBe("private");
  });
});
