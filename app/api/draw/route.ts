import { rpc } from "@/lib/server/db";
import { notifyGame } from "@/lib/server/broadcast";
import { fail, getSnapshot, handleError, ok, readBody, type RpcResult } from "@/lib/server/game";
import { hashToken, isTokenShaped, isUuid, newToken } from "@/lib/server/tokens";
import { authorizeCreate, claimSession } from "@/lib/server/access";
import { WORD_BANK, wordById } from "@/lib/draw/words";
import { knownWords } from "@/lib/draw/answers";
import {
  advance,
  applyHostMove,
  applyPlayerMove,
  applySettings,
  DEFAULT_SETTINGS,
  isLapCount,
  isTimerSeconds,
  newDoc,
  startGame,
  type DrawDoc,
  type DrawSettings,
  type EngineResult,
  type HostMove,
  type Phase,
  type PlayerMove,
} from "@/lib/draw/engine";
import { buildDrawGuestView, buildDrawHostView, drawDocOf, rosterOf, type DrawSessionConfig } from "@/lib/draw/views";
import type { Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * «وزارة المقيمين للفنون والرسم» endpoint, for the host screen (`as: "host"`,
 * host token) and the phones (`as: "guest"`, player token). Joining goes
 * through /api/guest.
 *
 * Every request: load the room → identify the sender → let the clock move
 * the match on → apply the sender's move, checked against its role, the
 * phase and the turn → save with an optimistic lock (two phones guessing at
 * once: the loser retries on the new state, so the server's order decides
 * who was first and nothing is scored twice) → answer with the sender's own
 * view only. Drafts and wrong guesses change nothing anyone else sees, so
 * they are saved without pinging the room.
 */

const MAX_ATTEMPTS = 8;
const PHASES: Phase[] = ["intro", "drawing", "guessing", "reveal", "final"];
const KNOWN = knownWords(WORD_BANK);
const wordOf = (id: string) => wordById(id)?.word ?? "";

type Actor = { kind: "host" } | { kind: "player"; id: string };
type Identified = { snapshot: Snapshot; actor: Actor } | { error: Response };

async function identify(body: Record<string, unknown>): Promise<Identified> {
  if (!isUuid(body.sessionId)) return { error: fail("GAME_NOT_FOUND", 404) };
  const snapshot = await getSnapshot(body.sessionId);
  if (!snapshot || snapshot.session.kind !== "draw" || !drawDocOf(snapshot)) return { error: fail("GAME_NOT_FOUND", 404) };
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

function viewFor(snapshot: Snapshot, doc: DrawDoc, actor: Actor) {
  return actor.kind === "host" ? buildDrawHostView(snapshot, doc, wordOf) : buildDrawGuestView(snapshot, doc, actor.id, wordOf);
}

const isTurn = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1000;
const optInt = (v: unknown) => (v === undefined || v === null ? undefined : (v as number));

function parsePlayerMove(raw: unknown): PlayerMove | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (!isTurn(a.turn)) return null;
  // Strokes are checked shape by shape by the engine.
  if (a.type === "draft" || a.type === "submit") return Array.isArray(a.strokes) ? { type: a.type, turn: a.turn, strokes: a.strokes } : null;
  if (a.type === "guess") return typeof a.text === "string" && a.text.length <= 400 ? { type: "guess", turn: a.turn, text: a.text } : null;
  return null;
}

function parseHostMove(raw: unknown): HostMove | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case "end":
      return { type: "end" };
    case "skip":
      return PHASES.includes(a.phase as Phase) && isTurn(a.turn) ? { type: "skip", phase: a.phase as Phase, turn: a.turn } : null;
    case "timers":
      return { type: "timers", drawSeconds: optInt(a.drawSeconds), guessSeconds: optInt(a.guessSeconds) };
    default:
      return null;
  }
}

/** Everyone still in the room, in join order (a freed seat is not dealt in). */
const seatedPlayers = (snapshot: Snapshot) =>
  snapshot.players.filter((p) => p.token_hash !== null).map((p) => ({ id: p.id, name: p.display_name }));

type Status = "LOBBY" | "PLAYING" | "FINISHED";
type Change =
  | { kind: "doc"; run: (doc: DrawDoc, now: number, snapshot: Snapshot) => EngineResult }
  | { kind: "lobby" }
  | { kind: "close" };

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
    const current = drawDocOf(snapshot)!;
    if (snapshot.session.status === "FINISHED") return ok({ view: viewFor(snapshot, current, actor) });

    const roster = rosterOf(snapshot);
    const clocked = advance(current, now, roster, WORD_BANK);
    let next = clocked;
    let quiet = false;

    if (change?.kind === "lobby") {
      next = { ...next, game: null };
    } else if (change?.kind === "doc") {
      const res = change.run(next, now, snapshot);
      if (!res.doc) {
        // Still save the clock's progress, then report the refusal.
        if (next !== current) await save(snapshot, next, statusOf(next), false);
        const rule = !/^[A-Z_]+$/.test(res.error);
        return rule
          ? Response.json({ ok: false, error: "RULE", message: res.error }, { status: 409 })
          : fail(res.error, res.error === "BAD_REQUEST" ? 400 : 409);
      }
      next = advance(res.doc, now, roster, WORD_BANK);
      // Quiet only if the clock moved nothing either.
      quiet = !!res.quiet && clocked === current && next === res.doc;
    }
    // The room is in the lobby exactly when no match is running.
    const status: Status = change?.kind === "close" ? "FINISHED" : statusOf(next);

    const unchanged = next === current && status === snapshot.session.status;
    if (unchanged) return ok({ view: viewFor(snapshot, current, actor) });

    const saved = await save(snapshot, next, status, quiet);
    if (saved === "ok") {
      const fresh = await getSnapshot(snapshot.session.id);
      const doc = fresh && drawDocOf(fresh);
      return fresh && doc ? ok({ view: viewFor(fresh, doc, actor) }) : fail("GAME_NOT_FOUND", 404);
    }
    if (saved !== "STALE_STATE") return fail(saved, 409);
    // Someone else saved first: run again on their state.
  }
  return fail("BUSY", 503);
}

const statusOf = (doc: DrawDoc): Status => (doc.game ? "PLAYING" : "LOBBY");

async function save(snapshot: Snapshot, doc: DrawDoc, status: Status, quiet: boolean): Promise<string> {
  const res = await rpc<RpcResult>("fq_draw_save_match", {
    p_session_id: snapshot.session.id,
    p_expected_version: snapshot.session.match_version ?? 0,
    p_match: doc,
    p_status: status,
  });
  if (!res.ok) return res.error;
  if (!quiet) await notifyGame(snapshot.session.id);
  return "ok";
}

/**
 * The strokes of the approved drawing (guessing and reveal), for every
 * screen in the room. The drawer may also fetch their own draft while
 * drawing, to get it back after a refresh. Read only: the clock is moved on
 * by `state`.
 */
function drawingFor(snapshot: Snapshot, actor: Actor): Response {
  const g = drawDocOf(snapshot)!.game;
  if (!g) return fail("DR_NO_DRAWING", 404);
  const t = g.turn;
  if ((g.phase === "guessing" || g.phase === "reveal") && t.drawing) {
    return ok({ turn: t.index, rev: t.rev, strokes: t.drawing });
  }
  if (actor.kind === "player" && actor.id === t.drawerId && (g.phase === "intro" || g.phase === "drawing")) {
    return ok({ turn: t.index, rev: null, strokes: t.draft });
  }
  return fail("DR_NO_DRAWING", 404);
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const action = body.action;

    // Opening a room needs an account, and the game visible to it.
    if (action === "create") {
      const auth = await authorizeCreate("draw");
      if ("error" in auth) return fail(auth.error, auth.status);
      // Optional starting settings (still editable in the lobby).
      const lobby = applySettings(newDoc(DEFAULT_SETTINGS), {
        laps: isLapCount(body.laps) ? body.laps : undefined,
        drawSeconds: isTimerSeconds(body.drawSeconds) ? body.drawSeconds : undefined,
        guessSeconds: isTimerSeconds(body.guessSeconds) ? body.guessSeconds : undefined,
      });
      const config: DrawSessionConfig = {
        kind: "draw",
        title: "وزارة المقيمين للفنون والرسم",
        emoji: "🎨",
        accent: "mint",
        settings: { lateJoin: true, askPersonOnJoin: false },
        people: [],
      };
      const hostToken = newToken();
      const res = await rpc<RpcResult>("fq_draw_create_session", {
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

    // Reading the state also lets the clock move the match on.
    if (action === "state") return await commit(body, who, null);
    if (action === "drawing") return drawingFor(who.snapshot, actor);

    if (actor.kind === "host") {
      if (action === "settings") {
        const patch: Partial<DrawSettings> = {
          laps: optInt(body.laps),
          drawSeconds: optInt(body.drawSeconds),
          guessSeconds: optInt(body.guessSeconds),
        };
        return await commit(body, who, { kind: "doc", run: (doc) => applySettings(doc, patch) });
      }

      // Start from the lobby, or a new match straight from the final results
      // (same room, same players). A second click finds a match running and
      // changes nothing.
      if (action === "start" || action === "rematch") {
        return await commit(body, who, {
          kind: "doc",
          run: (doc, now, snapshot) => {
            const lobby = snapshot.session.status === "LOBBY" && !doc.game;
            const over = doc.game?.phase === "final";
            if (action === "start" ? !lobby : !over) return { doc };
            return startGame(doc, seatedPlayers(snapshot), now, WORD_BANK);
          },
        });
      }

      if (action === "host") {
        const move = parseHostMove(body.move);
        if (!move) return fail("BAD_REQUEST");
        return await commit(body, who, {
          kind: "doc",
          run: (doc, now, snapshot) => applyHostMove(doc, move, now, rosterOf(snapshot), WORD_BANK),
        });
      }

      // Back to the lobby (settings can change).
      if (action === "lobby") return await commit(body, who, { kind: "lobby" });

      // Close the room for good (its code stops working).
      if (action === "close") return await commit(body, who, { kind: "close" });

      // Lobby: removes the player. During a match: frees the seat (the player
      // can come back by typing the same name) and stops waiting for them.
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
      const move = parsePlayerMove(body.move);
      if (!move) return fail("BAD_REQUEST");
      const playerId = actor.id;
      return await commit(body, who, {
        kind: "doc",
        run: (doc, now) => applyPlayerMove(doc, playerId, move, now, WORD_BANK, KNOWN),
      });
    }

    return fail("BAD_REQUEST");
  } catch (err) {
    return handleError(err);
  }
}
