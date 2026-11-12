"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { api, errorMessage, resultMessage } from "@/lib/client/api";
import type { HostCreds } from "@/lib/client/storage";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import type { KeyRole } from "@/lib/court/engine";
import type { CourtHostView, CourtPublicGame } from "@/lib/court/views";
import { InventSound, readSoundSettings, writeSoundSettings, type SoundSettings } from "@/components/invent/sound";
import {
  Brand,
  KIND,
  PauseIcon,
  PhaseSteps,
  ROLE,
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

type Run = (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
type Move = (move: Record<string, unknown>) => Promise<boolean>;

/** The shared screen (TV): lobby with the QR, the hearing, verdicts, standings. Host controls live behind ⚙. */
export function CourtHost({ creds }: { creds: HostCreds }) {
  const { sessionId, hostToken } = creds;
  const fetchView = useCallback(
    () => api<{ view: CourtHostView }>("/api/court", { action: "state", as: "host", sessionId, hostToken }),
    [sessionId, hostToken],
  );
  const { view, receivedAt, fatalError, connected, mutate, refresh } = useGameSync<CourtHostView>(sessionId, fetchView);
  useDeadlineRefresh(view?.game?.timer, view?.serverNow, receivedAt, refresh);
  useWakeLock();
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const run = useCallback<Run>(
    async (action, extra = {}) => {
      setError(null);
      const res = await mutate(() => api<{ view: CourtHostView }>("/api/court", { action, as: "host", sessionId, hostToken, ...extra }));
      if (!res.ok) setError(resultMessage(res));
      return res.ok;
    },
    [mutate, sessionId, hostToken],
  );
  const move = useCallback<Move>((m) => run("host", { move: m }), [run]);

  const sound = useRef<InventSound | null>(null);
  const [soundSettings, setSoundSettings] = useState<SoundSettings>({ muted: false, volume: 0.6 });
  useEffect(() => {
    sound.current = new InventSound();
    const s = readSoundSettings();
    sound.current.settings = s;
    void Promise.resolve().then(() => setSoundSettings(s));
    const unlock = () => void sound.current?.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  const toggleMute = () => {
    const s = { ...soundSettings, muted: !soundSettings.muted };
    setSoundSettings(s);
    writeSoundSettings(s);
    if (sound.current) sound.current.settings = s;
    void sound.current?.unlock();
  };
  useCues(view?.game ?? null, sound, view?.serverNow, receivedAt);

  // Space / Enter: the main button on the screens that wait for the host.
  const g = view?.game ?? null;
  useEffect(() => {
    if (!g || (g.phase !== "verdict" && g.phase !== "standings")) return;
    const onKey = (e: KeyboardEvent) => {
      if (panelOpen || (e.key !== " " && e.key !== "Enter") || (e.target as HTMLElement)?.closest("button, input")) return;
      e.preventDefault();
      void move({ type: "next", phase: g.phase, case: g.caseIndex });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [g, move, panelOpen]);

  if (fatalError || !view || view.status === "FINISHED") {
    return (
      <div className="ct ct-page ct-center">
        {!view && !fatalError ? (
          <span className="ct-loader" aria-label="جاري التحميل" />
        ) : (
          <div className="ct-card ct-stack">
            <Scales size={64} />
            {fatalError && <p className="ct-error">{errorMessage(fatalError)}</p>}
            <Link href="/games" className="ct-btn is-primary">
              قائمة الألعاب
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ct ct-tv">
      <header className="ct-tv-head">
        <Brand />
        {g && g.phase !== "final" && <PhaseSteps phase={g.phase} />}
        <span className="ct-grow" />
        {g && g.phase !== "final" && (
          <span className="ct-case-no" dir="ltr" aria-label={`القضية ${g.caseNumber} من ${g.totalCases}`}>
            {g.caseNumber}/{g.totalCases}
          </span>
        )}
        {!connected && <span className="ct-offline">الاتصال ضعيف…</span>}
        <button type="button" className="ct-icon-btn" aria-pressed={soundSettings.muted} aria-label={soundSettings.muted ? "تشغيل الصوت" : "كتم الصوت"} onClick={toggleMute}>
          {soundSettings.muted ? "🔇" : "🔊"}
        </button>
        {g && (
          <button type="button" className="ct-icon-btn" aria-label="تحكم المضيف" aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
            ⚙
          </button>
        )}
      </header>
      {error && (
        <p className="ct-error ct-tv-error" role="alert">
          {error}
        </p>
      )}
      {g ? (
        <>
          <Stage view={view} game={g} receivedAt={receivedAt} run={run} move={move} />
          {g.paused && <PauseCurtain game={g} view={view} receivedAt={receivedAt} move={move} />}
          {panelOpen && <HostPanel view={view} game={g} run={run} move={move} onClose={() => setPanelOpen(false)} />}
        </>
      ) : (
        <Lobby view={view} run={run} onStart={() => void sound.current?.unlock()} />
      )}
    </div>
  );
}

/** One cue per moment, never repeated by a refetch. */
function useCues(game: CourtPublicGame | null, sound: React.RefObject<InventSound | null>, serverNow: string | undefined, receivedAt: number) {
  const last = useRef<string | null>(null);
  const counts = useRef({ votes: 0, evidence: 0 });
  const tick = useRef<number | null>(null);
  const now = useServerNow(serverNow, receivedAt, 250);
  const key = game ? `${game.matchId}:${game.caseIndex}:${game.phase}` : null;

  useEffect(() => {
    if (!game) {
      last.current = "lobby";
      return;
    }
    if (key === last.current) return;
    const first = last.current === null;
    last.current = key;
    if (first) return;
    const s = sound.current;
    if (game.phase === "announce") s?.play("start");
    else if (game.phase === "objection") s?.play("close");
    else if (game.phase === "vote") s?.play("close");
    else if (game.phase === "verdict") s?.play("reveal");
    else if (game.phase === "standings") s?.play("points");
    else if (game.phase === "final") s?.play("winner");
  }, [key, game, sound]);

  useEffect(() => {
    if (!game) return;
    const c = { votes: game.votes.cast, evidence: game.evidence.length };
    if (c.votes > counts.current.votes || c.evidence > counts.current.evidence) sound.current?.play("submit");
    counts.current = c;
  }, [game, sound]);

  const ms = game && !game.paused ? timeLeft(game.timer, now) : null;
  const sec = ms === null ? null : Math.ceil(ms / 1000);
  useEffect(() => {
    if (sec === null || sec > 5 || sec <= 0 || sec === tick.current) return;
    tick.current = sec;
    sound.current?.play("tick");
  }, [sec, sound]);
}

/* ------------------------------------------------------------------ */
/* Lobby                                                               */
/* ------------------------------------------------------------------ */

function Lobby({ view, run, onStart }: { view: CourtHostView; run: Run; onStart: () => void }) {
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    QRCode.toString(`${window.location.origin}/join?code=${view.code}`, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#20163a", light: "#ffffff" },
    })
      .then((svg) => alive && setQr(svg))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [view.code]);

  const players = view.lobby.filter((p) => p.active);
  const n = players.length;
  const { minPlayers, maxPlayers, maxCases } = view.limits;
  const ready = n >= minPlayers && n <= maxPlayers;
  const cases = view.settings.cases;

  async function start() {
    if (busy) return;
    setBusy(true);
    onStart();
    await run("start");
    setBusy(false);
  }

  return (
    <main className="ct-lobby">
      <section className="ct-card ct-join" aria-label="الدخول">
        <div className="ct-qr" role="img" aria-label={`رمز QR للغرفة ${view.code}`} dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="ct-code" dir="ltr">
          {view.code}
        </p>
      </section>

      <section className="ct-lobby-side">
        <div className="ct-card ct-roster-card" aria-live="polite">
          <span className={`ct-count ${ready ? "is-ready" : ""}`} dir="ltr" aria-label={`${n} لاعبين`}>
            {n}
            <small>/{maxPlayers}</small>
          </span>
          {n === 0 ? (
            <p className="ct-empty" aria-hidden>
              📱
            </p>
          ) : (
            <ul className="ct-roster">
              {players.map((p, i) => (
                <li key={p.id} className="ct-rise" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                  <span className={`ct-dot ${p.here ? "is-here" : ""}`} aria-hidden />
                  <span className="ct-roster-name">{p.name}</span>
                  <button type="button" className="ct-x" aria-label={`شيل ${p.name}`} onClick={() => void run("release", { playerId: p.id })}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="ct-stepper" role="group" aria-label="عدد القضايا">
          <span className="ct-stepper-label">القضايا</span>
          <button type="button" aria-label="قضايا أقل" disabled={cases <= 1} onClick={() => void run("settings", { cases: cases - 1 })}>
            −
          </button>
          <span className="ct-stepper-value" dir="ltr">
            {cases}
          </span>
          <button type="button" aria-label="قضايا أكثر" disabled={cases >= maxCases} onClick={() => void run("settings", { cases: cases + 1 })}>
            +
          </button>
        </div>

        <button type="button" className="ct-btn is-primary is-xl" disabled={!ready || busy} onClick={start}>
          {busy && <span className="ct-loader is-small" />}
          بدء المحاكمة
        </button>
        {!ready && n < minPlayers && (
          <p className="ct-mute ct-hint" dir="ltr">
            {n}/{minPlayers}
          </p>
        )}
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* The hearing                                                         */
/* ------------------------------------------------------------------ */

function Stage({ view, game, receivedAt, run, move }: { view: CourtHostView; game: CourtPublicGame; receivedAt: number; run: Run; move: Move }) {
  const now = useServerNow(view.serverNow, receivedAt);
  const ms = timeLeft(game.timer, now);
  const timer = <TimerBar ms={ms} timer={game.timer} paused={!!game.paused} />;
  const k = `${game.matchId}:${game.caseIndex}:${game.phase}`;

  switch (game.phase) {
    case "announce":
      return (
        <main className="ct-stage ct-announce" key={k}>
          <h1 className="ct-case-title ct-rise">{game.title}</h1>
          <p className="ct-summary ct-rise">{game.summary}</p>
          <div className="ct-cast">
            {(["accused", "prosecutor", "lawyer"] as const).map((r, i) => (
              <div key={r} className={`ct-cast-card is-${r} ct-rise`} style={{ animationDelay: `${200 + i * 120}ms` }}>
                <span className="icon" aria-hidden>
                  {ROLE[r].icon}
                </span>
                <span className="label">{ROLE[r].label}</span>
                <span className="name">{game.roles[r].name}</span>
              </div>
            ))}
          </div>
          <div className="ct-stage-timer">{timer}</div>
        </main>
      );
    case "opening_p":
    case "opening_l":
    case "cross_p":
    case "cross_l":
    case "closing_p":
    case "closing_l":
      return <Floor game={game} timer={timer} k={k} />;
    case "evidence":
    case "objection":
      return <Evidence game={game} timer={timer} />;
    case "vote":
      return (
        <main className="ct-stage ct-vote" key={k}>
          <h1 className="ct-question">
            هل <b>{game.roles.accused.name}</b> مذنب؟
          </h1>
          <div className="ct-ballots" aria-label={`صوّت ${game.votes.cast} من ${game.votes.total}`}>
            {Array.from({ length: game.votes.total }, (_, i) => (
              <span key={i} className={`ct-ballot ${i < game.votes.cast ? "is-in" : ""}`} aria-hidden>
                🗳️
              </span>
            ))}
          </div>
          <p className="ct-tally" dir="ltr">
            {game.votes.cast}/{game.votes.total}
          </p>
          <div className="ct-stage-timer">{timer}</div>
        </main>
      );
    case "verdict":
      return <VerdictScreen game={game} move={move} />;
    case "standings":
      return (
        <main className="ct-stage ct-board" key={k}>
          <Standings rows={game.standings} />
          <button type="button" className="ct-btn is-primary is-lg" onClick={() => void move({ type: "next", phase: "standings", case: game.caseIndex })}>
            {game.caseNumber < game.totalCases ? "القضية التالية" : "النتيجة النهائية"}
          </button>
        </main>
      );
    case "final":
      return <Final view={view} game={game} run={run} />;
  }
}

/** Openings, cross-examination and closings: who has the floor, and the clock. */
function Floor({ game, timer, k }: { game: CourtPublicGame; timer: React.ReactNode; k: string }) {
  const s = speakerOf(game)!;
  return (
    <main className="ct-stage ct-floor" key={k}>
      <div className={`ct-speaker is-${s.role} ct-rise`}>
        <span className="ct-mic" aria-hidden>
          🎙️
        </span>
        <span className="label">
          {ROLE[s.role].icon} {ROLE[s.role].label}
        </span>
        <span className="name">{game.roles[s.role as KeyRole].name}</span>
      </div>
      {s.target && (
        <div className="ct-target ct-rise" style={{ animationDelay: "120ms" }}>
          <span className="arrow" aria-hidden>
            ⟵
          </span>
          <RoleTag role="accused" name={game.roles.accused.name} size="lg" />
        </div>
      )}
      <div className="ct-stage-timer">{timer}</div>
      {game.evidence.length > 0 && <ExhibitStrip game={game} />}
    </main>
  );
}

/** Small reminder of what is on the record (openings onward). */
function ExhibitStrip({ game }: { game: CourtPublicGame }) {
  return (
    <ol className="ct-strip" aria-label="الأدلة">
      {game.evidence.map((e, i) => (
        <li key={e.index}>
          <span className="no">{i + 1}</span>
          <span className="txt">{e.text}</span>
        </li>
      ))}
    </ol>
  );
}

function Evidence({ game, timer }: { game: CourtPublicGame; timer: React.ReactNode }) {
  const objecting = game.phase === "objection";
  const o = game.objection;
  return (
    <main className={`ct-stage ct-evidence ${objecting ? "is-objecting" : ""}`}>
      <div className="ct-evidence-head">
        <RoleTag role="prosecutor" name={game.roles.prosecutor.name} size="lg" />
        {timer}
      </div>
      <ol className="ct-exhibits">
        {[0, 1, 2].map((slot) => {
          const e = game.evidence[slot];
          if (!e) {
            return (
              <li key={`empty${slot}`} className="ct-exhibit is-empty" aria-label="لم يُقدَّم">
                <span className="no">{slot + 1}</span>
                <span className="q" aria-hidden>
                  ؟
                </span>
              </li>
            );
          }
          const target = o?.exhibit === e.index;
          return (
            <li key={e.index} className={`ct-exhibit ct-drop ${target ? "is-target" : ""}`}>
              <span className="no">{slot + 1}</span>
              <p className="txt">{e.text}</p>
              {target && o?.outcome && (
                <p className={`ct-ruling ${o.outcome.upheld ? "is-upheld" : "is-overruled"}`}>
                  <b>{o.outcome.upheld ? "✓ اعتراض مقبول" : "✗ اعتراض مرفوض"}</b>
                  {o.outcome.note && <span>{o.outcome.note}</span>}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {objecting && o && (
        <div className="ct-objection" role="status">
          <span className="ct-objection-word">اعتراض!</span>
          <RoleTag role="lawyer" name={o.lawyer} />
        </div>
      )}
    </main>
  );
}

function VerdictScreen({ game, move }: { game: CourtPublicGame; move: Move }) {
  const v = game.verdict;
  if (!v) return <main className="ct-stage" />;
  const next = () => void move({ type: "next", phase: "verdict", case: game.caseIndex });
  const right = v.guilty === v.truth;
  return (
    <main className="ct-stage ct-verdict">
      <section className="ct-verdict-main">
        <Stamp guilty={v.guilty} className="ct-stamp-in" />
        <p className="ct-votes" aria-label={`${v.guiltyVotes} مذنب، ${v.innocentVotes} بريء`}>
          {v.noVotes ? (
            <span className="ct-mute">ما أحد صوّت</span>
          ) : (
            <>
              <span className="is-guilty">
                مذنب <b dir="ltr">{v.guiltyVotes}</b>
              </span>
              <span className="is-innocent">
                بريء <b dir="ltr">{v.innocentVotes}</b>
              </span>
            </>
          )}
        </p>
        <p className={`ct-truth ${right ? "is-right" : "is-wrong"} ct-rise`} style={{ animationDelay: "700ms" }}>
          <span>الحقيقة</span>
          <b>{v.truth ? VERDICT_TEXT.guilty : VERDICT_TEXT.innocent}</b>
          <span aria-hidden>{right ? "✓" : "✗"}</span>
        </p>
      </section>
      <section className="ct-verdict-side ct-rise" style={{ animationDelay: "900ms" }}>
        <p className="ct-explain">{v.explanation}</p>
        <ul className="ct-classes">
          {v.exhibits.map((e, i) => (
            <li key={i} className={e.presented ? "" : "is-unused"}>
              <span className={`ct-kind ${KIND[e.kind].cls}`}>{KIND[e.kind].label}</span>
              <span className="txt">{e.text}</span>
              <span className="why">{e.why}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="ct-gains ct-rise" style={{ animationDelay: "1100ms" }}>
        {v.gained
          .filter((x) => x.points > 0)
          .map((x) => (
            <span key={x.id} className={`ct-gain is-${x.role}`}>
              <span aria-hidden>{ROLE[x.role].icon}</span>
              {x.name}
              <b dir="ltr">+{x.points}</b>
            </span>
          ))}
        <span className="ct-grow" />
        <button type="button" className="ct-btn is-primary is-lg" onClick={next}>
          الترتيب
        </button>
      </section>
    </main>
  );
}

const VERDICT_TEXT = { guilty: "مذنب", innocent: "بريء" } as const;

function Final({ view, game, run }: { view: CourtHostView; game: CourtPublicGame; run: Run }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const names = game.standings.filter((r) => game.winners.includes(r.playerId)).map((r) => r.name);
  const act = async (action: string) => {
    setBusy(true);
    const ok = await run(action);
    setBusy(false);
    if (ok && action === "close") router.push("/games");
  };
  return (
    <main className="ct-stage ct-final">
      <section className="ct-champion ct-rise">
        <span className="ct-crown" aria-hidden>
          🏆
        </span>
        <h1>{names.length ? names.join(" و ") : "—"}</h1>
        {names.length > 0 && (
          <p className="ct-champion-score" dir="ltr">
            {game.standings[0].score}
          </p>
        )}
      </section>
      <Standings rows={game.standings} showGain={false} />
      <div className="ct-actions">
        <button type="button" className="ct-btn is-primary is-lg" disabled={busy || view.lobby.filter((p) => p.active).length < view.limits.minPlayers} onClick={() => act("rematch")}>
          محاكمة جديدة
        </button>
        <button type="button" className="ct-btn is-lg" disabled={busy} onClick={() => act("lobby")}>
          الإعدادات
        </button>
        <button type="button" className="ct-btn is-lg" disabled={busy} onClick={() => act("close")}>
          قائمة الألعاب
        </button>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Pauses                                                              */
/* ------------------------------------------------------------------ */

function PauseCurtain({ game, view, receivedAt, move }: { game: CourtPublicGame; view: CourtHostView; receivedAt: number; move: Move }) {
  const now = useServerNow(view.serverNow, receivedAt, 500);
  const p = game.paused!;
  const graceLeft = p.graceEnds === null ? 0 : Math.max(0, Math.ceil((p.graceEnds - now) / 1000));
  const waiting = p.reason === "absent" && p.waitingFor.length > 0;
  return (
    <div className="ct-curtain" role="status">
      <div className="ct-card ct-curtain-card ct-rise">
        {waiting ? (
          <>
            <span className="ct-curtain-icon" aria-hidden>
              📵
            </span>
            <ul className="ct-waiting">
              {p.waitingFor.map((w) => (
                <li key={w.id}>
                  <RoleTag role={w.role} name={w.name} size="lg" />
                </li>
              ))}
            </ul>
            {graceLeft > 0 ? (
              <p className="ct-grace" dir="ltr">
                {graceLeft}
              </p>
            ) : (
              <div className="ct-curtain-actions">
                <button type="button" className="ct-btn is-primary" onClick={() => void move({ type: "resume" })}>
                  كمّل بدونه
                </button>
                {p.waitingFor.map((w) => (
                  <button key={w.id} type="button" className="ct-btn" onClick={() => void move({ type: "replace", role: w.role, case: game.caseIndex })}>
                    محلّف بدل {ROLE[w.role].label}
                  </button>
                ))}
                <button type="button" className="ct-btn is-danger" onClick={() => void move({ type: "void", case: game.caseIndex })}>
                  إلغاء القضية
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <PauseIcon big />
            <p className="ct-curtain-title">متوقّف</p>
            <button type="button" className="ct-btn is-primary is-lg" onClick={() => void move({ type: "resume" })}>
              استئناف
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Host panel (opened from ⚙)                                          */
/* ------------------------------------------------------------------ */

type Confirm = null | { text: string; act: () => Promise<unknown> };

function HostPanel({ view, game, run, move, onClose }: { view: CourtHostView; game: CourtPublicGame; run: Run; move: Move; onClose: () => void }) {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const over = game.phase === "final";
  const hearing = !["vote", "verdict", "standings", "final"].includes(game.phase);
  const timed = game.timer !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (confirm ? setConfirm(null) : onClose());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirm]);

  const roleOf = (id: string) =>
    (Object.keys(game.roles) as KeyRole[]).find((r) => game.roles[r].id === id) ?? (game.jurors.some((j) => j.id === id) ? "juror" : null);

  return (
    <div className="ct-backdrop" onClick={onClose}>
      <aside className="ct-panel" role="dialog" aria-modal="true" aria-label="تحكم المضيف" onClick={(e) => e.stopPropagation()}>
        <header className="ct-panel-head">
          <span className="ct-code is-small" dir="ltr">
            {view.code}
          </span>
          <button type="button" className="ct-x" aria-label="إغلاق" onClick={onClose}>
            ✕
          </button>
        </header>

        {!over && (
          <div className="ct-panel-row">
            {timed &&
              (game.paused ? (
                <button type="button" className="ct-btn is-primary" onClick={() => void move({ type: "resume" })}>
                  ▶ استئناف
                </button>
              ) : (
                <button type="button" className="ct-btn" onClick={() => void move({ type: "pause" })}>
                  ⏸ إيقاف
                </button>
              ))}
            <button type="button" className="ct-btn" onClick={() => void move({ type: "next", phase: game.phase, case: game.caseIndex })}>
              التالي ⏭
            </button>
          </div>
        )}

        {!over && (
          <ul className="ct-panel-players">
            {view.lobby
              .filter((p) => p.active || game.standings.some((s) => s.playerId === p.id))
              .map((p) => {
                const r = roleOf(p.id);
                return (
                  <li key={p.id} className={p.active ? "" : "is-gone"}>
                    <span className={`ct-dot ${p.here ? "is-here" : ""}`} aria-label={p.here ? "متصل" : "غير متصل"} />
                    <span className="name">{p.name}</span>
                    {r && <span className="ct-mini-role" aria-label={ROLE[r].label}>{ROLE[r].icon}</span>}
                    {hearing && r && r !== "juror" && (
                      <button
                        type="button"
                        className="ct-x"
                        aria-label={`محلّف بدل ${p.name}`}
                        title="استبدال"
                        onClick={() =>
                          setConfirm({ text: `محلّف بدل ${p.name}؟`, act: () => move({ type: "replace", role: r, case: game.caseIndex }) })
                        }
                      >
                        ⇄
                      </button>
                    )}
                    {p.active && (
                      <button
                        type="button"
                        className="ct-x"
                        aria-label={`حرّر مقعد ${p.name}`}
                        title="تحرير المقعد"
                        onClick={() => setConfirm({ text: `تحرير مقعد ${p.name}؟`, act: () => run("release", { playerId: p.id }) })}
                      >
                        ⏏
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>
        )}

        {!over && (
          <div className="ct-panel-row mt-auto">
            {game.phase !== "verdict" && game.phase !== "standings" && (
              <button type="button" className="ct-btn is-danger" onClick={() => setConfirm({ text: "إلغاء القضية؟", act: () => move({ type: "void", case: game.caseIndex }) })}>
                إلغاء القضية
              </button>
            )}
            <button
              type="button"
              className="ct-btn is-danger"
              onClick={() =>
                setConfirm({
                  text: "إنهاء الجلسة؟",
                  act: async () => {
                    onClose();
                    await move({ type: "end" });
                  },
                })
              }
            >
              إنهاء الجلسة
            </button>
          </div>
        )}

        {confirm && (
          <div className="ct-confirm" role="alertdialog" aria-label="تأكيد">
            <p>{confirm.text}</p>
            <button
              type="button"
              className="ct-btn is-danger"
              autoFocus
              onClick={async () => {
                const c = confirm;
                setConfirm(null);
                await c.act();
              }}
            >
              نعم
            </button>
            <button type="button" className="ct-btn" onClick={() => setConfirm(null)}>
              لا
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
