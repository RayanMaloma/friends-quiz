import "server-only";
import { TEAM_NAME, type Team } from "@/lib/mafia/rules";

/**
 * Shapes one room's record (fq_admin_session_detail) for the super admin's
 * activity page: what was configured and what happened, from the data the
 * system actually stored. Secrets that only matter during play (host token,
 * who holds which hidden role, answer keys) are not sent; nothing missing is
 * filled in.
 */

export interface SessionDetail {
  id: string;
  code: string;
  kind: string;
  gameKey: string | null;
  title: string;
  emoji: string;
  state: string;
  endReason: string | null;
  ownerEmail: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  finishedAt: string | null;
  players: { name: string; active: boolean }[];
  events: { kind: string; at: string }[];
  /** Label → value, as recorded. */
  settings: [string, string][];
  /** «اخترع إجابتك»: the room's question set. */
  questions: string[] | null;
  /** How the last match ended, when it did. */
  result: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const num = (v: unknown) => (typeof v === "number" ? v : null);
const seconds = (v: unknown) => (num(v) === null ? "—" : `${v} ث`);

function inventDetail(config: Obj, match: Obj): Pick<SessionDetail, "settings" | "questions" | "result"> {
  const settings = obj(match.settings);
  const custom = config.questionSet === "custom";
  const questions = custom && Array.isArray(config.questions)
    ? (config.questions as unknown[]).map((q) => String(obj(q).text ?? ""))
    : null;
  const game = obj(match.game);
  let result: string | null = null;
  if (game.phase === "final") {
    const players = Array.isArray(game.players) ? (game.players as Obj[]) : [];
    const scores = obj(game.scores);
    const top = Math.max(0, ...players.map((p) => Number(scores[String(p.id)] ?? 0)));
    const winners = top > 0 ? players.filter((p) => Number(scores[String(p.id)] ?? 0) === top).map((p) => String(p.name)) : [];
    result = game.endedEarly ? "أُنهيت مبكرًا" : winners.length ? `الفائز: ${winners.join("، ")} (${top})` : "بدون فائز";
  }
  return {
    settings: [
      ["الأسئلة", custom ? `${questions?.length ?? 0} (من المضيف)` : "أحاجي (٤٦)"],
      ["الجولات", String(num(settings.rounds) ?? "—")],
      ["وقت الإجابة", seconds(settings.answerSeconds)],
      ["وقت التصويت", seconds(settings.voteSeconds)],
    ],
    questions,
    result,
  };
}

function mafiaDetail(match: Obj): Pick<SessionDetail, "settings" | "questions" | "result"> {
  const winner = obj(match.winner);
  const players = Array.isArray(match.players) ? match.players.length : null;
  return {
    settings: [["اللاعبين في المباراة", players === null ? "—" : String(players)]],
    questions: null,
    result: winner.team ? `فاز فريق ${TEAM_NAME[winner.team as Team] ?? String(winner.team)}` : null,
  };
}

function dxDetail(config: Obj, match: Obj): Pick<SessionDetail, "settings" | "questions" | "result"> {
  const game = obj(config.game);
  const mechanics = obj(game.mechanics);
  const factions = Array.isArray(game.factions) ? (game.factions as Obj[]) : [];
  const winner = obj(match.winner);
  const faction = factions.find((f) => f.id === winner.factionId);
  return {
    settings: [
      ["اللعبة", String(obj(game.identity).name ?? config.title ?? "—")],
      ["عدد اللاعبين", `${num(mechanics.minPlayers) ?? "?"}–${num(mechanics.maxPlayers) ?? "?"}`],
      ["كشف التصويت", mechanics.voteReveal === "names" ? "بالأسماء" : "نسبة فقط"],
    ],
    questions: null,
    result: winner.factionId ? `فاز ${String(faction?.name ?? winner.factionId)}` : null,
  };
}

function quizDetail(config: Obj, total: number): Pick<SessionDetail, "settings" | "questions" | "result"> {
  const s = obj(config.settings);
  return {
    settings: [
      ["الأسئلة", String(total)],
      ["الوقت لكل سؤال", s.timeLimit === 0 ? "بدون" : seconds(s.timeLimit)],
      ["الترتيب", s.order === "fixed" ? "ثابت" : "عشوائي"],
      ["مكافأة السرعة", s.speedBonus ? "نعم" : "لا"],
    ],
    questions: null,
    result: null,
  };
}

export function summarizeSession(raw: Obj): SessionDetail {
  const s = obj(raw.session);
  const config = obj(s.config);
  const match = obj(s.match);
  const kind = String(s.kind ?? "quiz");
  const specific =
    kind === "invent" ? inventDetail(config, match)
    : kind === "mafia" ? mafiaDetail(match)
    : kind === "deduction" ? dxDetail(config, match)
    : quizDetail(config, Number(s.total_questions ?? 0));
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: String(s.id),
    code: String(s.code ?? ""),
    kind,
    gameKey: str(s.game_key),
    title: String(config.title ?? ""),
    emoji: String(config.emoji ?? "🎲"),
    state: String(s.state ?? ""),
    endReason: str(s.end_reason),
    ownerEmail: str(s.owner_email),
    createdAt: String(s.created_at),
    startedAt: str(s.started_at),
    completedAt: str(s.completed_at),
    finishedAt: str(s.finished_at),
    players: (Array.isArray(raw.players) ? (raw.players as Obj[]) : []).map((p) => ({ name: String(p.name ?? ""), active: !!p.active })),
    events: (Array.isArray(raw.events) ? (raw.events as Obj[]) : []).map((e) => ({ kind: String(e.kind), at: String(e.at) })),
    ...specific,
  };
}
