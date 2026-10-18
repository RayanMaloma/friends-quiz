import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { newDxDoc } from "@/lib/dx/doc";

// Deduction sessions on the real migrations (in-memory Postgres): kind
// detection, joining, the optimistic lock on the match state, and the end.

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

function sessionConfig() {
  const doc = newDxDoc("classic");
  return {
    kind: "deduction", title: doc.title, emoji: doc.emoji, accent: doc.accent,
    settings: { lateJoin: false, askPersonOnJoin: false }, people: [], game: doc.config, assets: [],
  };
}

describe("deduction sessions (SQL)", () => {
  it("stores deduction games with their kind", async () => {
    const saved = await call<R & { game: { id: string } }>("fq_admin_save_game", {
      p_id: null, p_doc: newDxDoc("shadow"), p_expected_version: null, p_status: "draft",
    });
    expect(saved.ok).toBe(true);
    const list = await call<{ games: { id: string; kind: string; max_players: number }[] }>("fq_admin_list_games", {});
    expect(list.games.find((g) => g.id === saved.game.id)).toMatchObject({ kind: "deduction", max_players: 10 });
  });

  it("runs a room: join in the lobby, versioned saves, no late joins, finish", async () => {
    const created = await call<R & { session_id: string; code: string }>("fq_dx_create_session", {
      p_host_token_hash: "host", p_game_id: null, p_config: sessionConfig(),
    });
    expect(created.ok).toBe(true);
    const { session_id: id, code } = created;

    const lookup = await call<R & { kind: string; can_join: boolean }>("fq_lookup_game", { p_code: code });
    expect(lookup).toMatchObject({ ok: true, kind: "deduction", can_join: true });

    for (let i = 1; i <= 5; i++) {
      const j = await call("fq_join_game", { p_code: code, p_display_name: `P${i}`, p_person_id: null, p_token_hash: `t${i}` });
      expect(j.ok).toBe(true);
    }

    const start = await call<R & { version: number }>("fq_dx_save_match", {
      p_session_id: id, p_expected_version: 0, p_match: { phase: "roleReveal" }, p_status: "PLAYING",
    });
    expect(start).toMatchObject({ ok: true, version: 1 });

    // A second write based on the old version loses (two phones at once).
    const stale = await call("fq_dx_save_match", {
      p_session_id: id, p_expected_version: 0, p_match: { phase: "nominate" }, p_status: "PLAYING",
    });
    expect(stale).toMatchObject({ ok: false, error: "STALE_STATE", version: 1 });

    // Nobody new can join a running game…
    const late = await call("fq_join_game", { p_code: code, p_display_name: "Late", p_person_id: null, p_token_hash: "late" });
    expect(late).toEqual({ ok: false, error: "GAME_ALREADY_STARTED" });
    // …but a player released by the host gets their seat back by name.
    const snap = await call<{ players: { id: string; display_name: string }[] }>("fq_get_snapshot", { p_session_id: id });
    const p2 = snap.players.find((p) => p.display_name === "P2")!;
    expect((await call("fq_release_player", { p_session_id: id, p_host_token_hash: "host", p_player_id: p2.id })).ok).toBe(true);
    const back = await call<R & { player_id: string }>("fq_join_game", { p_code: code, p_display_name: "p2", p_person_id: null, p_token_hash: "new-phone" });
    expect(back).toMatchObject({ ok: true, player_id: p2.id });

    const end = await call("fq_dx_save_match", {
      p_session_id: id, p_expected_version: 1, p_match: { phase: "gameOver" }, p_status: "FINISHED",
    });
    expect(end.ok).toBe(true);
    const after = await call<{ session: { status: string; kind: string; match: { phase: string }; match_version: number } }>(
      "fq_get_snapshot", { p_session_id: id },
    );
    expect(after.session).toMatchObject({ status: "FINISHED", kind: "deduction", match: { phase: "gameOver" }, match_version: 2 });
    // A finished game can't be reopened.
    const reopen = await call("fq_dx_save_match", {
      p_session_id: id, p_expected_version: 2, p_match: { phase: "nominate" }, p_status: "PLAYING",
    });
    expect(reopen).toMatchObject({ ok: false, error: "GAME_OVER" });
  });

  it("refuses non-deduction configs and quiz sessions", async () => {
    expect(await call("fq_dx_create_session", { p_host_token_hash: "h", p_game_id: null, p_config: { title: "x" } }))
      .toEqual({ ok: false, error: "BAD_REQUEST" });
  });
});
