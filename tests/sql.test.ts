import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, normalizeGameDoc } from "@/lib/game/doc";
import { buildRounds, buildSessionConfig } from "@/lib/game/rounds";

// Runs every real Supabase migration (in order) in an in-memory Postgres and
// exercises the integrity rules: duplicate clicks, locked rounds, exclusions,
// timers, answer validation and optimistic locking of game edits.

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

const HOST = "host-hash";
const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase/migrations");

const doc = normalizeGameDoc({
  title: "Test",
  people: [
    { id: "khalid", name: "Khalid" },
    { id: "rayan", name: "Rayan" },
    { id: "chinese", name: "Chinese" },
  ],
  settings: { ...DEFAULT_SETTINGS, order: "fixed", timeLimit: 0 },
  questions: [
    { type: "who", prompt: "who", correct: ["khalid"] },
    { type: "choice", prompt: "pick", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], correct: ["y"], timeLimit: 10 },
    { type: "text", prompt: "type", accepted: ["ok"] },
    { type: "number", prompt: "num", numberAnswer: 7 },
  ],
});

async function setupGame(configOverride: Record<string, unknown> = {}) {
  const config = { ...buildSessionConfig(doc), ...configOverride };
  const created = await call<R & { session_id: string; code: string }>("fq_create_session", {
    p_host_token_hash: HOST,
    p_game_id: null,
    p_config: config,
    p_rounds: buildRounds(doc),
  });
  expect(created.ok).toBe(true);
  expect(created.code).toMatch(/^\d{4}$/);
  const code = created.code;
  for (const person of ["khalid", "rayan", "chinese"]) {
    expect((await join(code, `Name ${person}`, person, `tok-${person}`)).ok).toBe(true);
  }
  expect((await join(code, "Guest", null, "tok-guest")).ok).toBe(true);
  return { sessionId: created.session_id, code };
}

const join = (code: string, name: string, person: string | null, token: string) =>
  call<R & { person_id?: string | null }>("fq_join_game", {
    p_code: code, p_display_name: name, p_person_id: person, p_token_hash: token,
  });

const transition = (sessionId: string, action: string, expected: number, hash = HOST) =>
  call<R & { changed?: boolean }>("fq_host_transition", {
    p_session_id: sessionId, p_host_token_hash: hash, p_action: action, p_expected_index: expected,
  });

const answer = (sessionId: string, who: string, roundIndex: number, value: unknown) =>
  call<R & { already_submitted?: boolean }>("fq_submit_answer", {
    p_session_id: sessionId, p_token_hash: `tok-${who}`, p_round_index: roundIndex, p_value: value,
  });

const snapshot = (sessionId: string) =>
  call<{
    session: { status: string; current_index: number; total_questions: number };
    rounds: { status: string; eligible_count: number | null; opened_at: string | null; answer_key: unknown }[];
    answers: { value: unknown; player_id: string }[];
  }>("fq_get_snapshot", { p_session_id: sessionId });

beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  }
});

describe("sessions (SQL)", () => {
  it("snapshots every round at creation and refuses empty games", async () => {
    const { sessionId } = await setupGame();
    const s = await snapshot(sessionId);
    expect(s.session).toMatchObject({ status: "LOBBY", total_questions: 4 });
    expect(s.rounds).toHaveLength(4);
    expect(s.rounds.every((r) => r.opened_at === null)).toBe(true);
    const empty = await call("fq_create_session", { p_host_token_hash: HOST, p_game_id: null, p_config: {}, p_rounds: [] });
    expect(empty.error).toBe("NO_QUESTIONS");
  });

  it("join: unique names/people, unknown people are ignored, lookup shows the game", async () => {
    const { code } = await setupGame();
    expect(await join(code, "Someone else", "khalid", "other")).toEqual({ ok: false, error: "IDENTITY_TAKEN" });
    expect(await join(code, "  guest ", null, "other")).toEqual({ ok: false, error: "NAME_TAKEN" });
    expect(await join(code, "   ", null, "other")).toEqual({ ok: false, error: "BAD_NAME" });
    const ghost = await join(code, "Ghost", "nobody", "ghost-tok");
    expect(ghost).toMatchObject({ ok: true, person_id: null });

    const lookup = await call<R & { taken_person_ids: string[]; people: { id: string }[]; title: string; ask_person: boolean }>(
      "fq_lookup_game",
      { p_code: code },
    );
    expect(lookup.title).toBe("Test");
    expect(lookup.ask_person).toBe(true);
    expect(lookup.people.map((p) => p.id)).toEqual(["khalid", "rayan", "chinese"]);
    expect(lookup.taken_person_ids.sort()).toEqual(["chinese", "khalid", "rayan"]);
    expect((await call("fq_lookup_game", { p_code: "0000" })).error).toBe("GAME_NOT_FOUND");
  });

  it("does not link people when the game doesn't ask", async () => {
    const config = buildSessionConfig({ ...doc, settings: { ...doc.settings, askPersonOnJoin: false } });
    const created = await call<R & { code: string }>("fq_create_session", {
      p_host_token_hash: HOST, p_game_id: null, p_config: config, p_rounds: buildRounds(doc),
    });
    expect(await join(created.code, "K", "khalid", "k-tok")).toMatchObject({ ok: true, person_id: null });
  });

  it("late join can be turned off (rejoining by name still works)", async () => {
    const { sessionId, code } = await setupGame({ settings: { ...doc.settings, lateJoin: false } });
    await call("fq_start_game", { p_session_id: sessionId, p_host_token_hash: HOST });
    expect((await join(code, "Late", null, "late-tok")).error).toBe("GAME_ALREADY_STARTED");
    const players = (await call<{ players: { id: string; display_name: string }[] }>("fq_get_snapshot", { p_session_id: sessionId })).players;
    const guest = players.find((p) => p.display_name === "Guest")!;
    await call("fq_release_player", { p_session_id: sessionId, p_host_token_hash: HOST, p_player_id: guest.id });
    expect((await join(code, "guest", null, "new-device")).ok).toBe(true);
  });

  it("rejects host actions with a wrong token; start is idempotent", async () => {
    const { sessionId } = await setupGame();
    expect((await call("fq_start_game", { p_session_id: sessionId, p_host_token_hash: "nope" })).error).toBe("FORBIDDEN");
    expect((await call("fq_start_game", { p_session_id: sessionId, p_host_token_hash: HOST })).changed).toBe(true);
    expect((await call("fq_start_game", { p_session_id: sessionId, p_host_token_hash: HOST })).changed).toBe(false);
    expect((await transition(sessionId, "reveal", 0, "nope")).error).toBe("FORBIDDEN");
  });

  it("full game: exclusions, answer validation, duplicates, locks, exactly-once transitions", async () => {
    const { sessionId } = await setupGame();
    await call("fq_start_game", { p_session_id: sessionId, p_host_token_hash: HOST });

    // Round 0 ("who", about khalid).
    expect((await answer(sessionId, "khalid", 0, { option: "rayan" })).error).toBe("OWNER_CANNOT_ANSWER");
    expect((await answer(sessionId, "rayan", 0, { option: "rayan" })).error).toBe("INVALID_CHOICE");
    expect((await answer(sessionId, "rayan", 0, { option: "ghost" })).error).toBe("INVALID_CHOICE");
    expect((await answer(sessionId, "rayan", 0, { text: "khalid" })).error).toBe("INVALID_CHOICE");
    expect((await answer(sessionId, "rayan", 1, { option: "x" })).error).toBe("ROUND_CLOSED");
    expect(await answer(sessionId, "rayan", 0, { option: "khalid", extra: 1 })).toEqual({ ok: true, already_submitted: false });
    expect(await answer(sessionId, "rayan", 0, { option: "chinese" })).toEqual({ ok: true, already_submitted: true });
    expect((await answer(sessionId, "guest", 0, { option: "chinese" })).ok).toBe(true);

    // Reveal locks the round; a double reveal is a no-op.
    expect((await transition(sessionId, "reveal", 0)).changed).toBe(true);
    expect((await transition(sessionId, "reveal", 0)).changed).toBe(false);
    expect((await answer(sessionId, "chinese", 0, { option: "khalid" })).error).toBe("ROUND_CLOSED");

    let s = await snapshot(sessionId);
    expect(s.rounds[0]).toMatchObject({ status: "REVEALED", eligible_count: 3 });
    // Stored values are normalized (extra keys dropped).
    expect(s.answers.map((a) => a.value)).toContainEqual({ option: "khalid" });
    expect(s.answers.some((a) => JSON.stringify(a.value).includes("extra"))).toBe(false);

    // next: exactly once even with a stale/double click.
    expect((await transition(sessionId, "next", 0)).changed).toBe(true);
    expect((await transition(sessionId, "next", 0)).changed).toBe(false);
    s = await snapshot(sessionId);
    expect(s.session).toMatchObject({ status: "QUESTION", current_index: 1 });
    expect(s.rounds[1].opened_at).not.toBeNull();

    // Round 1 (choice, 10s timer).
    expect((await answer(sessionId, "guest", 1, { option: "y" })).ok).toBe(true);
    await pg.query(`update public.game_rounds set opened_at = now() - interval '13 seconds' where round_index = 1 and session_id = $1`, [sessionId]);
    expect((await answer(sessionId, "rayan", 1, { option: "x" })).error).toBe("TIME_UP");
    await transition(sessionId, "reveal", 1);
    // Not about anyone: every player (linked or not) was eligible.
    expect((await snapshot(sessionId)).rounds[1].eligible_count).toBe(4);
    await transition(sessionId, "leaderboard", 1);
    await transition(sessionId, "next", 1);

    // Round 2 (text).
    expect((await answer(sessionId, "guest", 2, { option: "x" })).error).toBe("INVALID_ANSWER");
    expect((await answer(sessionId, "guest", 2, { text: "   " })).error).toBe("INVALID_ANSWER");
    expect((await answer(sessionId, "guest", 2, { text: "  ok  " })).ok).toBe(true);
    await transition(sessionId, "reveal", 2);
    await transition(sessionId, "next", 2);

    // Round 3 (number), last.
    expect((await answer(sessionId, "guest", 3, { number: "7" })).error).toBe("INVALID_ANSWER");
    expect((await answer(sessionId, "guest", 3, { number: 6.5 })).ok).toBe(true);
    expect((await transition(sessionId, "next", 3)).changed).toBe(false); // can't go past the last question
    expect((await transition(sessionId, "finish", 3)).changed).toBe(false); // must reveal first
    await transition(sessionId, "reveal", 3);
    expect((await transition(sessionId, "finish", 3)).changed).toBe(true);
    s = await snapshot(sessionId);
    expect(s.session.status).toBe("FINISHED");
    expect(s.answers.find((a) => JSON.stringify(a.value).includes("number"))?.value).toEqual({ number: 6.5 });
  });

  it("end: finishes from any state; finished codes are free again", async () => {
    const { sessionId, code } = await setupGame();
    await call("fq_start_game", { p_session_id: sessionId, p_host_token_hash: HOST });
    expect((await transition(sessionId, "end", 999)).changed).toBe(true);
    expect((await snapshot(sessionId)).session.status).toBe("FINISHED");
    expect((await call("fq_lookup_game", { p_code: code })).error).toBe("GAME_NOT_FOUND");
  });

  it("the trigger blocks direct inserts into closed rounds and by the excluded person", async () => {
    const { sessionId } = await setupGame();
    await call("fq_start_game", { p_session_id: sessionId, p_host_token_hash: HOST });
    const ids = await pg.query<{ round_id: string; player_id: string }>(
      `select r.id as round_id, p.id as player_id from public.game_rounds r, public.game_players p
        where r.session_id = $1 and p.session_id = $1 and r.round_index = 0 and p.person_id = 'khalid'`,
      [sessionId],
    );
    const { round_id, player_id } = ids.rows[0];
    await expect(
      pg.query(`insert into public.answers (session_id, round_id, player_id, value) values ($1, $2, $3, '{"option":"rayan"}')`, [
        sessionId, round_id, player_id,
      ]),
    ).rejects.toThrow(/OWNER_CANNOT_ANSWER/);
  });
});

describe("games (SQL)", () => {
  it("create, list, optimistic locking, status, delete", async () => {
    const created = await call<R & { game: { id: string; version: number } }>("fq_admin_save_game", {
      p_id: null, p_doc: doc, p_expected_version: null, p_status: null,
    });
    expect(created.ok).toBe(true);
    const id = created.game.id;
    expect(created.game.version).toBe(1);

    const saved = await call<R & { game: { version: number } }>("fq_admin_save_game", {
      p_id: id, p_doc: { ...doc, title: "Renamed" }, p_expected_version: 1, p_status: null,
    });
    expect(saved.game.version).toBe(2);
    // A stale tab (still on version 1) can't overwrite.
    const stale = await call("fq_admin_save_game", { p_id: id, p_doc: doc, p_expected_version: 1, p_status: null });
    expect(stale).toEqual({ ok: false, error: "VERSION_CONFLICT", version: 2 });

    expect((await call("fq_admin_set_game_status", { p_id: id, p_status: "published" })).status).toBe("published");
    expect((await call("fq_admin_set_game_status", { p_id: id, p_status: "nope" })).error).toBe("BAD_REQUEST");

    const list = await call<{ games: { id: string; title: string; question_count: number; people_count: number; status: string }[] }>(
      "fq_admin_list_games", {},
    );
    expect(list.games.find((g) => g.id === id)).toMatchObject({ title: "Renamed", question_count: 4, people_count: 3, status: "published" });

    // Sessions keep working after their game is deleted.
    const session = await call<R & { session_id: string }>("fq_create_session", {
      p_host_token_hash: HOST, p_game_id: id, p_config: buildSessionConfig(doc), p_rounds: buildRounds(doc),
    });
    await call("fq_admin_delete_game", { p_id: id });
    expect((await call("fq_admin_get_game", { p_id: id })).error).toBe("NOT_FOUND");
    expect((await snapshot(session.session_id)).session.status).toBe("LOBBY");

    const sessions = await call<{ sessions: { id: string }[] }>("fq_admin_list_sessions", { p_limit: 500 });
    expect(sessions.sessions.some((s) => s.id === session.session_id)).toBe(true);
    await call("fq_admin_delete_session", { p_id: session.session_id });
    expect((await snapshot(session.session_id)).session).toBeUndefined();
  });

  it("reports the schema version", async () => {
    expect(await call<number>("fq_schema_version", {})).toBe(3);
  });
});
