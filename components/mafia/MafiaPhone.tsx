"use client";

/**
 * A player's phone: the secret instrument. It holds the role card (press and
 * hold — let go and it hides), the night actions (one tap, no confirmation,
 * changeable until the phase closes), the vote, and the player's own fate.
 * It is silent: no sounds, no vibration, nothing that tells the room who is
 * busy at night.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorMessage, resultMessage } from "@/lib/client/api";
import { playerStore, type PlayerCreds } from "@/lib/client/storage";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import { ROLE_INFO, SETTLE_MS, teamOf, TEAM_NAME } from "@/lib/mafia/rules";
import type { PlayerMove } from "@/lib/mafia/types";
import type { MafiaGuestView, MafiaPublicMatch, MafiaSecret, MafiaTask } from "@/lib/mafia/views";
import { Emblem } from "./Emblem";
import { Scene, type Mood } from "./Scene";
import { INTRO, introDigit } from "./timing";
import { CardBack, PHASE_LABEL, Plain, remainingMs, RoleCard, RoleChip, useDeadlineRefresh, useServerNow } from "./parts";

type Act = (move: PlayerMove) => Promise<boolean>;

export function MafiaPhone({ creds }: { creds: PlayerCreds }) {
  useWakeLock();
  const { sessionId, playerToken } = creds;
  const fetchView = useCallback(
    () => api<{ view: MafiaGuestView }>("/api/mafia", { action: "state", as: "guest", sessionId, playerToken }),
    [sessionId, playerToken],
  );
  const { view, receivedAt, fatalError, connected, mutate, refresh } = useGameSync<MafiaGuestView>(sessionId, fetchView);
  useDeadlineRefresh(view?.match, view?.serverNow, receivedAt, refresh);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 3500);
    return () => clearTimeout(id);
  }, [error]);

  const act = useCallback<Act>(
    async (move) => {
      const res = await mutate(() => api<{ view: MafiaGuestView }>("/api/mafia", { action: "act", as: "guest", sessionId, playerToken, move }));
      if (!res.ok) {
        setError(resultMessage(res));
        return false;
      }
      // Once everyone has acted, the phase closes after a short settle: knock then.
      if (move.type === "night" || move.type === "seeRole") setTimeout(refresh, SETTLE_MS + 500);
      return true;
    },
    [mutate, sessionId, playerToken, refresh],
  );

  if (fatalError) {
    return (
      <Plain>
        <p className="mf-plain-title">{errorMessage(fatalError)}</p>
        <Link href="/join" onClick={() => playerStore.clear(sessionId)} className="mf-btn mf-btn-gold">
          ادخل من جديد
        </Link>
      </Plain>
    );
  }
  if (!view) return <Plain><span className="mf-loader" aria-label="جاري التحميل" /></Plain>;

  return <Phone view={view} receivedAt={receivedAt} act={act} creds={creds} connected={connected} error={error} />;
}

function phoneMood(m: MafiaPublicMatch | null): Mood {
  if (!m) return "lobby";
  switch (m.phase) {
    case "intro":
    case "roleReveal":
      return "dusk";
    case "nightfall":
    case "mafia":
    case "detective":
    case "doctor":
      // Every phone looks the same at night, whoever is acting.
      return "night";
    case "dawn":
      return "dawn";
    case "gameOver":
      return m.winner?.team === "mafia" ? "crimson" : "gold";
    default:
      return "day";
  }
}

function Phone({ view, receivedAt, act, creds, connected, error }: {
  view: MafiaGuestView;
  receivedAt: number;
  act: Act;
  creds: PlayerCreds;
  connected: boolean;
  error: string | null;
}) {
  // Finer ticks during the intro so ٣ ٢ ١ changes with the TV.
  const now = useServerNow(view.serverNow, receivedAt, view.match?.phase === "intro" ? 150 : 500);
  const m = view.match;
  const secret = view.secret;
  const left = m ? remainingMs(m, now) : null;
  const showHoldBar = !!m && !!secret && m.phase !== "intro" && m.phase !== "roleReveal";

  return (
    <div className="mf mf-phone" data-phase={m?.phase ?? "lobby"}>
      <Scene mood={phoneMood(m)} lite />
      <header className="mf-phone-head">
        <span className="mf-phone-name">{view.me.name}</span>
        <span className="mf-phone-status">
          {m ? (m.phase === "mafia" || m.phase === "detective" || m.phase === "doctor" ? `الليل · ${PHASE_LABEL[m.phase]}` : PHASE_LABEL[m.phase]) : <>رمز <b dir="ltr">{view.code}</b></>}
          {m?.paused ? " · متوقفة" : left !== null && m?.phase !== "dawn" && m?.phase !== "verdict" && m?.phase !== "nightfall" && m?.phase !== "intro" ? (
            <b className="mf-phone-timer" dir="ltr">{Math.ceil(left / 1000)}</b>
          ) : null}
        </span>
      </header>
      <main className={`mf-phone-body ${showHoldBar ? "has-bar" : ""}`}>
        {view.status === "LOBBY" || !m ? (
          <PhoneLobby view={view} creds={creds} />
        ) : m.phase === "intro" && view.seated ? (
          <PhoneIntro t={now - m.phaseStartedAt} />
        ) : !view.seated || !secret ? (
          <Center icon="moon" title="اللعبة بدأت بدونك" text="تابع من التلفزيون، وتدخل الجولة الجاية." />
        ) : (
          <PhoneGame m={m} secret={secret} act={act} meId={view.me.playerId} left={left} />
        )}
      </main>
      {showHoldBar && <HoldBar secret={secret!} />}
      {error && <p className="mf-toast" role="alert">{error}</p>}
      {!connected && <div className="mf-conn">في مشكلة بالاتصال… نحاول نرجع</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PhoneLobby({ view, creds }: { view: MafiaGuestView; creds: PlayerCreds }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const n = view.lobby.filter((p) => p.active).length;
  return (
    <div className="mf-phone-center">
      <p className="mf-wordmark-sm">MAFIA</p>
      <h1 className="mf-phone-title">دخلت الغرفة</h1>
      <p className="mf-phone-text">
        بانتظار المضيف يوزّع الأدوار… <br />
        <span className="mf-hint">في الغرفة {n} {n === 1 ? "لاعب" : "لاعبين"}</span>
      </p>
      <p className="mf-hint">إذا طلعت من الصفحة، ارجع لها وبتكمّل من مكانك.</p>
      <button
        className="mf-btn mf-btn-ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await api("/api/guest", { action: "leave", sessionId: creds.sessionId, playerToken: creds.playerToken });
          if (res.ok) {
            playerStore.clear(creds.sessionId);
            router.replace(`/mafia/join?code=${view.code}`);
          } else setBusy(false);
        }}
      >
        مو أنا؟ اطلع
      </button>
    </div>
  );
}

/** The opening sequence, on the same server clock as the TV. No role is sent yet. */
function PhoneIntro({ t }: { t: number }) {
  const digit = introDigit(t);
  return (
    <div className="mf-phone-center mf-phone-intro">
      <p className="mf-eyebrow">انظر للتلفزيون</p>
      <h1 className="mf-wordmark">MAFIA</h1>
      <p className="mf-phone-text">{t < INTRO.countAt ? "الأدوار توزّعت بالسر… بطاقتك جاية." : "استعد…"}</p>
      <div className="mf-phone-intro-count" aria-live="polite">{digit && <span key={digit}>{digit}</span>}</div>
    </div>
  );
}

function Center({ icon, title, text, children }: { icon: "moon" | "eye" | "sun"; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="mf-phone-center">
      <span className={`mf-glyph is-${icon}`} aria-hidden />
      <h1 className="mf-phone-title">{title}</h1>
      {text && <p className="mf-phone-text">{text}</p>}
      {children}
    </div>
  );
}

function PhoneGame({ m, secret, act, meId, left }: { m: MafiaPublicMatch; secret: MafiaSecret; act: Act; meId: string; left: number | null }) {
  if (m.phase === "gameOver") return <PhoneResult m={m} secret={secret} meId={meId} />;

  if (m.phase === "roleReveal") {
    return (
      <div className="mf-phone-reveal">
        <h1 className="mf-phone-title">بطاقتك</h1>
        <p className="mf-phone-text">اضغط مطوّل عشان تشوف دورك. أول ما ترفع إصبعك تختفي.</p>
        <HoldCard secret={secret} onFirstHold={secret.seen ? undefined : () => void act({ type: "seeRole" })} />
        {secret.seen && <p className="mf-hint">شفت دورك ✓ — انتظر الليل</p>}
      </div>
    );
  }

  if (!secret.alive) {
    const me = m.players.find((p) => p.id === meId);
    return (
      <Center
        icon="eye"
        title="طلعت من اللعبة"
        text={me?.out?.by === "night" ? `قتلوك بالليلة ${me.out.round}.` : me?.out ? `المدينة طردتك بتصويت يوم ${me.out.round}.` : undefined}
      >
        <RoleChip role={secret.role} />
        <p className="mf-hint">لا تتكلم ولا تلمّح… تابع القصة من التلفزيون.</p>
      </Center>
    );
  }

  if (secret.task && secret.task.kind !== "vote") {
    return <NightTask key={`${m.round}-${m.phase}`} m={m} task={secret.task} secret={secret} act={act} left={left} />;
  }
  if (secret.task && secret.task.kind === "vote") {
    return <VoteTask key={`vote-${m.round}`} m={m} task={secret.task} act={act} left={left} />;
  }

  switch (m.phase) {
    case "nightfall":
    case "mafia":
    case "detective":
    case "doctor":
      return <Center icon="moon" title="الليل…" text="خلّك هادي، وانتظر الصبح." />;
    case "discussion":
      return <Center icon="eye" title="النقاش" text="ناقشوا وجهًا لوجه… وراقب وجيههم." />;
    case "voting":
      return <Center icon="eye" title="التصويت" text="انظر للتلفزيون." />;
    default:
      return <Center icon="sun" title="انظر للتلفزيون" text="الراوي بيعلن وش صار." />;
  }
}

/* ------------------------------------------------------------------ */
/* Night actions                                                       */
/* ------------------------------------------------------------------ */

const TASK_COPY = {
  mafia: { title: "اختر الضحية", hint: "ضغطة وحدة تكفي · تقدر تغيّر قبل ما ينتهي الوقت" },
  detective: { title: "مع مين تحقق؟", hint: "ضغطة وحدة · تعرف دوره فورًا، ولا تقدر تغيّر" },
  doctor: { title: "مين تحمي الليلة؟", hint: "ضغطة وحدة · تقدر تحمي نفسك · كل شخص مرة وحدة باللعبة" },
} as const;

function NightTask({ m, task, secret, act, left }: { m: MafiaPublicMatch; task: MafiaTask; secret: MafiaSecret; act: Act; left: number | null }) {
  const kind = task.kind as "mafia" | "detective" | "doctor";
  const [pending, setPending] = useState<string | null>(null);
  const choice = pending ?? task.choice;
  const copy = TASK_COPY[kind];
  const result = kind === "detective" && task.locked ? secret.investigations.find((i) => i.round === m.round) : undefined;

  async function pick(id: string) {
    if (m.paused || (task.locked && id !== task.choice)) return;
    setPending(id);
    await act({ type: "night", phase: kind, round: m.round, targetId: id });
    setPending(null);
  }

  return (
    <div className="mf-task" data-kind={kind}>
      <header className="mf-task-head">
        <Emblem role={kind} />
        <div>
          <h1>{copy.title}</h1>
          <p>{copy.hint}</p>
        </div>
      </header>
      {result ? (
        <div className="mf-finding">
          <p className="mf-eyebrow">نتيجة التحقيق</p>
          <h2>{result.name}</h2>
          <RoleChip role={result.role} />
          <p className="mf-hint">النتيجة لك وحدك. احفظها… وتصرّف بحكمة.</p>
        </div>
      ) : (
        <ul className="mf-targets">
          {task.targets.map((t) => {
            const picks = task.team.filter((x) => x.targetId === t.id);
            const selected = choice === t.id;
            return (
              <li key={t.id}>
                <button
                  className={`mf-target ${selected ? "is-selected" : ""}`}
                  aria-pressed={selected}
                  disabled={m.paused || (task.locked && !selected)}
                  onClick={() => pick(t.id)}
                >
                  <span className="mf-target-name">{t.name}</span>
                  {picks.length > 0 && <span className="mf-target-tags">{picks.map((x) => x.name).join("، ")}</span>}
                  <span className="mf-target-mark" aria-hidden />
                </button>
              </li>
            );
          })}
          {task.blocked.map((t) => (
            <li key={t.id}>
              <button className="mf-target is-blocked" disabled>
                <span className="mf-target-name">{t.name}</span>
                <span className="mf-target-tags">حميته قبل</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mf-task-foot">
        {choice ? "اختيارك وصل ✓" : "ما اخترت للحين"}
        {left !== null && !m.paused && <> · باقي <b dir="ltr">{Math.ceil(left / 1000)}</b> ث</>}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Day vote                                                            */
/* ------------------------------------------------------------------ */

function VoteTask({ m, task, act, left }: { m: MafiaPublicMatch; task: MafiaTask; act: Act; left: number | null }) {
  const [pending, setPending] = useState<string | null>(null);
  const choice = pending ?? task.choice;

  async function vote(option: string) {
    if (m.paused) return;
    setPending(option);
    await act({ type: "vote", round: m.round, choice: option });
    setPending(null);
  }

  return (
    <div className="mf-task" data-kind="vote">
      <header className="mf-task-head">
        <div>
          <h1>مين تطرد؟</h1>
          <p>صوتك سرّي · تقدر تغيّره قبل ما ينتهي الوقت</p>
        </div>
      </header>
      <button className={`mf-skip-vote ${choice === "skip" ? "is-selected" : ""}`} aria-pressed={choice === "skip"} disabled={m.paused} onClick={() => vote("skip")}>
        تخطي التصويت
      </button>
      <ul className="mf-targets">
        {task.targets.map((t) => (
          <li key={t.id}>
            <button className={`mf-target ${choice === t.id ? "is-selected" : ""}`} aria-pressed={choice === t.id} disabled={m.paused} onClick={() => vote(t.id)}>
              <span className="mf-target-name">{t.name}</span>
              <span className="mf-target-mark" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <p className="mf-task-foot">
        {choice ? "صوتك وصل ✓" : "ما صوّت للحين — بدون صوت = تخطي"}
        {left !== null && !m.paused && <> · باقي <b dir="ltr">{Math.ceil(left / 1000)}</b> ث</>}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* End                                                                 */
/* ------------------------------------------------------------------ */

function PhoneResult({ m, secret, meId }: { m: MafiaPublicMatch; secret: MafiaSecret; meId: string }) {
  const team = m.winner?.team ?? "citizens";
  const won = teamOf(secret.role) === team;
  return (
    <div className="mf-phone-center mf-phone-result" data-won={won}>
      <p className="mf-eyebrow">{TEAM_NAME[team]} انتصرت</p>
      <h1 className="mf-phone-title">{won ? "فزتوا" : "خسرتوا"}</h1>
      <p className="mf-phone-text">{m.winner?.reason}</p>
      <ul className="mf-phone-cast">
        {m.players.map((p) => (
          <li key={p.id} className={`${p.alive ? "" : "is-out"} ${p.id === meId ? "is-me" : ""}`}>
            <span>{p.name}</span>
            {p.role && <RoleChip role={p.role} />}
          </li>
        ))}
      </ul>
      <p className="mf-hint">بانتظار المضيف يبدأ جولة جديدة…</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hold to reveal                                                      */
/* ------------------------------------------------------------------ */

/** Pressed = visible. Released, blurred or backgrounded = hidden again. */
function useHold(onFirst?: () => void) {
  const [held, setHeld] = useState(false);
  const first = useRef(onFirst);
  useEffect(() => {
    first.current = onFirst;
  });
  useEffect(() => {
    const hide = () => setHeld(false);
    const onVis = () => {
      if (document.visibilityState !== "visible") hide();
    };
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  const show = () => {
    setHeld(true);
    if (first.current) {
      first.current();
      first.current = undefined;
    }
  };
  const hide = () => setHeld(false);
  const bind = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      show();
      // Keep receiving the release even if the finger slides off the card.
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Not capturable: pointerup / blur still hide it.
      }
    },
    onPointerUp: hide,
    onPointerCancel: hide,
    onLostPointerCapture: hide,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        show();
      }
    },
    onKeyUp: hide,
    onBlur: hide,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
  return { held, bind };
}

function HoldCard({ secret, onFirstHold }: { secret: MafiaSecret; onFirstHold?: () => void }) {
  const { held, bind } = useHold(onFirstHold);
  return (
    <button type="button" className={`mf-hold ${held ? "is-held" : ""}`} aria-label="اضغط مطوّل عشان تشوف دورك" {...bind}>
      {/* While not held, the role is not in the page at all. */}
      {held ? <RoleCard role={secret.role} teammates={secret.role === "mafia" ? secret.teammates : undefined} /> : <CardBack hint="اضغط مطوّل" />}
    </button>
  );
}

function HoldBar({ secret }: { secret: MafiaSecret }) {
  const { held, bind } = useHold();
  return (
    <>
      {held && (
        <div className="mf-hold-sheet" aria-live="polite">
          <RoleCard role={secret.role} teammates={secret.role === "mafia" ? secret.teammates : undefined} compact />
          {secret.investigations.length > 0 && (
            <div className="mf-notebook">
              <p className="mf-eyebrow">دفتر التحقيق</p>
              <ul>
                {secret.investigations.map((i) => (
                  <li key={`${i.round}-${i.targetId}`}>
                    <span>الليلة {i.round}</span>
                    <b>{i.name}</b>
                    <em data-role={i.role}>{ROLE_INFO[i.role].name}</em>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <button type="button" className={`mf-holdbar ${held ? "is-held" : ""}`} {...bind}>
        <span className="mf-holdbar-dot" aria-hidden />
        {held ? "ارفع إصبعك عشان تخفيها" : "اضغط مطوّل · بطاقتي"}
      </button>
    </>
  );
}
