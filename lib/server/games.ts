import "server-only";
import { rpc } from "@/lib/server/db";
import type { GameDoc, GameRecord, GameRecordStatus, GameSummary } from "@/lib/types";
import { normalizeGameDoc } from "@/lib/game/doc";

type Fail = { ok: false; error: string; version?: number };

interface RawGame {
  id: string;
  status: GameRecordStatus;
  version: number;
  doc: unknown;
  updated_at: string;
}

function toRecord(raw: RawGame): GameRecord {
  return {
    id: raw.id,
    status: raw.status,
    version: raw.version,
    // Re-normalize on read too: documents written by older versions stay valid.
    doc: normalizeGameDoc(raw.doc),
    updatedAt: raw.updated_at,
  };
}

export async function listGames(): Promise<GameSummary[]> {
  const res = await rpc<{ ok: true; games: Record<string, unknown>[] }>("fq_admin_list_games", {});
  return res.games.map((g) => ({
    id: String(g.id),
    title: String(g.title ?? ""),
    emoji: String(g.emoji ?? "🎉"),
    cover: typeof g.cover === "string" ? g.cover : null,
    accent: (g.accent as GameSummary["accent"]) ?? "sun",
    status: g.status as GameRecordStatus,
    questionCount: Number(g.question_count ?? 0),
    peopleCount: Number(g.people_count ?? 0),
    updatedAt: String(g.updated_at),
    sessionCount: Number(g.session_count ?? 0),
  }));
}

export async function getGame(id: string): Promise<GameRecord | null> {
  const res = await rpc<{ ok: true; game: RawGame } | Fail>("fq_admin_get_game", { p_id: id });
  return res.ok ? toRecord(res.game) : null;
}

export async function saveGame(
  id: string | null,
  doc: GameDoc,
  expectedVersion: number | null,
  status: GameRecordStatus | null = null,
): Promise<{ ok: true; game: GameRecord } | Fail> {
  const res = await rpc<{ ok: true; game: RawGame } | Fail>("fq_admin_save_game", {
    p_id: id,
    p_doc: doc,
    p_expected_version: expectedVersion,
    p_status: status,
  });
  return res.ok ? { ok: true, game: toRecord(res.game) } : res;
}
