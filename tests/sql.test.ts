import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

// Runs the real Supabase migration in an in-memory Postgres (PGlite) and
// exercises the integrity rules: duplicate clicks, locked rounds, owners.

let pg: PGlite;

async function call<T = Record<string, unknown>>(fn: string, params: Record<string, unknown>): Promise<T> {
  const keys = Object.keys(params);
  const args = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
  const values = keys.map((k) => {
    const v = params[k];
    return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  });
  const res = await pg.query<{ result: T }>(`select public.${fn}(${args}) as result`, values);
  return res.rows[0].result;
}

const HOST = "host-hash";
const rounds = [
  { fact_id: "f1", fact_text: "fact one", owner_person_id: "khalid" },
  { fact_id: "f2", fact_text: "fact two", owner_person_id: "rayan" },
];

async function setupGame() {
  const created = await call<{ ok: boolean; session_id: string; code: string }>("fq_create_game", {
    p_host_token_hash: HOST,
  });
  expect(created.ok).toBe(true);
  expect(created.code).toMatch(/^\d{4}$/);
  const code = created.code;
  for (const person of ["khalid", "rayan", "chinese"]) {
    const j = await call<{ ok: boolean }>("fq_join_game", {
      p_code: code, p_person_id: person, p_token_hash: `tok-${person}`,
    });
    expect(j.ok).toBe(true);
  }
  return { sessionId: created.session_id, code };
}

const transition = (sessionId: string, action: string, expected: number, hash = HOST) =>
  call<{ ok: boolean; changed?: boolean; error?: string }>("fq_host_transition", {
    p_session_id: sessionId, p_host_token_hash: hash, p_action: action, p_expected_index: expected,
  });

const answer = (sessionId: string, person: string, roundIndex: number, chosen: string) =>
  call<{ ok: boolean; error?: string; already_submitted?: boolean }>("fq_submit_answer", {
    p_session_id: sessionId, p_token_hash: `tok-${person}`, p_round_index: roundIndex, p_chosen_person_id: chosen,
  });

const snapshot = (sessionId: string) =>
  call<{
    session: { status: string; current_index: number };
    rounds: { status: string; eligible_count: number | null }[];
    answers: unknown[];
  }>("fq_get_snapshot", { p_session_id: sessionId });

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(readFileSync(path.join(__dirname, "..", "supabase/migrations/20261004000000_init.sql"), "utf8"));
});

describe("game integrity (SQL)", () => {
  it("prevents duplicate identities", async () => {
    const { code } = await setupGame();
    const dup = await call<{ ok: boolean; error: string }>("fq_join_game", {
      p_code: code, p_person_id: "khalid", p_token_hash: "other-device",
    });
    expect(dup).toEqual({ ok: false, error: "IDENTITY_TAKEN" });
    const lookup = await call<{ taken_person_ids: string[] }>("fq_lookup_game", { p_code: code });
    expect(lookup.taken_person_ids.sort()).toEqual(["chinese", "khalid", "rayan"]);
    const bad = await call<{ ok: boolean; error: string }>("fq_lookup_game", { p_code: "0000" });
    expect(bad.error).toBe("GAME_NOT_FOUND");
  });

  it("rejects host actions with a wrong token", async () => {
    const { sessionId } = await setupGame();
    const res = await call<{ ok: boolean; error: string }>("fq_start_game", {
      p_session_id: sessionId, p_host_token_hash: "nope", p_rounds: rounds,
    });
    expect(res.error).toBe("FORBIDDEN");
  });

  it("start is idempotent and never reshuffles", async () => {
    const { sessionId } = await setupGame();
    const a = await call<{ changed: boolean }>("fq_start_game", { p_session_id: sessionId, p_host_token_hash: HOST, p_rounds: rounds });
    const b = await call<{ changed: boolean }>("fq_start_game", {
      p_session_id: sessionId, p_host_token_hash: HOST, p_rounds: [...rounds].reverse(),
    });
    expect(a.changed).toBe(true);
    expect(b.changed).toBe(false);
    const s = await call<{ rounds: { fact_id: string }[] }>("fq_get_snapshot", { p_session_id: sessionId });
    expect(s.rounds.map((r) => r.fact_id)).toEqual(["f1", "f2"]);
  });

  it("full round: owner excluded, duplicates ignored, reveal locks, next is exactly-once", async () => {
    const { sessionId } = await setupGame();
    await call("fq_start_game", { p_session_id: sessionId, p_host_token_hash: HOST, p_rounds: rounds });

    // Owner (khalid) cannot answer round 0.
    expect((await answer(sessionId, "khalid", 0, "rayan")).error).toBe("OWNER_CANNOT_ANSWER");
    // Can't pick yourself.
    expect((await answer(sessionId, "rayan", 0, "rayan")).error).toBe("INVALID_CHOICE");
    // Wrong round index.
    expect((await answer(sessionId, "rayan", 1, "khalid")).error).toBe("ROUND_CLOSED");

    // Double submit: second is a no-op, first answer stays.
    expect(await answer(sessionId, "rayan", 0, "khalid")).toEqual({ ok: true, already_submitted: false });
    expect(await answer(sessionId, "rayan", 0, "chinese")).toEqual({ ok: true, already_submitted: true });

    // Double reveal (concurrent).
    const [r1, r2] = await Promise.all([transition(sessionId, "reveal", 0), transition(sessionId, "reveal", 0)]);
    expect([r1.changed, r2.changed].filter(Boolean)).toHaveLength(1);

    let s = await snapshot(sessionId);
    expect(s.session.status).toBe("REVEAL");
    expect(s.rounds[0].status).toBe("REVEALED");
    expect(s.rounds[0].eligible_count).toBe(2); // rayan + chinese
    expect(s.answers).toHaveLength(1);

    // Late answer after reveal is rejected.
    expect((await answer(sessionId, "chinese", 0, "khalid")).error).toBe("ROUND_CLOSED");
    // Direct insert is blocked by the trigger too.
    await expect(
      pg.query(
        `insert into answers (session_id, round_id, player_id, chosen_person_id)
         select $1, r.id, p.id, 'khalid' from game_rounds r, game_players p
          where r.session_id = $1 and r.round_index = 0 and p.session_id = $1 and p.person_id = 'chinese'`,
        [sessionId],
      ),
    ).rejects.toThrow(/ROUND_CLOSED/);

    // Leaderboard then double "next": only one advance.
    expect((await transition(sessionId, "leaderboard", 0)).changed).toBe(true);
    expect((await transition(sessionId, "next", 0)).changed).toBe(true);
    expect((await transition(sessionId, "next", 0)).changed).toBe(false);
    s = await snapshot(sessionId);
    expect(s.session).toMatchObject({ status: "QUESTION", current_index: 1 });

    // Next on the last question is refused; finish works once.
    await transition(sessionId, "reveal", 1);
    expect((await transition(sessionId, "next", 1)).changed).toBe(false);
    expect((await transition(sessionId, "finish", 1)).changed).toBe(true);
    expect((await transition(sessionId, "finish", 1)).changed).toBe(false);
    s = await snapshot(sessionId);
    expect(s.session.status).toBe("FINISHED");
  });

  it("host release lets a new device claim the identity mid-game", async () => {
    const { sessionId, code } = await setupGame();
    await call("fq_start_game", { p_session_id: sessionId, p_host_token_hash: HOST, p_rounds: rounds });
    await call("fq_release_player", { p_session_id: sessionId, p_host_token_hash: HOST, p_person_id: "chinese" });
    const j = await call<{ ok: boolean }>("fq_join_game", {
      p_code: code, p_person_id: "chinese", p_token_hash: "new-device",
    });
    expect(j.ok).toBe(true);
    // Old device token no longer works.
    expect((await answer(sessionId, "chinese", 0, "khalid")).error).toBe("NOT_A_PLAYER");
  });

  it("leave is only allowed in the lobby", async () => {
    const { sessionId } = await setupGame();
    const left = await call<{ ok: boolean }>("fq_leave_game", { p_session_id: sessionId, p_token_hash: "tok-chinese" });
    expect(left.ok).toBe(true);
    await call("fq_start_game", { p_session_id: sessionId, p_host_token_hash: HOST, p_rounds: rounds });
    const late = await call<{ ok: boolean; error: string }>("fq_leave_game", { p_session_id: sessionId, p_token_hash: "tok-rayan" });
    expect(late.error).toBe("GAME_ALREADY_STARTED");
  });
});

describe("migration on a Supabase-like database", () => {
  it("applies cleanly when anon/authenticated/service_role exist, and is re-runnable", async () => {
    const db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role;");
    const sql = readFileSync(path.join(__dirname, "..", "supabase/migrations/20261004000000_init.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql); // idempotent re-run
    const anonExec = await db.query<{ ok: boolean }>(
      "select has_function_privilege('anon', 'public.fq_get_snapshot(uuid)', 'execute') as ok",
    );
    const serviceExec = await db.query<{ ok: boolean }>(
      "select has_function_privilege('service_role', 'public.fq_get_snapshot(uuid)', 'execute') as ok",
    );
    const anonSelect = await db.query<{ ok: boolean }>(
      "select has_table_privilege('anon', 'public.answers', 'select') as ok",
    );
    expect(anonExec.rows[0].ok).toBe(false);
    expect(serviceExec.rows[0].ok).toBe(true);
    expect(anonSelect.rows[0].ok).toBe(false);
  });
});
