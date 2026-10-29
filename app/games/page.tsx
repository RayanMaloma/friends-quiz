"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, errorMessage } from "@/lib/client/api";
import { hostStore } from "@/lib/client/storage";
import { ACCENT_HEX } from "@/lib/colors";
import type { Me } from "@/lib/auth";
import type { CatalogKind, Visibility } from "@/lib/catalog";
import type { Accent } from "@/lib/types";
import { Brand, Decor, Spinner } from "@/components/ui";
import { AuthChoice, AuthStage } from "@/components/auth/AuthForms";

interface Game {
  key: string;
  kind: CatalogKind;
  title: string;
  emoji: string;
  accent: Accent;
  minPlayers: number | null;
  maxPlayers: number | null;
  questionCount: number | null;
  /** Privileged viewers only. */
  visibility?: Visibility;
  status?: "published" | "draft";
}

interface MySession {
  id: string;
  code: string;
  kind: CatalogKind;
  title: string | null;
  emoji: string | null;
  player_count: number;
}

const HOST_PATH: Record<CatalogKind, string> = { quiz: "/host", deduction: "/dx/host", mafia: "/mafia/host", invent: "/invent/host" };

/** Still-running room this browser holds the host token of (each kind answers on its own endpoint). */
async function localRoom(creds: { sessionId: string; code: string; hostToken: string }): Promise<MySession | null> {
  const quiz = await api<{ view: { status: string } }>("/api/host", { action: "state", ...creds });
  if (quiz.ok) return quiz.view.status === "FINISHED" ? null : { id: creds.sessionId, code: creds.code, kind: "quiz", title: null, emoji: null, player_count: 0 };
  const kind = ({ DX_SESSION: "deduction", MAFIA_SESSION: "mafia", INVENT_SESSION: "invent" } as const)[quiz.error as "DX_SESSION"];
  if (!kind) return null;
  const endpoint = kind === "deduction" ? "/api/dx" : kind === "mafia" ? "/api/mafia" : "/api/invent";
  const res = await api<{ view: { status: string } }>(endpoint, { action: "state", as: "host", ...creds });
  return res.ok && res.view.status !== "FINISHED" ? { id: creds.sessionId, code: creds.code, kind, title: null, emoji: null, player_count: 0 } : null;
}

/**
 * Game selection («اختر لعبة»). Signed out: two cards (sign in / register).
 * Signed in: the games this account may open — the server only sends public
 * ones to regular users — and its own rooms that are still open.
 */
export default function GamesPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [games, setGames] = useState<Game[] | null>(null);
  const [mine, setMine] = useState<MySession[]>([]);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const who = await api<Me>("/api/auth", { action: "me" });
    if (!who.ok) {
      setError(errorMessage(who.error));
      return;
    }
    setMe({ user: who.user, gm: who.gm });
    if (!who.user && !who.gm) return;
    const [list, sessions] = await Promise.all([
      api<{ games: Game[] }>("/api/catalog", { action: "list" }),
      api<{ sessions: MySession[] }>("/api/catalog", { action: "mySessions" }),
    ]);
    if (list.ok) setGames(list.games);
    else setError(errorMessage(list.error));
    const own = sessions.ok ? sessions.sessions : [];
    // The room this browser hosted last (also rooms opened with the dashboard password, which have no owner).
    const last = hostStore.last();
    const local = last && !own.some((s) => s.id === last.sessionId) ? await localRoom(last) : null;
    setMine(local ? [local, ...own] : own);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  function open(kind: CatalogKind, creds: { sessionId: string; code: string; hostToken: string }) {
    hostStore.save(creds);
    router.push(`${HOST_PATH[kind]}/${creds.sessionId}`);
  }

  async function start(game: Game) {
    if (creating) return;
    // A public «اخترع إجابتك» room starts with its host's own questions.
    if (game.key === "invent") {
      router.push("/invent/new");
      return;
    }
    setCreating(game.key);
    setError(null);
    const endpoint = game.kind === "mafia" ? "/api/mafia" : game.kind === "invent" ? "/api/invent" : game.kind === "deduction" ? "/api/dx" : "/api/host";
    const body = game.kind === "mafia" ? {} : game.kind === "invent" ? { questionSet: "ahaji" } : { gameId: game.key };
    const res = await api<{ sessionId: string; code: string; hostToken: string }>(endpoint, { action: "create", ...body });
    if (!res.ok) {
      setError(errorMessage(res.error));
      setCreating(null);
      return;
    }
    open(game.kind, res);
  }

  async function resume(s: MySession) {
    const local = hostStore.get(s.id);
    if (local) {
      router.push(`${HOST_PATH[s.kind]}/${s.id}`);
      return;
    }
    setCreating(s.id);
    const res = await api<{ sessionId: string; code: string; hostToken: string; kind: CatalogKind }>("/api/catalog", { action: "resume", sessionId: s.id });
    if (!res.ok) {
      setError(errorMessage(res.error));
      setCreating(null);
      return;
    }
    open(res.kind, res);
  }

  async function logout() {
    await api("/api/auth", { action: "logout" });
    router.replace("/");
  }

  if (me && !me.user && !me.gm) {
    return (
      <AuthStage>
        <AuthChoice />
      </AuthStage>
    );
  }

  const privileged = me?.gm || me?.user?.role === "super_admin";

  return (
    <main className="safe-pad relative flex min-h-dvh flex-col items-center gap-8 overflow-hidden pb-16 pt-6">
      <Decor />
      <header className="relative flex w-full max-w-5xl items-center gap-2">
        <Link href="/" aria-label="الرئيسية">
          <Brand className="anim-pop text-4xl sm:text-5xl" />
        </Link>
        <div className="ms-auto flex items-center gap-2">
          {privileged && (
            <Link href="/admin" className="abtn abtn-sm">
              لوحة التحكم
            </Link>
          )}
          {me && (
            <button onClick={logout} className="abtn abtn-quiet abtn-sm text-mute" title={me.user?.email}>
              خروج
            </button>
          )}
        </div>
      </header>

      {mine.length > 0 && (
        <section className="relative flex w-full max-w-5xl flex-wrap justify-center gap-3">
          {mine.map((s) => (
            <button key={s.id} onClick={() => resume(s)} disabled={!!creating} className="btn btn-primary anim-rise h-16 px-6 text-xl">
              {creating === s.id ? <Spinner /> : <span aria-hidden>{s.emoji ?? "🎲"}</span>}
              كمّل {s.title ?? "اللعبة"} ({s.code})
            </button>
          ))}
        </section>
      )}

      <section className="relative flex w-full max-w-5xl flex-col gap-4">
        <h1 className="text-center font-display text-4xl">وش نلعب اليوم؟</h1>
        {error && <p className="text-center font-bold text-pink">{error}</p>}
        {games === null ? (
          <Spinner className="mx-auto size-8 text-ink" />
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((g, i) => (
              <li key={g.key} className="anim-rise" style={{ animationDelay: `${i * 60}ms` }}>
                <GameCard game={g} busy={creating === g.key} disabled={!!creating} onStart={() => start(g)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/** Dark cinematic covers for the built-in games, the chunky card for authored ones. */
const COVERS: Partial<Record<string, { bg: string; fg: string; accent: string }>> = {
  mafia: { bg: "radial-gradient(120% 140% at 85% 0%, #490F19 0%, #17191D 45%, #08090B 100%)", fg: "#E6DCC9", accent: "#C3A46B" },
  invent: { bg: "radial-gradient(120% 140% at 85% 0%, #3a2a0c 0%, #17181d 50%, #0c0d10 100%)", fg: "#f3ead8", accent: "#f5c242" },
  invent_ahaji: { bg: "radial-gradient(120% 140% at 85% 0%, #3a2a0c 0%, #17181d 50%, #0c0d10 100%)", fg: "#f3ead8", accent: "#f5c242" },
};

function GameCard({ game: g, busy, disabled, onStart }: { game: Game; busy: boolean; disabled: boolean; onStart: () => void }) {
  const cover = COVERS[g.key];
  const meta = [
    g.minPlayers && g.maxPlayers ? `${g.minPlayers}–${g.maxPlayers} لاعب` : null,
    g.kind === "quiz" && g.questionCount ? `${g.questionCount} سؤال` : null,
    g.visibility === "private" ? "🔒" : null,
    g.status === "draft" ? "مسودة" : null,
  ].filter(Boolean);
  return (
    <button
      onClick={onStart}
      disabled={disabled || (g.kind === "quiz" && !g.questionCount)}
      className={`group flex h-full w-full flex-col items-start gap-2 p-5 text-start transition-transform hover:-translate-y-1 disabled:opacity-60 ${
        cover ? "rounded-[1.75rem] border-4 border-ink shadow-[0_6px_0_#20163a]" : "chunk bg-card"
      }`}
      style={cover ? { background: cover.bg, color: cover.fg } : undefined}
    >
      <span
        className="chunk-sm grid size-16 -rotate-6 place-items-center text-4xl"
        style={{ background: cover ? cover.accent : ACCENT_HEX[g.accent] }}
      >
        {busy ? <Spinner className="size-7" /> : g.emoji}
      </span>
      <span className="font-display text-3xl leading-tight" style={cover ? { color: cover.accent } : undefined}>
        {g.title}
      </span>
      {meta.length > 0 && <span className="text-sm font-bold opacity-75">{meta.join(" · ")}</span>}
    </button>
  );
}
