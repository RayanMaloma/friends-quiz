"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { hostStore } from "@/lib/client/storage";
import type { GameRecord, GameSummary } from "@/lib/types";
import { TEMPLATES, type TemplateId } from "@/lib/game/doc";
import { ACCENT_HEX } from "@/lib/colors";
import { peopleLabel, questionsLabel } from "@/lib/format";
import { Spinner } from "@/components/ui";
import { Modal, Segmented, StatusPill } from "@/components/admin/ui";

type Filter = "active" | "published" | "draft" | "archived";

export default function AdminGamesPage() {
  const router = useRouter();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await api<{ games: GameSummary[] }>("/api/admin", { action: "listGames" });
    if (res.ok) setGames(res.games);
    else setError(errorMessage(res.error));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function create(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setError(null);
    const res = await api<{ game: GameRecord }>("/api/admin", { action, ...extra });
    setBusy(null);
    if (!res.ok) {
      setError(errorMessage(res.error));
      return;
    }
    router.push(`/admin/games/${res.game.id}`);
  }

  async function act(id: string, action: string, extra: Record<string, unknown> = {}) {
    setBusy(id);
    setError(null);
    const res = await api("/api/admin", { action, id, ...extra });
    setBusy(null);
    if (!res.ok) setError(errorMessage(res.error));
    await load();
  }

  async function play(id: string) {
    setBusy(id);
    setError(null);
    const res = await api<{ sessionId: string; code: string; hostToken: string }>("/api/host", {
      action: "create",
      gameId: id,
    });
    setBusy(null);
    if (!res.ok) {
      setError(errorMessage(res.error));
      return;
    }
    hostStore.save({ sessionId: res.sessionId, code: res.code, hostToken: res.hostToken });
    router.push(`/host/${res.sessionId}`);
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const doc = JSON.parse(await file.text());
      await create("importGame", { doc });
    } catch {
      setError("الملف مو ملف لعبة صالح (JSON)");
    }
  }

  const visible =
    games?.filter((g) => (filter === "active" ? g.status !== "archived" : g.status === filter)) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl">ألعابك 🎮</h1>
        <div className="flex gap-2">
          <button onClick={() => importInput.current?.click()} className="btn btn-ghost h-12 px-4 text-lg">
            استيراد
          </button>
          <button onClick={() => setShowNew(true)} className="btn btn-primary h-12 px-5 text-xl">
            + لعبة جديدة
          </button>
        </div>
        <input
          ref={importInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {error && <p className="chunk-sm bg-pink px-3 py-2 font-bold text-white">{error}</p>}

      {games === null ? (
        <Spinner className="mx-auto mt-10 size-8 text-ink" />
      ) : games.length === 0 ? (
        <EmptyState busy={busy} onLegacy={() => create("importLegacy")} onNew={() => setShowNew(true)} />
      ) : (
        <>
          <Segmented
            value={filter}
            onChange={setFilter}
            size="sm"
            options={[
              { value: "active", label: `الكل (${games.filter((g) => g.status !== "archived").length})` },
              { value: "published", label: "منشورة" },
              { value: "draft", label: "مسودات" },
              { value: "archived", label: "الأرشيف" },
            ]}
          />
          {visible.length === 0 ? (
            <p className="py-10 text-center font-bold text-mute">ما فيه ألعاب هنا</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((g) => (
                <GameCard key={g.id} game={g} busy={busy === g.id} onPlay={() => play(g.id)} onAct={(a, x) => act(g.id, a, x)} />
              ))}
            </ul>
          )}
        </>
      )}

      {showNew && (
        <Modal title="لعبة جديدة — اختار قالب" onClose={() => setShowNew(false)} wide>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <li key={t.id}>
                <button
                  disabled={!!busy}
                  onClick={() => create("createGame", { template: t.id satisfies TemplateId })}
                  className="chunk-sm flex h-full w-full flex-col items-start gap-1 bg-card p-4 text-start transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                >
                  <span className="text-3xl">{t.emoji}</span>
                  <span className="font-display text-xl">{t.title}</span>
                  <span className="text-sm font-bold text-mute">{t.description}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs font-bold text-mute">القالب بس نقطة بداية — كل شي قابل للتعديل بعدين.</p>
        </Modal>
      )}
    </div>
  );
}

function EmptyState({ busy, onLegacy, onNew }: { busy: string | null; onLegacy: () => void; onNew: () => void }) {
  return (
    <div className="chunk mx-auto mt-6 flex max-w-xl flex-col items-center gap-4 bg-card p-8 text-center">
      <span className="text-6xl">🎲</span>
      <h2 className="font-display text-3xl">ما عندك ألعاب للحين</h2>
      <p className="font-bold text-mute">ابدأ لعبة جديدة من قالب، أو رجّع لعبة «عن مين؟» الأصلية بكل معلوماتها وصورها.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button onClick={onNew} className="btn btn-primary h-14 px-6 text-xl">
          + لعبة جديدة
        </button>
        <button onClick={onLegacy} disabled={!!busy} className="btn btn-ghost h-14 px-6 text-xl">
          {busy === "importLegacy" && <Spinner />}
          استيراد «عن مين؟» الأصلية
        </button>
      </div>
    </div>
  );
}

function GameCard({
  game: g,
  busy,
  onPlay,
  onAct,
}: {
  game: GameSummary;
  busy: boolean;
  onPlay: () => void;
  onAct: (action: string, extra?: Record<string, unknown>) => void;
}) {
  const [menu, setMenu] = useState(false);
  const updated = new Date(g.updatedAt).toLocaleDateString("ar-SA-u-nu-latn", { day: "numeric", month: "short" });
  return (
    <li className="chunk relative flex flex-col gap-3 bg-card p-4">
      <div className="flex items-start gap-3">
        <span
          className="chunk-sm grid size-14 shrink-0 -rotate-6 place-items-center text-3xl"
          style={{ background: ACCENT_HEX[g.accent] }}
        >
          {g.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <Link href={`/admin/games/${g.id}`} className="block truncate font-display text-2xl leading-tight hover:underline">
            {g.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-mute">
            <StatusPill status={g.status} />
            <span>{questionsLabel(g.questionCount)}</span>
            {g.peopleCount > 0 && <span>· {peopleLabel(g.peopleCount)}</span>}
            {g.sessionCount > 0 && <span>· لُعبت {g.sessionCount} مرة</span>}
            <span>· {updated}</span>
          </div>
        </div>
        <button onClick={() => setMenu((m) => !m)} className="btn btn-ghost size-10 shrink-0 text-lg" aria-label="خيارات">
          ⋯
        </button>
      </div>
      {menu && (
        <div className="chunk-sm absolute end-4 top-16 z-10 flex min-w-40 flex-col bg-card py-1" onMouseLeave={() => setMenu(false)}>
          <MenuItem onClick={() => onAct("duplicateGame")}>نسخ اللعبة</MenuItem>
          {g.status === "archived" ? (
            <MenuItem onClick={() => onAct("setStatus", { status: "draft" })}>استرجاع من الأرشيف</MenuItem>
          ) : (
            <MenuItem onClick={() => onAct("setStatus", { status: "archived" })}>أرشفة</MenuItem>
          )}
          <MenuItem
            danger
            onClick={() => {
              if (window.confirm(`حذف «${g.title}» نهائياً؟ ما ينفع ترجعها.`)) onAct("deleteGame");
            }}
          >
            حذف نهائي
          </MenuItem>
        </div>
      )}
      <div className="flex gap-2">
        <Link href={`/admin/games/${g.id}`} className="btn btn-ghost h-11 flex-1 text-lg">
          تعديل
        </Link>
        <button
          onClick={onPlay}
          disabled={busy || g.status === "archived" || g.questionCount === 0}
          className="btn btn-primary h-11 flex-1 text-lg"
        >
          {busy ? <Spinner className="size-4" /> : "📺"} تشغيل
        </button>
      </div>
    </li>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`px-4 py-2 text-start font-bold hover:bg-cream ${danger ? "text-pink" : ""}`}>
      {children}
    </button>
  );
}
