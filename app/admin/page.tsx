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
import { Modal, Segmented, StatusPill, VisibilityToggle } from "@/components/admin/ui";
import type { CatalogEntry, Visibility } from "@/lib/catalog";

type Filter = "active" | "published" | "draft" | "archived";

const DX_TEMPLATES = [
  { id: "classic", emoji: "🕵️", title: "هتلر السرّي", description: "الليبراليون ضد الفاشيين، ٥–١٠ لاعبين. الأسماء والبطاقات والقوانين كلها قابلة للتعديل." },
  { id: "shadow", emoji: "🌒", title: "مجلس الظلال", description: "نفس اللعبة بشكل فانتازيا مظلمة: الحرّاس ضد الطائفة والليتش." },
];

export default function AdminGamesPage() {
  const router = useRouter();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [ahaji, setAhaji] = useState<{ id: string; text: string }[] | null>(null);
  const [copied, setCopied] = useState<{ title: string; removed: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [res, cat] = await Promise.all([
      api<{ games: GameSummary[] }>("/api/admin", { action: "listGames" }),
      api<{ catalog: CatalogEntry[] }>("/api/admin", { action: "catalog" }),
    ]);
    if (res.ok) setGames(res.games);
    else setError(errorMessage(res.error));
    if (cat.ok) setCatalog(cat.catalog);
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
    router.push(action.startsWith("dx") ? `/admin/dx/${res.game.id}` : `/admin/games/${res.game.id}`);
  }

  async function act(id: string, action: string, extra: Record<string, unknown> = {}) {
    setBusy(id);
    setError(null);
    const res = await api("/api/admin", { action, id, ...extra });
    setBusy(null);
    if (!res.ok) setError(errorMessage(res.error));
    await load();
  }

  async function setVisibility(key: string, visibility: Visibility) {
    setBusy(key);
    const res = await api("/api/admin", { action: "setVisibility", key, visibility });
    setBusy(null);
    if (!res.ok) setError(errorMessage(res.error));
    await load();
  }

  async function makePublicCopy(id: string, title: string) {
    const name = window.prompt("اسم النسخة العامة", title);
    if (!name) return;
    setBusy(id);
    setError(null);
    const res = await api<{ game: GameRecord; removedNames: string[] }>("/api/admin", { action: "dxPublicCopy", id, title: name });
    setBusy(null);
    if (!res.ok) {
      setError(errorMessage(res.error));
      return;
    }
    setCopied({ title: name, removed: res.removedNames });
    await load();
  }

  async function playBuiltin(key: string) {
    if (key === "invent") {
      router.push("/invent/new");
      return;
    }
    setBusy(key);
    setError(null);
    const kind = key === "mafia" ? "mafia" : "invent";
    const res = await api<{ sessionId: string; code: string; hostToken: string }>(`/api/${kind}`, {
      action: "create",
      ...(key === "invent_ahaji" ? { questionSet: "ahaji" } : {}),
    });
    setBusy(null);
    if (!res.ok) {
      setError(errorMessage(res.error));
      return;
    }
    hostStore.save({ sessionId: res.sessionId, code: res.code, hostToken: res.hostToken });
    router.push(`/${kind}/host/${res.sessionId}`);
  }

  async function play(id: string, dx: boolean) {
    setBusy(id);
    setError(null);
    const res = await api<{ sessionId: string; code: string; hostToken: string }>(dx ? "/api/dx" : "/api/host", {
      action: "create",
      gameId: id,
    });
    setBusy(null);
    if (!res.ok) {
      setError(errorMessage(res.error));
      return;
    }
    hostStore.save({ sessionId: res.sessionId, code: res.code, hostToken: res.hostToken });
    router.push(dx ? `/dx/host/${res.sessionId}` : `/host/${res.sessionId}`);
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const doc = JSON.parse(await file.text());
      const dx = doc?.doc?.kind === "deduction" || doc?.kind === "deduction";
      await create(dx ? "dxImport" : "importGame", { doc });
    } catch {
      setError("الملف مو ملف لعبة صالح (JSON)");
    }
  }

  const visible =
    games?.filter((g) => (filter === "active" ? g.status !== "archived" : g.status === filter)) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl">الألعاب</h1>
        <div className="flex gap-2">
          <button onClick={() => importInput.current?.click()} className="abtn">
            استيراد
          </button>
          <button onClick={() => setShowNew(true)} className="abtn abtn-primary">
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

      {error && <p className="panel-sm bg-pink px-3 py-2 font-bold text-white">{error}</p>}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {catalog
          .filter((c) => c.builtin)
          .map((c) => (
            <li key={c.key} className="panel flex flex-col gap-3 bg-card p-4">
              <div className="flex items-start gap-3">
                <span className="panel-sm grid size-14 shrink-0 -rotate-6 place-items-center text-3xl" style={{ background: ACCENT_HEX[c.accent] }}>
                  {c.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-2xl leading-tight">{c.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-mute">
                    <VisibilityToggle value={c.visibility} disabled={busy === c.key} onChange={(v) => setVisibility(c.key, v)} />
                    <span>
                      {c.minPlayers}–{c.maxPlayers} لاعب
                    </span>
                    {c.questionCount !== null && <span>· {c.questionCount} سؤال</span>}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {c.key === "invent_ahaji" && (
                  <button
                    onClick={async () => {
                      const res = await api<{ questions: { id: string; text: string }[] }>("/api/admin", { action: "inventAhajiQuestions" });
                      if (res.ok) setAhaji(res.questions);
                    }}
                    className="abtn flex-1"
                  >
                    الأسئلة
                  </button>
                )}
                <button onClick={() => playBuiltin(c.key)} disabled={busy === c.key} className="abtn abtn-primary flex-1">
                  {busy === c.key ? <Spinner className="size-4" /> : "📺"} تشغيل
                </button>
              </div>
            </li>
          ))}
      </ul>

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
                <GameCard
                  key={g.id}
                  game={g}
                  busy={busy === g.id}
                  visibility={catalog.find((c) => c.key === g.id)?.visibility ?? "private"}
                  onVisibility={(v) => setVisibility(g.id, v)}
                  onPublicCopy={() => makePublicCopy(g.id, g.title)}
                  onPlay={() => play(g.id, g.kind === "deduction")}
                  onAct={(a, x) => act(g.id, a, x)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {ahaji && (
        <Modal title={`أسئلة أحاجي (${ahaji.length})`} onClose={() => setAhaji(null)} wide>
          <ol className="flex list-decimal flex-col gap-1.5 ps-6 text-sm font-bold">
            {ahaji.map((q) => (
              <li key={q.id}>{q.text}</li>
            ))}
          </ol>
        </Modal>
      )}

      {copied && (
        <Modal title={`«${copied.title}» جاهزة 🌐`} onClose={() => setCopied(null)}>
          <p className="font-bold">نفس القوانين، بدون أسماء أو صور.</p>
          {copied.removed.length > 0 && <p className="text-sm font-bold text-mute">انشالت: {copied.removed.join("، ")}</p>}
        </Modal>
      )}

      {showNew && (
        <Modal title="لعبة جديدة — اختار قالب" onClose={() => setShowNew(false)} wide>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <li key={t.id}>
                <button
                  disabled={!!busy}
                  onClick={() => create("createGame", { template: t.id satisfies TemplateId })}
                  className="panel-sm flex h-full w-full flex-col items-start gap-1 bg-card p-4 text-start transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                >
                  <span className="text-3xl">{t.emoji}</span>
                  <span className="font-display text-xl">{t.title}</span>
                  <span className="text-sm font-bold text-mute">{t.description}</span>
                </button>
              </li>
            ))}
          </ul>
          <h3 className="mt-2 font-display text-2xl">🕵️ ألعاب الأدوار السرّية</h3>
          <p className="-mt-2 text-sm font-bold text-mute">لعبة طاولة: كل لاعب يشوف دوره السرّي في جواله، يصوّتون من جوالاتهم، واللوحة على التلفزيون.</p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {DX_TEMPLATES.map((t) => (
              <li key={t.id}>
                <button
                  disabled={!!busy}
                  onClick={() => create("dxCreate", { template: t.id })}
                  className="panel-sm flex h-full w-full flex-col items-start gap-1 bg-card p-4 text-start transition-transform hover:-translate-y-0.5 disabled:opacity-50"
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
    <div className="panel mx-auto mt-6 flex max-w-xl flex-col items-center gap-4 bg-card p-8 text-center">
      <span className="text-6xl">🎲</span>
      <h2 className="font-display text-3xl">ما عندك ألعاب للحين</h2>
      <p className="font-bold text-mute">ابدأ لعبة جديدة من قالب، أو رجّع لعبة «عن مين؟» الأصلية بكل معلوماتها وصورها.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button onClick={onNew} className="abtn abtn-primary abtn-lg">
          + لعبة جديدة
        </button>
        <button onClick={onLegacy} disabled={!!busy} className="abtn abtn-lg">
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
  visibility,
  onVisibility,
  onPublicCopy,
  onPlay,
  onAct,
}: {
  game: GameSummary;
  busy: boolean;
  visibility: Visibility;
  onVisibility: (v: Visibility) => void;
  onPublicCopy: () => void;
  onPlay: () => void;
  onAct: (action: string, extra?: Record<string, unknown>) => void;
}) {
  const [menu, setMenu] = useState(false);
  const dx = g.kind === "deduction";
  const editHref = dx ? `/admin/dx/${g.id}` : `/admin/games/${g.id}`;
  const updated = new Date(g.updatedAt).toLocaleDateString("ar-SA-u-nu-latn", { day: "numeric", month: "short" });
  return (
    <li className="panel relative flex flex-col gap-3 bg-card p-4">
      <div className="flex items-start gap-3">
        <span
          className="panel-sm grid size-14 shrink-0 -rotate-6 place-items-center text-3xl"
          style={{ background: ACCENT_HEX[g.accent] }}
        >
          {g.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <Link href={editHref} className="block truncate font-display text-2xl leading-tight hover:underline">
            {g.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-mute">
            <StatusPill status={g.status} />
            {g.status !== "archived" && <VisibilityToggle value={visibility} disabled={busy} onChange={onVisibility} />}
            <span>{dx ? `أدوار سرّية · ${g.minPlayers ?? "?"}–${g.maxPlayers ?? "?"} لاعبين` : questionsLabel(g.questionCount)}</span>
            {!dx && g.peopleCount > 0 && <span>· {peopleLabel(g.peopleCount)}</span>}
            {g.sessionCount > 0 && <span>· لُعبت {g.sessionCount} مرة</span>}
            <span>· {updated}</span>
          </div>
        </div>
        <button onClick={() => setMenu((m) => !m)} className="abtn size-10 shrink-0" aria-label="خيارات">
          ⋯
        </button>
      </div>
      {menu && (
        <div className="panel-sm absolute end-4 top-16 z-10 flex min-w-40 flex-col bg-card py-1" onMouseLeave={() => setMenu(false)}>
          <MenuItem onClick={() => onAct(dx ? "dxDuplicate" : "duplicateGame")}>نسخ اللعبة</MenuItem>
          {dx && <MenuItem onClick={onPublicCopy}>نسخة عامة (بدون أسماء وصور)</MenuItem>}
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
        <Link href={editHref} className="abtn flex-1">
          تعديل
        </Link>
        <button
          onClick={onPlay}
          disabled={busy || g.status === "archived" || (!dx && g.questionCount === 0)}
          className="abtn abtn-primary flex-1"
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
