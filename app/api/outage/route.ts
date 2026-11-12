import { randomInt } from "node:crypto";
import { rpc } from "@/lib/server/db";
import { notifyGame } from "@/lib/server/broadcast";
import { fail, getSnapshot, handleError, ok, readBody, type RpcResult } from "@/lib/server/game";
import { hashToken, isTokenShaped, isUuid, newToken } from "@/lib/server/tokens";
import { authorizeCreate, claimSession } from "@/lib/server/access";
import {
  advance,
  applyCommand,
  applyHostMove,
  applySettings,
  DEFAULT_SETTINGS,
  isDifficulty,
  newDoc,
  startGame,
  touch,
  type EngineResult,
  type HostMove,
  type OutageDoc,
} from "@/lib/outage/engine";
import {
  DEVICES,
  DOORS,
  PROCEDURES,
  SECTIONS,
  SYSTEMS,
  VALVES,
  type Command,
  type DeviceId,
  type DoorId,
  type Procedure,
  type SectionId,
  type SysId,
  type ValveId,
} from "@/lib/outage/sim";
import { buildOutageGuestView, buildOutageHostView, outageDocOf, rosterOf, type OutageSessionConfig } from "@/lib/outage/views";
import type { Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * «انقطاع الاتصال» endpoint, for the host screen (`as: "host"`, host token)
 * and the phones (`as: "guest"`, player token). Joining goes through
 * /api/guest.
 *
 * Every request: load the room → identify the sender → record the phone's
 * presence → let the clock run the station up to now (whole seconds, server
 * time) → apply the sender's command, checked against the panels it holds and
 * the station's state → save with an optimistic lock (two commands at the
 * same instant: the second one retries on the new state) → answer with the
 * sender's own view only.
 *
 * A request that only moved the clock is saved without pinging the room
 * unless something visible happened (a fault started or ended, a blackout, a
 * reassignment…): screens poll for the running values.
 */

const MAX_ATTEMPTS = 8;

type Actor = { kind: "host" } | { kind: "player"; id: string };
type Identified = { snapshot: Snapshot; actor: Actor } | { error: Response };

async function identify(body: Record<string, unknown>): Promise<Identified> {
  if (!isUuid(body.sessionId)) return { error: fail("GAME_NOT_FOUND", 404) };
  const snapshot = await getSnapshot(body.sessionId);
  if (!snapshot || snapshot.session.kind !== "outage" || !outageDocOf(snapshot)) return { error: fail("GAME_NOT_FOUND", 404) };
  if (body.as === "host") {
    if (!isTokenShaped(body.hostToken) || snapshot.session.host_token_hash !== hashToken(body.hostToken)) {
      return { error: fail("FORBIDDEN", 403) };
    }
    return { snapshot, actor: { kind: "host" } };
  }
  if (!isTokenShaped(body.playerToken)) return { error: fail("NOT_A_PLAYER", 401) };
  const hash = hashToken(body.playerToken);
  const player = snapshot.players.find((p) => p.token_hash === hash);
  if (!player) return { error: fail("NOT_A_PLAYER", 401) };
  return { snapshot, actor: { kind: "player", id: player.id } };
}

function viewFor(snapshot: Snapshot, doc: OutageDoc, actor: Actor) {
  return actor.kind === "host" ? buildOutageHostView(snapshot, doc) : buildOutageGuestView(snapshot, doc, actor.id);
}

/* ------------------------------------------------------------------ */
/* Parsing (whitelists only: nothing from the browser is trusted)      */
/* ------------------------------------------------------------------ */

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const digits = (v: unknown, max = 8): v is string => typeof v === "string" && /^[0-9]+$/.test(v) && v.length <= max;

function parseCommand(raw: unknown): Command | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  switch (c.type) {
    case "main":
    case "backup":
    case "pump":
      return isBool(c.on) ? { type: c.type, on: c.on } : null;
    case "breaker":
      return oneOf<SysId>(SYSTEMS, c.sys) && isBool(c.on) ? { type: "breaker", sys: c.sys, on: c.on } : null;
    case "alloc":
      return oneOf<SysId>(SYSTEMS, c.sys) && isInt(c.value, 0, 100) ? { type: "alloc", sys: c.sys, value: c.value } : null;
    case "pumpPower":
      return isInt(c.value, 0, 100) ? { type: "pumpPower", value: c.value } : null;
    case "loop":
      return (c.loop === "reactor" || c.loop === "gen") && isBool(c.open) ? { type: "loop", loop: c.loop, open: c.open } : null;
    case "door":
      if (!oneOf<DoorId>(DOORS, c.door) || !isBool(c.open)) return null;
      if (c.code !== undefined && c.code !== null && !digits(c.code)) return null;
      return { type: "door", door: c.door, open: c.open, code: typeof c.code === "string" ? c.code : undefined };
    case "override":
      return digits(c.code) ? { type: "override", code: c.code } : null;
    case "valve":
      return oneOf<ValveId>(VALVES, c.valve) && isBool(c.open) ? { type: "valve", valve: c.valve, open: c.open } : null;
    case "purge":
      return oneOf<SectionId>(SECTIONS, c.section) ? { type: "purge", section: c.section } : null;
    case "tune":
      return isInt(c.freq, 0, 99) ? { type: "tune", freq: c.freq } : null;
    case "decrypt":
      return typeof c.message === "string" && c.message.length <= 12 && isInt(c.key, 0, 9) ? { type: "decrypt", message: c.message, key: c.key } : null;
    case "handshake":
      return digits(c.code) ? { type: "handshake", code: c.code } : null;
    case "calibrate":
      return oneOf<SectionId>(SECTIONS, c.section) ? { type: "calibrate", section: c.section } : null;
    case "repair":
      return oneOf<DeviceId>(DEVICES, c.device) && oneOf<Procedure>(PROCEDURES, c.procedure) ? { type: "repair", device: c.device, procedure: c.procedure } : null;
    case "scrubber":
    case "refill":
      return { type: c.type };
    default:
      return null;
  }
}

function parseHostMove(raw: unknown): HostMove | null {
  if (!raw || typeof raw !== "object") return null;
  const t = (raw as Record<string, unknown>).type;
  return t === "pause" || t === "resume" || t === "end" ? { type: t } : null;
}

/** Everyone still in the room, in join order (a freed seat is not dealt in). */
const seatedPlayers = (snapshot: Snapshot) =>
  snapshot.players.filter((p) => p.token_hash !== null).map((p) => ({ id: p.id, name: p.display_name }));

/* ------------------------------------------------------------------ */
/* Commit                                                              */
/* ------------------------------------------------------------------ */

type Status = "LOBBY" | "PLAYING" | "FINISHED";
type Change =
  | { kind: "doc"; run: (doc: OutageDoc, now: number, snapshot: Snapshot) => EngineResult }
  | { kind: "lobby" }
  | { kind: "close" };

const statusOf = (doc: OutageDoc): Status => (doc.game ? "PLAYING" : "LOBBY");

/** Something every screen should refetch for (not just running values). */
function eventful(a: OutageDoc, b: OutageDoc): boolean {
  const x = a.game;
  const y = b.game;
  if (!x || !y) return x !== y;
  if (x.outcome !== y.outcome || x.held !== y.held || x.paused !== y.paused) return true;
  if (x.blackouts.length !== y.blackouts.length) return true;
  if (x.missions.some((m, i) => m.status !== y.missions[i]?.status)) return true;
  if (JSON.stringify(x.assignment) !== JSON.stringify(y.assignment)) return true;
  const lastX = x.sim.log.at(-1);
  const lastY = y.sim.log.at(-1);
  return lastX?.t !== lastY?.t || lastX?.text !== lastY?.text || x.sim.log.length !== y.sim.log.length;
}

/**
 * Runs `change` (or just the clock when null) on the latest state and saves
 * it. Retries when another device saved first. Returns the sender's view.
 */
async function commit(body: Record<string, unknown>, first: Identified, change: Change | null): Promise<Response> {
  let who = first;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) who = await identify(body);
    if ("error" in who) return who.error;
    const { snapshot, actor } = who;
    const now = Date.parse(snapshot.now);
    const current = outageDocOf(snapshot)!;
    if (snapshot.session.status === "FINISHED") return ok({ view: viewFor(snapshot, current, actor) });

    const roster = rosterOf(snapshot);
    const seen = actor.kind === "player" ? touch(current, actor.id, now) : current;
    const clocked = advance(seen, now, roster);
    let next = clocked;
    let refusal: string | null = null;

    if (change?.kind === "lobby") {
      next = { ...next, game: null };
    } else if (change?.kind === "doc") {
      const res = change.run(next, now, snapshot);
      next = res.doc;
      refusal = res.error ?? null;
      // The command itself can't move the clock, but keep the station consistent.
      if (!refusal) next = advance(next, now, roster);
    }
    const status: Status = change?.kind === "close" ? "FINISHED" : statusOf(next);

    const unchanged = next === current && status === snapshot.session.status;
    if (!unchanged) {
      // Presence or the running values only: no ping (screens poll for those).
      const quiet = change === null && !eventful(current, next);
      const saved = await save(snapshot, next, status, quiet);
      if (saved === "STALE_STATE") continue;
      if (saved !== "ok") return fail(saved, 409);
    }
    if (refusal) {
      const rule = !/^[A-Z_]+$/.test(refusal);
      return rule
        ? Response.json({ ok: false, error: "RULE", message: refusal }, { status: 409 })
        : fail(refusal, refusal === "BAD_REQUEST" ? 400 : 409);
    }
    if (unchanged) return ok({ view: viewFor(snapshot, current, actor) });
    const fresh = await getSnapshot(snapshot.session.id);
    const doc = fresh && outageDocOf(fresh);
    return fresh && doc ? ok({ view: viewFor(fresh, advance(doc, Date.parse(fresh.now), rosterOf(fresh)), actor) }) : fail("GAME_NOT_FOUND", 404);
  }
  return fail("BUSY", 503);
}

async function save(snapshot: Snapshot, doc: OutageDoc, status: Status, quiet: boolean): Promise<string> {
  const res = await rpc<RpcResult>("fq_outage_save_match", {
    p_session_id: snapshot.session.id,
    p_expected_version: snapshot.session.match_version ?? 0,
    p_match: doc,
    p_status: status,
  });
  if (!res.ok) return res.error;
  if (!quiet) await notifyGame(snapshot.session.id);
  return "ok";
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const action = body.action;

    // Opening a room needs an account, and the game visible to it.
    if (action === "create") {
      const auth = await authorizeCreate("outage");
      if ("error" in auth) return fail(auth.error, auth.status);
      const lobby = applySettings(newDoc(DEFAULT_SETTINGS), { difficulty: isDifficulty(body.difficulty) ? body.difficulty : undefined });
      const config: OutageSessionConfig = {
        kind: "outage",
        title: "انقطاع الاتصال",
        emoji: "🛰",
        accent: "sky",
        settings: { lateJoin: false, askPersonOnJoin: false },
        people: [],
      };
      const hostToken = newToken();
      const res = await rpc<RpcResult>("fq_outage_create_session", {
        p_host_token_hash: hashToken(hostToken),
        p_config: config,
        p_match: lobby.doc,
      });
      if (!res.ok) return fail(res.error);
      await claimSession(res.session_id as string, auth.actor);
      return ok({ sessionId: res.session_id, code: res.code, hostToken });
    }

    const who = await identify(body);
    if ("error" in who) return who.error;
    const { actor } = who;

    // Reading the state also runs the clock and records the phone's presence.
    if (action === "state") return await commit(body, who, null);

    if (actor.kind === "host") {
      if (action === "settings") {
        if (body.difficulty !== undefined && !isDifficulty(body.difficulty)) return fail("BAD_REQUEST");
        const difficulty = isDifficulty(body.difficulty) ? body.difficulty : undefined;
        return await commit(body, who, { kind: "doc", run: (doc) => applySettings(doc, { difficulty }) });
      }

      // Start from the lobby. A second click finds the mission running and changes nothing.
      if (action === "start") {
        return await commit(body, who, {
          kind: "doc",
          run: (doc, now, snapshot) => {
            if (snapshot.session.status !== "LOBBY" || doc.game) return { doc };
            return startGame(doc, seatedPlayers(snapshot), now, randomInt(1, 2 ** 31 - 1));
          },
        });
      }

      if (action === "host") {
        const move = parseHostMove(body.move);
        if (!move) return fail("BAD_REQUEST");
        return await commit(body, who, { kind: "doc", run: (doc, now) => applyHostMove(doc, move, now) });
      }

      // Back to the lobby (same players; difficulty can change) → a new mission.
      if (action === "lobby") return await commit(body, who, { kind: "lobby" });

      // Close the room for good (its code stops working).
      if (action === "close") return await commit(body, who, { kind: "close" });

      // Lobby: removes the player. During a mission: frees the seat (the
      // player can come back by typing the same name); their panels go to
      // the others.
      if (action === "release") {
        if (!isUuid(body.playerId)) return fail("BAD_REQUEST");
        const res = await rpc<RpcResult>("fq_release_player", {
          p_session_id: who.snapshot.session.id,
          p_host_token_hash: who.snapshot.session.host_token_hash,
          p_player_id: body.playerId,
        });
        if (!res.ok) return fail(res.error, res.error === "FORBIDDEN" ? 403 : 400);
        await notifyGame(who.snapshot.session.id);
        return await commit(body, await identify(body), null);
      }
      return fail("BAD_REQUEST");
    }

    if (action === "act") {
      const cmd = parseCommand(body.command);
      if (!cmd) return fail("BAD_REQUEST");
      const playerId = actor.id;
      return await commit(body, who, { kind: "doc", run: (doc, now) => applyCommand(doc, playerId, cmd, now) });
    }

    return fail("BAD_REQUEST");
  } catch (err) {
    return handleError(err);
  }
}
