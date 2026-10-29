"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, errorMessage, resultMessage } from "@/lib/client/api";
import { playerStore, type PlayerCreds } from "@/lib/client/storage";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import type { InventGuestView, InventPublicGame } from "@/lib/invent/views";
import { AnswerCards, Countdown, Podium, RoundLabel, Standings, timeLeft, useDeadlineRefresh, useServerNow } from "./parts";

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
          <span className="ms-auto" />
          {!connected && <span className="iv-error text-xs">نعيد الاتصال…</span>}
          <span className="me iv-chip">{view.me.name}</span>
        </header>
        {view.status === "FINISHED" ? (
          <Center emoji="👋" title="الغرفة انقفلت" text="شكرًا على اللعب!" />
        ) : !g ? (
          <Center
            emoji="🎉"
            title="أنت داخل!"
            text={`انتظر المضيف يبدأ اللعبة · ${view.lobby.filter((p) => p.active).length} لاعبين في الغرفة`}
          />
        ) : !view.seated ? (
          <Center emoji="👀" title="المباراة شغّالة" text="دخلت بعد ما بدأت. تابع الشاشة، وبتلعب المباراة الجاية." />
        ) : (
          <Round view={view} game={g} receivedAt={receivedAt} act={act} />
        )}
        {g?.paused && g.phase !== "final" && <div className="iv-paused" role="status">⏸ المضيف أوقف اللعبة مؤقتًا</div>}
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
  const head = (
    <>
      <div className="flex items-center gap-3">
        <RoundLabel index={game.roundIndex} total={game.totalRounds} />
        <span className="ms-auto" />
        {game.timer && (game.phase === "answering" || game.phase === "voting") && (
          <Countdown ms={ms} total={game.timer.durationMs} paused={game.paused} size="3.6rem" />
        )}
      </div>
      <p className="iv-question" dir="auto">{game.question.text}</p>
    </>
  );

  switch (game.phase) {
    case "question":
      return (
        <Center emoji="🤔" title={`الجولة ${game.roundIndex + 1} من ${game.totalRounds}`}>
          <p className="iv-question m-0 text-2xl" dir="auto">{game.question.text}</p>
          <p className="iv-mute m-0 font-bold">فكّر بجواب يضحّك… مربع الإجابة يفتح بعد ثواني</p>
        </Center>
      );
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
          {mine ? (
            <p className="iv-progress m-0 text-xl">
              إجابتك جابت <b>{mine.points ?? 0}</b> نقطة
            </p>
          ) : (
            <p className="iv-mute m-0 font-bold">ما أرسلت إجابة هالجولة.</p>
          )}
          {game.votingSkipped && <p className="iv-mute m-0 font-bold">إجابة وحدة بس، ما فيه تصويت هالجولة.</p>}
          {game.cards && game.cards.length > 0 ? (
            <AnswerCards cards={game.cards} votedId={view.myVote} />
          ) : (
            <Center emoji="😶" title="ما وصلت ولا إجابة" />
          )}
        </>
      );
    }
    case "leaderboard": {
      const me = game.standings.find((r) => r.playerId === view.me.playerId);
      return (
        <>
          <div className="text-center">
            <p className="iv-eyebrow m-0">ترتيبك</p>
            <p className="iv-wordmark m-0 text-6xl">{me?.rank ?? "—"}</p>
            <p className="iv-mute m-0 font-bold">
              {me?.score ?? 0} نقطة {me && me.gained > 0 ? `(+${me.gained} هالجولة)` : ""}
            </p>
          </div>
          <Standings rows={game.standings} meId={view.me.playerId} />
        </>
      );
    }
    case "final": {
      const me = game.standings.find((r) => r.playerId === view.me.playerId);
      const won = game.winners.includes(view.me.playerId);
      const names = game.standings.filter((r) => game.winners.includes(r.playerId)).map((r) => r.name);
      return (
        <>
          <div className="iv-pop text-center">
            <span className="iv-big-emoji">{won ? "🏆" : "👏"}</span>
            <h1 className="iv-wordmark m-0 text-4xl">{won ? (names.length > 1 ? "فوز مشترك!" : "أنت الفائز!") : names.length === 0 ? "ما أحد جمع نقاط" : `الفائز: ${names.join(" و ")}`}</h1>
            <p className="iv-mute m-0 font-bold">
              ترتيبك {me?.rank ?? "—"} · {me?.score ?? 0} نقطة
            </p>
          </div>
          <Podium rows={game.standings} />
          <Standings rows={game.standings} meId={view.me.playerId} showGain={false} />
          <p className="iv-mute text-center text-sm font-bold">لو المضيف بدأ مباراة جديدة بتنتقل لها تلقائيًا.</p>
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
      <Center emoji="✅" title="تم إرسال إجابتك، انتظر البقية!">
        <p className="iv-panel m-0 w-full p-4 text-lg font-extrabold" dir="auto">
          {view.myAnswer}
        </p>
        <p className="iv-progress m-0">
          <b>{game.answeredCount}</b> من {game.playerCount} جاوبوا
        </p>
      </Center>
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
    <form className="flex flex-1 flex-col gap-2" onSubmit={submit}>
      <label htmlFor="iv-answer" className="iv-eyebrow">
        اخترع إجابتك
      </label>
      <textarea
        id="iv-answer"
        className="iv-textarea"
        dir="auto"
        value={text}
        maxLength={max * 2}
        placeholder="اكتب أضحك جواب يخطر ببالك…"
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
      <Center emoji="⏳" title="ما فيه إجابات تصوّت لها" text="انتظر البقية يصوّتون…">
        <AnswerCards cards={cards} />
      </Center>
    );
  }

  if (view.myVote) {
    return (
      <>
        <p className="iv-progress m-0 text-center text-lg">
          صوتك وصل 🗳️ · <b>{game.votedCount}</b> من {game.voterCount} صوّتوا
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
      <p className="iv-eyebrow m-0">اختار أضحك إجابة (ما تقدر تختار إجابتك)</p>
      <AnswerCards cards={cards} selectable selectedId={picked} onSelect={(id) => setPicked(id)} />
      {error && (
        <p className="iv-error m-0" role="alert">
          {error}
        </p>
      )}
      <div className="iv-sticky-action mt-auto">
        <button type="button" className="iv-btn iv-btn-gold iv-btn-lg iv-btn-block" disabled={!picked || busy} onClick={confirm}>
          {busy && <span className="iv-loader" />}
          {picked ? "أكّد صوتك" : "اختار إجابة"}
        </button>
      </div>
    </>
  );
}
