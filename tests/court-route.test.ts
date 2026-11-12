import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migratedDb } from "./helpers/db";
import { CASES } from "@/lib/court/cases";
import { fill, type CourtGuestView, type CourtHostView } from "@/lib/court/views";
import type { CourtDoc } from "@/lib/court/engine";

// The /api/court endpoint end to end, on the real migrations (in-memory
// Postgres): rooms and joining, roles and what each phone may see, every
// phase, exhibits and the objection, jurors voting at once, scoring, a key
// role going away, reconnecting (same device, or a new one after the host
// frees the seat), forged requests, next case / final / rematch / close,
// and that the other games' endpoints hand court rooms over.

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

const { POST } = await import("@/app/api/court/route");
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

const FIVE = ["راشد", "فهد", "سلطان", "نايف", "عبدالله"];
const TWELVE = [...FIVE, "خالد", "ماجد", "تركي", "بدر", "سعود", "مشعل", "يزيد"];

interface Room {
  sessionId: string;
  code: string;
  hostToken: string;
  tokens: Record<string, string>;
  host: (action: string, extra?: Record<string, unknown>) => Promise<Res<CourtHostView>>;
  guest: (name: string, action?: string, extra?: Record<string, unknown>) => Promise<Res<CourtGuestView>>;
  join: (name: string) => Promise<Res<unknown>>;
  /** Every phone checks in (keeps everyone present). */
  everyone: () => Promise<void>;
  nameOf: (id: string) => string;
  ids: Record<string, string>;
}

async function openRoom(names = FIVE, create: Record<string, unknown> = {}): Promise<Room> {
  const created = await call<never>(POST, { action: "create", ...create });
  expect(created.body.ok).toBe(true);
  const { sessionId, code, hostToken } = created.body as { sessionId: string; code: string; hostToken: string };
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const room: Room = {
    sessionId,
    code,
    hostToken,
    tokens,
    ids,
    host: (action, extra = {}) => call(POST, { action, as: "host", sessionId, hostToken, ...extra }),
    guest: (name, action = "state", extra = {}) => call(POST, { action, as: "guest", sessionId, playerToken: tokens[name], ...extra }),
    join: async (name) => {
      const res = await call<unknown>(GUEST, { action: "join", code, name, personId: null });
      if (res.body.ok) tokens[name] = res.body.playerToken!;
      return res;
    },
    everyone: async () => {
      for (const n of Object.keys(tokens)) await room.guest(n);
    },
    nameOf: (id) => Object.keys(ids).find((n) => ids[n] === id)!,
  };
  for (const n of names) {
    expect((await room.join(n)).body.ok).toBe(true);
    const v = await room.guest(n);
    ids[n] = v.body.view!.me.playerId;
  }
  return room;
}

async function docOf(sessionId: string): Promise<CourtDoc> {
  const r = await pg.query<{ match: CourtDoc }>("select match from public.game_sessions where id = $1", [sessionId]);
  return r.rows[0].match;
}

/** Moves the stored clock back so the current phase has run for `ms` longer. */
async function age(sessionId: string, ms: number) {
  const doc = await docOf(sessionId);
  doc.game!.phaseStartedAt -= ms;
  if (doc.game!.pausedAt !== null) doc.game!.pausedAt -= ms;
  await pg.query("update public.game_sessions set match = $2 where id = $1", [sessionId, JSON.stringify(doc)]);
}

/** Lets the current phase run out, then every phone checks in. */
async function expire(room: Room) {
  const g = (await docOf(room.sessionId)).game!;
  await age(room.sessionId, (g.phaseMs ?? 0) + 10);
  await room.everyone();
}

async function phase(room: Room) {
  return (await room.host("state")).body.view!.game!.phase;
}

/** Marks a player's phone as not seen for a minute. */
async function goAway(room: Room, name: string) {
  await pg.query("update public.fq_player_presence set seen_at = now() - interval '1 minute' where player_id = $1", [room.ids[name]]);
}

async function rolesOf(room: Room) {
  const g = (await docOf(room.sessionId)).game!;
  const c = g.case;
  return { c, accused: room.nameOf(c.accused), lawyer: room.nameOf(c.lawyer), prosecutor: room.nameOf(c.prosecutor), jurors: c.jurors.map(room.nameOf) };
}

async function startedRoom(names = FIVE, cases = 2) {
  const room = await openRoom(names);
  expect((await room.host("settings", { cases })).body.ok).toBe(true);
  const res = await room.host("start");
  expect(res.body.ok).toBe(true);
  expect(res.body.view!.game!.phase).toBe("announce");
  return room;
}

describe("rooms and lobby", () => {
  it("creates a court room; /join's lookup routes phones to it; other endpoints hand it over", async () => {
    const room = await openRoom(["أ"]);
    const look = await call<never>(GUEST, { action: "lookup", code: room.code });
    expect(look.body.kind).toBe("court");
    expect((await call(GUEST, { action: "state", sessionId: room.sessionId, playerToken: room.tokens["أ"] })).body.error).toBe("COURT_SESSION");
    expect((await call(HOST, { action: "state", sessionId: room.sessionId, hostToken: room.hostToken })).body.error).toBe("COURT_SESSION");
    const r = await pg.query<{ game_key: string; kind: string }>("select game_key, kind from public.game_sessions where id = $1", [room.sessionId]);
    expect(r.rows[0]).toEqual({ game_key: "court", kind: "court" });
  });

  it("shows names live, sets the number of cases, and needs five players to start", async () => {
    const room = await openRoom(FIVE.slice(0, 4));
    const lobby = (await room.host("state")).body.view!;
    expect(lobby.lobby.map((p) => p.name)).toEqual(FIVE.slice(0, 4));
    expect(lobby.lobby.every((p) => p.here)).toBe(true);
    expect(lobby.settings.cases).toBe(3);
    expect((await room.host("settings", { cases: 9 })).body.error).toBe("BAD_REQUEST");
    expect((await room.host("settings", { cases: 4 })).body.view!.settings.cases).toBe(4);
    const early = await room.host("start");
    expect(early.body.error).toBe("RULE");
    expect(early.body.message).toMatch(/5/);
    await room.join(FIVE[4]);
    expect((await room.host("start")).body.view!.game!.totalCases).toBe(4);
    // A second click changes nothing.
    const again = await room.host("start");
    expect(again.body.view!.game!.caseIndex).toBe(0);
    expect((await room.host("settings", { cases: 2 })).body.error).toBe("GAME_ALREADY_STARTED");
  });

  it("a wrong host token or a missing player is refused", async () => {
    const room = await openRoom(["أ"]);
    expect((await call(POST, { action: "state", as: "host", sessionId: room.sessionId, hostToken: "x".repeat(32) })).status).toBe(403);
    expect((await call(POST, { action: "state", as: "guest", sessionId: room.sessionId, playerToken: "y".repeat(32) })).status).toBe(401);
    // A phone can't send host actions by claiming to be the host with its own token.
    expect((await call(POST, { action: "start", as: "host", sessionId: room.sessionId, hostToken: room.tokens["أ"] })).status).toBe(403);
  });
});

describe("a full case, five players", () => {
  it("roles, secrets, phases, exhibits, objection, vote, verdict, points, next case, final", async () => {
    const room = await startedRoom(FIVE, 2);
    const { c, accused, lawyer, prosecutor, jurors } = await rolesOf(room);
    const data = CASES.find((x) => x.id === c.caseId)!;
    const f = (t: string) => fill(t, accused);

    // Every phone knows its own role, and only its own secret.
    const views = Object.fromEntries(await Promise.all(FIVE.map(async (n) => [n, (await room.guest(n)).body.view!] as const)));
    expect(views[accused].myRole).toBe("accused");
    expect(views[accused].secret).toEqual({ role: "accused", guilty: data.guilty, text: f(data.accusedSecret) });
    expect(views[lawyer].secret).toMatchObject({ role: "lawyer", text: f(data.lawyerInfo) });
    expect(views[prosecutor].secret).toMatchObject({ role: "prosecutor", text: f(data.prosecutorInfo) });
    for (const j of jurors) {
      expect(views[j].myRole).toBe("juror");
      expect(views[j].secret).toBeNull();
    }
    // The TV: case, names of the roles, no secret.
    const tv = (await room.host("state")).body.view!;
    expect(tv.game!.summary).toBe(f(data.summary));
    expect(tv.game!.roles.accused.name).toBe(accused);
    const tvJson = JSON.stringify(tv);
    for (const s of [data.accusedSecret, data.lawyerInfo, data.prosecutorInfo, data.explanation].map(f)) expect(tvJson).not.toContain(s);

    // Moving on by the clock.
    for (const p of ["opening_p", "opening_l", "evidence"]) {
      await expire(room);
      expect(await phase(room)).toBe(p);
    }

    // Exhibits: the prosecutor only, once each.
    expect((await room.guest(jurors[0], "act", { move: { type: "present", case: 0, exhibit: 0 } })).body.error).toBe("CT_NOT_ALLOWED");
    expect((await room.guest(lawyer, "act", { move: { type: "present", case: 0, exhibit: 0 } })).body.error).toBe("CT_NOT_ALLOWED");
    const held = data.evidence.findIndex((e) => e.challenge !== null);
    const shown = await room.guest(prosecutor, "act", { move: { type: "present", case: 0, exhibit: held } });
    expect(shown.body.ok).toBe(true);
    expect((await room.guest(prosecutor, "act", { move: { type: "present", case: 0, exhibit: held } })).body.error).toBe("CT_DUPLICATE");
    expect((await room.host("state")).body.view!.game!.evidence).toEqual([{ index: held, text: f(data.evidence[held].text) }]);

    // The objection: once, pauses the evidence, outcome after 15 s.
    expect((await room.guest(jurors[0], "act", { move: { type: "object", case: 0, exhibit: held } })).body.error).toBe("CT_NOT_ALLOWED");
    const obj = await room.guest(lawyer, "act", { move: { type: "object", case: 0, exhibit: held } });
    expect(obj.body.view!.game!.phase).toBe("objection");
    expect(obj.body.view!.game!.objection!.outcome).toBeNull();
    await expire(room);
    const after = (await room.host("state")).body.view!.game!;
    expect(after.phase).toBe("evidence");
    expect(after.objection!.outcome).toEqual({ upheld: true, note: f(data.evidence[held].challenge!) });
    expect((await room.guest(lawyer, "act", { move: { type: "object", case: 0, exhibit: held } })).body.error).toBe("CT_OBJECTED");

    for (const p of ["cross_p", "cross_l", "closing_p", "closing_l", "vote"]) {
      await expire(room);
      expect(await phase(room)).toBe(p);
    }

    // Jurors vote at the same instant: none is lost; the TV sees counts only.
    expect((await room.guest(accused, "act", { move: { type: "vote", case: 0, vote: "innocent" } })).body.error).toBe("CT_NOT_JUROR");
    const right = data.guilty ? "guilty" : "innocent";
    const wrong = data.guilty ? "innocent" : "guilty";
    const mid = await room.guest(jurors[0], "act", { move: { type: "vote", case: 0, vote: right } });
    expect(mid.body.view!.game!.votes).toEqual({ cast: 1, total: 2 });
    expect(mid.body.view!.myVote).toBe(right);
    expect((await room.guest(jurors[0], "act", { move: { type: "vote", case: 0, vote: wrong } })).body.error).toBe("CT_VOTED");
    const last = await room.guest(jurors[1], "act", { move: { type: "vote", case: 0, vote: right } });
    // Everyone voted: straight to the verdict.
    expect(last.body.view!.game!.phase).toBe("verdict");
    const v = (await room.host("state")).body.view!.game!.verdict!;
    expect(v.guilty).toBe(data.guilty);
    expect(v.truth).toBe(data.guilty);
    expect(v.explanation).toBe(f(data.explanation));
    expect(v.exhibits.map((e) => e.kind)).toEqual(data.evidence.map((e) => e.kind));
    const pts = Object.fromEntries(v.gained.map((g) => [g.name, g.points]));
    expect(pts[accused]).toBe(0);
    expect(pts[prosecutor]).toBe(data.guilty ? 150 : 0);
    expect(pts[lawyer]).toBe(data.guilty ? 0 : 150);
    for (const j of jurors) expect(pts[j]).toBe(100);

    // Verdict → standings → next case (new roles) → … → final.
    const v1 = (await room.host("host", { move: { type: "next", phase: "verdict", case: 0 } })).body.view!.game!;
    expect(v1.phase).toBe("standings");
    expect(v1.standings[0].score).toBeGreaterThan(0);
    const c2 = (await room.host("host", { move: { type: "next", phase: "standings", case: 0 } })).body.view!.game!;
    expect(c2.phase).toBe("announce");
    expect(c2.caseNumber).toBe(2);
    const second = await rolesOf(room);
    expect(second.c.caseId).not.toBe(c.caseId);
    expect(second.accused).not.toBe(accused);
    // A stale "next" from the old screen does nothing.
    expect((await room.host("host", { move: { type: "next", phase: "standings", case: 0 } })).body.view!.game!.phase).toBe("announce");

    // Second case: nobody votes.
    for (let i = 0; i < 9; i++) await expire(room);
    const end2 = (await room.host("state")).body.view!.game!;
    expect(end2.phase).toBe("verdict");
    expect(end2.verdict!.noVotes).toBe(true);
    expect(end2.verdict!.guilty).toBe(false);
    await room.host("host", { move: { type: "next", phase: "verdict", case: 1 } });
    const fin = (await room.host("host", { move: { type: "next", phase: "standings", case: 1 } })).body.view!.game!;
    expect(fin.phase).toBe("final");
    const top = fin.standings[0].score;
    expect(fin.winners.sort()).toEqual(fin.standings.filter((s) => s.score === top).map((s) => s.playerId).sort());

    // The session counts as completed.
    const done = await pg.query<{ completed_at: string | null }>("select completed_at from public.game_sessions where id = $1", [room.sessionId]);
    expect(done.rows[0].completed_at).not.toBeNull();

    // Rematch (new cases), lobby, close.
    const re = await room.host("rematch");
    expect(re.body.view!.game!.phase).toBe("announce");
    expect([c.caseId, second.c.caseId]).not.toContain((await docOf(room.sessionId)).game!.case.caseId);
    expect((await room.host("lobby")).body.view!.game).toBeNull();
    expect((await room.host("close")).body.view!.status).toBe("FINISHED");
    expect((await call(GUEST, { action: "lookup", code: room.code })).body.ok).toBe(false);
  });

  it("only the host moves phases; a phone sending a host move is refused", async () => {
    const room = await startedRoom();
    const res = await call(POST, { action: "host", as: "guest", sessionId: room.sessionId, playerToken: room.tokens[FIVE[0]], move: { type: "next", phase: "announce", case: 0 } });
    expect(res.status).toBe(400);
    expect(await phase(room)).toBe("announce");
    // Unknown or malformed moves.
    expect((await room.guest(FIVE[0], "act", { move: { type: "present", case: 0, exhibit: 7 } })).status).toBe(400);
    expect((await room.guest(FIVE[0], "act", { move: { type: "vote", case: 0, vote: "maybe" } })).status).toBe(400);
    expect((await room.guest(FIVE[0], "act", { move: { type: "score", points: 9999 } })).status).toBe(400);
    expect((await room.host("host", { move: { type: "replace", role: "judge", case: 0 } })).status).toBe(400);
  });
});

describe("twelve players", () => {
  it("deals 3 key roles and 9 jurors, and all 9 votes land at once", async () => {
    const room = await startedRoom(TWELVE, 1);
    const { c, jurors } = await rolesOf(room);
    expect(jurors).toHaveLength(9);
    for (let i = 0; i < 8; i++) await expire(room);
    expect(await phase(room)).toBe("vote");
    const data = CASES.find((x) => x.id === c.caseId)!;
    const results = await Promise.all(jurors.map((j, i) => room.guest(j, "act", { move: { type: "vote", case: 0, vote: i < 5 ? "guilty" : "innocent" } })));
    expect(results.map((r) => r.body.error ?? "ok")).toEqual(jurors.map(() => "ok"));
    const v = (await room.host("state")).body.view!.game!;
    expect(v.phase).toBe("verdict");
    expect(v.verdict!.guiltyVotes).toBe(5);
    expect(v.verdict!.innocentVotes).toBe(4);
    const right = jurors.filter((_, i) => (i < 5) === data.guilty);
    for (const j of jurors) expect(v.verdict!.gained.find((g) => g.name === j)!.points).toBe(right.includes(j) ? 100 : 0);
  });
});

describe("connection", () => {
  it("a refresh (same device) keeps role and points", async () => {
    const room = await startedRoom();
    const { accused } = await rolesOf(room);
    const before = (await room.guest(accused)).body.view!;
    const again = (await room.guest(accused)).body.view!;
    expect(again.myRole).toBe("accused");
    expect(again.secret).toEqual(before.secret);
  });

  it("a key role going away pauses the hearing; their return resumes it", async () => {
    const room = await startedRoom();
    const { lawyer } = await rolesOf(room);
    await goAway(room, lawyer);
    const paused = (await room.host("state")).body.view!.game!;
    expect(paused.paused!.reason).toBe("absent");
    expect(paused.paused!.waitingFor).toEqual([{ id: room.ids[lawyer], name: lawyer, role: "lawyer" }]);
    expect(paused.timer!.deadline).toBeNull();
    const left = paused.timer!.remainingMs;
    // Time does not run while they are away.
    await age(room.sessionId, 60000);
    expect((await room.host("state")).body.view!.game!.phase).toBe("announce");
    // They come back (any request from their phone).
    const back = (await room.guest(lawyer)).body.view!.game!;
    expect(back.paused).toBeNull();
    expect(back.timer!.remainingMs).toBeGreaterThan(left - 2000);
  });

  it("a new device takes the seat back after the host frees it: same role, same points", async () => {
    const room = await startedRoom();
    const { prosecutor } = await rolesOf(room);
    const old = room.tokens[prosecutor];
    // The phone is lost: joining with the same name is refused while the seat is held.
    expect((await call(GUEST, { action: "join", code: room.code, name: prosecutor, personId: null })).body.error).toBe("NAME_TAKEN");
    expect((await room.host("release", { playerId: room.ids[prosecutor] })).body.ok).toBe(true);
    // The freed seat pauses the hearing.
    expect((await room.host("state")).body.view!.game!.paused!.waitingFor.map((w) => w.role)).toEqual(["prosecutor"]);
    expect((await call(POST, { action: "state", as: "guest", sessionId: room.sessionId, playerToken: old })).status).toBe(401);
    expect((await room.join(prosecutor)).body.ok).toBe(true);
    const view = (await room.guest(prosecutor)).body.view!;
    expect(view.me.playerId).toBe(room.ids[prosecutor]);
    expect(view.myRole).toBe("prosecutor");
    expect((await room.host("state")).body.view!.game!.paused).toBeNull();
  });

  it("the host can go on without them, or hand the role to a juror", async () => {
    const room = await startedRoom(["أ", "ب", "ج", "د", "هـ", "و"]);
    const { accused, jurors } = await rolesOf(room);
    await goAway(room, accused);
    expect((await room.host("state")).body.view!.game!.paused).not.toBeNull();
    const resumed = await room.host("host", { move: { type: "resume" } });
    expect(resumed.body.view!.game!.paused).toBeNull();
    expect((await room.host("state")).body.view!.game!.paused).toBeNull();
    // Replace: a present juror becomes the accused and gets the secret.
    const rep = await room.host("host", { move: { type: "replace", role: "accused", case: 0 } });
    const newAccused = rep.body.view!.game!.roles.accused.name;
    expect(jurors).toContain(newAccused);
    expect(rep.body.view!.game!.benched.map((b) => b.name)).toEqual([accused]);
    const mine = (await room.guest(newAccused)).body.view!;
    expect(mine.myRole).toBe("accused");
    expect(mine.secret!.role).toBe("accused");
    const old = (await room.guest(accused)).body.view!;
    expect(old.myRole).toBe("benched");
    expect(old.secret).toBeNull();
  });

  it("host pause and resume", async () => {
    const room = await startedRoom();
    expect((await room.host("host", { move: { type: "pause" } })).body.view!.game!.paused!.reason).toBe("host");
    await age(room.sessionId, 120000);
    await room.everyone();
    expect(await phase(room)).toBe("announce");
    expect((await room.guest(FIVE[0], "act", { move: { type: "vote", case: 0, vote: "guilty" } })).body.error).toBeTruthy();
    expect((await room.host("host", { move: { type: "resume" } })).body.view!.game!.paused).toBeNull();
  });
});

describe("other games", () => {
  it("the catalog lists the court as a public built-in", async () => {
    const r = await pg.query<{ result: { builtin: Record<string, string> } }>("select public.fq_catalog_list() as result");
    expect(r.rows[0].result.builtin.court).toBe("public");
  });

  it("presence rows only for players of that room", async () => {
    const a = await openRoom(["س"]);
    const b = await openRoom(["ص"]);
    const res = await pg.query<{ result: { seen: Record<string, number> } }>("select public.fq_court_touch($1, $2) as result", [a.sessionId, b.ids["ص"]]);
    expect(Object.keys(res.rows[0].result.seen)).toEqual([a.ids["س"]]);
  });
});
