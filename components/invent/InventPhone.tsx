"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, errorMessage, resultMessage } from "@/lib/client/api";
import { playerStore, type PlayerCreds } from "@/lib/client/storage";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import type { InventGuestView, InventPublicGame } from "@/lib/invent/views";
import { AnswerCards, Countdown, Standings, timeLeft, useDeadlineRefresh, useServerNow } from "./parts";

const vibrate = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // unsupported
  }
};

/** A player's phone: join confirmation, answer box, voting, reveal, standings. */
export function InventPhone({ creds }: { creds: PlayerCreds }) {
  const { sessionId, playerToken } = creds;
  const fetchView = useCallback(
    () => api<{ view: InventGuestView }>("/api/invent", { action: "state", as: "guest", sessionId, playerToken }),
    [sessionId, playerToken],
  );
  const { view, receivedAt, fatalError, connected, mutate, refresh } = useGameSync<InventGuestView>(sessionId, fetchView);
  useDeadlineRefresh(view?.game?.timer, view?.serverNow, receivedAt, refresh);
  useWakeLock();

  useEffect(() => {
    if (fatalError === "NOT_A_PLAYER") playerStore.clear(sessionId);
  }, [fatalError, sessionId]);

  const act = useCallback(
    async (move: Record<string, unknown>) => {
      const res = await mutate(() => api<{ view: InventGuestView }>("/api/invent", { action: "act", as: "guest", sessionId, playerToken, move }));
      return res.ok ? null : resultMessage(res);
    },
    [mutate, sessionId, playerToken],
  );

  if (fatalError) {
    return (
      <div className="iv iv-joinpage">
        <div className="iv-join-form">
          <p className="iv-wordmark text-4xl">اخترع إجابتك</p>
          <p className="iv-error">{errorMessage(fatalError)}</p>
          <Link href="/join" className="iv-btn iv-btn-gold">دخول لعبة</Link>
        </div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="iv iv-joinpage">
        <span className="iv-loader" aria-label="جاري التحميل" />
      </div>
    );
  }

  const g = view.game;
  return (
    <div className="iv">
      <div className="iv-phone">
        <header className="iv-phone-head">
          <span className="iv-wordmark text-xl">اخترع إجابتك 💡</span>
          {g && g.phase !== "final" && view.seated && (
            <span className="iv-round-pill" dir="ltr" aria-label={`الجولة ${g.roundIndex + 1} من ${g.totalRounds}`}>
              {g.roundIndex + 1}/{g.totalRounds}
            </span>
          )}
          <span className="ms-auto" />
          {!connected && <span className="iv-error text-xs">نعيد الاتصال…</span>}
          <span className="me iv-chip">{view.me.name}</span>
        </header>
        {view.status === "FINISHED" ? (
          <Center emoji="👋" title="انتهت" />
        ) : !g ? (
          <Center emoji="🎉" title="أنت داخل!" text={`${view.lobby.filter((p) => p.active).length} لاعبين`} />
        ) : !view.seated ? (
          <Center emoji="👀" title="تلعب المباراة الجاية" />
        ) : (
          <Round view={view} game={g} receivedAt={receivedAt} act={act} />
        )}
        {g?.paused && g.phase !== "final" && <div className="iv-paused" role="status">⏸ متوقفة</div>}
      </div>
    </div>
  );
}

function Center({ emoji, title, text, children }: { emoji: string; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="iv-center iv-pop">
      <span className="iv-big-emoji" aria-hidden>
        {emoji}
      </span>
      <h1 className="iv-display m-0 text-3xl font-black">{title}</h1>
      {text && <p className="iv-mute m-0 font-bold">{text}</p>}
      {children}
    </div>
  );
}

type Act = (move: Record<string, unknown>) => Promise<string | null>;

function Round({ view, game, receivedAt, act }: { view: InventGuestView; game: InventPublicGame; receivedAt: number; act: Act }) {
  const now = useServerNow(view.serverNow, receivedAt);
  const ms = timeLeft(game.timer, now);
  const timed = game.phase === "answering" || game.phase === "voting";
  // One question block per screen, with the timer beside it while there is one.
  const head = (
    <div className="iv-qhead">
      <p className="iv-question" dir="auto">
        {game.question.text}
      </p>
      {timed && game.timer && <Countdown ms={ms} total={game.timer.durationMs} paused={game.paused} size="3.4rem" />}
    </div>
  );

  switch (game.phase) {
    case "answering":
      return (
        <>
          {head}
          <AnswerBox key={`${game.matchId}:${game.roundIndex}`} view={view} game={game} act={act} />
        </>
      );
    case "voting":
      return (
        <>
          {head}
          <Voting key={`${game.matchId}:${game.roundIndex}`} view={view} game={game} act={act} />
        </>
      );
    case "reveal": {
      const mine = game.cards?.find((c) => c.mine);
      return (
        <>
          {head}
          {mine && (
            <p className="iv-gain" dir="ltr" aria-label={`إجابتك جابت ${mine.points ?? 0} نقطة`}>
              +{mine.points ?? 0}
            </p>
          )}
          {game.cards && game.cards.length > 0 ? <AnswerCards cards={game.cards} votedId={view.myVote} /> : <p className="iv-empty">ما وصلت إجابات</p>}
          {game.votingSkipped && <p className="iv-empty">إجابة وحدة — بدون نقاط</p>}
        </>
      );
    }
    case "leaderboard":
      return <Standings rows={game.standings} meId={view.me.playerId} />;
    case "final": {
      const won = game.winners.includes(view.me.playerId);
      const names = game.standings.filter((r) => game.winners.includes(r.playerId)).map((r) => r.name);
      return (
        <>
          <h1 className="iv-wordmark iv-pop m-0 text-center text-4xl">
            {won ? (names.length > 1 ? "🏆 فوز مشترك" : "🏆 فزت!") : names.length === 0 ? "ما أحد جمع نقاط" : `🏆 ${names.join(" و ")}`}
          </h1>
          <Standings rows={game.standings} meId={view.me.playerId} showGain={false} />
        </>
      );
    }
  }
}

function AnswerBox({ view, game, act }: { view: InventGuestView; game: InventPublicGame; act: Act }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const max = view.limits.maxAnswer;
  const length = [...text].length;
  const trimmed = text.trim();

  if (view.myAnswer !== null) {
    return (
      <p className="iv-sent iv-pop" role="status">
        <span aria-hidden>✓</span> تم الإرسال
      </p>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const err = await act({ type: "answer", round: game.roundIndex, text });
    sending.current = false;
    setBusy(false);
    if (err) setError(err);
    else vibrate(30);
  }

  return (
    <form className="iv-answer-form" onSubmit={submit}>
      <textarea
        id="iv-answer"
        aria-label="إجابتك"
        className="iv-textarea"
        dir="auto"
        value={text}
        maxLength={max * 2}
        placeholder="إجابتك…"
        enterKeyHint="send"
        onChange={(e) => {
          setText([...e.target.value].slice(0, max).join(""));
          setError(null);
        }}
      />
      <p className={`iv-counter m-0 ${length > max - 20 ? "is-near" : ""}`} dir="ltr">
        {length}/{max}
      </p>
      {error && (
        <p className="iv-error m-0" role="alert">
          {error}
        </p>
      )}
      <div className="iv-sticky-action mt-auto">
        <button type="submit" className="iv-btn iv-btn-gold iv-btn-lg iv-btn-block" disabled={!trimmed || busy}>
          {busy && <span className="iv-loader" />}
          أرسل
        </button>
      </div>
    </form>
  );
}

function Voting({ view, game, act }: { view: InventGuestView; game: InventPublicGame; act: Act }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const cards = game.cards ?? [];

  if (!view.canVote) {
    return (
      <>
        <p className="iv-hint-line">⏳ ما فيه إجابات تصوّت لها</p>
        <AnswerCards cards={cards} />
      </>
    );
  }

  if (view.myVote) {
    return (
      <>
        <p className="iv-sent is-inline" role="status">
          <span aria-hidden>✓</span> صوتك وصل
        </p>
        <AnswerCards cards={cards} votedId={view.myVote} />
      </>
    );
  }

  async function confirm() {
    if (!picked || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const err = await act({ type: "vote", round: game.roundIndex, answerId: picked });
    sending.current = false;
    setBusy(false);
    if (err) setError(err);
    else vibrate(30);
  }

  return (
    <>
      <p className="iv-hint-line">صوّت لأفضل إجابة</p>
      <AnswerCards cards={cards} selectable selectedId={picked} onSelect={(id) => setPicked(id)} />
      {error && (
        <p className="iv-error m-0" role="alert">
          {error}
        </p>
      )}
      <div className="iv-sticky-action mt-auto">
        <button type="button" className="iv-btn iv-btn-gold iv-btn-lg iv-btn-block" disabled={!picked || busy} onClick={confirm}>
          {busy && <span className="iv-loader" />}
          صوّت
        </button>
      </div>
    </>
  );
}
