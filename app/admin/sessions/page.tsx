"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errorMessage } from "@/lib/client/api";
import { hostStore } from "@/lib/client/storage";
import type { GameStatus, LeaderboardEntry } from "@/lib/types";
import { playersLabel } from "@/lib/format";
import { Spinner } from "@/components/ui";
import { Modal } from "@/components/admin/ui";

interface SessionRow {
  id: string;
  code: string;
  game_id: string | null;
  title: string;
  emoji: string;
  status: GameStatus;
  current_index: number;
  total_questions: number;
  player_count: number;
  created_at: string;
  finished_at: string | null;
}

const STATUS_LABEL: Record<GameStatus, string> = {
  LOBBY: "بانتظار اللاعبين",
  QUESTION: "شغّالة",
  REVEAL: "شغّالة",
  LEADERBOARD: "شغّالة",
  FINISHED: "خلصت",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ar-SA-u-nu-latn", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SessionsPage() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ row: SessionRow; board: LeaderboardEntry[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ sessions: SessionRow[] }>("/api/admin", { action: "listSessions" });
    if (res.ok) setRows(res.sessions);
    else setError(errorMessage(res.error));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function act(row: SessionRow, action: "endSession" | "deleteSession") {
    const msg = action === "endSession" ? `إنهاء الجلسة ${row.code}؟` : `حذف الجلسة ${row.code} ونتائجها؟`;
    if (!window.confirm(msg)) return;
    setBusy(row.id);
    const res = await api("/api/admin", { action, id: row.id });
    setBusy(null);
    if (!res.ok) setError(errorMessage(res.error));
    await load();
  }

  async function showResults(row: SessionRow) {
    setBusy(row.id);
    const res = await api<{ leaderboard: LeaderboardEntry[] }>("/api/admin", { action: "sessionResults", id: row.id });
    setBusy(null);
    if (!res.ok) {
      setError(errorMessage(res.error));
      return;
    }
    setResults({ row, board: res.leaderboard });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-4xl">الجلسات 🕹️</h1>
        <p className="font-bold text-mute">كل مرة تفتح فيها غرفة على التلفزيون. آخر ١٠٠ جلسة.</p>
      </div>
      {error && <p className="panel-sm bg-pink px-3 py-2 font-bold text-white">{error}</p>}
      {rows === null ? (
        <Spinner className="mx-auto mt-10 size-8 text-ink" />
      ) : rows.length === 0 ? (
        <p className="py-10 text-center font-bold text-mute">ما فيه جلسات للحين</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const live = r.status !== "FINISHED";
            const canOpen = live && !!hostStore.get(r.id);
            return (
              <li key={r.id} className="panel-sm flex flex-wrap items-center gap-3 bg-card p-3">
                <span className="text-2xl">{r.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-extrabold">
                    {r.title} <span className="font-display text-mute" dir="ltr">#{r.code}</span>
                  </p>
                  <p className="text-xs font-bold text-mute">
                    <span className={live ? "text-mint" : ""}>{STATUS_LABEL[r.status]}</span>
                    {r.status !== "LOBBY" && r.status !== "FINISHED" && ` · سؤال ${r.current_index + 1}/${r.total_questions}`}
                    {` · ${playersLabel(r.player_count)} · ${formatDate(r.created_at)}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canOpen && (
                    <Link href={`/host/${r.id}`} className="abtn abtn-primary abtn-sm">
                      فتح التلفزيون
                    </Link>
                  )}
                  <button onClick={() => showResults(r)} disabled={busy === r.id} className="abtn abtn-sm">
                    النتائج
                  </button>
                  {live && (
                    <button onClick={() => act(r, "endSession")} disabled={busy === r.id} className="abtn abtn-sm">
                      إنهاء
                    </button>
                  )}
                  <button onClick={() => act(r, "deleteSession")} disabled={busy === r.id} className="abtn abtn-danger abtn-sm">
                    حذف
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {results && (
        <Modal title={`${results.row.emoji} ${results.row.title} — النتائج`} onClose={() => setResults(null)}>
          {results.board.length === 0 ? (
            <p className="font-bold text-mute">ما فيه لاعبين</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {results.board.map((e) => (
                <li key={e.playerId} className={`panel-sm flex items-center gap-3 px-3 py-2 ${e.rank === 1 ? "bg-sun" : "bg-card"}`}>
                  <span className="w-8 text-center font-display text-xl">
                    {e.rank <= 3 ? ["🥇", "🥈", "🥉"][e.rank - 1] : e.rank}
                  </span>
                  <span className="flex-1 truncate font-extrabold">{e.name}</span>
                  <span className="font-display text-xl tabular-nums">{e.score}</span>
                </li>
              ))}
            </ol>
          )}
        </Modal>
      )}
    </div>
  );
}
