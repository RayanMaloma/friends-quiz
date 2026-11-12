"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { api, errorMessage, resultMessage } from "@/lib/client/api";
import { playerStore, type PlayerCreds } from "@/lib/client/storage";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import type { Vote } from "@/lib/court/engine";
import type { CourtGuestView, CourtPublicGame } from "@/lib/court/views";
import {
  Brand,
  HoldToReveal,
  phaseLabel,
  RoleTag,
  Scales,
  speakerOf,
  Stamp,
  Standings,
  TimerBar,
  timeLeft,
  useDeadlineRefresh,
  useServerNow,
} from "./parts";

type Act = (move: Record<string, unknown>) => Promise<boolean>;

/** A player's phone: their role and secret, their one action (exhibit, objection, ballot), their score. */
export function CourtPhone({ creds }: { creds: PlayerCreds }) {
  const { sessionId, playerToken } = creds;
  const fetchView = useCallback(
    () => api<{ view: CourtGuestView }>("/api/court", { action: "state", as: "guest", sessionId, playerToken }),
    [sessionId, playerToken],
  );
  const { view, receivedAt, fatalError, connected, mutate, refresh } = useGameSync<CourtGuestView>(sessionId, fetchView);
  useDeadlineRefresh(view?.game?.timer, view?.serverNow, receivedAt, refresh);
  useWakeLock();
  const [error, setError] = useState<string | null>(null);

  const act = useCallback<Act>(
    async (move) => {
      setError(null);
      const res = await mutate(() => api<{ view: CourtGuestView }>("/api/court", { action: "act", as: "guest", sessionId, playerToken, move }));
      if (!res.ok) setError(resultMessage(res));
      return res.ok;
    },
    [mutate, sessionId, playerToken],
  );

  if (fatalError || !view || view.status === "FINISHED") {
    if (fatalError === "NOT_A_PLAYER") playerStore.clear(sessionId);
    return (
      <div className="ct ct-page ct-center">
        {!view && !fatalError ? (
          <span className="ct-loader" aria-label="جاري التحميل" />
        ) : (
          <div className="ct-card ct-stack">
            <Scales size={56} />
            {fatalError ? <p className="ct-error">{errorMessage(fatalError)}</p> : <p className="ct-mute">انتهت الجلسة</p>}
            <Link href="/join" className="ct-btn is-primary">
              دخول غرفة
            </Link>
          </div>
        )}
      </div>
    );
  }

  const g = view.game;
  return (
    <div className="ct ct-phone">
      <header className="ct-phone-head">
        <Brand compact />
        <span className="ct-grow" />
        <span className="ct-me">{view.me.name}</span>
      </header>
      {!connected && <p className="ct-banner is-warn">الاتصال ضعيف… نحاول نرجّعك</p>}
      {g?.paused && <PausedBanner game={g} />}
      {!g ? (
        <Waiting name={view.me.name} />
      ) : !view.seated ? (
        <main className="ct-phone-main ct-center-col">
          <span className="ct-big-icon" aria-hidden>
            ⏳
          </span>
          <p className="ct-lead">تدخل مع القضية الجاية</p>
        </main>
      ) : (
        <Hearing view={view} game={g} receivedAt={receivedAt} act={act} />
      )}
      {error && (
        <p className="ct-error ct-phone-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Waiting({ name }: { name: string }) {
  return (
    <main className="ct-phone-main ct-center-col">
      <span className="ct-check ct-rise" aria-hidden>
        ✓
      </span>
      <p className="ct-lead">{name}</p>
      <p className="ct-mute">بانتظار بدء المحاكمة</p>
    </main>
  );
}

function PausedBanner({ game }: { game: CourtPublicGame }) {
  const p = game.paused!;
  const names = p.waitingFor.map((w) => w.name).join("، ");
  return <p className="ct-banner">{p.reason === "absent" && names ? `⏸ بانتظار ${names}` : "⏸ الجلسة موقّفة"}</p>;
}

/* ------------------------------------------------------------------ */
/* During a case                                                       */
/* ------------------------------------------------------------------ */

function Hearing({ view, game, receivedAt, act }: { view: CourtGuestView; game: CourtPublicGame; receivedAt: number; act: Act }) {
  const now = useServerNow(view.serverNow, receivedAt);
  const ms = timeLeft(game.timer, now);
  const role = view.myRole;

  if (game.phase === "verdict" || game.phase === "standings") return <MyResult view={view} game={game} />;
  if (game.phase === "final") return <MyFinal view={view} game={game} />;

  const speaker = speakerOf(game);
  const myTurn = !!speaker && role === speaker.role && game.phase !== "evidence" && game.phase !== "objection";
  const questioned = !!speaker?.target && role === "accused";

  return (
    <main className="ct-phone-main">
      <section className={`ct-my-role ${role ? `is-${role}` : ""}`}>
        {role && role !== "benched" ? <RoleTag role={role} size="lg" /> : <span className="ct-mute">خارج هالقضية</span>}
        <span className="ct-case-name">{game.title}</span>
      </section>

      <section className="ct-now">
        {myTurn || questioned ? (
          <span className={`ct-your-turn ct-rise ${questioned ? "is-questioned" : ""}`}>
            <span aria-hidden>🎙️</span>
            {questioned ? "يستجوبونك" : "دورك"}
          </span>
        ) : (
          <span className="ct-now-label">{phaseLabel(game.phase)}</span>
        )}
        <TimerBar ms={ms} timer={game.timer} paused={!!game.paused} />
      </section>

      {game.phase === "vote" ? (
        role === "juror" ? (
          <Ballot key={game.caseIndex} game={game} mine={view.myVote} act={act} />
        ) : (
          <p className="ct-lead ct-vote-wait" dir="rtl">
            🗳️ <span dir="ltr">{game.votes.cast}/{game.votes.total}</span>
          </p>
        )
      ) : (
        <>
          {view.secret?.role === "accused" && (
            <HoldToReveal>
              <Stamp guilty={view.secret.guilty} />
              <span className="ct-secret-text">{view.secret.text}</span>
            </HoldToReveal>
          )}
          {view.secret?.role === "lawyer" && (
            <>
              <HoldToReveal>
                <span className="ct-secret-text">{view.secret.text}</span>
              </HoldToReveal>
              <Objection game={game} used={view.secret.objectionUsed} act={act} />
            </>
          )}
          {view.secret?.role === "prosecutor" && (
            <>
              <HoldToReveal>
                <span className="ct-secret-text">{view.secret.text}</span>
              </HoldToReveal>
              <Exhibits game={game} exhibits={view.secret.exhibits} act={act} />
            </>
          )}
          {role === "juror" && <JurorRecord game={game} />}
        </>
      )}
    </main>
  );
}

/** The prosecutor's three exhibits: present each once, during the evidence. */
function Exhibits({ game, exhibits, act }: { game: CourtPublicGame; exhibits: { index: number; text: string; presented: boolean }[]; act: Act }) {
  const [busy, setBusy] = useState<number | null>(null);
  const open = game.phase === "evidence" && !game.paused;
  return (
    <ol className="ct-my-exhibits">
      {exhibits.map((e) => (
        <li key={e.index} className={e.presented ? "is-done" : ""}>
          <p>{e.text}</p>
          {e.presented ? (
            <span className="ct-done" aria-label="مقدّم">
              ✓
            </span>
          ) : (
            open && (
              <button
                type="button"
                className="ct-btn is-primary is-sm"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(e.index);
                  await act({ type: "present", case: game.caseIndex, exhibit: e.index });
                  setBusy(null);
                }}
              >
                {busy === e.index && <span className="ct-loader is-small" />}
                قدّم
              </button>
            )
          )}
        </li>
      ))}
    </ol>
  );
}

/** The lawyer's one objection, against an exhibit on the record. */
function Objection({ game, used, act }: { game: CourtPublicGame; used: boolean; act: Act }) {
  const [busy, setBusy] = useState(false);
  const o = game.objection;
  if (used && o) {
    return (
      <div className="ct-objection-mine">
        <span className="ct-tag">✋ اعتراض</span>
        {o.outcome && <b className={o.outcome.upheld ? "is-upheld" : "is-overruled"}>{o.outcome.upheld ? "مقبول" : "مرفوض"}</b>}
      </div>
    );
  }
  if (game.phase !== "evidence" || game.evidence.length === 0) return null;
  return (
    <ol className="ct-my-exhibits is-record">
      {game.evidence.map((e, i) => (
        <li key={e.index}>
          <span className="no">{i + 1}</span>
          <p>{e.text}</p>
          <button
            type="button"
            className="ct-btn is-danger is-sm"
            disabled={busy || !!game.paused}
            onClick={async () => {
              setBusy(true);
              await act({ type: "object", case: game.caseIndex, exhibit: e.index });
              setBusy(false);
            }}
          >
            ✋ اعتراض
          </button>
        </li>
      ))}
    </ol>
  );
}

/** What jurors have to go on: the exhibits presented so far. */
function JurorRecord({ game }: { game: CourtPublicGame }) {
  if (game.evidence.length === 0) return null;
  return (
    <ol className="ct-my-exhibits is-record">
      {game.evidence.map((e, i) => (
        <li key={e.index}>
          <span className="no">{i + 1}</span>
          <p>{e.text}</p>
        </li>
      ))}
    </ol>
  );
}

/** One secret ballot: pick, then confirm. */
function Ballot({ game, mine, act }: { game: CourtPublicGame; mine: Vote | null; act: Act }) {
  const [pick, setPick] = useState<Vote | null>(null);
  const [busy, setBusy] = useState(false);
  if (mine) {
    return (
      <div className="ct-voted ct-rise">
        <span className="ct-check" aria-hidden>
          ✓
        </span>
        <span className={`ct-choice is-${mine}`}>{mine === "guilty" ? "مذنب" : "بريء"}</span>
      </div>
    );
  }
  const closed = !!game.paused;
  return (
    <div className="ct-ballot-box">
      <p className="ct-question is-phone">
        هل <b>{game.roles.accused.name}</b> مذنب؟
      </p>
      <div className="ct-ballot-choices">
        {(["guilty", "innocent"] as const).map((v) => (
          <button key={v} type="button" className={`ct-choice-btn is-${v} ${pick === v ? "is-picked" : ""}`} aria-pressed={pick === v} disabled={closed || busy} onClick={() => setPick(v)}>
            {v === "guilty" ? "مذنب" : "بريء"}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="ct-btn is-primary is-lg is-block"
        disabled={!pick || closed || busy}
        onClick={async () => {
          if (!pick) return;
          setBusy(true);
          await act({ type: "vote", case: game.caseIndex, vote: pick });
          setBusy(false);
        }}
      >
        {busy && <span className="ct-loader is-small" />}
        أرسل
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

function MyResult({ view, game }: { view: CourtGuestView; game: CourtPublicGame }) {
  const v = game.verdict;
  const me = view.me.playerId;
  const row = game.standings.find((s) => s.playerId === me);
  const gained = v?.gained.find((x) => x.id === me)?.points ?? 0;
  return (
    <main className="ct-phone-main ct-center-col">
      {v && !v.voided && <Stamp guilty={v.guilty} className="ct-stamp-in" />}
      {v && !v.voided && (
        <p className="ct-truth-line">
          الحقيقة: <b>{v.truth ? "مذنب" : "بريء"}</b>
        </p>
      )}
      <p className={`ct-points ${gained > 0 ? "is-plus" : ""}`} dir="ltr">
        +{gained}
      </p>
      {row && (
        <p className="ct-rank-line">
          <span className="ct-mute">#{row.rank}</span> <b dir="ltr">{row.score}</b>
        </p>
      )}
    </main>
  );
}

function MyFinal({ view, game }: { view: CourtGuestView; game: CourtPublicGame }) {
  const me = view.me.playerId;
  const won = game.winners.includes(me);
  const mine = game.standings.find((s) => s.playerId === me);
  const top = game.standings.slice(0, 5);
  const rows = mine && !top.includes(mine) ? [...top.slice(0, 4), mine] : top;
  return (
    <main className="ct-phone-main">
      <div className="ct-center-col">
        <span className="ct-big-icon" aria-hidden>
          {won ? "🏆" : "⚖️"}
        </span>
        {won ? (
          <p className="ct-lead">فزت!</p>
        ) : (
          mine && (
            <p className="ct-rank-line">
              <span className="ct-mute">#{mine.rank}</span> <b dir="ltr">{mine.score}</b>
            </p>
          )
        )}
      </div>
      <Standings rows={rows} meId={me} showGain={false} />
    </main>
  );
}

