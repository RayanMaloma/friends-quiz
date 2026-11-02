import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migratedDb } from "./helpers/db";
import { WORD_BANK } from "@/lib/draw/words";
import type { DrawDoc, Stroke } from "@/lib/draw/engine";
import type { DrawGuestView, DrawHostView } from "@/lib/draw/views";

// The /api/draw endpoint end to end, on the real migrations (in-memory
// Postgres): rooms and joining, what each device may see (the word and the
// drawing above all), autosave and approval, phones guessing at the same
// instant, scoring once, latecomers, a drawer leaving, refresh, rematch /
// lobby / close, and the catalog/activity bookkeeping.

let pg: PGlite;
let pings = 0;

vi.mock("@/lib/server/db", () => ({
  isSupabaseConfigured: false,
  ConfigError: class extends Error {},
  SchemaError: class extends Error {},
  rpc: async (fn: string, params: Record<string, unknown>) => {
    const keys = Object.keys(params);
    const args = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
    const values = keys.map((k) => {
      const v = params[k];
      return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    });
    const res = await pg.query<{ result: unknown }>(`select public.${fn}(${args}) as result`, values);
    return res.rows[0].result;
  },
}));
vi.mock("@/lib/server/broadcast", () => ({
  notifyGame: async () => {
    pings++;
  },
}));
vi.mock("@/lib/server/access", () => ({
  authorizeCreate: async () => ({ actor: { user: null, privileged: true } }),
  claimSession: async () => {},
}));

const { POST } = await import("@/app/api/draw/route");
const { POST: GUEST } = await import("@/app/api/guest/route");

beforeAll(async () => {
  pg = await migratedDb();
});
beforeEach(() => {
  pings = 0;
});

type Body<V> = {
  ok: boolean;
  error?: string;
  message?: string;
  view?: V;
  sessionId?: string;
  code?: string;
  hostToken?: string;
  playerToken?: string;
  strokes?: Stroke[];
  rev?: number | null;
};
type Res<V> = { status: number; body: Body<V> };

async function call<V>(handler: (r: Request) => Promise<Response>, body: Record<string, unknown>): Promise<Res<V>> {
  const res = await handler(new Request("http://test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

const NAMES = ["الدحام", "أبو قاسم", "العمري", "عبدالرحمن الناهض"];
const LINE: Stroke[] = [{ c: 1, w: 1, p: [100, 100, 500, 520, 900, 880] }];

interface Room {
  sessionId: string;
  code: string;
  tokens: Record<string, string>;
  host: (action: string, extra?: Record<string, unknown>) => Promise<Res<DrawHostView>>;
  guest: (name: string, action: string, extra?: Record<string, unknown>) => Promise<Res<DrawGuestView>>;
  join: (name: string) => Promise<Res<unknown>>;
}

async function openRoom(names = NAMES, create: Record<string, unknown> = {}): Promise<Room> {
  const created = await call<never>(POST, { action: "create", ...create });
  expect(created.body.ok).toBe(true);
  const { sessionId, code, hostToken } = created.body as { sessionId: string; code: string; hostToken: string };
  const tokens: Record<string, string> = {};
  const room: Room = {
    sessionId,
    code,
    tokens,
    host: (action, extra = {}) => call(POST, { action, as: "host", sessionId, hostToken, ...extra }),
    guest: (name, action, extra = {}) => call(POST, { action, as: "guest", sessionId, playerToken: tokens[name], ...extra }),
    join: async (name) => {
      const res = await call<unknown>(GUEST, { action: "join", code, name, personId: null });
      if (res.body.ok) tokens[name] = res.body.playerToken!;
      return res;
    },
  };
  for (const n of names) expect((await room.join(n)).body.ok).toBe(true);
  return room;
}

async function docOf(sessionId: string): Promise<DrawDoc> {
  const r = await pg.query<{ match: DrawDoc }>("select match from public.game_sessions where id = $1", [sessionId]);
  return r.rows[0].match;
}

/** Moves the stored clock back so the current phase has run for `ms` longer. */
async function age(sessionId: string, ms: number) {
  const doc = await docOf(sessionId);
  doc.game!.phaseStartedAt -= ms;
  await pg.query("update public.game_sessions set match = $2 where id = $1", [sessionId, JSON.stringify(doc)]);
}

/** The turn's word and every answer accepted for it (none of which may reach a guesser early). */
async function secretOf(sessionId: string) {
  const wordId = (await docOf(sessionId)).game!.turn.wordId;
  const w = WORD_BANK.find((x) => x.id === wordId)!;
  return { word: w.word, all: [w.word, ...w.also] };
}

async function drawerOf(room: Room) {
  const id = (await docOf(room.sessionId)).game!.turn.drawerId;
  const v = (await room.host("state")).body.view!;
  return v.lobby.find((p) => p.id === id)!.name;
}

/** Start, then intro → drawing. */
async function startDrawing(room: Room) {
  await room.host("start");
  await age(room.sessionId, 4000);
  const h = await room.host("state");
  expect(h.body.view!.game!.phase).toBe("drawing");
  return drawerOf(room);
}

describe("/api/draw", () => {
  it("routes lookups to its join screen and lets latecomers in", async () => {
    const room = await openRoom([]);
    const look = await call<never>(GUEST, { action: "lookup", code: room.code });
    expect(look.body).toMatchObject({ ok: true, kind: "draw", canJoin: true });
    const state = await call<never>(GUEST, { action: "state", sessionId: room.sessionId, playerToken: "x".repeat(24) });
    expect(state.body.error).toBe("DRAW_SESSION");
    const row = await pg.query<{ game_key: string }>("select game_key from public.game_sessions where id = $1", [room.sessionId]);
    expect(row.rows[0].game_key).toBe("draw");
  });

  it("lobby: defaults, settings with limits, minimum players", async () => {
    const room = await openRoom(["أ", "ب"]);
    let h = await room.host("state");
    expect(h.body.view!.settings).toEqual({ laps: 1, drawSeconds: 60, guessSeconds: 30 });
    h = await room.host("settings", { laps: 2, drawSeconds: 45, guessSeconds: 20 });
    expect(h.body.view!.settings).toEqual({ laps: 2, drawSeconds: 45, guessSeconds: 20 });
    expect((await room.host("settings", { laps: 6 })).status).toBe(400);
    expect((await room.host("settings", { drawSeconds: 4 })).status).toBe(400);
    expect((await room.host("start")).body).toMatchObject({ ok: false, error: "RULE" });
    // Only the host runs the room.
    expect((await room.guest("أ", "start")).status).toBe(400);
    expect((await call(POST, { action: "settings", as: "host", sessionId: room.sessionId, hostToken: "y".repeat(43) })).status).toBe(403);
  });

  it("keeps the word on the drawer's phone and the drawing off every screen until approved", async () => {
    const room = await openRoom();
    await room.host("start");
    const { word, all } = await secretOf(room.sessionId);
    const drawer = await drawerOf(room);
    const others = NAMES.filter((n) => n !== drawer);

    // Intro: the drawer has the word; nobody else, TV included.
    const mine = (await room.guest(drawer, "state")).body.view!;
    expect(mine).toMatchObject({ isDrawer: true, word });
    for (const n of others) {
      const v = (await room.guest(n, "state")).body.view!;
      expect(v.isDrawer).toBe(false);
      expect(v.word).toBeNull();
      for (const a of all) expect(JSON.stringify(v)).not.toContain(a);
    }
    const tv = JSON.stringify((await room.host("state")).body.view);
    for (const a of all) expect(tv).not.toContain(a);
    expect(tv).not.toMatch(/wordId|drawerId":|"also"/);

    // Drawing: autosaves are quiet, server-only; nobody but the drawer can fetch them.
    await age(room.sessionId, 4000);
    await room.host("state");
    pings = 0;
    const saved = await room.guest(drawer, "act", { move: { type: "draft", turn: 0, strokes: LINE } });
    expect(saved.body.ok).toBe(true);
    expect(pings).toBe(0);
    expect((await docOf(room.sessionId)).game!.turn.draft).toEqual(LINE);
    expect((await room.guest(drawer, "drawing")).body).toMatchObject({ ok: true, rev: null, strokes: LINE });
    expect((await room.guest(others[0], "drawing")).status).toBe(404);
    expect((await room.host("drawing")).status).toBe(404);
    expect((await room.guest(others[0], "act", { move: { type: "draft", turn: 0, strokes: LINE } })).body.error).toBe("DR_NOT_DRAWER");
    expect((await room.guest(others[0], "act", { move: { type: "guess", turn: 0, text: word } })).body.error).toBe("DR_CLOSED");

    // Approve: guessing starts, every screen can fetch the strokes, views still carry none.
    const sent = await room.guest(drawer, "act", { move: { type: "submit", turn: 0, strokes: LINE } });
    expect(sent.body.view!.game!.phase).toBe("guessing");
    expect(pings).toBeGreaterThan(0);
    const g = (await room.host("state")).body.view!.game!;
    expect(g.drawingRev).toBe(1);
    expect(JSON.stringify(g)).not.toContain("[100,100");
    for (const who of [() => room.host("drawing"), () => room.guest(others[1], "drawing")]) {
      expect((await who()).body).toMatchObject({ ok: true, rev: 1, strokes: LINE });
    }
    // Approved means final: no more edits.
    expect((await room.guest(drawer, "act", { move: { type: "draft", turn: 0, strokes: [] } })).body.ok).toBe(true);
    expect((await docOf(room.sessionId)).game!.turn.drawing).toEqual(LINE);
  });

  it("scores guesses in the order the server got them, once, even when they land together", async () => {
    const room = await openRoom();
    const drawer = await startDrawing(room);
    const { word } = await secretOf(room.sessionId);
    const others = NAMES.filter((n) => n !== drawer);
    await room.guest(drawer, "act", { move: { type: "submit", turn: 0, strokes: LINE } });

    // A wrong guess: quiet, counted, the box stays open.
    pings = 0;
    const wrong = await room.guest(others[0], "act", { move: { type: "guess", turn: 0, text: "إسطبل" } });
    expect(wrong.body.view).toMatchObject({ solved: false, attempts: 1 });
    expect(pings).toBe(0);
    expect((await room.guest(drawer, "act", { move: { type: "guess", turn: 0, text: word } })).body.error).toBe("DR_DRAWER");

    // Three right answers at the same instant (different spellings).
    const results = await Promise.all(
      others.map((n, i) => room.guest(n, "act", { move: { type: "guess", turn: 0, text: i === 1 ? `ال${word}` : ` ${word} ` } })),
    );
    expect(results.map((r) => r.body.ok)).toEqual([true, true, true]);
    for (const r of results) expect(r.body.view!.solved).toBe(true);
    // Their guesses are never shown to anyone while guessing; it ended early (everyone got it).
    const tv = (await room.host("state")).body.view!;
    expect(tv.game!.phase).toBe("reveal");
    const doc = await docOf(room.sessionId);
    const order = doc.game!.turn.correct.map((c) => c.id);
    expect(order).toHaveLength(3);
    const points = order.map((id) => doc.game!.turn.gained![id]);
    expect(points).toEqual([150, 125, 100]);
    expect(doc.game!.turn.gained![doc.game!.turn.drawerId]).toBe(150);
    expect(Object.values(doc.game!.scores).reduce((a, b) => a + b, 0)).toBe(525);

    // The reveal: the word, who got it (in order) and the points, for everyone.
    expect(tv.game!.reveal).toMatchObject({ word, skipped: null, drawerPoints: 150 });
    expect(tv.game!.reveal!.correct.map((c) => c.points)).toEqual([150, 125, 100]);
    expect((await room.guest(others[0], "state")).body.view!.game!.reveal!.word).toBe(word);
    // A late retry changes nothing.
    await room.guest(others[0], "act", { move: { type: "guess", turn: 0, text: word } });
    expect(Object.values((await docOf(room.sessionId)).game!.scores).reduce((a, b) => a + b, 0)).toBe(525);
  });

  it("a guess that lands after the timer is refused; the timer approves the last autosave", async () => {
    const room = await openRoom();
    const drawer = await startDrawing(room);
    const { word } = await secretOf(room.sessionId);
    const other = NAMES.find((n) => n !== drawer)!;
    await room.guest(drawer, "act", { move: { type: "draft", turn: 0, strokes: LINE } });
    await age(room.sessionId, 60_000);
    // The next request (from anyone) moves the clock: the autosave goes up.
    let v = (await room.guest(other, "state")).body.view!;
    expect(v.game!.phase).toBe("guessing");
    expect(v.game!.drawingRev).toBe(1);
    await age(room.sessionId, 30_000);
    const late = await room.guest(other, "act", { move: { type: "guess", turn: 0, text: word } });
    expect(late.body.error).toBe("DR_CLOSED");
    v = (await room.guest(other, "state")).body.view!;
    expect(v.game!.phase).toBe("reveal");
    expect(v.game!.reveal!.correct).toEqual([]);
  });

  it("a drawer who leaves mid-turn: the turn passes; latecomers draw before the lap ends", async () => {
    const room = await openRoom(NAMES.slice(0, 3));
    const drawer = await startDrawing(room);
    // A latecomer joins mid-match: in the room, not yet seated.
    expect((await room.join("ريان")).body.ok).toBe(true);
    expect((await room.guest("ريان", "state")).body.view).toMatchObject({ seated: false, isDrawer: false });
    const id = (await room.host("state")).body.view!.lobby.find((p) => p.name === drawer)!.id;
    let h = await room.host("release", { playerId: id });
    expect(h.body.view!.game!.phase).toBe("reveal");
    expect(h.body.view!.game!.reveal!.skipped).toBe("absent");
    await age(room.sessionId, 9000);
    h = await room.host("state");
    expect(h.body.view!.game!.phase).toBe("intro");
    expect((await room.guest("ريان", "state")).body.view!.seated).toBe(true);
    const doc = await docOf(room.sessionId);
    expect([doc.game!.turn.drawerId, ...doc.game!.queue]).toContain(h.body.view!.lobby.find((p) => p.name === "ريان")!.id);
    expect(h.body.view!.game!.totalTurns).toBe(4);
  });

  it("survives a refresh: same view, the drawer gets the autosave back", async () => {
    const room = await openRoom();
    const drawer = await startDrawing(room);
    await room.guest(drawer, "act", { move: { type: "draft", turn: 0, strokes: LINE } });
    // "Refresh" = a new device session with the same token.
    const again = await room.guest(drawer, "state");
    expect(again.body.view).toMatchObject({ isDrawer: true });
    expect((await room.guest(drawer, "drawing")).body.strokes).toEqual(LINE);
  });

  it("host: skip once per click, timers for the next phase, end, rematch, lobby, close", async () => {
    const room = await openRoom();
    await room.host("start");
    let h = await room.host("host", { move: { type: "skip", phase: "intro", turn: 0 } });
    expect(h.body.view!.game!.phase).toBe("drawing");
    h = await room.host("host", { move: { type: "skip", phase: "intro", turn: 0 } });
    expect(h.body.view!.game!.phase).toBe("drawing");
    h = await room.host("host", { move: { type: "timers", drawSeconds: 20, guessSeconds: 10 } });
    expect(h.body.view!.game!.timer!.durationMs).toBe(60_000);
    expect(h.body.view!.settings).toMatchObject({ drawSeconds: 20, guessSeconds: 10 });
    // Nothing drawn: skipping drawing skips the turn.
    h = await room.host("host", { move: { type: "skip", phase: "drawing", turn: 0 } });
    expect(h.body.view!.game!.reveal!.skipped).toBe("blank");

    // Play the rest by skipping: every player draws once, then the final.
    let guard = 0;
    while (h.body.view!.game!.phase !== "final" && guard++ < 50) {
      const g = h.body.view!.game!;
      h = await room.host("host", { move: { type: "skip", phase: g.phase, turn: g.turn } });
    }
    expect(h.body.view!.game!.phase).toBe("final");
    expect((await docOf(room.sessionId)).game!.turnsDone).toBe(4);
    const row = await pg.query<{ completed_at: string | null }>("select completed_at from public.game_sessions where id = $1", [room.sessionId]);
    expect(row.rows[0].completed_at).not.toBeNull();

    const first = (await docOf(room.sessionId)).game!.id;
    h = await room.host("rematch");
    expect(h.body.view!.game!.phase).toBe("intro");
    expect(h.body.view!.game!.matchId).not.toBe(first);
    h = await room.host("host", { move: { type: "end" } });
    expect(h.body.view!.game).toMatchObject({ phase: "final", endedEarly: true });
    h = await room.host("lobby");
    expect(h.body.view!.status).toBe("LOBBY");
    expect(h.body.view!.game).toBeNull();
    h = await room.host("close");
    expect(h.body.view!.status).toBe("FINISHED");
    expect((await call(GUEST, { action: "lookup", code: room.code })).body.ok).toBe(false);
  });

  it("refuses bad moves and drawings", async () => {
    const room = await openRoom();
    const drawer = await startDrawing(room);
    for (const move of [
      { type: "submit", turn: 0, strokes: [{ c: 1, w: 1, p: [1, 2, 3] }] },
      { type: "submit", turn: 0, strokes: [{ c: 1, w: 1, p: [5000, 1] }] },
    ]) {
      expect((await room.guest(drawer, "act", { move })).body.error).toBe("DR_BAD_DRAWING");
    }
    expect((await room.guest(drawer, "act", { move: { type: "submit", turn: 0, strokes: [] } })).body.error).toBe("DR_EMPTY");
    expect((await room.guest(drawer, "act", { move: { type: "submit", turn: 3, strokes: LINE } })).body.error).toBe("DR_CLOSED");
    expect((await room.guest(drawer, "act", { move: { type: "nope", turn: 0 } })).status).toBe(400);
    expect((await call(POST, { action: "state", as: "guest", sessionId: room.sessionId, playerToken: "z".repeat(43) })).status).toBe(401);
  });
});
