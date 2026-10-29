"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { api, errorMessage, resultMessage } from "@/lib/client/api";
import type { HostCreds } from "@/lib/client/storage";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import type { InventHostView, InventPublicGame } from "@/lib/invent/views";
import {
  AnswerCards,
  PHASE_LABEL,
  Podium,
  Standings,
  timeLeft,
  useDeadlineRefresh,
  useServerNow,
} from "./parts";
import { InventSound, readSoundSettings, writeSoundSettings, type SoundSettings } from "./sound";

type Run = (action: string, extra?: Record<string, unknown>) => Promise<boolean>;

/** The host screen (laptop / TV): lobby, the round on screen, host controls, results. */
export function InventHost({ creds }: { creds: HostCreds }) {
  const { sessionId, hostToken } = creds;
  const fetchView = useCallback(
    () => api<{ view: InventHostView }>("/api/invent", { action: "state", as: "host", sessionId, hostToken }),
    [sessionId, hostToken],
  );
  const { view, receivedAt, fatalError, connected, mutate, refresh } = useGameSync<InventHostView>(sessionId, fetchView);
  useDeadlineRefresh(view?.game?.timer, view?.serverNow, receivedAt, refresh);
  useWakeLock();
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const run = useCallback<Run>(
    async (action, extra = {}) => {
      setError(null);
      const res = await mutate(() => api<{ view: InventHostView }>("/api/invent", { action, as: "host", sessionId, hostToken, ...extra }));
      if (!res.ok) setError(resultMessage(res));
      return res.ok;
    },
    [mutate, sessionId, hostToken],
  );

  const sound = useRef<InventSound | null>(null);
  const [soundSettings, setSoundSettings] = useState<SoundSettings>({ muted: false, volume: 0.6 });
  useEffect(() => {
    sound.current = new InventSound();
    const s = readSoundSettings();
    sound.current.settings = s;
    void Promise.resolve().then(() => setSoundSettings(s));
  }, []);
  const changeSound = (s: SoundSettings) => {
    setSoundSettings(s);
    writeSoundSettings(s);
    if (sound.current) sound.current.settings = s;
    void sound.current?.unlock();
  };
  // Any click on the page unlocks audio (autoplay rules).
  useEffect(() => {
    const unlock = () => void sound.current?.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  useCues(view?.game ?? null, sound, view?.serverNow, receivedAt);

  if (fatalError) {
    return (
      <div className="iv iv-joinpage">
        <div className="iv-join-form">
          <p className="iv-wordmark text-4xl">اخترع إجابتك</p>
          <p className="iv-error">{errorMessage(fatalError)}</p>
          <Link href="/games" className="iv-btn iv-btn-gold">قائمة الألعاب</Link>
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
  if (view.status === "FINISHED") {
    return (
      <div className="iv iv-joinpage">
        <div className="iv-join-form">
          <p className="iv-wordmark text-4xl">اخترع إجابتك</p>
          <p className="iv-mute font-bold">الغرفة انقفلت.</p>
          <Link href="/games" className="iv-btn iv-btn-gold">قائمة الألعاب</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="iv iv-host">
      <header className="iv-topbar">
        <span className="iv-wordmark text-2xl">
          اخترع إجابتك <span className="bulb">💡</span>
        </span>
        {view.game ? (
          view.game.phase !== "final" && (
            <span className="iv-round-pill" dir="ltr" aria-label={`الجولة ${view.game.roundIndex + 1} من ${view.game.totalRounds}`}>
              {view.game.roundIndex + 1}/{view.game.totalRounds}
            </span>
          )
        ) : (
          <span className="iv-mute font-bold">
            الرمز <span className="code" dir="ltr">{view.code}</span>
          </span>
        )}
        <span className="ms-auto" />
        {!connected && <span className="iv-error text-sm">الاتصال ضعيف…</span>}
        <SoundControls settings={soundSettings} onChange={changeSound} />
        {view.game && (
          <button
            type="button"
            className="iv-btn iv-btn-sm iv-gear"
            aria-label="الإعدادات"
            aria-expanded={settingsOpen}
            title="الإعدادات"
            onClick={() => setSettingsOpen((o) => !o)}
          >
            ⚙
          </button>
        )}
      </header>
      {error && (
        <p className="iv-error px-5 pt-3" role="alert">
          {error}
        </p>
      )}
      {view.game ? (
        <Match view={view} game={view.game} run={run} receivedAt={receivedAt} settingsOpen={settingsOpen} onCloseSettings={closeSettings} />
      ) : (
        <Lobby view={view} run={run} onStart={() => void sound.current?.unlock()} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sound                                                               */
/* ------------------------------------------------------------------ */

function SoundControls({ settings, onChange }: { settings: SoundSettings; onChange: (s: SoundSettings) => void }) {
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        className="iv-btn iv-btn-sm"
        aria-pressed={settings.muted}
        onClick={() => onChange({ ...settings, muted: !settings.muted })}
        title={settings.muted ? "تشغيل الصوت" : "كتم الصوت"}
      >
        {settings.muted ? "🔇" : "🔊"}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        aria-label="مستوى الصوت"
        value={Math.round(settings.volume * 100)}
        onChange={(e) => onChange({ ...settings, volume: Number(e.target.value) / 100, muted: false })}
        className="w-24 accent-[#f5c242]"
      />
    </span>
  );
}

/** Plays a cue once per moment (keyed by match, round and phase), so a refresh or refetch never repeats it. */
function useCues(game: InventPublicGame | null, sound: React.RefObject<InventSound | null>, serverNow: string | undefined, receivedAt: number) {
  const lastPhase = useRef<string | null>(null);
  const lastAnswered = useRef(0);
  const lastVoted = useRef(0);
  const lastTick = useRef<number | null>(null);
  const now = useServerNow(serverNow, receivedAt, 250);

  const key = game ? `${game.matchId}:${game.roundIndex}:${game.phase}` : null;
  useEffect(() => {
    // From the lobby into round 1 counts as a moment (start cue); opening the page mid-match does not.
    if (!game) {
      lastPhase.current = "lobby";
      return;
    }
    if (key === lastPhase.current) return;
    const first = lastPhase.current === null;
    lastPhase.current = key;
    lastAnswered.current = game.answeredCount;
    lastVoted.current = game.votedCount;
    if (first) return; // Opening the page mid-round: no cue.
    const s = sound.current;
    if (game.phase === "answering") s?.play(game.roundIndex === 0 ? "start" : "tick");
    else if (game.phase === "voting") s?.play("close");
    else if (game.phase === "reveal") s?.play("reveal");
    else if (game.phase === "leaderboard") s?.play("points");
    else if (game.phase === "final") s?.play("winner");
  }, [key, game, sound]);

  useEffect(() => {
    if (!game) return;
    if (game.answeredCount > lastAnswered.current || game.votedCount > lastVoted.current) sound.current?.play("submit");
    lastAnswered.current = game.answeredCount;
    lastVoted.current = game.votedCount;
  }, [game, sound]);

  // Last five seconds of answering / voting.
  const ms = game && (game.phase === "answering" || game.phase === "voting") && !game.paused ? timeLeft(game.timer, now) : null;
  const sec = ms === null ? null : Math.ceil(ms / 1000);
  useEffect(() => {
    if (sec === null || sec > 5 || sec <= 0 || sec === lastTick.current) return;
    lastTick.current = sec;
    sound.current?.play("tick");
  }, [sec, sound]);
}

/* ------------------------------------------------------------------ */
/* Lobby                                                               */
/* ------------------------------------------------------------------ */

function Lobby({ view, run, onStart }: { view: InventHostView; run: Run; onStart: () => void }) {
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const starting = useRef(false);

  useEffect(() => {
    let alive = true;
    QRCode.toString(`${window.location.origin}/join?code=${view.code}`, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0e0f13", light: "#f3ead8" },
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
  const { minPlayers, maxPlayers } = view.limits;
  const issue =
    n < minPlayers
      ? `ننتظر ${minPlayers - n} ${minPlayers - n === 1 ? "لاعب" : "لاعبين"} على الأقل`
      : n > maxPlayers
        ? `الحد الأعلى ${maxPlayers} لاعب — شيل ${n - maxPlayers}`
        : null;

  async function start() {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    onStart();
    await run("start");
    starting.current = false;
    setBusy(false);
  }

  return (
    <main className="iv-lobby-main">
      <header className="iv-lobby-head">
        <h1 className="iv-wordmark">
          اخترع إجابتك <span className="bulb">💡</span>
        </h1>
      </header>
      <div className="iv-lobby">
        {/* First in RTL = right column: the main way in. */}
        <section className="iv-panel iv-join-panel" aria-label="طريقة الدخول">
          <div className="iv-qr" role="img" aria-label={`رمز QR لدخول الغرفة ${view.code}`} dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="iv-join-code" dir="ltr">
            {view.code}
          </p>
          <p className="iv-mute text-center text-sm font-bold">امسح أو اكتب الرمز</p>
        </section>
        <div className="iv-lobby-side">
          <section className="iv-panel iv-lobby-section" aria-live="polite">
            <header className="iv-section-head">
              <h2>اللاعبين</h2>
              <span className={`iv-count ${n >= minPlayers && n <= maxPlayers ? "is-ready" : ""}`} dir="ltr">
                {n}
                <small>/{maxPlayers}</small>
              </span>
            </header>
            {n === 0 ? (
              <div className="iv-roster-empty">
                <span aria-hidden>📱</span>
                <p>ما دخل أحد للحين</p>
              </div>
            ) : (
              <ul className="iv-roster">
                {players.map((p) => (
                  <li key={p.id}>
                    <span className="iv-roster-name">{p.name}</span>
                    <button type="button" className="iv-x" aria-label={`شيل ${p.name}`} title="شيل اللاعب" onClick={() => void run("release", { playerId: p.id })}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <SettingsForm view={view} run={run} />
          <div className="iv-start">
            <button type="button" className="iv-btn iv-btn-gold iv-btn-lg iv-start-btn" disabled={!!issue || busy} onClick={start}>
              {busy && <span className="iv-loader" />}
              ابدأ اللعبة
            </button>
            <p className={`iv-start-note ${issue ? "" : "is-ready"}`}>{issue ?? `جاهزين — ${n} ${n <= 10 ? "لاعبين" : "لاعب"}`}</p>
          </div>
        </div>
      </div>
    </main>
  );
}

/** A whole-number field that saves on blur / Enter (any value in range, no presets). */
function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onSave,
  variant = "field",
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onSave: (v: number) => Promise<boolean> | void;
  /** "setting": lobby row (label · input · hint); "field": compact host-panel row. */
  variant?: "field" | "setting";
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const parsed = Number(shown);
  const valid = /^\d+$/.test(shown.trim()) && parsed >= min && parsed <= max;
  const commit = () => {
    if (draft === null) return;
    if (valid && parsed !== value) void onSave(parsed);
    setDraft(null);
  };
  return (
    <label className={variant === "setting" ? "iv-setting" : "iv-field"}>
      <span className="iv-setting-label">{label}</span>
      <input
        className="iv-input iv-num"
        inputMode="numeric"
        dir="ltr"
        value={shown}
        aria-invalid={!valid}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d٠-٩]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(null);
        }}
      />
      {hint && <small className="iv-setting-hint">{hint}</small>}
    </label>
  );
}

function SettingsForm({ view, run }: { view: InventHostView; run: Run }) {
  const { settings, limits } = view;
  return (
    <section className="iv-panel iv-lobby-section">
      <header className="iv-section-head">
        <h2>إعدادات المباراة</h2>
      </header>
      <NumberField
        label="عدد الأسئلة"
        hint={`١–${limits.questions}`}
        value={settings.rounds}
        min={1}
        max={limits.questions}
        onSave={(rounds) => run("settings", { rounds })}
        variant="setting"
      />
      <NumberField
        label="وقت الإجابة (ثانية)"
        value={settings.answerSeconds}
        min={1}
        max={limits.maxSeconds}
        onSave={(answerSeconds) => run("settings", { answerSeconds })}
        variant="setting"
      />
      <NumberField
        label="وقت التصويت (ثانية)"
        value={settings.voteSeconds}
        min={1}
        max={limits.maxSeconds}
        onSave={(voteSeconds) => run("settings", { voteSeconds })}
        variant="setting"
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Match: a presentation screen (admin lives in the settings drawer)   */
/* ------------------------------------------------------------------ */

function Match({
  view,
  game,
  run,
  receivedAt,
  settingsOpen,
  onCloseSettings,
}: {
  view: InventHostView;
  game: InventPublicGame;
  run: Run;
  receivedAt: number;
  settingsOpen: boolean;
  onCloseSettings: () => void;
}) {
  const now = useServerNow(view.serverNow, receivedAt);
  const ms = timeLeft(game.timer, now);
  return (
    <main className={`iv-show is-${game.phase}`}>
      <Stage view={view} game={game} ms={ms} run={run} />
      {settingsOpen && <SettingsDrawer view={view} game={game} ms={ms} run={run} onClose={onCloseSettings} />}
      {game.paused && game.phase !== "final" && (
        <div className="iv-paused" role="status">
          ⏸ متوقفة
        </div>
      )}
    </main>
  );
}

/** m:ss, large and plain: readable from across the room. */
function Clock({ ms, paused }: { ms: number | null; paused: boolean }) {
  if (ms === null) return null;
  const s = Math.ceil(ms / 1000);
  return (
    <span className={`iv-clock ${!paused && ms <= 5000 ? "is-urgent" : ""} ${paused ? "is-paused" : ""}`} role="timer" dir="ltr" aria-label={`باقي ${s} ثانية`}>
      {`${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`}
    </span>
  );
}

function Stage({ view, game, ms, run }: { view: InventHostView; game: InventPublicGame; ms: number | null; run: Run }) {
  switch (game.phase) {
    case "answering":
      return (
        <section className="iv-answering" key={`a${game.matchId}${game.roundIndex}`}>
          <h1 className="iv-question iv-q-hero" dir="auto">
            {game.question.text}
          </h1>
          <Clock ms={ms} paused={game.paused} />
          <ul className="iv-status-grid" aria-label={`${game.answeredCount} من ${game.playerCount} جاوبوا`}>
            {view.progress
              .filter((p) => p.active)
              .map((p) => (
                <li key={p.id} className={p.answered ? "is-done" : ""}>
                  <span className="iv-status-name">{p.name}</span>
                  <span className="iv-status-mark" aria-label={p.answered ? "جاوب" : "ما جاوب"}>
                    {p.answered ? "✓" : ""}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      );
    case "voting":
    case "reveal":
      return (
        <section className="iv-board">
          <header className="iv-board-head">
            <h1 className="iv-question iv-q-board" dir="auto">
              {game.question.text}
            </h1>
            {game.phase === "voting" ? (
              <div className="iv-board-meta">
                <Clock ms={ms} paused={game.paused} />
                <span className="iv-progress">
                  <b>{game.votedCount}</b>/{game.voterCount} صوّتوا
                </span>
              </div>
            ) : null}
          </header>
          {game.cards && game.cards.length === 0 ? (
            <p className="iv-empty">ما وصلت إجابات</p>
          ) : (
            <>
              <AnswerCards cards={game.cards ?? []} />
              {game.phase === "reveal" && game.votingSkipped && <p className="iv-empty">إجابة وحدة — بدون نقاط</p>}
            </>
          )}
        </section>
      );
    case "leaderboard":
      return (
        <section className="iv-ranking">
          <h1 className="iv-ranking-title">الترتيب</h1>
          <Standings rows={game.standings} />
        </section>
      );
    case "final":
      return <Final game={game} run={run} view={view} />;
  }
}

function Final({ game, run, view }: { game: InventPublicGame; run: Run; view: InventHostView }) {
  const router = useRouter();
  const names = game.standings.filter((r) => game.winners.includes(r.playerId)).map((r) => r.name);
  const [busy, setBusy] = useState(false);
  const act = async (action: string) => {
    setBusy(true);
    const ok = await run(action);
    setBusy(false);
    if (ok && action === "close") router.push("/games");
  };
  return (
    <section className="iv-ranking">
      <h1 className="iv-wordmark iv-final-title iv-pop">
        {names.length === 0 ? "ما أحد جمع نقاط" : names.length > 1 ? `🏆 ${names.join(" و ")}` : `🏆 ${names[0]}`}
      </h1>
      <Podium rows={game.standings} />
      <Standings rows={game.standings} showGain={false} />
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" className="iv-btn iv-btn-gold iv-btn-lg" disabled={busy || view.lobby.filter((p) => p.active).length < view.limits.minPlayers} onClick={() => act("rematch")}>
          مباراة جديدة
        </button>
        <button type="button" className="iv-btn iv-btn-lg" disabled={busy} onClick={() => act("lobby")}>
          اللوبي
        </button>
        <button type="button" className="iv-btn iv-btn-lg" disabled={busy} onClick={() => act("close")}>
          قائمة الألعاب
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Settings drawer (host controls; never takes layout space)           */
/* ------------------------------------------------------------------ */

const SKIP_LABEL: Record<string, string> = {
  answering: "أنهِ الإجابة",
  voting: "أنهِ التصويت",
  reveal: "التالي",
  leaderboard: "السؤال الجاي",
};

function SettingsDrawer({
  view,
  game,
  ms,
  run,
  onClose,
}: {
  view: InventHostView;
  game: InventPublicGame;
  ms: number | null;
  run: Run;
  onClose: () => void;
}) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [freeing, setFreeing] = useState<{ id: string; name: string } | null>(null);
  const over = game.phase === "final";
  const active = view.progress.filter((p) => p.active).length;
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmEnd && !freeing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmEnd, freeing]);

  return (
    <div className="iv-drawer-backdrop" onClick={onClose}>
      <div
        ref={panel}
        className="iv-drawer iv-panel"
        role="dialog"
        aria-modal="true"
        aria-label="إعدادات المضيف"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="iv-drawer-head">
          <h2>الإعدادات</h2>
          <button type="button" className="iv-x" aria-label="إغلاق" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="iv-stats">
          <div className="iv-stat">
            <span>الرمز</span>
            <b dir="ltr">{view.code}</b>
          </div>
          <div className="iv-stat">
            <span>الجولة</span>
            <b>
              {game.roundIndex + 1}/{game.totalRounds}
            </b>
          </div>
          <div className="iv-stat">
            <span>المرحلة</span>
            <b className="text-base">{PHASE_LABEL[game.phase]}</b>
          </div>
          <div className="iv-stat">
            <span>الوقت</span>
            <b dir="ltr">{ms === null ? "—" : Math.ceil(ms / 1000)}</b>
          </div>
          <div className="iv-stat">
            <span>الإجابات</span>
            <b>
              {game.answeredCount}/{game.playerCount}
            </b>
          </div>
          <div className="iv-stat">
            <span>الأصوات</span>
            <b>
              {game.votedCount}/{game.voterCount}
            </b>
          </div>
          <div className="iv-stat">
            <span>متصلين</span>
            <b>
              {active}/{view.progress.length}
            </b>
          </div>
        </div>

        {!over && (
          <div className="flex gap-2">
            {game.paused ? (
              <button type="button" className="iv-btn iv-btn-gold flex-1" onClick={() => run("host", { move: { type: "resume" } })}>
                ▶ كمّل
              </button>
            ) : (
              <button type="button" className="iv-btn flex-1" onClick={() => run("host", { move: { type: "pause" } })}>
                ⏸ إيقاف
              </button>
            )}
            <button type="button" className="iv-btn flex-1" onClick={() => run("host", { move: { type: "skip", phase: game.phase, round: game.roundIndex } })}>
              {SKIP_LABEL[game.phase]} ⏭
            </button>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <NumberField
            label="وقت الإجابة (ث)"
            value={view.settings.answerSeconds}
            min={1}
            max={view.limits.maxSeconds}
            onSave={(answerSeconds) => run("host", { move: { type: "timers", answerSeconds } })}
            variant="setting"
          />
          <NumberField
            label="وقت التصويت (ث)"
            value={view.settings.voteSeconds}
            min={1}
            max={view.limits.maxSeconds}
            onSave={(voteSeconds) => run("host", { move: { type: "timers", voteSeconds } })}
            variant="setting"
          />
        </div>

        {!over && (
          <details>
            <summary className="cursor-pointer text-sm font-bold text-[color:var(--iv-mute)]">اللاعبين ({view.progress.length})</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {view.progress.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm font-bold">
                  <span className={`flex-1 ${p.active ? "" : "line-through opacity-50"}`}>{p.name}</span>
                  {p.active && (
                    <button type="button" className="iv-btn iv-btn-sm" onClick={() => setFreeing({ id: p.id, name: p.name })}>
                      حرّر المقعد
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {!over && (
          <button type="button" className="iv-btn iv-btn-danger mt-auto" onClick={() => setConfirmEnd(true)}>
            إنهاء المباراة
          </button>
        )}
      </div>

      {confirmEnd && (
        <Confirm
          title="تنهي المباراة؟"
          text="تطلع النتيجة بالنقاط الحالية."
          action="أنهِها"
          onCancel={() => setConfirmEnd(false)}
          onConfirm={async () => {
            setConfirmEnd(false);
            onClose();
            await run("host", { move: { type: "end" } });
          }}
        />
      )}
      {freeing && (
        <Confirm
          title={`تحرّر مقعد ${freeing.name}؟`}
          text="نقاطه تبقى، ويرجع بنفس الاسم."
          action="حرّر"
          onCancel={() => setFreeing(null)}
          onConfirm={async () => {
            const id = freeing.id;
            setFreeing(null);
            await run("release", { playerId: id });
          }}
        />
      )}
    </div>
  );
}

function Confirm({ title, text, action, onCancel, onConfirm }: { title: string; text: string; action: string; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div
      className="iv-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div className="iv-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="iv-display m-0 text-2xl font-bold">{title}</h2>
        <p className="iv-mute m-0 font-bold">{text}</p>
        <div className="flex gap-2">
          <button type="button" className="iv-btn iv-btn-gold flex-1" onClick={onConfirm} autoFocus>
            {action}
          </button>
          <button type="button" className="iv-btn flex-1" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
