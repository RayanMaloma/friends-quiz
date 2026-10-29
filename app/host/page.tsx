"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, errorMessage } from "@/lib/client/api";
import { hostStore, type HostCreds } from "@/lib/client/storage";
import type { GameSummary, HostView } from "@/lib/types";
import { ACCENT_HEX } from "@/lib/colors";
import { peopleLabel, questionsLabel } from "@/lib/format";
import { Brand, Decor, Spinner } from "@/components/ui";
import { LoginForm } from "@/components/admin/LoginForm";

/** TV entry: pick a game and open a room (admin only), or resume the running one. */
export default function HostEntryPage() {
  const router = useRouter();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [resumable, setResumable] = useState<(HostCreds & { dx?: boolean; mafia?: boolean; invent?: boolean }) | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ games: GameSummary[] }>("/api/admin", { action: "listGames" });
    if (!res.ok) {
      if (res.error === "ADMIN_REQUIRED") setNeedsLogin(true);
      else setError(errorMessage(res.error));
      setGames([]);
      return;
    }
    setNeedsLogin(false);
    setGames(res.games.filter((g) => g.status !== "archived"));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    // Offer to resume an unfinished session this browser is hosting.
    const last = hostStore.last();
    if (last) {
      void api<{ view: HostView }>("/api/host", {
        action: "state",
        sessionId: last.sessionId,
        hostToken: last.hostToken,
      }).then((res) => {
        if (res.ok && res.view.status !== "FINISHED") setResumable(last);
        // A deduction room answers on its own endpoint.
        else if (!res.ok && res.error === "DX_SESSION") {
          void api<{ view: { status: string } }>("/api/dx", { action: "state", as: "host", ...last }).then((dx) => {
            if (dx.ok && dx.view.status !== "FINISHED") setResumable({ ...last, dx: true });
          });
        } else if (!res.ok && res.error === "MAFIA_SESSION") {
          void api<{ view: { status: string } }>("/api/mafia", { action: "state", as: "host", ...last }).then((mf) => {
            if (mf.ok && mf.view.status !== "FINISHED") setResumable({ ...last, mafia: true });
          });
        } else if (!res.ok && res.error === "INVENT_SESSION") {
          void api<{ view: { status: string } }>("/api/invent", { action: "state", as: "host", ...last }).then((iv) => {
            if (iv.ok && iv.view.status !== "FINISHED") setResumable({ ...last, invent: true });
          });
        }
      });
    }
  }, [load]);

  /** The built-in games (Mafia, اخترع إجابتك): no game to pick, the rules live in code. */
  async function startBuiltIn(kind: "mafia" | "invent") {
    if (creating) return;
    setCreating(kind);
    setError(null);
    const res = await api<{ sessionId: string; code: string; hostToken: string }>(`/api/${kind}`, { action: "create" });
    if (!res.ok) {
      setError(errorMessage(res.error));
      setCreating(null);
      return;
    }
    hostStore.save({ sessionId: res.sessionId, code: res.code, hostToken: res.hostToken });
    router.push(`/${kind}/host/${res.sessionId}`);
  }

  async function start(gameId: string) {
    if (creating) return;
    setCreating(gameId);
    setError(null);
    const dx = games?.find((g) => g.id === gameId)?.kind === "deduction";
    const res = await api<{ sessionId: string; code: string; hostToken: string }>(dx ? "/api/dx" : "/api/host", {
      action: "create",
      gameId,
    });
    if (!res.ok) {
      setError(errorMessage(res.error));
      setCreating(null);
      return;
    }
    hostStore.save({ sessionId: res.sessionId, code: res.code, hostToken: res.hostToken });
    router.push(dx ? `/dx/host/${res.sessionId}` : `/host/${res.sessionId}`);
  }

  if (needsLogin) {
    return <LoginForm hint="تشغيل لعبة يحتاج دخول لوحة التحكم (مرة وحدة على هذا الجهاز)." onSuccess={load} />;
  }

  const published = games?.filter((g) => g.status === "published") ?? [];
  const drafts = games?.filter((g) => g.status === "draft") ?? [];

  return (
    <main className="safe-pad relative flex min-h-dvh flex-col items-center gap-8 overflow-hidden pb-16 pt-10">
      <Decor />
      <Brand className="anim-pop relative text-7xl" />

      {resumable && (
        <Link href={resumable.invent ? `/invent/host/${resumable.sessionId}` : resumable.mafia ? `/mafia/host/${resumable.sessionId}` : resumable.dx ? `/dx/host/${resumable.sessionId}` : `/host/${resumable.sessionId}`} className="btn btn-primary anim-rise relative h-20 px-10 text-3xl">
          كمّل اللعبة الحالية ({resumable.code})
        </Link>
      )}

      <section className="relative flex w-full max-w-5xl flex-col gap-4">
        <h1 className="text-center font-display text-4xl">وش نلعب اليوم؟</h1>
        {error && <p className="text-center font-bold text-pink">{error}</p>}
        <InventCard creating={creating} onStart={() => startBuiltIn("invent")} />
        <MafiaCard creating={creating} onStart={() => startBuiltIn("mafia")} />
        {games === null ? (
          <Spinner className="mx-auto size-8 text-ink" />
        ) : published.length === 0 ? (
          <div className="chunk mx-auto flex max-w-md flex-col items-center gap-3 bg-card p-6 text-center">
            <p className="font-display text-2xl">ما فيه ألعاب منشورة</p>
            <p className="font-bold text-mute">سوّ لعبة من لوحة التحكم وانشرها، وبتطلع هنا.</p>
            <Link href="/admin" className="btn btn-primary h-14 px-6 text-xl">
              لوحة التحكم
            </Link>
          </div>
        ) : (
          <GameGrid games={published} creating={creating} onStart={start} />
        )}
      </section>

      {drafts.length > 0 && (
        <section className="relative flex w-full max-w-5xl flex-col gap-3">
          <button onClick={() => setShowDrafts((v) => !v)} className="self-center font-bold text-mute underline underline-offset-4">
            {showDrafts ? "إخفاء المسودات" : `تجربة مسودة (${drafts.length})`}
          </button>
          {showDrafts && <GameGrid games={drafts} creating={creating} onStart={start} />}
        </section>
      )}

      <p className="relative max-w-md text-center font-bold text-mute">
        افتح هذي الصفحة على الجهاز الموصول بالتلفزيون. الجوالات تدخل من صفحة «دخول لعبة».
      </p>
    </main>
  );
}

function GameGrid({
  games,
  creating,
  onStart,
}: {
  games: GameSummary[];
  creating: string | null;
  onStart: (id: string) => void;
}) {
  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {games.map((g, i) => (
        <li key={g.id} className="anim-rise" style={{ animationDelay: `${i * 60}ms` }}>
          <button
            onClick={() => onStart(g.id)}
            disabled={!!creating || (g.kind === "quiz" && g.questionCount === 0)}
            className="chunk group flex w-full flex-col items-start gap-2 bg-card p-5 text-start transition-transform hover:-translate-y-1 disabled:opacity-50"
          >
            <span
              className="chunk-sm grid size-16 -rotate-6 place-items-center text-4xl"
              style={{ background: ACCENT_HEX[g.accent] }}
            >
              {creating === g.id ? <Spinner className="size-7" /> : g.emoji}
            </span>
            <span className="font-display text-3xl leading-tight">{g.title}</span>
            <span className="text-sm font-bold text-mute">
              {g.kind === "deduction"
                ? `أدوار سرّية · ${g.minPlayers ?? "?"}–${g.maxPlayers ?? "?"} لاعبين`
                : questionsLabel(g.questionCount)}
              {g.kind === "quiz" && g.peopleCount > 0 ? ` · ${peopleLabel(g.peopleCount)}` : ""}
              {g.status === "draft" ? " · مسودة" : ""}
            </span>
            <span className="mt-1 font-display text-xl text-ink/70 group-hover:text-ink">افتح الغرفة ←</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The built-in Mafia game (fixed rules, nothing to set up in the dashboard). */
function MafiaCard({ creating, onStart }: { creating: string | null; onStart: () => void }) {
  return (
    <button
      onClick={onStart}
      disabled={!!creating}
      className="anim-rise group relative flex w-full items-center gap-5 overflow-hidden rounded-3xl border-4 border-ink p-6 text-start shadow-[6px_6px_0_#1b1b1b] transition-transform hover:-translate-y-1 disabled:opacity-60"
      style={{ background: "radial-gradient(120% 140% at 85% 0%, #490F19 0%, #17191D 45%, #08090B 100%)", color: "#E6DCC9" }}
    >
      <span className="grid size-20 shrink-0 place-items-center rounded-2xl border-2 text-5xl" style={{ borderColor: "#C3A46B" }}>
        {creating === "mafia" ? <Spinner className="size-8" /> : "🌒"}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-display text-4xl leading-tight" style={{ color: "#C3A46B" }}>المافيا</span>
        <span className="text-sm font-bold opacity-80">قتلة، شايب، طبيب ومواطنين · ٤–١٢ لاعب · التلفزيون هو الراوي</span>
      </span>
      <span className="ms-auto hidden font-display text-xl opacity-70 group-hover:opacity-100 sm:block">افتح الغرفة ←</span>
    </button>
  );
}

/** The built-in «اخترع إجابتك» game (46 fixed questions, settings in its own lobby). */
function InventCard({ creating, onStart }: { creating: string | null; onStart: () => void }) {
  return (
    <button
      onClick={onStart}
      disabled={!!creating}
      className="anim-rise group relative flex w-full items-center gap-5 overflow-hidden rounded-3xl border-4 border-ink p-6 text-start shadow-[6px_6px_0_#1b1b1b] transition-transform hover:-translate-y-1 disabled:opacity-60"
      style={{ background: "radial-gradient(120% 140% at 85% 0%, #3a2a0c 0%, #17181d 50%, #0c0d10 100%)", color: "#f3ead8" }}
    >
      <span className="grid size-20 shrink-0 rotate-[-6deg] place-items-center rounded-2xl text-5xl" style={{ background: "#f5c242", color: "#17181d" }}>
        {creating === "invent" ? <Spinner className="size-8" /> : "💡"}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-display text-4xl leading-tight" style={{ color: "#f5c242" }}>اخترع إجابتك</span>
        <span className="text-sm font-bold opacity-80">كل واحد يألّف جواب، والكل يصوّت للأضحك · ٣–١٦ لاعب · ٤٦ سؤال</span>
      </span>
      <span className="ms-auto hidden font-display text-xl opacity-70 group-hover:opacity-100 sm:block">افتح الغرفة ←</span>
    </button>
  );
}
