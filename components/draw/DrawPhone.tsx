"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, errorMessage, resultMessage } from "@/lib/client/api";
import { playerStore, type PlayerCreds } from "@/lib/client/storage";
import { playersLabel } from "@/lib/format";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import type { Stroke } from "@/lib/draw/engine";
import type { DrawGuestView, DrawPublicGame } from "@/lib/draw/views";
import { Board, readBackup } from "./Board";
import {
  drawingRequest,
  Letterhead,
  Seal,
  Sketch,
  Standings,
  TimerBar,
  timeLeft,
  useApprovedDrawing,
  useDeadlineRefresh,
  useServerNow,
  useVisibleHeight,
} from "./parts";

const vibrate = (ms: number | number[]) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // unsupported
  }
};

type Act = (move: Record<string, unknown>) => Promise<{ error: string | null; view: DrawGuestView | null }>;

/** A player's phone: lobby, the word and the canvas when drawing, the guess box otherwise, results. */
export function DrawPhone({ creds }: { creds: PlayerCreds }) {
  const { sessionId, playerToken } = creds;
  const fetchView = useCallback(
    () => api<{ view: DrawGuestView }>("/api/draw", { action: "state", as: "guest", sessionId, playerToken }),
    [sessionId, playerToken],
  );
  const { view, receivedAt, fatalError, connected, mutate, refresh } = useGameSync<DrawGuestView>(sessionId, fetchView);
  useDeadlineRefresh(view?.game?.timer, view?.serverNow, receivedAt, refresh);
  useWakeLock();
  useVisibleHeight();

  useEffect(() => {
    if (fatalError === "NOT_A_PLAYER") playerStore.clear(sessionId);
  }, [fatalError, sessionId]);

  const act = useCallback<Act>(
    async (move) => {
      const res = await mutate(() => api<{ view: DrawGuestView }>("/api/draw", { action: "act", as: "guest", sessionId, playerToken, move }));
      return res.ok ? { error: null, view: res.view } : { error: resultMessage(res), view: null };
    },
    [mutate, sessionId, playerToken],
  );

  if (fatalError) {
    return (
      <div className="mw mw-page mw-center-page">
        <div className="mw-card mw-stack">
          <Seal size={64} />
          <p className="mw-error">{errorMessage(fatalError)}</p>
          <Link href="/join" className="mw-btn mw-btn-primary">دخول لعبة</Link>
        </div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="mw mw-page mw-center-page">
        <span className="mw-loader" aria-label="جاري التحميل" />
      </div>
    );
  }

  const g = view.game;
  return (
    <div className="mw mw-phone">
      <header className="mw-phone-head">
        <Letterhead compact />
        <span className="ms-auto" />
        {!connected && (
          <span className="mw-offline" role="status">
            نعيد الاتصال…
          </span>
        )}
        <span className="mw-chip">{view.me.name}</span>
      </header>
      <main className="mw-phone-body">
        {view.status === "FINISHED" ? (
          <Center icon={<Seal size={84} />} title="انتهت" />
        ) : !g ? (
          <Center icon={<span className="mw-check">✓</span>} title="أنت داخل" text={playersLabel(view.lobby.filter((p) => p.active).length)} />
        ) : !view.seated ? (
          <Center icon={<Seal size={84} />} title="تدخل مع الدور الجاي" />
        ) : (
          <Turn view={view} game={g} receivedAt={receivedAt} act={act} creds={creds} />
        )}
      </main>
    </div>
  );
}

function Center({ icon, title, text, children }: { icon?: React.ReactNode; title?: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="mw-center mw-rise">
      {icon}
      {title && <h1 className="mw-title">{title}</h1>}
      {text && <p className="mw-mute">{text}</p>}
      {children}
    </div>
  );
}

function Turn({ view, game, receivedAt, act, creds }: { view: DrawGuestView; game: DrawPublicGame; receivedAt: number; act: Act; creds: PlayerCreds }) {
  const now = useServerNow(view.serverNow, receivedAt);
  const ms = timeLeft(game.timer, now);
  const turnKey = `${game.matchId}:${game.turn}`;
  const strokes = useApprovedDrawing(game.drawingRev, turnKey, drawingRequest(creds));
  const { colors, sizes } = view.limits;

  switch (game.phase) {
    case "intro":
      return view.isDrawer ? (
        <Center icon={<Seal size={72} />} title={view.word ?? ""}>
          <span className="mw-badge">✏️ دورك</span>
        </Center>
      ) : (
        <Center icon={<span className="mw-pencil">✏️</span>} title={game.drawer.name} text="معالي الرسّام" />
      );

    case "drawing":
      return view.isDrawer ? (
        <DrawerPanel key={turnKey} view={view} game={game} ms={ms} act={act} creds={creds} />
      ) : (
        <Center icon={<span className="mw-pencil is-busy">✏️</span>} title={game.drawer.name} text="يرسم…">
          <TimerBar ms={ms} timer={game.timer} />
        </Center>
      );

    case "guessing":
      return (
        <div className="mw-play">
          <div className="mw-play-bar">
            {view.isDrawer ? <span className="mw-badge">{view.word}</span> : <span className="mw-badge is-quiet">🔍</span>}
            <span className="mw-count" aria-label={`${game.solvedCount} من ${game.guesserCount} عرفوها`}>
              ✓ {game.solvedCount}/{game.guesserCount}
            </span>
            <TimerBar ms={ms} timer={game.timer} />
          </div>
          <Sketch strokes={strokes} colors={colors} sizes={sizes} className="mw-play-sketch" />
          {!view.isDrawer && <GuessBox key={turnKey} view={view} game={game} act={act} />}
        </div>
      );

    case "reveal": {
      const r = game.reveal;
      const mine = game.standings.find((s) => s.playerId === view.me.playerId)?.gained ?? 0;
      return (
        <Center icon={<Stamp text={r?.word ?? ""} skipped={r?.skipped ?? null} />}>
          <p className={`mw-gain ${mine ? "" : "is-zero"}`} dir="ltr" aria-label={`${mine} نقطة`}>
            +{mine}
          </p>
        </Center>
      );
    }

    case "final": {
      const me = game.standings.find((s) => s.playerId === view.me.playerId);
      const won = game.winners.includes(view.me.playerId);
      return (
        <div className="mw-final-phone mw-rise">
          <Seal size={72} className={won ? "is-gold" : ""} />
          <h1 className="mw-title">{won ? "🏆 المركز الأول" : me ? `المركز ${me.rank}` : ""}</h1>
          <Standings rows={game.standings} meId={view.me.playerId} showGain={false} />
        </div>
      );
    }
  }
}

/** The word in an official rubber stamp (or why there was nothing to guess). */
export function Stamp({ text, skipped }: { text: string; skipped: null | "absent" | "blank" }) {
  return (
    <div className={`mw-stamp ${skipped ? "is-void" : ""}`}>
      <span className="mw-stamp-word">{text}</span>
      {skipped && <span className="mw-stamp-note">{skipped === "absent" ? "غاب الرسّام" : "لوحة فاضية"}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */

const AUTOSAVE_MS = 2000;

function DrawerPanel({ view, game, ms, act, creds }: { view: DrawGuestView; game: DrawPublicGame; ms: number | null; act: Act; creds: PlayerCreds }) {
  const backupKey = `fq:draw:${creds.sessionId}:${game.matchId}:${game.turn}`;
  const [initial, setInitial] = useState<Stroke[] | null>(null);
  const latest = useRef<Stroke[]>([]);
  const uploaded = useRef("[]");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(true);
  const approving = useRef(false);

  // Back after a refresh: this device's backup, else the server's autosave.
  useEffect(() => {
    const local = readBackup(backupKey);
    if (local && local.length > 0) {
      void Promise.resolve().then(() => setInitial(local));
      return;
    }
    void drawingRequest(creds)().then((res) => {
      if (res.ok && res.strokes.length > 0) {
        uploaded.current = JSON.stringify(res.strokes);
        setInitial(res.strokes);
      }
    });
  }, [backupKey, creds]);

  const upload = useCallback(async () => {
    const json = JSON.stringify(latest.current);
    if (json === uploaded.current || approving.current) return;
    uploaded.current = json;
    await act({ type: "draft", turn: game.turn, strokes: latest.current });
  }, [act, game.turn]);

  // Autosave: the server approves the last one when time runs out (or if this phone drops).
  useEffect(() => {
    const id = setInterval(() => void upload(), AUTOSAVE_MS);
    return () => clearInterval(id);
  }, [upload]);
  const lastSecond = ms !== null && ms <= 1500;
  useEffect(() => {
    if (lastSecond) void upload();
  }, [lastSecond, upload]);

  async function approve() {
    if (approving.current || latest.current.length === 0) return;
    approving.current = true;
    setBusy(true);
    setError(null);
    const res = await act({ type: "submit", turn: game.turn, strokes: latest.current });
    approving.current = false;
    setBusy(false);
    if (res.error) setError(res.error);
    else vibrate(40);
  }

  return (
    <div className="mw-drawer">
      <div className="mw-play-bar">
        <span className="mw-badge is-word">{view.word}</span>
        <TimerBar ms={ms} timer={game.timer} />
      </div>
      <Board
        backupKey={backupKey}
        initial={initial}
        colors={view.limits.colors}
        sizes={view.limits.sizes}
        onChange={(s) => {
          latest.current = s;
          setEmpty(s.length === 0);
        }}
      />
      {error && (
        <p className="mw-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="mw-btn mw-btn-primary mw-btn-block mw-approve" disabled={empty || busy} onClick={approve}>
        {busy ? <span className="mw-loader is-small" /> : <Seal size={22} />}
        اعتماد اللوحة
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Guessing                                                            */
/* ------------------------------------------------------------------ */

function GuessBox({ view, game, act }: { view: DrawGuestView; game: DrawPublicGame; act: Act }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrong, setWrong] = useState(0);
  const sending = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  if (view.solved) {
    return (
      <p className="mw-solved mw-pop" role="status">
        <span aria-hidden>✓</span> صح
      </p>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const guess = text.trim();
    if (!guess || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const res = await act({ type: "guess", turn: game.turn, text: guess });
    sending.current = false;
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.view?.solved) {
      vibrate([30, 40, 60]);
      return;
    }
    // Wrong: shake, clear, keep the keyboard up for the next try.
    setWrong((n) => n + 1);
    setText("");
    vibrate(80);
    input.current?.focus();
  }

  const left = view.maxAttempts - view.attempts;
  return (
    <form className="mw-guess" onSubmit={submit}>
      <div key={wrong} className={`mw-guess-row ${wrong ? "is-wrong" : ""}`}>
        <input
          ref={input}
          className="mw-input"
          aria-label="تخمينك"
          dir="auto"
          value={text}
          maxLength={view.limits.maxGuess}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
          placeholder="؟"
          disabled={left <= 0}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="mw-btn mw-btn-primary mw-send" aria-label="أرسل" disabled={!text.trim() || busy || left <= 0}>
          {busy ? <span className="mw-loader is-small" /> : <SendIcon />}
        </button>
      </div>
      {error ? (
        <p className="mw-error" role="alert">
          {error}
        </p>
      ) : wrong > 0 ? (
        <p className="mw-wrong" role="status" key={`w${wrong}`}>
          ✗
        </p>
      ) : null}
    </form>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 3L10 14" />
      <path d="M21 3l-7 18-4-7-7-4z" />
    </svg>
  );
}
