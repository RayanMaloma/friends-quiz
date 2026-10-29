import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migratedDb } from "./helpers/db";
import type { InventDoc } from "@/lib/invent/engine";
import type { InventGuestView, InventHostView } from "@/lib/invent/views";

// The /api/invent endpoint end to end, on the real migrations (in-memory
// Postgres): rooms and joining, host-only actions, what each device may see,
// phones acting at the same instant, scoring once, live timer edits,
// rematch / lobby / close.

let pg: PGlite;

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
vi.mock("@/lib/server/broadcast", () => ({ notifyGame: async () => {} }));
// Room creation is gated by lib/server/access (covered in access.test.ts): signed in as the super admin here.
vi.mock("@/lib/server/access", () => ({
  authorizeCreate: async () => ({ actor: { user: null, privileged: true } }),
  claimSession: async () => {},
}));

const { POST } = await import("@/app/api/invent/route");
const { POST: GUEST } = await import("@/app/api/guest/route");


beforeAll(async () => {
  pg = await migratedDb();
});

type Body<V> = { ok: boolean; error?: string; message?: string; view?: V; sessionId?: string; code?: string; hostToken?: string; playerToken?: string };
type Res<V> = { status: number; body: Body<V> };

async function call<V>(handler: (r: Request) => Promise<Response>, body: Record<string, unknown>): Promise<Res<V>> {
  const res = await handler(new Request("http://test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

const NAMES = ["الدحام", "أبو قاسم", "العمري", "عبدالرحمن الناهض"];

interface Room {
  sessionId: string;
  code: string;
  tokens: Record<string, string>;
  host: (action: string, extra?: Record<string, unknown>) => Promise<Res<InventHostView>>;
  guest: (name: string, action: string, extra?: Record<string, unknown>) => Promise<Res<InventGuestView>>;
  join: (name: string) => Promise<Res<unknown>>;
}

/** The private Ahaji room by default (46 questions); pass `create` for a public room with its own questions. */
async function openRoom(names = NAMES, create: Record<string, unknown> = { questionSet: "ahaji" }): Promise<Room> {
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

async function docOf(sessionId: string): Promise<InventDoc> {
  const r = await pg.query<{ match: InventDoc }>("select match from public.game_sessions where id = $1", [sessionId]);
  return r.rows[0].match;
}

/** Moves the stored clock back so the current phase has run for `ms` longer. */
async function age(sessionId: string, ms: number) {
  const doc = await docOf(sessionId);
  const g = doc.game!;
  if (g.clock.runningSince !== null) g.clock.runningSince -= ms;
  g.phaseStartedAt -= ms;
  await pg.query("update public.game_sessions set match = $2 where id = $1", [sessionId, JSON.stringify(doc)]);
}

describe("/api/invent", () => {
  it("routes lookups to the right join screen", async () => {
    const room = await openRoom([]);
    const look = await call<never>(GUEST, { action: "lookup", code: room.code });
    expect(look.body).toMatchObject({ ok: true, kind: "invent", canJoin: true });
    // The quiz endpoints hand the device over to this game.
    const state = await call<never>(GUEST, { action: "state", sessionId: room.sessionId, playerToken: "x".repeat(24) });
    expect(state.body.error).toBe("INVENT_SESSION");
  });

  it("lobby: defaults, settings, removal, minimum players, duplicate names", async () => {
    const room = await openRoom(["أ", "ب"]);
    let h = await room.host("state");
    expect(h.body.view!.settings).toEqual({ rounds: 36, answerSeconds: 60, voteSeconds: 30 });
    expect((await room.join("أ")).body.error).toBe("NAME_TAKEN");

    h = await room.host("settings", { rounds: 5, answerSeconds: 24, voteSeconds: 15 });
    expect(h.body.view!.settings).toEqual({ rounds: 5, answerSeconds: 24, voteSeconds: 15 });
    expect((await room.host("settings", { rounds: 47 })).status).toBe(400);

    const start = await room.host("start");
    expect(start.body).toMatchObject({ ok: false, error: "RULE" });
    await room.join("ج");
    await room.join("د");
    const d = h.body.view!.lobby.find((p) => p.name === "أ") ?? (await room.host("state")).body.view!.lobby[0];
    h = await room.host("release", { playerId: d.id });
    expect(h.body.view!.lobby.map((p) => p.name)).toEqual(["ب", "ج", "د"]);

    h = await room.host("start");
    expect(h.body.view!.status).toBe("PLAYING");
    expect(h.body.view!.game!.totalRounds).toBe(5);
    // Joining closes when the game starts.
    expect((await room.join("متأخر")).body.error).toBe("GAME_ALREADY_STARTED");
    // A second start changes nothing.
    const again = await room.host("start");
    expect(again.body.view!.game!.matchId).toBe(h.body.view!.game!.matchId);
  });

  it("only the host can control the room", async () => {
    const room = await openRoom();
    const bad = await call<never>(POST, { action: "start", as: "host", sessionId: room.sessionId, hostToken: "y".repeat(32) });
    expect(bad.status).toBe(403);
    // A player token sent as a host is refused too.
    const asHost = await call<never>(POST, { action: "host", as: "host", sessionId: room.sessionId, hostToken: room.tokens["الدحام"], move: { type: "end" } });
    expect(asHost.status).toBe(403);
    // Players have no host actions.
    expect((await room.guest("الدحام", "start")).status).toBe(400);
    expect((await room.guest("الدحام", "settings", { rounds: 1 })).status).toBe(400);
  });

  it("plays a round: hidden answers, anonymous cards, one stable order, scoring once", async () => {
    const room = await openRoom();
    await room.host("settings", { rounds: 2 });
    await room.host("start");
        let h = await room.host("state");
    expect(h.body.view!.game!.phase).toBe("answering");

    // Answers stay hidden: a phone sees only its own, the host only counts.
    const texts: Record<string, string> = { الدحام: "قال الفاتورة تحتاج تحديث ويندوز", "أبو قاسم": "النت فاصل", العمري: "القطوة مشت على الكيبورد" };
    for (const [name, text] of Object.entries(texts)) {
      const r = await room.guest(name, "act", { move: { type: "answer", round: 0, text } });
      expect(r.body.view!.myAnswer).toBe(text);
    }
    const peek = await room.guest("العمري", "state");
    expect(JSON.stringify(peek.body.view)).not.toContain(texts["الدحام"]);
    h = await room.host("state");
    expect(h.body.view!.game!.answeredCount).toBe(3);
    expect(JSON.stringify(h.body.view)).not.toContain(texts["الدحام"]);
    // Duplicate and different second answers.
    expect((await room.guest("الدحام", "act", { move: { type: "answer", round: 0, text: texts["الدحام"] } })).body.ok).toBe(true);
    expect((await room.guest("الدحام", "act", { move: { type: "answer", round: 0, text: "ثاني" } })).body.error).toBe("IV_ANSWERED");

    // Last answer at the same instant from two tabs of the same player: stored once.
    const both = await Promise.all([
      room.guest("عبدالرحمن الناهض", "act", { move: { type: "answer", round: 0, text: "بنى المحل ليقو" } }),
      room.guest("عبدالرحمن الناهض", "act", { move: { type: "answer", round: 0, text: "بنى المحل ليقو" } }),
    ]);
    expect(both.every((r) => r.body.ok)).toBe(true);
    expect((await docOf(room.sessionId)).game!.round.answers).toHaveLength(4);

    // Everyone answered → voting, cards anonymous, same order for everyone.
    h = await room.host("state");
    const g = h.body.view!.game!;
    expect(g.phase).toBe("voting");
    expect(g.cards!.every((c) => c.author === null && c.votes === null && c.points === null)).toBe(true);
    const views = await Promise.all(NAMES.map((n) => room.guest(n, "state")));
    for (const v of views) {
      expect(v.body.view!.game!.cards!.map((c) => c.id)).toEqual(g.cards!.map((c) => c.id));
      expect(v.body.view!.game!.cards!.filter((c) => c.mine)).toHaveLength(1);
      expect(JSON.stringify(v.body.view)).not.toMatch(/authorId|"author":\{/);
    }
    const doc = await docOf(room.sessionId);
    const idOf = (name: string) => doc.game!.round.answers.find((a) => a.authorId === views[NAMES.indexOf(name)].body.view!.me.playerId)!.id;

    // Self vote refused; four phones vote at the same instant.
    expect((await room.guest("الدحام", "act", { move: { type: "vote", round: 0, answerId: idOf("الدحام") } })).body.error).toBe("IV_OWN_ANSWER");
    const votes: [string, string][] = [["أبو قاسم", "الدحام"], ["العمري", "الدحام"], ["عبدالرحمن الناهض", "الدحام"], ["الدحام", "أبو قاسم"]];
    const results = await Promise.all(votes.map(([voter, author]) => room.guest(voter, "act", { move: { type: "vote", round: 0, answerId: idOf(author) } })));
    expect(results.map((r) => r.body.error ?? "ok")).toEqual(["ok", "ok", "ok", "ok"]);

    // Reveal: authors, votes and points on the same cards, same order.
    h = await room.host("state");
    const rev = h.body.view!.game!;
    expect(rev.phase).toBe("reveal");
    expect(rev.cards!.map((c) => c.id)).toEqual(g.cards!.map((c) => c.id));
    const top = rev.cards!.find((c) => c.id === idOf("الدحام"))!;
    expect(top).toMatchObject({ author: { name: "الدحام" }, votes: 3, points: 300 });
    expect(rev.cards!.find((c) => c.id === idOf("أبو قاسم"))).toMatchObject({ votes: 1, points: 100 });
    const scores = Object.fromEntries(rev.standings.map((r) => [r.name, r.score]));
    expect(scores).toEqual({ الدحام: 300, "أبو قاسم": 100, العمري: 0, "عبدالرحمن الناهض": 0 });

    // Refreshes and late votes never change the score.
    for (let i = 0; i < 3; i++) await room.host("state");
    expect((await room.guest("العمري", "act", { move: { type: "vote", round: 0, answerId: idOf("أبو قاسم") } })).body.error).toBe("IV_VOTED");
    expect((await room.guest("العمري", "act", { move: { type: "answer", round: 0, text: "متأخر جدًا" } })).body.error).toBe("IV_ANSWERED");
    const total = Object.values((await docOf(room.sessionId)).game!.scores).reduce((a, b) => a + b, 0);
    expect(total).toBe(400);
  });

  it("host timer edits apply to the running phase and reach every device", async () => {
    const room = await openRoom();
    await room.host("start");
    await age(room.sessionId, 10000); // 10s into answering
    let h = await room.host("host", { move: { type: "timers", answerSeconds: 24 } });
    const remaining = h.body.view!.game!.timer!.remainingMs;
    expect(remaining).toBeGreaterThan(13000);
    expect(remaining).toBeLessThanOrEqual(14000);
    const phone = await room.guest("العمري", "state");
    expect(phone.body.view!.settings.answerSeconds).toBe(24);
    expect(phone.body.view!.game!.timer!.remainingMs).toBeLessThanOrEqual(14000);

    // Pause: frozen for everyone; edits while paused; then resume.
    h = await room.host("host", { move: { type: "pause" } });
    expect(h.body.view!.game!.paused).toBe(true);
    expect(h.body.view!.game!.timer!.deadline).toBeNull();
    h = await room.host("host", { move: { type: "timers", answerSeconds: 5 } });
    // 5s is below the 10s already played: closes as soon as the clock runs again.
    expect(h.body.view!.game!.phase).toBe("answering");
    h = await room.host("host", { move: { type: "resume" } });
    expect(h.body.view!.game!.phase).not.toBe("answering");
    expect(h.body.view!.game!.roundIndex).toBe(0);
  });

  it("end early, rematch with fresh scores, back to the lobby, close", async () => {
    const room = await openRoom();
    await room.host("start");
    await room.guest("الدحام", "act", { move: { type: "answer", round: 0, text: "جواب" } });
    let h = await room.host("host", { move: { type: "end" } });
    expect(h.body.view!.game!.phase).toBe("final");
    expect((await room.guest("العمري", "act", { move: { type: "answer", round: 0, text: "x" } })).body.error).toBe("IV_CLOSED");
    const first = h.body.view!.game!.matchId;

    h = await room.host("rematch");
    expect(h.body.view!.game!.matchId).not.toBe(first);
    expect(h.body.view!.game!.phase).toBe("answering");
    expect(h.body.view!.game!.standings.every((s) => s.score === 0)).toBe(true);
    // Rematch only from the final results.
    expect((await room.host("rematch")).body.view!.game!.matchId).toBe(h.body.view!.game!.matchId);

    h = await room.host("lobby");
    expect(h.body.view!.status).toBe("LOBBY");
    expect(h.body.view!.game).toBeNull();
    expect((await room.join("جديد")).body.ok).toBe(true);

    h = await room.host("close");
    expect(h.body.view!.status).toBe("FINISHED");
    expect((await call<never>(GUEST, { action: "lookup", code: room.code })).body.error).toBe("GAME_NOT_FOUND");
  });

  it("a returning device keeps its identity; a freed seat can be reclaimed by name", async () => {
    const room = await openRoom();
    await room.host("start");
    await room.guest("العمري", "act", { move: { type: "answer", round: 0, text: "رجعت" } });
    const again = await room.guest("العمري", "state");
    expect(again.body.view!.myAnswer).toBe("رجعت");
    const id = again.body.view!.me.playerId;

    await room.host("release", { playerId: id });
    expect((await room.guest("العمري", "state")).status).toBe(401);
    expect((await room.join("العمري")).body.ok).toBe(true);
    const back = await room.guest("العمري", "state");
    expect(back.body.view!.me.playerId).toBe(id);
    expect(back.body.view!.myAnswer).toBe("رجعت");
    expect(back.body.view!.seated).toBe(true);
  });
});

describe("/api/invent public rooms (the host's own questions)", () => {
  const QS = ["وش أغرب أكلة جربتها؟", "لو صرت مدير يوم واحد وش أول قرار؟", "وش أسوأ هدية جاتك؟"];

  it("refuses a room without questions, or a match longer than its questions", async () => {
    expect((await call<never>(POST, { action: "create" })).body.error).toBe("IV_QUESTIONS");
    expect((await call<never>(POST, { action: "create", questions: ["", "   "] })).body.error).toBe("IV_QUESTIONS");
    expect((await call<never>(POST, { action: "create", questions: ["x".repeat(201)] })).body.error).toBe("IV_QUESTIONS");
    expect((await call<never>(POST, { action: "create", questions: QS, rounds: 4 })).body.error).toBe("IV_ROUNDS");
  });

  it("stores the questions with the room and plays only those (never the Ahaji set)", async () => {
    const room = await openRoom(["أ", "ب", "ج"], { questions: [...QS, ` ${QS[0]} `, ""], rounds: 3, answerSeconds: 20 });
    let h = await room.host("state");
    expect(h.body.view!.limits.questions).toBe(3);
    expect(h.body.view!.settings).toEqual({ rounds: 3, answerSeconds: 20, voteSeconds: 30 });
    expect((await room.host("settings", { rounds: 4 })).status).toBe(400);

    const row = await pg.query<{ config: { questionSet: string; questions: { text: string }[] }; game_key: string }>(
      "select config, game_key from public.game_sessions where id = $1",
      [room.sessionId],
    );
    expect(row.rows[0].game_key).toBe("invent");
    expect(row.rows[0].config.questionSet).toBe("custom");
    expect(row.rows[0].config.questions.map((q) => q.text)).toEqual(QS);

    h = await room.host("start");
    const shown = h.body.view!.game!.question.text;
    expect(QS).toContain(shown);
    expect((await room.guest("أ", "state")).body.view!.game!.question.text).toBe(shown);
    expect((await docOf(room.sessionId)).game!.questions!.map((q) => q.text).sort()).toEqual([...QS].sort());
  });

  it("an Ahaji room is filed under the private catalog entry", async () => {
    const room = await openRoom([]);
    const row = await pg.query<{ game_key: string }>("select game_key from public.game_sessions where id = $1", [room.sessionId]);
    expect(row.rows[0].game_key).toBe("invent_ahaji");
  });
});
