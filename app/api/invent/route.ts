import { rpc } from "@/lib/server/db";
import { notifyGame } from "@/lib/server/broadcast";
import { fail, getSnapshot, handleError, ok, readBody, type RpcResult } from "@/lib/server/game";
import { hashToken, isTokenShaped, isUuid, newToken } from "@/lib/server/tokens";
import { authorizeCreate, claimSession } from "@/lib/server/access";
import { QUESTION_BANK } from "@/lib/invent/questions";
import {
  advance,
  applyHostMove,
  applyPlayerMove,
  applySettings,
  cleanQuestions,
  DEFAULT_SETTINGS,
  isTimerSeconds,
  newDoc,
  startGame,
  type EngineResult,
  type HostMove,
  type InventDoc,
  type InventQuestion,
  type InventSettings,
  type Phase,
  type PlayerMove,
} from "@/lib/invent/engine";
import {
  activeIds,
  buildInventGuestView,
  buildInventHostView,
  inventDocOf,
  type InventSessionConfig,
} from "@/lib/invent/views";
import type { Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * «اخترع إجابتك» endpoint, for the host screen (`as: "host"`, host token) and
 * the phones (`as: "guest"`, player token). Joining goes through /api/guest.
 *
 * Every request: load the room → identify the sender → let the clock move
 * the match on (timers that ran out, phases everyone finished) → apply the
 * sender's move, checked against its role, the phase and the round → save
 * with an optimistic lock (two phones acting at once: the loser retries on
 * the new state, so nothing is lost and nothing is scored twice) → answer
 * with the sender's own view only.
 */

const MAX_ATTEMPTS = 8;
const PHASES: Phase[] = ["answering", "voting", "reveal", "leaderboard", "final"];

type Actor = { kind: "host" } | { kind: "player"; id: string };
type Identified = { snapshot: Snapshot; actor: Actor } | { error: Response };

async function identify(body: Record<string, unknown>): Promise<Identified> {
  if (!isUuid(body.sessionId)) return { error: fail("GAME_NOT_FOUND", 404) };
  const snapshot = await getSnapshot(body.sessionId);
  if (!snapshot || snapshot.session.kind !== "invent" || !inventDocOf(snapshot)) return { error: fail("GAME_NOT_FOUND", 404) };
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

function viewFor(snapshot: Snapshot, doc: InventDoc, actor: Actor) {
  return actor.kind === "host" ? buildInventHostView(snapshot, doc) : buildInventGuestView(snapshot, doc, actor.id);
}

/** The questions this room draws from: its host's own, or (private room) the Ahaji set. */
function poolOf(snapshot: Snapshot): readonly InventQuestion[] {
  const config = snapshot.session.config as unknown as InventSessionConfig;
  if (config.questionSet === "custom") return Array.isArray(config.questions) ? config.questions : [];
  return QUESTION_BANK;
}

/** Matches saved before rooms had pools only stored question ids: add their text once. */
function withQuestionText(doc: InventDoc, pool: readonly InventQuestion[]): InventDoc {
  const g = doc.game;
  if (!g || g.questions) return doc;
  const byId = new Map(pool.map((q) => [q.id, q]));
  return { ...doc, game: { ...g, questions: g.questionIds.map((id) => ({ id, text: byId.get(id)?.text ?? "" })) } };
}

const isRound = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 100;
const isId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9]{1,32}$/.test(v);
const optInt = (v: unknown) => (v === undefined || v === null ? undefined : (v as number));

function parsePlayerMove(raw: unknown): PlayerMove | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.type === "answer") {
    // Length is checked by the engine after cleaning; this only stops absurd payloads.
    return isRound(a.round) && typeof a.text === "string" && a.text.length <= 2000
      ? { type: "answer", round: a.round, text: a.text }
      : null;
  }
  if (a.type === "vote") return isRound(a.round) && isId(a.answerId) ? { type: "vote", round: a.round, answerId: a.answerId } : null;
  return null;
}

function parseHostMove(raw: unknown): HostMove | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case "pause":
    case "resume":
    case "end":
      return { type: a.type };
    case "skip":
      return PHASES.includes(a.phase as Phase) && isRound(a.round) ? { type: "skip", phase: a.phase as Phase, round: a.round } : null;
    case "timers":
      return { type: "timers", answerSeconds: optInt(a.answerSeconds), voteSeconds: optInt(a.voteSeconds) };
    default:
      return null;
  }
}

/** Everyone still in the room, in join order (a freed seat is not dealt in). */
const seatedPlayers = (snapshot: Snapshot) =>
  snapshot.players.filter((p) => p.token_hash !== null).map((p) => ({ id: p.id, name: p.display_name }));

type Status = "LOBBY" | "PLAYING" | "FINISHED";
type Change =
  | { kind: "doc"; run: (doc: InventDoc, now: number, snapshot: Snapshot) => EngineResult }
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
    const current = withQuestionText(inventDocOf(snapshot)!, poolOf(snapshot));
    if (snapshot.session.status === "FINISHED") return ok({ view: viewFor(snapshot, current, actor) });

    const active = activeIds(snapshot);
    let next = advance(current, now, active);

    if (change?.kind === "lobby") {
      next = { ...next, game: null };
    } else if (change?.kind === "doc") {
      const res = change.run(next, now, snapshot);
      if (!res.doc) {
        // Still save the clock's progress, then report the refusal.
        if (next !== current) await save(snapshot, next, statusOf(next));
        const rule = !/^[A-Z_]+$/.test(res.error);
        return rule
          ? Response.json({ ok: false, error: "RULE", message: res.error }, { status: 409 })
          : fail(res.error, res.error === "BAD_REQUEST" ? 400 : 409);
      }
      next = advance(res.doc, now, active);
    }
    // The room is in the lobby exactly when no match is running.
    const status: Status = change?.kind === "close" ? "FINISHED" : statusOf(next);

    const unchanged = next === current && status === snapshot.session.status;
    if (unchanged) return ok({ view: viewFor(snapshot, current, actor) });

    const saved = await save(snapshot, next, status);
    if (saved === "ok") {
      const fresh = await getSnapshot(snapshot.session.id);
      const doc = fresh && inventDocOf(fresh);
      return fresh && doc ? ok({ view: viewFor(fresh, doc, actor) }) : fail("GAME_NOT_FOUND", 404);
    }
    if (saved !== "STALE_STATE") return fail(saved, 409);
    // Someone else saved first: run again on their state.
  }
  return fail("BUSY", 503);
}

const statusOf = (doc: InventDoc): Status => (doc.game ? "PLAYING" : "LOBBY");

async function save(snapshot: Snapshot, doc: InventDoc, status: Status): Promise<string> {
  const res = await rpc<RpcResult>("fq_invent_save_match", {
    p_session_id: snapshot.session.id,
    p_expected_version: snapshot.session.match_version ?? 0,
    p_match: doc,
    p_status: status,
  });
  if (!res.ok) return res.error;
  await notifyGame(snapshot.session.id);
  return "ok";
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const action = body.action;

    // Opening a room needs an account. A public room plays the host's own
    // questions (sent here, kept with the room); the Ahaji set is private.
    if (action === "create") {
      const ahaji = body.questionSet === "ahaji";
      const auth = await authorizeCreate(ahaji ? "invent_ahaji" : "invent");
      if ("error" in auth) return fail(auth.error, auth.status);
      const questions = ahaji ? null : cleanQuestions(body.questions);
      if (!ahaji && !questions) return fail("IV_QUESTIONS");
      const poolSize = questions ? questions.length : QUESTION_BANK.length;
      // Match settings chosen with the questions (still editable in the lobby).
      const settings = { ...DEFAULT_SETTINGS, rounds: Math.min(DEFAULT_SETTINGS.rounds, poolSize) };
      const lobby = applySettings(newDoc(settings), {
        rounds: optInt(body.rounds),
        answerSeconds: isTimerSeconds(body.answerSeconds) ? body.answerSeconds : undefined,
        voteSeconds: isTimerSeconds(body.voteSeconds) ? body.voteSeconds : undefined,
      }, poolSize);
      if (!lobby.doc) return fail("IV_ROUNDS");
      const config: InventSessionConfig = {
        kind: "invent",
        title: ahaji ? "اخترع إجابتك · أحاجي" : "اخترع إجابتك",
        emoji: "💡",
        accent: "sun",
        settings: { lateJoin: false, askPersonOnJoin: false },
        people: [],
        ...(questions ? { questionSet: "custom" as const, questions } : { questionSet: "ahaji" as const }),
      };
      const hostToken = newToken();
      const res = await rpc<RpcResult>("fq_invent_create_session", {
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

    if (actor.kind === "host") {
      if (action === "settings") {
        const patch: Partial<InventSettings> = {
          rounds: optInt(body.rounds),
          answerSeconds: optInt(body.answerSeconds),
          voteSeconds: optInt(body.voteSeconds),
        };
        return await commit(body, who, { kind: "doc", run: (doc, _now, snapshot) => applySettings(doc, patch, poolOf(snapshot).length) });
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
            return startGame(doc, seatedPlayers(snapshot), now, poolOf(snapshot));
          },
        });
      }

      if (action === "host") {
        const move = parseHostMove(body.move);
        if (!move) return fail("BAD_REQUEST");
        return await commit(body, who, { kind: "doc", run: (doc, now) => applyHostMove(doc, move, now) });
      }

      // Back to the lobby (new players can join, settings can change).
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
      return await commit(body, who, { kind: "doc", run: (doc, now) => applyPlayerMove(doc, playerId, move, now) });
    }

    return fail("BAD_REQUEST");
  } catch (err) {
    return handleError(err);
  }
}
