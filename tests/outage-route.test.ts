import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migratedDb } from "./helpers/db";
import type { OutageDoc } from "@/lib/outage/engine";
import { panelOf, PANELS, type PanelId } from "@/lib/outage/roles";
import type { Command } from "@/lib/outage/sim";
import type { OutageGuestView, OutageHostView } from "@/lib/outage/views";
import { nextCommand } from "./helpers/outageCrew";

// /api/outage end to end, on the real migrations (in-memory Postgres): rooms
// and joining (3–8), difficulty, per-device privacy, panel permissions,
// simultaneous commands, the shared server clock, refresh / reconnection,
// a player leaving and coming back, host controls, results → new mission,
// and the catalog/activity bookkeeping.

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

const { POST } = await import("@/app/api/outage/route");
const { POST: GUEST } = await import("@/app/api/guest/route");
const { POST: HOST } = await import("@/app/api/host/route");

beforeAll(async () => {
  pg = await migratedDb();
});
beforeEach(() => {
  pings = 0;
});

type Body<V> = { ok: boolean; error?: string; message?: string; view?: V; sessionId?: string; code?: string; hostToken?: string; playerToken?: string; kind?: string };
type Res<V> = { status: number; body: Body<V> };

async function call<V>(handler: (r: Request) => Promise<Response>, body: Record<string, unknown>): Promise<Res<V>> {
  const res = await handler(new Request("http://test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

const NAMES = ["الدحام", "أبو قاسم", "العمري", "الناهض", "القضيبي", "يزيد", "خالد", "ريان", "التميمي"];

interface Room {
  sessionId: string;
  code: string;
  tokens: Record<string, string>;
  ids: Record<string, string>;
  host: (action: string, extra?: Record<string, unknown>) => Promise<Res<OutageHostView>>;
  guest: (name: string, action: string, extra?: Record<string, unknown>) => Promise<Res<OutageGuestView>>;
  join: (name: string) => Promise<Res<unknown>>;
}

async function openRoom(n: number, create: Record<string, unknown> = {}): Promise<Room> {
  const created = await call<never>(POST, { action: "create", ...create });
  expect(created.body.ok).toBe(true);
  const { sessionId, code, hostToken } = created.body as { sessionId: string; code: string; hostToken: string };
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const room: Room = {
    sessionId,
    code,
    tokens,
    ids,
    host: (action, extra = {}) => call(POST, { action, as: "host", sessionId, hostToken, ...extra }),
    guest: (name, action, extra = {}) => call(POST, { action, as: "guest", sessionId, playerToken: tokens[name], ...extra }),
    join: async (name) => {
      const res = await call<unknown>(GUEST, { action: "join", code, name, personId: null });
      if (res.body.ok) tokens[name] = res.body.playerToken!;
      return res;
    },
  };
  for (const name of NAMES.slice(0, n)) {
    expect((await room.join(name)).body.ok).toBe(true);
    const v = await room.guest(name, "state");
    ids[name] = v.body.view!.me.playerId;
  }
  return room;
}

async function docOf(sessionId: string): Promise<OutageDoc> {
  const r = await pg.query<{ match: OutageDoc }>("select match from public.game_sessions where id = $1", [sessionId]);
  return r.rows[0].match;
}

async function writeDoc(sessionId: string, doc: OutageDoc) {
  await pg.query("update public.game_sessions set match = $2 where id = $1", [sessionId, JSON.stringify(doc)]);
}

/** Moves the stored clock back: the match has run `ms` longer (presence untouched, so nobody looks gone). */
async function age(sessionId: string, ms: number) {
  const doc = await docOf(sessionId);
  doc.game!.startedAt -= ms;
  if (doc.game!.frozenAt !== null) doc.game!.frozenAt -= ms;
  await writeDoc(sessionId, doc);
}

/** Name of whoever holds `panel`. */
async function holder(room: Room, panel: PanelId): Promise<string> {
  const g = (await docOf(room.sessionId)).game!;
  return Object.keys(room.ids).find((n) => room.ids[n] === g.assignment[panel])!;
}

const act = (room: Room, name: string, command: Command) => room.guest(name, "act", { command });

describe("/api/outage", () => {
  it("routes lookups to its join screen; other endpoints point to it", async () => {
    const room = await openRoom(3);
    const lookup = await call<never>(GUEST, { action: "lookup", code: room.code });
    expect(lookup.body.kind).toBe("outage");
    const legacy = await call<never>(GUEST, { action: "state", sessionId: room.sessionId, playerToken: room.tokens[NAMES[0]] });
    expect(legacy.body.error).toBe("OUTAGE_SESSION");
    const row = await pg.query<{ game_key: string }>("select game_key from public.game_sessions where id = $1", [room.sessionId]);
    expect(row.rows[0].game_key).toBe("outage");
    expect((await call<never>(HOST, { action: "state", sessionId: room.sessionId, hostToken: "x".repeat(43) })).body.error).toMatch(/FORBIDDEN|OUTAGE_SESSION/);
  });

  it("lobby: easy by default, the host picks the difficulty, 3–8 players to start", async () => {
    const two = await openRoom(2);
    let v = await two.host("state");
    expect(v.body.view!.settings.difficulty).toBe("easy");
    expect((await two.host("settings", { difficulty: "hard" })).body.view!.settings.difficulty).toBe("hard");
    expect((await two.host("settings", { difficulty: "extreme" })).status).toBe(400);
    const refused = await two.host("start");
    expect(refused.body.ok).toBe(false);
    expect(refused.body.message).toMatch(/3/);

    const nine = await openRoom(9);
    expect((await nine.host("start")).body.message).toMatch(/8/);

    for (const n of [3, 6, 8]) {
      const room = await openRoom(n);
      v = await room.host("start");
      expect(v.body.ok).toBe(true);
      expect(v.body.view!.game!.crew).toHaveLength(n);
      const doc = await docOf(room.sessionId);
      const owners = new Set(PANELS.map((p) => doc.game!.assignment[p]));
      expect(owners.size).toBe(n);
      // Each phone: a different console made of its own panels only.
      const consoles = new Set<string>();
      for (const name of NAMES.slice(0, n)) {
        const g = (await room.guest(name, "state")).body.view!.game!;
        expect(g.panels.length).toBeGreaterThan(0);
        expect(Object.keys(g.data).sort()).toEqual([...g.panels].sort());
        consoles.add(g.panels.join(","));
      }
      expect(consoles.size).toBe(n);
      // Nobody new can join a running mission.
      expect((await room.join("متأخر")).body.error).toBe("GAME_ALREADY_STARTED");
    }
  });

  it("the TV shows the station, never a code; the code reaches only comms", async () => {
    const room = await openRoom(6);
    await room.host("start");
    await age(room.sessionId, 8000);
    const tv = (await room.host("state")).body.view!;
    const doc = await docOf(room.sessionId);
    const code = doc.game!.missions[0].params.code;
    expect(tv.game!.station.reactor.temp).toBeGreaterThanOrEqual(91);
    expect(tv.game!.faults[0].id).toBe("reactor");
    expect(JSON.stringify(tv)).not.toContain(code);
    for (const name of NAMES.slice(0, 6)) {
      const g = (await room.guest(name, "state")).body.view!.game!;
      const has = JSON.stringify(g).includes(code);
      expect(has).toBe(g.panels.includes("comms"));
    }
  });

  it("refuses commands from the wrong panel, malformed ones, and explains rule refusals", async () => {
    const room = await openRoom(4);
    await room.host("start");
    await age(room.sessionId, 5000);
    const cooling = await holder(room, "cooling");
    const other = NAMES.slice(0, 4).find((n) => n !== cooling)!;
    const wrong = await act(room, other === (await holder(room, "breakers")) ? (await holder(room, "doors")) : other, { type: "pump", on: true });
    expect(wrong.body.message).toBe("ليست من صلاحياتك");
    expect((await act(room, cooling, { type: "pump", on: true })).body.message).toBe("لا توجد طاقة للمضخة");
    expect((await room.guest(cooling, "act", { command: { type: "pump", on: "yes" } })).status).toBe(400);
    expect((await room.guest(cooling, "act", { command: { type: "nuke" } })).status).toBe(400);
    expect((await room.guest(cooling, "act", { command: { type: "door", door: "gate", open: false, code: "12ab" } })).status).toBe(400);
    expect((await call(POST, { action: "act", as: "guest", sessionId: room.sessionId, playerToken: "x".repeat(43), command: { type: "pump", on: true } })).status).toBe(401);
  });

  it("wrong codes count as errors and show up in the score; the right one closes the gate", async () => {
    const room = await openRoom(3);
    await room.host("start");
    await age(room.sessionId, 8000);
    const doors = await holder(room, "doors");
    const doc = await docOf(room.sessionId);
    const code = doc.game!.missions[0].params.code;
    const bad = code === "0000" ? "1111" : "0000";
    expect((await act(room, doors, { type: "door", door: "gate", open: false, code: bad })).body.message).toBe("رمز خاطئ");
    expect((await docOf(room.sessionId)).game!.sim.errors).toBe(1);
    const ok = await act(room, doors, { type: "door", door: "gate", open: false, code });
    expect(ok.body.ok).toBe(true);
    expect((await docOf(room.sessionId)).game!.sim.doors.gate).toBe(false);
  });

  it("two commands sent at the same instant are both applied, one after the other", async () => {
    const room = await openRoom(6);
    await room.host("start");
    await age(room.sessionId, 4000);
    const grid = await holder(room, "grid");
    const doors = await holder(room, "valves");
    const [a, b] = await Promise.all([
      act(room, grid, { type: "alloc", sys: "life", value: 30 }),
      act(room, doors, { type: "valve", valve: "A", open: false }),
    ]);
    expect(a.body.ok && b.body.ok).toBe(true);
    const s = (await docOf(room.sessionId)).game!.sim;
    expect(s.power.alloc.life).toBe(30);
    expect(s.valves.A).toBe(false);
    // Conflicting allocations at once: each is checked on the state left by the other.
    const [c, d] = await Promise.all([
      act(room, grid, { type: "alloc", sys: "comms", value: 15 }),
      act(room, grid, { type: "alloc", sys: "comms", value: 20 }),
    ]);
    expect(c.body.ok || d.body.ok).toBe(true);
    expect([15, 20]).toContain((await docOf(room.sessionId)).game!.sim.power.alloc.comms);
  });

  it("one clock for everyone: TV and phones show the same station; a refresh gets it back", async () => {
    const room = await openRoom(4);
    await room.host("start");
    await age(room.sessionId, 30_000);
    const tv = (await room.host("state")).body.view!.game!;
    const cooling = await holder(room, "cooling");
    const phone = (await room.guest(cooling, "state")).body.view!.game!;
    // Both read the same simulation (a second may tick between the two requests).
    expect(Math.abs(Math.round(phone.data.cooling!.temp) - tv.station.reactor.temp)).toBeLessThanOrEqual(1);
    expect(Math.abs(phone.clock.left - tv.clock.left)).toBeLessThanOrEqual(1);
    // "Refresh": the same token, a fresh request — same console, same values.
    const again = (await room.guest(cooling, "state")).body.view!.game!;
    expect(again.panels).toEqual(phone.panels);
    expect(again.data.cooling!.temp).toBe(phone.data.cooling!.temp);
  });

  it("a player who drops out keeps their panels through the grace period, then they move; back by the same name", async () => {
    const room = await openRoom(4);
    await room.host("start");
    const doc = await docOf(room.sessionId);
    const leaver = NAMES[0];
    const id = room.ids[leaver];
    const theirs = PANELS.filter((p) => doc.game!.assignment[p] === id);
    // 20 s of silence: still theirs (grace period).
    doc.game!.seen[id] -= 20_000;
    await writeDoc(room.sessionId, doc);
    let a = (await docOf(room.sessionId)).game!.assignment;
    await room.host("state");
    a = (await docOf(room.sessionId)).game!.assignment;
    expect(theirs.every((p) => a[p] === id)).toBe(true);
    // Past the grace period: redistributed among the others.
    const d2 = await docOf(room.sessionId);
    d2.game!.seen[id] -= 40_000;
    await writeDoc(room.sessionId, d2);
    const tv = (await room.host("state")).body.view!.game!;
    a = (await docOf(room.sessionId)).game!.assignment;
    expect(theirs.every((p) => a[p] !== id)).toBe(true);
    expect(tv.crew.find((c) => c.id === id)!.online).toBe(false);
    // They come back (same device): their panels return.
    const back = (await room.guest(leaver, "state")).body.view!.game!;
    expect(back.panels).toEqual(theirs);
    // Lost phone: the host frees the seat, the panels move at once, the name gets back in.
    await room.host("release", { playerId: id });
    a = (await docOf(room.sessionId)).game!.assignment;
    expect(theirs.every((p) => a[p] !== id)).toBe(true);
    expect((await room.guest(leaver, "state")).status).toBe(401);
    expect((await room.join(leaver)).body.ok).toBe(true);
    expect((await room.guest(leaver, "state")).body.view!.game!.panels).toEqual(theirs);
  });

  it("host: pause stops the station, end shows the results; then a new mission with the same crew, or close", async () => {
    const room = await openRoom(3);
    await room.host("start");
    await age(room.sessionId, 10_000);
    await room.host("host", { move: { type: "pause" } });
    const t = (await docOf(room.sessionId)).game!.sim.t;
    // A minute passes while paused.
    await age(room.sessionId, 60_000);
    await room.host("state");
    expect((await docOf(room.sessionId)).game!.sim.t).toBe(t);
    const cooling = await holder(room, "cooling");
    expect((await act(room, cooling, { type: "pump", on: true })).body.message).toBe("اللعبة متوقفة");
    await room.host("host", { move: { type: "resume" } });
    const ended = (await room.host("host", { move: { type: "end" } })).body.view!.game!;
    expect(ended.outcome).toBe("aborted");
    const lobby = (await room.host("lobby")).body.view!;
    expect(lobby.game).toBeNull();
    expect(lobby.status).toBe("LOBBY");
    expect(lobby.lobby.filter((p) => p.active)).toHaveLength(3);
    expect((await room.host("start")).body.view!.game!.outcome).toBeNull();
    expect((await room.host("close")).body.view!.status).toBe("FINISHED");
    expect((await call(GUEST, { action: "lookup", code: room.code })).body.ok).toBe(false);
  });

  it("a whole easy mission through the API: the crew saves the station, results, score, completion recorded", async () => {
    const room = await openRoom(3);
    await room.host("start");
    for (let i = 0; i < 400; i++) {
      await age(room.sessionId, 3000);
      for (const name of NAMES.slice(0, 3)) {
        const d = await docOf(room.sessionId);
        if (d.game) d.game.seen[room.ids[name]] = Date.now();
        await writeDoc(room.sessionId, d);
      }
      const tv = (await room.host("state")).body.view!;
      if (tv.game!.outcome) break;
      const doc = await docOf(room.sessionId);
      const cmd = nextCommand(doc.game!);
      if (!cmd) continue;
      const who = Object.keys(room.ids).find((n) => room.ids[n] === doc.game!.assignment[panelOf(cmd)])!;
      await act(room, who, cmd);
    }
    const tv = (await room.host("state")).body.view!.game!;
    expect(tv.outcome).toBe("success");
    expect(tv.score!.completed).toBe(3);
    expect(tv.score!.score).toBeGreaterThan(3000);
    const phone = (await room.guest(NAMES[0], "state")).body.view!.game!;
    expect(phone.outcome).toBe("success");
    expect(phone.panels).toEqual([]);
    const row = await pg.query<{ completed_at: string | null }>("select completed_at from public.game_sessions where id = $1", [room.sessionId]);
    expect(row.rows[0].completed_at).not.toBeNull();
    expect(pings).toBeGreaterThan(0);
  });

  it("a mission left alone fails, with the reason on every screen", async () => {
    const room = await openRoom(3);
    await room.host("start");
    const doc = await docOf(room.sessionId);
    for (const id of Object.values(room.ids)) doc.game!.seen[id] = Date.now() + 10 * 60_000;
    await writeDoc(room.sessionId, doc);
    await age(room.sessionId, 300_000);
    const tv = (await room.host("state")).body.view!.game!;
    expect(tv.outcome).toBe("failed");
    expect(tv.reason).toBe("انصهار المفاعل");
    expect(tv.score!.grade).toBe("F");
    expect((await room.guest(NAMES[1], "state")).body.view!.game!.reason).toBe("انصهار المفاعل");
  });
});
