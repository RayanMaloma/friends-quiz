"use client";

/**
 * The TV: the room's game master. Shows only public information, narrates
 * every phase and keeps the atmosphere. The host's controls stay small and
 * out of the way (pause, sound, fullscreen, back to lobby).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { api, errorMessage, resultMessage } from "@/lib/client/api";
import type { HostCreds } from "@/lib/client/storage";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import { MAX_PLAYERS, MIN_PLAYERS, roleCounts, ROLE_INFO, TEAM_NAME, type Role } from "@/lib/mafia/rules";
import { cue, type Cue, type CueKey } from "@/lib/mafia/narration";
import type { MafiaHostView, MafiaPublicMatch, MafiaPublicPlayer } from "@/lib/mafia/views";
import { MafiaAudioProvider, useMafiaAudio } from "./audio/AudioProvider";
import type { Ambience } from "./audio/sound";
import { Emblem } from "./Emblem";
import { Scene, type Mood } from "./Scene";
import {
  CardBack,
  Countdown,
  countsLine,
  formatClock,
  PHASE_LABEL,
  PHASE_TOTAL_MS,
  Plain,
  remainingMs,
  RoleChip,
  useDeadlineRefresh,
  useServerNow,
} from "./parts";
import { DAWN_REVEAL_MS, INTRO, VERDICT_REVEAL_MS } from "./timing";
import { IntroSequence } from "./Intro";

type Send = (action: string, extra?: Record<string, unknown>) => Promise<string | null>;

export function MafiaHost({ creds }: { creds: HostCreds }) {
  useWakeLock();
  const { sessionId, hostToken } = creds;
  const fetchView = useCallback(
    () => api<{ view: MafiaHostView }>("/api/mafia", { action: "state", as: "host", sessionId, hostToken }),
    [sessionId, hostToken],
  );
  const { view, receivedAt, fatalError, connected, mutate, refresh } = useGameSync<MafiaHostView>(sessionId, fetchView);
  useDeadlineRefresh(view?.match, view?.serverNow, receivedAt, refresh);

  const send = useCallback<Send>(
    async (action, extra = {}) => {
      const res = await mutate(() => api<{ view: MafiaHostView }>("/api/mafia", { action, as: "host", sessionId, hostToken, ...extra }));
      return res.ok ? null : resultMessage(res);
    },
    [mutate, sessionId, hostToken],
  );

  if (fatalError) {
    return (
      <Plain>
        <p className="mf-plain-title">{errorMessage(fatalError)}</p>
        <Link href="/host" className="mf-btn mf-btn-gold">غرفة جديدة</Link>
      </Plain>
    );
  }
  if (!view) return <Plain><span className="mf-loader" aria-label="جاري التحميل" /></Plain>;

  return (
    <MafiaAudioProvider session={{ sessionId, hostToken }}>
      <Tv view={view} receivedAt={receivedAt} send={send} connected={connected} />
    </MafiaAudioProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Mood & direction                                                    */
/* ------------------------------------------------------------------ */

function moodOf(m: MafiaPublicMatch | null): Mood {
  if (!m) return "lobby";
  switch (m.phase) {
    case "intro":
      return "night";
    case "roleReveal":
      return "dusk";
    case "nightfall":
    case "detective":
    case "doctor":
      return "night";
    case "mafia":
      return "blood";
    case "dawn":
      return "dawn";
    case "discussion":
    case "voting":
    case "verdict":
      return "day";
    case "gameOver":
      return m.winner?.team === "mafia" ? "crimson" : "gold";
  }
}

const AMBIENCE: Record<Mood, Ambience> = {
  lobby: "lobby",
  dusk: "night",
  night: "night",
  blood: "night",
  dawn: "day",
  day: "day",
  crimson: "crimson",
  gold: "gold",
};

const NIGHT_PHASE = new Set(["nightfall", "mafia", "detective", "doctor"]);

const nameOf = (m: MafiaPublicMatch, id: string | null) => m.players.find((p) => p.id === id)?.name ?? "";

/**
 * Lines already spoken on this TV, kept across reloads (sessionStorage), so
 * a refresh or a reconnect never says a line twice.
 */
const SPOKEN_KEY = "fq:mafia:spoken";
/** How long a new line may wait for the previous one to end. */
const LINE_WAIT_MS = 4000;
function markSpoken(id: string): boolean {
  try {
    const list: string[] = JSON.parse(window.sessionStorage.getItem(SPOKEN_KEY) ?? "[]");
    if (list.includes(id)) return false;
    window.sessionStorage.setItem(SPOKEN_KEY, JSON.stringify([...list.slice(-60), id]));
  } catch {
    // Storage blocked: the in-memory guard below still stops repeats.
  }
  return true;
}

/**
 * Plays the sound and narration of each phase as it starts, driven by the
 * server's phase changes. Keyed on the phase's start time, so a reload
 * mid-phase doesn't replay old lines. Returns the current subtitle.
 */
function useDirector(sessionId: string, m: MafiaPublicMatch | null, now: number): Cue | null {
  const { sound, narrator, unlocked } = useMafiaAudio();
  const [subtitle, setSubtitle] = useState<Cue | null>(null);
  const played = useRef<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mood = moodOf(m);
  const nightPhase =
    !!m &&
    !m.paused &&
    (m.phase === "mafia" || m.phase === "detective" || m.phase === "doctor" || (m.phase === "intro" && now - m.phaseStartedAt >= INTRO.suspenseAt));

  useEffect(() => {
    sound.setAmbience(AMBIENCE[mood]);
  }, [sound, mood, unlocked]);
  useEffect(() => {
    sound.heartbeat(nightPhase);
    return () => sound.heartbeat(false);
  }, [sound, nightPhase]);

  const key = m ? `${m.round}:${m.phase}:${m.phaseStartedAt}` : "lobby";
  const age = m ? now - m.phaseStartedAt : 0;
  const ageRef = useRef(age);
  const matchRef = useRef(m);
  // Declared before the cue effect, so it sees this render's values.
  useEffect(() => {
    ageRef.current = age;
    matchRef.current = m;
  });

  useEffect(() => {
    const s = matchRef.current;
    if (!s || played.current === key) return;
    played.current = key;
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    // Arrived late (reload, reconnect): stay silent, the screen shows where we are.
    const late = ageRef.current > 4000;
    const say = (c: Cue) => {
      setSubtitle(c);
      // Let a recording that is still playing finish (briefly) rather than cut it off.
      if (markSpoken(`${sessionId}|${key}|${c.key}`)) void narrator.speak(c, { waitMs: LINE_WAIT_MS });
    };
    const at = (ms: number, fn: () => void) => {
      const wait = ms - ageRef.current;
      if (wait < -1500) return;
      timers.current.push(setTimeout(fn, Math.max(0, wait)));
    };
    const line = (k: CueKey, name?: string | null) => cue(k, name);
    // The named lines of this phase are known now: load them while the suspense plays.
    if (s.phase === "dawn" && s.dawn?.victimId) narrator.prefetch([line(s.dawn.outcome === "saved" ? "dawn_saved" : "dawn_killed", nameOf(s, s.dawn.victimId))]);
    if (s.phase === "verdict" && s.verdict?.targetId) narrator.prefetch([line("verdict_eliminated", nameOf(s, s.verdict.targetId))]);

    if (!late) {
      switch (s.phase) {
        case "roleReveal":
          say(line("roles"));
          break;
        case "nightfall":
          sound.play("nightfall");
          at(900, () => say(line(s.round === 1 ? "night_first" : "night")));
          break;
        case "mafia":
        case "detective":
        case "doctor":
          sound.play("phase");
          at(400, () => say(line(s.phase as CueKey)));
          break;
        case "dawn":
          sound.play("dawn");
          at(500, () => say(line("dawn")));
          break;
        case "discussion":
          say(line("discussion"));
          break;
        case "voting":
          sound.play("alarm");
          at(1200, () => say(line("voting")));
          break;
        case "verdict":
          say(line("verdict"));
          break;
        case "gameOver":
          sound.play(s.winner?.team === "mafia" ? "mafiaWin" : "cityWin");
          at(1800, () => say(line(s.winner?.team === "mafia" ? "win_mafia" : "win_citizens")));
          break;
      }
    } else {
      setSubtitle(null);
    }

    if (s.phase === "intro") {
      at(0, () => sound.play("introDark"));
      at(INTRO.suspenseAt, () => sound.play("introHit"));
      at(INTRO.narrateAt, () => say(line("intro")));
      at(INTRO.countAt - 300, () => sound.play("suspense"));
      for (const ms of [INTRO.countAt, INTRO.countAt + 1000, INTRO.countAt + 2000]) at(ms, () => sound.play("count"));
    }

    // The reveal moments inside dawn and verdict (also after a late arrival, if still ahead).
    if (s.phase === "dawn" && s.dawn) {
      const d = s.dawn;
      at(DAWN_REVEAL_MS - 2600, () => sound.play("suspense"));
      at(DAWN_REVEAL_MS, () => {
        if (d.outcome === "killed") {
          sound.play("sting");
          say(line("dawn_killed", nameOf(s, d.victimId)));
        } else if (d.outcome === "saved") {
          sound.play("saved");
          say(line("dawn_saved", nameOf(s, d.victimId)));
        } else {
          sound.play("quiet");
          say(line("dawn_quiet"));
        }
      });
    }
    if (s.phase === "verdict" && s.verdict) {
      const v = s.verdict;
      at(VERDICT_REVEAL_MS - 2600, () => sound.play("suspense"));
      at(VERDICT_REVEAL_MS, () => {
        if (v.outcome === "eliminated") {
          sound.play("sting");
          say(line("verdict_eliminated", nameOf(s, v.targetId)));
        } else {
          sound.play("quiet");
          say(line(v.outcome === "skip" ? "verdict_skip" : "verdict_tie"));
        }
      });
    }
  }, [key, narrator, sound, sessionId]);

  useEffect(() => () => {
    for (const t of timers.current) clearTimeout(t);
    narrator.stop();
  }, [narrator]);

  // Clock ticks in the last ten seconds of the discussion and the vote.
  const left = m ? remainingMs(m, now) : null;
  const sec = left === null ? null : Math.ceil(left / 1000);
  const ticking = !!m && !m.paused && (m.phase === "discussion" || m.phase === "voting");
  useEffect(() => {
    if (ticking && sec !== null && sec > 0 && sec <= 10) sound.play("tick");
  }, [ticking, sec, sound]);

  // Subtitles fade after a while.
  useEffect(() => {
    if (!subtitle) return;
    const id = setTimeout(() => setSubtitle(null), 9000);
    return () => clearTimeout(id);
  }, [subtitle]);

  return subtitle;
}

/* ------------------------------------------------------------------ */
/* The TV                                                              */
/* ------------------------------------------------------------------ */

function Tv({ view, receivedAt, send, connected }: { view: MafiaHostView; receivedAt: number; send: Send; connected: boolean }) {
  const now = useServerNow(view.serverNow, receivedAt);
  const m = view.match;
  const subtitle = useDirector(view.sessionId, m, now);
  const audio = useMafiaAudio();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (action: string, extra?: Record<string, unknown>) => {
      setError(null);
      const err = await send(action, extra);
      if (err) setError(err);
    },
    [send],
  );

  return (
    <div className="mf mf-tv" data-phase={m?.phase ?? "lobby"}>
      <Scene mood={moodOf(m)} />
      <TopBar view={view} run={run} />
      <main className="mf-stage" key={m ? `${m.round}-${m.phase}` : "lobby"}>
        {!m ? <Lobby view={view} run={run} /> : <PhaseScreen m={m} now={now} run={run} />}
      </main>
      {m && m.phase !== "gameOver" && m.phase !== "intro" && <PlayerStrip m={m} />}
      <div className={`mf-subtitle ${subtitle ? "is-on" : ""}`} aria-live="polite">
        {subtitle && <p key={subtitle.text}>{subtitle.text}</p>}
      </div>
      {m?.paused && (
        <div className="mf-paused">
          <p className="mf-eyebrow">وقفة</p>
          <h2>اللعبة متوقفة مؤقتًا</h2>
          <button className="mf-btn mf-btn-gold mf-btn-lg" onClick={() => run("host", { move: { type: "resume" } })}>
            كمّل اللعبة
          </button>
        </div>
      )}
      {m && !audio.unlocked && (
        <button className="mf-unlock" onClick={() => void audio.unlock()}>
          <SpeakerIcon /> اضغط هنا عشان يشتغل الصوت والراوي
        </button>
      )}
      {error && <p className="mf-toast" role="alert">{error}</p>}
      {!connected && <div className="mf-conn">في مشكلة بالاتصال… نحاول نرجع</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Top bar & host controls                                             */
/* ------------------------------------------------------------------ */

function TopBar({ view, run }: { view: MafiaHostView; run: (a: string, x?: Record<string, unknown>) => Promise<void> }) {
  const m = view.match;
  const [sound, setSound] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const canPause = !!m && m.phase !== "gameOver" && m.phase !== "intro";
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };
  return (
    <header className="mf-topbar">
      <div className="mf-topbar-brand">
        <span className="mf-wordmark-sm">MAFIA</span>
        {m && (
          <span className="mf-topbar-phase">
            {m.phase !== "intro" && m.phase !== "roleReveal" && m.phase !== "gameOver" && <>{NIGHT_PHASE.has(m.phase) ? "الليلة" : "اليوم"} {m.round} · </>}
            {PHASE_LABEL[m.phase]}
          </span>
        )}
      </div>
      <div className="mf-topbar-tools">
        <span className="mf-code-chip">
          رمز الغرفة <b dir="ltr">{view.code}</b>
        </span>
        {canPause && (
          <button
            className="mf-icon-btn"
            onClick={() => run("host", { move: { type: m!.paused ? "resume" : "pause" } })}
            aria-label={m!.paused ? "كمّل" : "إيقاف مؤقت"}
            title={m!.paused ? "كمّل" : "إيقاف مؤقت"}
          >
            {m!.paused ? <PlayIcon /> : <PauseIcon />}
          </button>
        )}
        <button className="mf-icon-btn" onClick={() => setSound((v) => !v)} aria-label="الصوت" title="الصوت والراوي" aria-expanded={sound}>
          <SpeakerIcon />
        </button>
        <button className="mf-icon-btn" onClick={fullscreen} aria-label="ملء الشاشة" title="ملء الشاشة">
          <FullscreenIcon />
        </button>
        {m && m.phase !== "gameOver" && (
          <button className="mf-icon-btn" onClick={() => setConfirm(true)} aria-label="إلغاء الجولة" title="إلغاء الجولة والرجوع للوبي">
            <ExitIcon />
          </button>
        )}
      </div>
      {sound && <SoundPanel onClose={() => setSound(false)} />}
      {confirm && (
        <div className="mf-modal-back" onClick={() => setConfirm(false)}>
          <div className="mf-modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
            <h3>نلغي الجولة؟</h3>
            <p>ترجعون للوبي بنفس اللاعبين، والأدوار تتوزع من جديد.</p>
            <div className="mf-modal-actions">
              <button className="mf-btn mf-btn-crimson" onClick={() => { setConfirm(false); void run("lobby"); }}>إلغاء الجولة</button>
              <button className="mf-btn mf-btn-ghost" autoFocus onClick={() => setConfirm(false)}>كمّلوا اللعب</button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function SoundPanel({ onClose }: { onClose: () => void }) {
  const { settings, update, source, voices, narrator, unlock } = useMafiaAudio();
  const tts = narrator.ttsSource();
  return (
    <div className="mf-popover" role="dialog" aria-label="الصوت والراوي">
      <div className="mf-popover-head">
        <h3>الصوت والراوي</h3>
        <button className="mf-icon-btn" onClick={onClose} aria-label="إغلاق">✕</button>
      </div>
      <label className="mf-field">
        <span>مستوى الصوت</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.volume}
          onChange={(e) => update({ volume: Number(e.target.value), muted: false })}
        />
      </label>
      <label className="mf-check">
        <input type="checkbox" checked={settings.muted} onChange={(e) => update({ muted: e.target.checked })} />
        <span>كتم كل الأصوات</span>
      </label>
      <div className="mf-field">
        <span>الراوي</span>
        <p className={`mf-source is-${source.kind}`}>{source.label}</p>
        {source.kind === "recorded" && <p className="mf-hint">الجمل اللي فيها أسماء: {narrator.hasServerVoice ? "خدمة الصوت" : tts.label}</p>}
        {!source.najdi && (
          <p className="mf-hint">
            لصوت راوي نجدي: سجّل الجمل في public/mafia/voice، أو فعّل خدمة صوت (MAFIA_TTS_PROVIDER) على السيرفر.
          </p>
        )}
        {narrator.lastError && <p className="mf-hint">{narrator.lastError}</p>}
      </div>
      <label className="mf-field">
        <span>صوت النظام (للجمل بدون تسجيل)</span>
        <select value={settings.voice} onChange={(e) => update({ voice: e.target.value })}>
          <option value="auto">تلقائي — سعودي رجّالي إذا موجود، وإلا أي صوت عربي</option>
          <option value="off">بدون صوت (نص فقط)</option>
          {voices.map((v) => (
            <option key={v.uri} value={v.uri}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
        {voices.length === 0 && <p className="mf-hint">هذا المتصفح ما فيه أصوات عربية.</p>}
      </label>
      <button
        className="mf-btn mf-btn-ghost"
        onClick={async () => {
          await unlock();
          void narrator.speak(cue("intro"));
        }}
      >
        جرّب الراوي
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lobby                                                               */
/* ------------------------------------------------------------------ */

function Lobby({ view, run }: { view: MafiaHostView; run: (a: string, x?: Record<string, unknown>) => Promise<void> }) {
  const { unlock } = useMafiaAudio();
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toString(`${window.location.origin}/join?code=${view.code}`, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#08090B", light: "#E6DCC9" },
    })
      .then((svg) => {
        if (alive) setQr(svg);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [view.code]);

  const players = view.lobby.filter((p) => p.active);
  const n = players.length;
  const counts = roleCounts(n);
  const issue = n < MIN_PLAYERS ? `ننتظر ${MIN_PLAYERS - n} ${MIN_PLAYERS - n === 1 ? "لاعب" : "لاعبين"} على الأقل` : n > MAX_PLAYERS ? `الحد الأعلى ${MAX_PLAYERS} لاعب` : null;

  // A ref, not just state: a double click lands before React re-renders the disabled button.
  const starting = useRef(false);
  async function start() {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    // The click unlocks audio, so the opening sequence starts with sound.
    await unlock();
    await run("start");
    starting.current = false;
    setBusy(false);
  }

  return (
    <div className="mf-lobby">
      <header className="mf-title-block">
        <p className="mf-eyebrow">ألعاب الشلّة تقدّم</p>
        <h1 className="mf-wordmark">MAFIA</h1>
        <p className="mf-title-ar">المافيا</p>
        <p className="mf-tagline">الليلة… محد يدري مين يقدر يثق فيه.</p>
      </header>
      <div className="mf-lobby-grid">
        <section className="mf-dossier mf-join">
          <p className="mf-eyebrow">ادخلوا من جوالاتكم</p>
          <div className="mf-qr" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="mf-join-code" dir="ltr">{view.code}</p>
          <p className="mf-hint">امسح الرمز، أو افتح «دخول لعبة» واكتب الرمز</p>
        </section>
        <section className="mf-dossier mf-roster">
          <header className="mf-roster-head">
            <h2>المشتبه فيهم</h2>
            <span className="mf-count" dir="ltr">
              {n}<small>/{MAX_PLAYERS}</small>
            </span>
          </header>
          {n === 0 ? (
            <p className="mf-roster-empty">ما دخل أحد للحين…</p>
          ) : (
            <ol className="mf-roster-list">
              {players.map((p, i) => (
                <li key={p.id} className="mf-rise" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                  <span className="mf-roster-no">{String(i + 1).padStart(2, "0")}</span>
                  <span className="mf-roster-name">{p.name}</span>
                  <button className="mf-roster-x" onClick={() => setRemoving({ id: p.id, name: p.name })} aria-label={`إخراج ${p.name}`}>
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          )}
          {counts && (
            <div className="mf-dist">
              {countsLine(counts).map(({ role, n: c }) => (
                <span key={role} className="mf-dist-item" data-role={role}>
                  <Emblem role={role} />
                  <b>{c}</b> {ROLE_INFO[role].name}
                </span>
              ))}
            </div>
          )}
          <button className="mf-btn mf-btn-crimson mf-btn-lg mf-start" disabled={!!issue || busy} onClick={start}>
            {busy ? <span className="mf-loader" /> : null}
            {issue ?? "ابدأ اللعبة"}
          </button>
        </section>
      </div>
      {removing && (
        <div className="mf-modal-back" onClick={() => setRemoving(null)}>
          <div className="mf-modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
            <h3>إخراج {removing.name}؟</h3>
            <p>يطلع من الغرفة، ويقدر يدخل من جديد.</p>
            <div className="mf-modal-actions">
              <button
                className="mf-btn mf-btn-crimson"
                onClick={() => {
                  void run("release", { playerId: removing.id });
                  setRemoving(null);
                }}
              >
                إخراج
              </button>
              <button className="mf-btn mf-btn-ghost" autoFocus onClick={() => setRemoving(null)}>
                تراجع
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Phases                                                              */
/* ------------------------------------------------------------------ */

const NIGHT_ORDINAL = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة"];
const nightName = (round: number) => `الليلة ${NIGHT_ORDINAL[round - 1] ?? round}`;

function PhaseScreen({ m, now, run }: { m: MafiaPublicMatch; now: number; run: (a: string, x?: Record<string, unknown>) => Promise<void> }) {
  const left = remainingMs(m, now);
  const t = now - m.phaseStartedAt;
  const total = PHASE_TOTAL_MS[m.phase] ?? 0;

  switch (m.phase) {
    case "intro":
      return <IntroSequence elapsed={t} />;

    case "roleReveal": {
      const seen = new Set(m.seenIds);
      return (
        <div className="mf-scene-text mf-reveal">
          <p className="mf-eyebrow">الأدوار توزّعت</p>
          <h1 className="mf-headline">كل واحد يشوف دوره… بصمت</h1>
          <p className="mf-lede">اضغط مطوّل على البطاقة في جوالك. لا توري أحد، ولا تعلّق.</p>
          <ul className="mf-deal">
            {m.players.map((p, i) => (
              <li key={p.id} className={seen.has(p.id) ? "is-seen" : ""} style={{ animationDelay: `${i * 90}ms` }}>
                <CardBack />
                <span>{p.name}</span>
              </li>
            ))}
          </ul>
          <div className="mf-dist mf-dist-tv">
            {countsLine(m.counts).map(({ role, n }) => (
              <span key={role} className="mf-dist-item" data-role={role}>
                <Emblem role={role} />
                <b>{n}</b> {ROLE_INFO[role].name}
              </span>
            ))}
          </div>
          <div className="mf-reveal-foot">
            <Countdown ms={left} total={total} size="sm" />
            <span className="mf-hint">
              شافوا أدوارهم: <b>{seen.size}</b> من {m.players.length}
            </span>
            <button className="mf-btn mf-btn-ghost" onClick={() => run("host", { move: { type: "skipReveal" } })}>
              كلّنا شفنا ← ابدأ الليل
            </button>
          </div>
        </div>
      );
    }

    case "nightfall":
      return (
        <div className="mf-scene-text mf-nightfall">
          <p className="mf-eyebrow mf-fade">{nightName(m.round)}</p>
          <h1 className="mf-display mf-fade-slow" style={{ animationDelay: "600ms" }}>حلّ الليل</h1>
          <p className="mf-lede mf-fade" style={{ animationDelay: "1800ms" }}>وكل واحد يخفي أسراره…</p>
        </div>
      );

    case "mafia":
    case "detective":
    case "doctor": {
      const copy = {
        mafia: { title: "القتلة… جاء دوركم", lede: "اختاروا ضحيتكم من جوالاتكم… بصمت." },
        detective: { title: "الشايب… حان وقت التحقيق", lede: "اختر شخص واحد… وتعرف حقيقته." },
        doctor: { title: "الطبيب… اختر من تحميه", lede: "لو كان هو الهدف، بينجو الليلة." },
      }[m.phase];
      return (
        <div className="mf-scene-text mf-night-role" data-role={m.phase}>
          <p className="mf-eyebrow">{nightName(m.round)}</p>
          <Emblem role={m.phase} className="mf-night-emblem" />
          <h1 className="mf-headline">{copy.title}</h1>
          <p className="mf-lede">{copy.lede}</p>
          <Countdown ms={left} total={total} size="lg" />
        </div>
      );
    }

    case "dawn": {
      const d = m.dawn;
      const revealed = t >= DAWN_REVEAL_MS;
      if (!revealed || !d) {
        return (
          <div className="mf-scene-text mf-dawn">
            <p className="mf-eyebrow mf-fade">{nightName(m.round)} انتهت</p>
            <h1 className="mf-display mf-fade-slow">طلع الفجر</h1>
            <p className="mf-lede mf-fade" style={{ animationDelay: "1400ms" }}>وخلونا نشوف وش صار الليلة…</p>
          </div>
        );
      }
      const victim = nameOf(m, d.victimId);
      if (d.outcome === "killed") {
        return (
          <div className="mf-scene-text mf-announce is-killed">
            <p className="mf-eyebrow mf-fade">ضحية الليلة</p>
            <h1 className="mf-victim mf-fade-slow">{victim}</h1>
            {/* Same for every role: what they were stays secret until the end. */}
            <p className="mf-lede mf-fade" style={{ animationDelay: "500ms" }}>تم قتله… ودوره يبقى سرّ لين النهاية.</p>
          </div>
        );
      }
      if (d.outcome === "saved") {
        return (
          <div className="mf-scene-text mf-announce is-saved">
            <p className="mf-eyebrow mf-fade">محاولة اغتيال فاشلة</p>
            <h1 className="mf-victim mf-fade-slow">{victim}</h1>
            <p className="mf-lede mf-fade" style={{ animationDelay: "600ms" }}>كان الهدف الليلة… بس الطبيب كان أسرع منهم.</p>
            <Emblem role="doctor" className="mf-announce-emblem mf-fade" />
          </div>
        );
      }
      return (
        <div className="mf-scene-text mf-announce is-quiet">
          <p className="mf-eyebrow mf-fade">الليلة مرّت</p>
          <h1 className="mf-display mf-fade-slow">ليلة هادية</h1>
          <p className="mf-lede mf-fade" style={{ animationDelay: "600ms" }}>محد مات الليلة… بس القتلة لسا بينكم.</p>
        </div>
      );
    }

    case "discussion":
      return (
        <div className="mf-scene-text mf-discussion">
          <p className="mf-eyebrow">النقاش</p>
          <div className={`mf-bigclock ${left !== null && left <= 10000 ? "is-urgent" : ""}`} dir="ltr" role="timer">
            {formatClock(left)}
          </div>
          <h1 className="mf-headline">ناقشوا… وشكّوا في بعض</h1>
          <p className="mf-lede">
            {m.players.filter((p) => p.alive).length} باقين بالمدينة · اللي طلعوا ما يتكلمون
          </p>
        </div>
      );

    case "voting":
      return (
        <div className="mf-scene-text mf-voting">
          <p className="mf-eyebrow">التصويت</p>
          <h1 className="mf-headline">صوّتوا من جوالاتكم</h1>
          <Countdown ms={left} total={total} size="lg" />
          <div className="mf-votes" aria-label={`صوّت ${m.votedCount} من ${m.voterCount}`}>
            {Array.from({ length: m.voterCount }, (_, i) => (
              <span key={i} className={i < m.votedCount ? "is-on" : ""} />
            ))}
          </div>
          <p className="mf-lede">
            صوّت <b>{m.votedCount}</b> من {m.voterCount} · اللي ما يصوّت = تخطي · التعادل = محد يطلع
          </p>
        </div>
      );

    case "verdict": {
      const v = m.verdict;
      if (!v || t < VERDICT_REVEAL_MS) {
        return (
          <div className="mf-scene-text mf-verdict-wait">
            <p className="mf-eyebrow">انتهى التصويت</p>
            <h1 className="mf-display mf-fade-slow">المدينة قررت…</h1>
          </div>
        );
      }
      const max = Math.max(1, ...v.tally.map((x) => x.count));
      return (
        <div className={`mf-scene-text mf-verdict is-${v.outcome}`}>
          {v.outcome === "eliminated" ? (
            <>
              <p className="mf-eyebrow mf-fade">المدينة طردت</p>
              <h1 className="mf-victim mf-fade-slow">{nameOf(m, v.targetId)}</h1>
              <p className="mf-lede mf-fade" style={{ animationDelay: "900ms" }}>تم استبعاده… ودوره يبقى سرّ لين النهاية.</p>
            </>
          ) : (
            <>
              <p className="mf-eyebrow mf-fade">{v.outcome === "skip" ? "تخطّي" : "تعادل"}</p>
              <h1 className="mf-display mf-fade-slow">محد يطلع اليوم</h1>
              <p className="mf-lede mf-fade">{v.outcome === "skip" ? "أغلب المدينة اختارت تتخطى." : "الأصوات تعادلت… والقتلة يبتسمون."}</p>
            </>
          )}
          <ul className="mf-tally mf-fade" style={{ animationDelay: "500ms" }}>
            {v.tally.map((x) => (
              <li key={x.option} className={x.option === v.targetId ? "is-top" : ""}>
                <span className="mf-tally-name">{x.option === "skip" ? "تخطي" : nameOf(m, x.option)}</span>
                <span className="mf-tally-bar"><i style={{ transform: `scaleX(${x.count / max})` }} /></span>
                <b>{x.count}</b>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    case "gameOver":
      return <Finale m={m} run={run} />;
  }
}

function outLabel(p: MafiaPublicPlayer): string {
  if (!p.out) return "نجا";
  return p.out.by === "night" ? `قُتل بالليلة ${p.out.round}` : `طُرد بتصويت يوم ${p.out.round}`;
}

function Finale({ m, run }: { m: MafiaPublicMatch; run: (a: string, x?: Record<string, unknown>) => Promise<void> }) {
  const team = m.winner?.team ?? "citizens";
  const [busy, setBusy] = useState(false);
  const order: Role[] = ["mafia", "detective", "doctor", "citizen"];
  const cast = [...m.players].sort((a, b) => order.indexOf(a.role!) - order.indexOf(b.role!));
  return (
    <div className="mf-finale" data-team={team}>
      <Emblem role={team === "mafia" ? "mafia" : "city"} className="mf-finale-emblem mf-fade-slow" />
      <p className="mf-eyebrow mf-fade">انتهت اللعبة</p>
      <h1 className="mf-display mf-fade-slow">{team === "mafia" ? "المافيا انتصرت" : "المدينة انتصرت"}</h1>
      <p className="mf-lede mf-fade" style={{ animationDelay: "900ms" }}>{m.winner?.reason}</p>
      <ul className="mf-cast">
        {cast.map((p, i) => {
          const won = p.role !== null && (p.role === "mafia") === (team === "mafia");
          return (
            <li key={p.id} className={`mf-rise ${won ? "is-winner" : ""} ${p.alive ? "" : "is-out"}`} style={{ animationDelay: `${1400 + i * 110}ms` }}>
              {p.role && <RoleChip role={p.role} />}
              <b>{p.name}</b>
              <small>{outLabel(p)}</small>
            </li>
          );
        })}
      </ul>
      <div className="mf-finale-actions mf-fade" style={{ animationDelay: "2200ms" }}>
        <button
          className="mf-btn mf-btn-gold mf-btn-lg"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await run("lobby");
            setBusy(false);
          }}
        >
          جولة جديدة بنفس الشلّة
        </button>
        <Link href="/host" className="mf-btn mf-btn-ghost">غرفة جديدة</Link>
      </div>
      <p className="mf-hint">{TEAM_NAME[team]} · {m.round} {m.round === 1 ? "ليلة" : "ليالي"}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Player strip                                                        */
/* ------------------------------------------------------------------ */

function PlayerStrip({ m }: { m: MafiaPublicMatch }) {
  return (
    <footer className="mf-strip" aria-label="اللاعبين">
      {m.players.map((p) => (
        // Out players look the same whatever their role (it isn't sent anyway).
        <span key={p.id} className={`mf-strip-item ${p.alive ? "" : "is-out"}`}>
          <span className="mf-strip-name">{p.name}</span>
        </span>
      ))}
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

const ico = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

function SpeakerIcon() {
  return (
    <svg {...ico}>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg {...ico}>
      <path d="M8 5v14M16 5v14" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg {...ico}>
      <path d="M17 12 7 5v14z" />
    </svg>
  );
}
function FullscreenIcon() {
  return (
    <svg {...ico}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}
function ExitIcon() {
  return (
    <svg {...ico}>
      <path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10" />
    </svg>
  );
}
