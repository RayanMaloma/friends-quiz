import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Mafia rooms on the real migrations (in-memory Postgres): kind detection,
// joining, the optimistic lock, going back to the lobby for a rematch, closing.

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

const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase/migrations");

beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  }
});

const CONFIG = {
  kind: "mafia",
  title: "المافيا",
  emoji: "🌒",
  accent: "grape",
  settings: { lateJoin: false, askPersonOnJoin: false },
  people: [],
};

describe("mafia rooms (SQL)", () => {
  it("is schema version 6", async () => {
    expect(await call<number>("fq_schema_version", {})).toBe(6);
  });

  it("only creates rooms of kind mafia", async () => {
    const bad = await call("fq_mafia_create_session", { p_host_token_hash: "h", p_config: { ...CONFIG, kind: "quiz" } });
    expect(bad).toMatchObject({ ok: false, error: "BAD_REQUEST" });
  });

  it("runs a room: lobby, versioned saves, no late joins, rematch, close", async () => {
    const created = await call<R & { session_id: string; code: string }>("fq_mafia_create_session", {
      p_host_token_hash: "host",
      p_config: CONFIG,
    });
    expect(created.ok).toBe(true);
    const { session_id: id, code } = created;

    expect(await call("fq_lookup_game", { p_code: code })).toMatchObject({ ok: true, kind: "mafia", can_join: true });
    for (const name of ["أ", "ب", "ج", "د"]) {
      expect(await call("fq_join_game", { p_code: code, p_display_name: name, p_person_id: null, p_token_hash: `t-${name}` })).toMatchObject({ ok: true });
    }
    // Same name twice is refused.
    expect(await call("fq_join_game", { p_code: code, p_display_name: "أ", p_person_id: null, p_token_hash: "t-x" })).toMatchObject({
      ok: false,
      error: "NAME_TAKEN",
    });

    // A match can't be saved as PLAYING without state.
    expect(await call("fq_mafia_save_match", { p_session_id: id, p_expected_version: 0, p_match: null, p_status: "PLAYING" })).toMatchObject({
      ok: false,
      error: "BAD_REQUEST",
    });

    const saved = await call("fq_mafia_save_match", { p_session_id: id, p_expected_version: 0, p_match: { v: 1, round: 1 }, p_status: "PLAYING" });
    expect(saved).toMatchObject({ ok: true, version: 1 });
    // A second writer on the old version loses.
    const stale = await call("fq_mafia_save_match", { p_session_id: id, p_expected_version: 0, p_match: { v: 1, round: 2 }, p_status: "PLAYING" });
    expect(stale).toMatchObject({ ok: false, error: "STALE_STATE", version: 1 });

    // Roles are dealt: no new players, but a released player may come back by name.
    expect(await call("fq_join_game", { p_code: code, p_display_name: "هـ", p_person_id: null, p_token_hash: "t-late" })).toMatchObject({
      ok: false,
      error: "GAME_ALREADY_STARTED",
    });
    const snap = await call<{ players: { id: string; display_name: string }[] }>("fq_get_snapshot", { p_session_id: id });
    const b = snap.players.find((p) => p.display_name === "ب")!;
    expect(await call("fq_release_player", { p_session_id: id, p_host_token_hash: "host", p_player_id: b.id })).toMatchObject({ ok: true });
    expect(await call("fq_join_game", { p_code: code, p_display_name: "ب", p_person_id: null, p_token_hash: "t-b2" })).toMatchObject({
      ok: true,
      player_id: b.id,
    });

    // Rematch: back to the lobby, new players may join again.
    expect(await call("fq_mafia_save_match", { p_session_id: id, p_expected_version: 1, p_match: null, p_status: "LOBBY" })).toMatchObject({ ok: true });
    expect(await call("fq_join_game", { p_code: code, p_display_name: "هـ", p_person_id: null, p_token_hash: "t-late" })).toMatchObject({ ok: true });

    // Closing is final.
    expect(await call("fq_mafia_save_match", { p_session_id: id, p_expected_version: 2, p_match: null, p_status: "FINISHED" })).toMatchObject({ ok: true });
    expect(await call("fq_mafia_save_match", { p_session_id: id, p_expected_version: 3, p_match: { v: 1 }, p_status: "PLAYING" })).toMatchObject({
      ok: false,
      error: "GAME_OVER",
    });
    expect(await call("fq_lookup_game", { p_code: code })).toMatchObject({ ok: false });
  });

  it("does not save mafia state into other kinds of rooms", async () => {
    const quiz = await call<R & { session_id: string }>("fq_dx_create_session", {
      p_host_token_hash: "h",
      p_game_id: null,
      p_config: { kind: "deduction", title: "x", emoji: "x", accent: "sun", settings: {}, people: [], game: {}, assets: [] },
    });
    expect(await call("fq_mafia_save_match", { p_session_id: quiz.session_id, p_expected_version: 0, p_match: { v: 1 }, p_status: "PLAYING" })).toMatchObject({
      ok: false,
      error: "GAME_NOT_FOUND",
    });
  });
});
