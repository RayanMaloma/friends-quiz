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

type HostAction = "start" | "reveal" | "leaderboard" | "next" | "finish";

export default function HostGamePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const creds = useStored<HostCreds>(hostKey(sessionId));

  if (creds === undefined) return <FullScreenCenter><Spinner className="size-10 text-sun" /></FullScreenCenter>;
  if (creds === null) {
    return (
      <FullScreenCenter>
        <p className="text-3xl font-black">{errorMessage("FORBIDDEN")}</p>
        <Link href="/host" className="btn btn-primary h-14 px-8 text-xl">إنشاء لعبة جديدة</Link>
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
    async (personId: string) => {
      const res = await mutate(() =>
        api<{ view: HostView }>("/api/host", { action: "release", sessionId, hostToken, personId }),
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
        <p className="text-3xl font-black">{errorMessage(fatalError)}</p>
        <Link href="/host" className="btn btn-primary h-14 px-8 text-xl">رجوع</Link>
      </FullScreenCenter>
    );
  }
  if (!view) return <FullScreenCenter><Spinner className="size-10 text-sun" /></FullScreenCenter>;

  return (
    <main className="flex h-dvh flex-col gap-[2.5vh] overflow-hidden px-[3.5vw] py-[3vh]">
      <ConnectionBanner show={!connected} />
      <PortraitPreloader personIds={PEOPLE.map((p) => p.id)} />

      {/* Header */}
      <header className="flex shrink-0 items-center justify-between">
        <Brand className="text-[4vh]" />
        <div className="flex items-center gap-[1vw]">
          {view.status !== "LOBBY" && (
            <span className="rounded-full bg-panel-2 px-[1.2vw] py-[0.5vh] text-[2.4vh] font-bold text-mute">
              رمز الدخول <span dir="ltr" className="font-black text-paper tabular-nums">{view.code}</span>
            </span>
          )}
          <button
            onClick={() => setShowPlayers(true)}
            className="btn btn-ghost h-[5vh] rounded-full px-[1.2vw] text-[2.2vh]"
          >
            اللاعبين
          </button>
          <button
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.().catch(() => {});
            }}
            className="btn btn-ghost h-[5vh] rounded-full px-[1.2vw] text-[2.2vh]"
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
      <footer className="flex h-[10vh] shrink-0 items-center justify-between gap-[2vw]">
        <div className="min-w-0 flex-1">
          {view.status === "QUESTION" && view.question && (
            <AnswerProgress answered={view.question.answeredCount} eligible={view.question.eligibleCount} />
          )}
          {actionError && <p className="text-[2.4vh] font-bold text-rose">{actionError}</p>}
        </div>
        {primary && (
          <button
            onClick={() => void runAction(primary.action)}
            disabled={busy || primary.disabled}
            className={`btn btn-primary h-[9vh] min-w-[24vw] px-[2.4vw] text-[4vh] ${
              primary.pulse && !busy ? "anim-pulse" : ""
            }`}
          >
            {busy && <Spinner className="size-[3.4vh]" />}
            {primary.label}
          </button>
        )}
        {view.status === "FINISHED" && (
          <Link href="/host" className="btn btn-ghost h-[8vh] px-[2.4vw] text-[3.2vh]">
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
