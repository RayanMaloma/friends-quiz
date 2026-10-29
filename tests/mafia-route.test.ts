import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migratedDb } from "./helpers/db";
import type { MafiaMatch } from "@/lib/mafia/types";
import type { MafiaGuestView, MafiaHostView } from "@/lib/mafia/views";

// The /api/mafia endpoint end to end, on the real migrations (in-memory
// Postgres): host-only actions, the rematch without the lobby, and phones
// acting at the same moment.

let pg: PGlite;
const notified: string[] = [];

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
vi.mock("@/lib/server/broadcast", () => ({ notifyGame: async (id: string) => void notified.push(id) }));
// Room creation is gated by lib/server/access (covered in access.test.ts): signed in as the super admin here.
vi.mock("@/lib/server/access", () => ({
  authorizeCreate: async () => ({ actor: { user: null, privileged: true } }),
  claimSession: async () => {},
}));

const { POST } = await import("@/app/api/mafia/route");
const { hashToken } = await import("@/lib/server/tokens");


beforeAll(async () => {
  pg = await migratedDb();
});

type Res<V> = { status: number; body: { ok: boolean; error?: string; view?: V; sessionId?: string; code?: string; hostToken?: string } };

async function post<V = MafiaHostView>(body: Record<string, unknown>): Promise<Res<V>> {
  const res = await POST(new Request("http://test/api/mafia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

const NAMES = ["نورة", "فهد", "سارة", "خالد", "ريم", "ماجد"];

interface Room {
  sessionId: string;
  hostToken: string;
  tokens: Record<string, string>; // name → player token
  host: (action: string, extra?: Record<string, unknown>) => Promise<Res<MafiaHostView>>;
  guest: (name: string, action: string, extra?: Record<string, unknown>) => Promise<Res<MafiaGuestView>>;
}

async function openRoom(): Promise<Room> {
  const created = await post({ action: "create" });
  const { sessionId, code, hostToken } = created.body as { sessionId: string; code: string; hostToken: string };
  const tokens: Record<string, string> = {};
  for (const name of NAMES) {
    const token = `token-${name}-${sessionId}`.padEnd(24, "x");
    tokens[name] = token;
    await pg.query("select public.fq_join_game(p_code => $1, p_display_name => $2, p_person_id => null, p_token_hash => $3)", [code, name, hashToken(token)]);
  }
  return {
    sessionId,
    hostToken,
    tokens,
    host: (action, extra = {}) => post({ action, as: "host", sessionId, hostToken, ...extra }),
    guest: (name, action, extra = {}) => post<MafiaGuestView>({ action, as: "guest", sessionId, playerToken: tokens[name], ...extra }),
  };
}

async function matchOf(sessionId: string): Promise<{ match: MafiaMatch; version: number; players: number }> {
  const r = await pg.query<{ match: MafiaMatch; match_version: number }>("select match, match_version from public.game_sessions where id = $1", [sessionId]);
  const n = await pg.query<{ n: number }>("select count(*)::int as n from public.game_players where session_id = $1", [sessionId]);
  return { match: r.rows[0].match, version: r.rows[0].match_version, players: n.rows[0].n };
}

/** Puts the room's match into a given state (as if the clock had run there). */
async function setMatch(sessionId: string, patch: (m: MafiaMatch, now: number) => MafiaMatch) {
  const { match, version } = await matchOf(sessionId);
  const now = Date.now();
  const res = await pg.query<{ result: { ok: boolean } }>(
    "select public.fq_mafia_save_match(p_session_id => $1, p_expected_version => $2, p_match => $3, p_status => 'PLAYING') as result",
    [sessionId, version, JSON.stringify(patch(match, now))],
  );
  expect(res.rows[0].result.ok).toBe(true);
}

beforeEach(() => {
  notified.length = 0;
});

describe("/api/mafia", () => {
  it("rematch: same room and players, new roles, straight into the intro — no lobby, no double start", async () => {
    const room = await openRoom();
    expect((await room.host("start")).body.ok).toBe(true);
    const first = await matchOf(room.sessionId);

    // Not before the match is over.
    await room.host("rematch");
    expect((await matchOf(room.sessionId)).match.phaseStartedAt).toBe(first.match.phaseStartedAt);

    // The match ends (with some history to clear).
    await setMatch(room.sessionId, (m) => ({
      ...m,
      phase: "gameOver",
      deadline: null,
      round: 3,
      players: m.players.map((p, i) => (i < 2 ? { ...p, alive: false, out: { round: 1, by: "night" as const } } : p)),
      doctorHistory: [m.players[0].id],
      investigations: [{ round: 1, targetId: m.players[1].id, role: m.players[1].role }],
      votes: { [m.players[2].id]: "skip" },
      winner: { team: "citizens", reason: "x" },
      timeline: [{ round: 1, kind: "night", outcome: "killed", playerId: m.players[0].id }],
    }));
    const ended = await matchOf(room.sessionId);

    // Two clicks at once: one new match.
    const [a, b] = await Promise.all([room.host("rematch"), room.host("rematch")]);
    expect(a.body.ok && b.body.ok).toBe(true);
    const next = await matchOf(room.sessionId);
    expect(next.version).toBe(ended.version + 1);
    expect(next.players).toBe(NAMES.length);
    expect(next.match).toMatchObject({
      phase: "intro",
      round: 1,
      deadline: next.match.phaseStartedAt + 10_000,
      doctorHistory: [],
      investigations: [],
      votes: {},
      winner: null,
      timeline: [],
      roleSeen: [],
      dawn: null,
      verdict: null,
    });
    expect(next.match.players.map((p) => p.id).sort()).toEqual(first.match.players.map((p) => p.id).sort());
    expect(next.match.players.every((p) => p.alive && p.out === null)).toBe(true);

    // The TV and every phone are in the new match (not the lobby); phones get no role during the intro.
    const tv = await room.host("state");
    expect(tv.body.view!.status).toBe("PLAYING");
    expect(tv.body.view!.match!.phase).toBe("intro");
    for (const name of NAMES) {
      const v = (await room.guest(name, "state")).body.view!;
      expect(v.seated).toBe(true);
      expect(v.match!.phase).toBe("intro");
      expect(v.secret).toBeNull();
    }
    expect(notified).toContain(room.sessionId);

    // A third click while the intro runs changes nothing.
    await room.host("rematch");
    expect((await matchOf(room.sessionId)).version).toBe(next.version);
  });

  it("rematch deals fresh roles (not the same table every time)", async () => {
    const room = await openRoom();
    await room.host("start");
    const deals = new Set<string>();
    for (let i = 0; i < 8; i++) {
      await setMatch(room.sessionId, (m) => ({ ...m, phase: "gameOver", deadline: null }));
      await room.host("rematch");
      const { match } = await matchOf(room.sessionId);
      deals.add(match.players.map((p) => `${p.id}:${p.role}`).sort().join(","));
    }
    expect(deals.size).toBeGreaterThan(1);
  });

  it("only the host can rematch or skip the discussion", async () => {
    const room = await openRoom();
    await room.host("start");
    await setMatch(room.sessionId, (m, now) => ({ ...m, phase: "discussion", phaseStartedAt: now, deadline: now + 90_000 }));
    const before = await matchOf(room.sessionId);
    for (const extra of [{ action: "rematch" }, { action: "host", move: { type: "skipDiscussion" } }]) {
      // A phone pretending to be the host has no host token.
      const asPhone = await post({ ...extra, as: "host", sessionId: room.sessionId, hostToken: room.tokens[NAMES[0]] });
      expect(asPhone.status).toBe(403);
      const asGuest = await room.guest(NAMES[0], extra.action, extra);
      expect(asGuest.body.ok).toBe(false);
    }
    expect((await matchOf(room.sessionId)).version).toBe(before.version);
  });

  it("«سكّب النقاش!» moves everyone to the vote once, with a full 30-second timer", async () => {
    const room = await openRoom();
    await room.host("start");
    await setMatch(room.sessionId, (m, now) => ({ ...m, phase: "discussion", phaseStartedAt: now, deadline: now + 90_000 }));
    const before = await matchOf(room.sessionId);
    const [a, b] = await Promise.all([room.host("host", { move: { type: "skipDiscussion" } }), room.host("host", { move: { type: "skipDiscussion" } })]);
    expect(a.body.ok && b.body.ok).toBe(true);
    const after = await matchOf(room.sessionId);
    expect(after.version).toBe(before.version + 1);
    expect(after.match.phase).toBe("voting");
    expect(after.match.deadline! - after.match.phaseStartedAt).toBe(30_000);
    const phone = (await room.guest(NAMES[1], "state")).body.view!;
    expect(phone.match!.phase).toBe("voting");
    expect(phone.secret!.task!.kind).toBe("vote");
  });

  it("two mafia phones submitting at the same moment: both count, the phase changes exactly once", async () => {
    const room = await openRoom();
    await room.host("start");
    // Fix the table: two mafia, then detective, doctor, citizens.
    await setMatch(room.sessionId, (m, now) => ({
      ...m,
      phase: "mafia",
      phaseStartedAt: now,
      deadline: now + 30_000,
      players: m.players.map((p, i) => ({ ...p, role: (["mafia", "mafia", "detective", "doctor", "citizen", "citizen"] as const)[i] })),
    }));
    const { match, version } = await matchOf(room.sessionId);
    const name = (i: number) => match.players[i].name;
    const target = match.players[4].id;
    const round = match.round;

    const [a, b] = await Promise.all([
      room.guest(name(0), "act", { move: { type: "night", phase: "mafia", round, targetId: target } }),
      room.guest(name(1), "act", { move: { type: "night", phase: "mafia", round, targetId: "skip" } }),
    ]);
    expect(a.body.ok).toBe(true);
    expect(b.body.ok).toBe(true);
    const after = await matchOf(room.sessionId);
    expect(after.match.phase).toBe("detective");
    expect(after.version).toBe(version + 2); // two saves: the first vote, then the second (which closed the phase)
    expect(after.match.night.mafiaVotes).toEqual({ [match.players[0].id]: target, [match.players[1].id]: "skip" });

    // A late repeat after the phase moved on is refused, and nothing changes.
    const late = await room.guest(name(0), "act", { move: { type: "night", phase: "mafia", round, targetId: target } });
    expect(late.body).toMatchObject({ ok: false, error: "MF_CLOSED" });
    expect((await matchOf(room.sessionId)).version).toBe(after.version);

    // The detective acts: straight to the doctor, and the finding stays on the detective's phone.
    const det = await room.guest(name(2), "act", { move: { type: "night", phase: "detective", round, targetId: match.players[0].id } });
    expect(det.body.view!.match!.phase).toBe("doctor");
    expect(det.body.view!.secret!.investigations).toEqual([{ round, targetId: match.players[0].id, name: name(0), role: "mafia" }]);

    // The doctor skips: the night ends, and nobody sees the victim before the reveal.
    const doc = await room.guest(name(3), "act", { move: { type: "night", phase: "doctor", round, targetId: "skip" } });
    expect(doc.body.view!.match!.phase).toBe("dawn");
    const tv = (await room.host("state")).body.view!;
    expect(tv.match!.dawn).toBeNull();
    expect(tv.match!.players.every((p) => p.alive)).toBe(true);
    const victimPhone = (await room.guest(name(4), "state")).body.view!;
    expect(victimPhone.secret!.alive).toBe(true);
    expect((await matchOf(room.sessionId)).match.players[4].alive).toBe(false); // resolved on the server
  });
});
