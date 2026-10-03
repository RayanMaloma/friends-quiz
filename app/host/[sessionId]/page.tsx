"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { hostKey, type HostCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import type { HostView } from "@/lib/types";
import { PEOPLE } from "@/lib/people";
import { Brand, ConnectionBanner, Spinner } from "@/components/ui";
import { PortraitPreloader } from "@/components/PersonImage";
import {
  AnswerProgress,
  HostFinished,
  HostLeaderboard,
  HostLobby,
  HostQuestion,
  HostReveal,
} from "@/components/host/HostScreens";
import { PlayersPanel } from "@/components/host/PlayersPanel";
import { PeekingFriends } from "@/components/host/PeekingFriends";

type HostAction = "start" | "reveal" | "leaderboard" | "next" | "finish";

export default function HostGamePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const creds = useStored<HostCreds>(hostKey(sessionId));

  if (creds === undefined) return <FullScreenCenter><Spinner className="size-10 text-ink" /></FullScreenCenter>;
  if (creds === null) {
    return (
      <FullScreenCenter>
        <p className="font-display text-4xl">{errorMessage("FORBIDDEN")}</p>
        <Link href="/host" className="btn btn-primary h-16 px-8 text-2xl">إنشاء لعبة جديدة</Link>
      </FullScreenCenter>
    );
  }
  return <HostGame creds={creds} />;
}

function HostGame({ creds }: { creds: HostCreds }) {
  useWakeLock();
  const { sessionId, hostToken } = creds;

  const fetchView = useCallback(
    () => api<{ view: HostView }>("/api/host", { action: "state", sessionId, hostToken }),
    [sessionId, hostToken],
  );
  const { view, fatalError, connected, mutate } = useGameSync<HostView>(sessionId, fetchView);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPlayers, setShowPlayers] = useState(false);

  const runAction = useCallback(
    async (action: HostAction) => {
      if (!view || busy) return;
      setBusy(true);
      setActionError(null);
      const res = await mutate(() =>
        api<{ view: HostView }>("/api/host", {
          action,
          sessionId,
          hostToken,
          expectedIndex: view.currentIndex,
        }),
      );
      if (!res.ok) setActionError(errorMessage(res.error));
      setBusy(false);
    },
    [view, busy, mutate, sessionId, hostToken],
  );

  const release = useCallback(
    async (playerId: string) => {
      const res = await mutate(() =>
        api<{ view: HostView }>("/api/host", { action: "release", sessionId, hostToken, playerId }),
      );
      if (!res.ok) setActionError(errorMessage(res.error));
    },
    [mutate, sessionId, hostToken],
  );

  const primary = view ? primaryAction(view) : null;

  // Keyboard: Space / Enter / → triggers the primary action (handy on a TV laptop).
  const primaryRef = useRef<() => void>(() => {});
  useEffect(() => {
    primaryRef.current = () => {
      if (primary && !primary.disabled) void runAction(primary.action);
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["BUTTON", "INPUT", "TEXTAREA", "A"].includes(target.tagName)) return;
      if (e.repeat) return;
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowLeft") {
        e.preventDefault();
        primaryRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (fatalError) {
    return (
      <FullScreenCenter>
        <p className="font-display text-4xl">{errorMessage(fatalError)}</p>
        <Link href="/host" className="btn btn-primary h-16 px-8 text-2xl">رجوع</Link>
      </FullScreenCenter>
    );
  }
  if (!view) return <FullScreenCenter><Spinner className="size-10 text-ink" /></FullScreenCenter>;

  return (
    <main className="relative flex h-dvh flex-col gap-[2.5vh] overflow-hidden px-[3.5vw] py-[3vh]">
      <ConnectionBanner show={!connected} />
      <PortraitPreloader personIds={PEOPLE.map((p) => p.id)} />
      {view.status === "LOBBY" && <PeekingFriends />}

      {/* Header */}
      <header className="relative z-10 flex shrink-0 items-center justify-between">
        <Brand className="text-[5vh]" />
        <div className="flex items-center gap-[1vw]">
          {view.status !== "LOBBY" && (
            <span className="chunk-sm bg-card px-[1.2vw] pb-[0.2vh] pt-[0.9vh] font-display text-[2.8vh] leading-none">
              رمز الدخول <span dir="ltr" className="tabular-nums">{view.code}</span>
            </span>
          )}
          <button
            onClick={() => setShowPlayers(true)}
            className="btn btn-ghost h-[5.4vh] px-[1.2vw] text-[2.6vh]"
          >
            اللاعبين
          </button>
          <button
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.().catch(() => {});
            }}
            className="btn btn-ghost h-[5.4vh] px-[1.2vw] text-[2.6vh]"
            title="ملء الشاشة"
          >
            ⛶
          </button>
        </div>
      </header>

      {/* Stage */}
      {view.status === "LOBBY" && <HostLobby view={view} />}
      {view.status === "QUESTION" && view.question && <HostQuestion view={view} />}
      {view.status === "REVEAL" && view.reveal && <HostReveal view={view} />}
      {view.status === "LEADERBOARD" && <HostLeaderboard view={view} />}
      {view.status === "FINISHED" && <HostFinished view={view} />}

      {/* Controls */}
      <footer className="relative z-10 flex h-[10vh] shrink-0 items-center justify-between gap-[2vw]">
        <div className="min-w-0 flex-1">
          {view.status === "QUESTION" && view.question && (
            <AnswerProgress answered={view.question.answeredCount} eligible={view.question.eligibleCount} />
          )}
          {actionError && <p className="text-[2.4vh] font-bold text-pink">{actionError}</p>}
        </div>
        {primary && (
          <button
            onClick={() => void runAction(primary.action)}
            disabled={busy || primary.disabled}
            className={`btn btn-primary btn-tv h-[9.5vh] min-w-[24vw] px-[2.4vw] text-[4.6vh] ${
              primary.pulse && !busy ? "anim-nudge" : ""
            }`}
          >
            {busy && <Spinner className="size-[3.4vh]" />}
            {primary.label}
          </button>
        )}
        {view.status === "FINISHED" && (
          <Link href="/host" className="btn btn-ghost btn-tv h-[8vh] px-[2.4vw] text-[3.4vh]">
            لعبة جديدة
          </Link>
        )}
      </footer>

      {showPlayers && (
        <PlayersPanel view={view} onClose={() => setShowPlayers(false)} onRelease={release} />
      )}
    </main>
  );
}

function primaryAction(view: HostView): {
  action: HostAction;
  label: string;
  disabled?: boolean;
  pulse?: boolean;
} | null {
  switch (view.status) {
    case "LOBBY":
      return { action: "start", label: "ابدأ اللعبة", disabled: view.players.length === 0, pulse: view.players.length > 1 };
    case "QUESTION": {
      const q = view.question;
      const all = !!q && q.eligibleCount > 0 && q.answeredCount >= q.eligibleCount;
      return { action: "reveal", label: "إظهار الشخص", pulse: all };
    }
    case "REVEAL":
      return { action: "leaderboard", label: "عرض الترتيب" };
    case "LEADERBOARD":
      return view.isLastQuestion
        ? { action: "finish", label: "النتائج النهائية 🏆", pulse: true }
        : { action: "next", label: "المعلومة التالية" };
    default:
      return null;
  }
}

function FullScreenCenter({ children }: { children: React.ReactNode }) {
  return (
    <main className="safe-pad flex min-h-dvh flex-col items-center justify-center gap-6 text-center">
      {children}
    </main>
  );
}
