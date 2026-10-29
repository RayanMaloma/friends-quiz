"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Countdown,
  PHASE_LABEL,
  Podium,
  RoundLabel,
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
          <Link href="/host" className="iv-btn iv-btn-gold">قائمة الألعاب</Link>
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
          <Link href="/host" className="iv-btn iv-btn-gold">قائمة الألعاب</Link>
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
        <span className="iv-mute font-bold">
          الرمز <span className="code" dir="ltr">{view.code}</span>
        </span>
        {view.game && <RoundLabel index={view.game.roundIndex} total={view.game.totalRounds} />}
        {view.game && <span className="iv-phase-banner">{PHASE_LABEL[view.game.phase]}</span>}
        <span className="ms-auto" />
        {!connected && <span className="iv-error text-sm">الاتصال ضعيف… نحاول</span>}
        <SoundControls settings={soundSettings} onChange={changeSound} />
      </header>
      {error && (
        <p className="iv-error px-5 pt-3" role="alert">
          {error}
        </p>
      )}
      {view.game ? (
        <Match view={view} game={view.game} run={run} receivedAt={receivedAt} />
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
    if (!game || key === lastPhase.current) return;
    const first = lastPhase.current === null;
    lastPhase.current = key;
    lastAnswered.current = game.answeredCount;
    lastVoted.current = game.votedCount;
    if (first) return; // Opening the page mid-round: no cue.
    const s = sound.current;
    if (game.phase === "question") s?.play(game.roundIndex === 0 ? "start" : "tick");
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
    <main className="iv-host-main" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="text-center">
          <p className="iv-eyebrow">أحاجي تقدّم</p>
          <h1 className="iv-wordmark text-6xl sm:text-7xl">
            اخترع إجابتك <span className="bulb">💡</span>
          </h1>
          <p className="iv-mute mt-2 text-lg font-bold">ما فيه إجابة صح. اكتب أضحك جواب، وكل صوت يجيك = ١٠٠ نقطة.</p>
        </header>
        <div className="iv-lobby">
          <section className="iv-panel flex flex-col items-center gap-3 p-5">
            <p className="iv-eyebrow">ادخلوا من جوالاتكم</p>
            <div className="iv-qr w-full" dangerouslySetInnerHTML={{ __html: qr }} />
            <p className="iv-join-code" dir="ltr">
              {view.code}
            </p>
            <p className="iv-mute text-center text-sm font-bold">امسح الرمز، أو افتح «دخول لعبة» واكتب الرمز</p>
          </section>
          <div className="flex flex-col gap-5">
            <section className="iv-panel flex flex-col gap-4 p-5">
              <header className="flex items-center justify-between">
                <h2 className="iv-display m-0 text-2xl font-bold">اللاعبين</h2>
                <span className="iv-display text-3xl font-black" dir="ltr">
                  {n}
                  <small className="iv-mute text-lg">/{maxPlayers}</small>
                </span>
              </header>
              {n === 0 ? (
                <p className="iv-mute font-bold">ما دخل أحد للحين…</p>
              ) : (
                <ul className="iv-roster">
                  {players.map((p) => (
                    <li key={p.id}>
                      {p.name}
                      <button type="button" className="iv-x" aria-label={`شيل ${p.name}`} title="شيل اللاعب" onClick={() => void run("release", { playerId: p.id })}>
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <SettingsForm view={view} run={run} />
            <div className="flex flex-col items-center gap-2">
              <button type="button" className="iv-btn iv-btn-gold iv-btn-lg min-w-64" disabled={!!issue || busy} onClick={start}>
                {busy && <span className="iv-loader" />}
                ابدأ اللعبة
              </button>
              {issue && <p className="iv-mute font-bold">{issue}</p>}
            </div>
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
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onSave: (v: number) => Promise<boolean> | void;
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
    <label className="iv-field">
      <span>
        {label}
        {hint && (
          <>
            <br />
            <small>{hint}</small>
          </>
        )}
      </span>
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
    </label>
  );
}

function SettingsForm({ view, run }: { view: InventHostView; run: Run }) {
  const { settings, limits } = view;
  return (
    <section className="iv-panel flex flex-col gap-3 p-5">
      <h2 className="iv-display m-0 text-2xl font-bold">إعدادات المباراة</h2>
      <NumberField
        label="عدد الأسئلة"
        hint={`من ١ إلى ${limits.questions} — تنختار عشوائيًا بدون تكرار`}
        value={settings.rounds}
        min={1}
        max={limits.questions}
        onSave={(rounds) => run("settings", { rounds })}
      />
      <NumberField
        label="وقت الإجابة (ثانية)"
        hint="تقدر تغيّره وقت اللعب"
        value={settings.answerSeconds}
        min={1}
        max={limits.maxSeconds}
        onSave={(answerSeconds) => run("settings", { answerSeconds })}
      />
      <NumberField
        label="وقت التصويت (ثانية)"
        hint="تقدر تغيّره وقت اللعب"
        value={settings.voteSeconds}
        min={1}
        max={limits.maxSeconds}
        onSave={(voteSeconds) => run("settings", { voteSeconds })}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Match                                                               */
/* ------------------------------------------------------------------ */

function Match({ view, game, run, receivedAt }: { view: InventHostView; game: InventPublicGame; run: Run; receivedAt: number }) {
  const now = useServerNow(view.serverNow, receivedAt);
  const ms = timeLeft(game.timer, now);
  return (
    <main className="iv-host-main">
      <section className="iv-stage">
        <Stage view={view} game={game} ms={ms} run={run} />
      </section>
      <Controls view={view} game={game} ms={ms} run={run} />
      {game.paused && <div className="iv-paused" role="status">⏸ اللعبة موقّفة مؤقتًا</div>}
    </main>
  );
}

function StageHead({ game, ms }: { game: InventPublicGame; ms: number | null }) {
  return (
    <div className="iv-stage-head">
      <p className="iv-question" dir="auto">{game.question.text}</p>
      {game.timer && <Countdown ms={ms} total={game.timer.durationMs} paused={game.paused} size="5.5rem" />}
    </div>
  );
}

function Stage({ view, game, ms, run }: { view: InventHostView; game: InventPublicGame; ms: number | null; run: Run }) {
  switch (game.phase) {
    case "question":
      return (
        <div key={`q${game.roundIndex}`} className="iv-pop flex min-h-[55vh] flex-col items-center justify-center gap-6 text-center">
          <p className="iv-display text-4xl font-black">
            <RoundLabel index={game.roundIndex} total={game.totalRounds} />
          </p>
          <h1 className="iv-question iv-hero-question" dir="auto">{game.question.text}</h1>
          <p className="iv-mute text-lg font-bold">جهّزوا جوالاتكم… الإجابة تفتح بعد ثواني</p>
        </div>
      );
    case "answering":
      return (
        <>
          <StageHead game={game} ms={ms} />
          <p className="iv-progress text-3xl">
            <b>{game.answeredCount}</b> من {game.playerCount} جاوبوا
          </p>
          <ul className="flex flex-wrap gap-2">
            {view.progress.map((p) => (
              <li key={p.id} className={`iv-chip ${p.answered ? "is-done" : ""} ${p.active ? "" : "is-away"}`}>
                {p.answered ? "✓" : "✍️"} {p.name}
              </li>
            ))}
          </ul>
          <p className="iv-mute font-bold">الإجابات مخفية لين التصويت 🤫</p>
        </>
      );
    case "voting":
      return (
        <>
          <StageHead game={game} ms={ms} />
          <p className="iv-progress text-2xl">
            <b>{game.votedCount}</b> من {game.voterCount} صوّتوا
          </p>
          <AnswerCards cards={game.cards ?? []} />
        </>
      );
    case "reveal":
      return (
        <>
          <StageHead game={game} ms={null} />
          {game.cards && game.cards.length === 0 ? (
            <p className="iv-display iv-mute py-10 text-center text-3xl">ما وصلت ولا إجابة هالجولة 😶</p>
          ) : (
            <>
              {game.votingSkipped && <p className="iv-mute font-bold">إجابة وحدة بس، ما فيه تصويت — هالجولة بدون نقاط.</p>}
              <AnswerCards cards={game.cards ?? []} />
            </>
          )}
        </>
      );
    case "leaderboard":
      return (
        <>
          <div className="iv-stage-head">
            <h2 className="iv-question m-0 flex-1 text-4xl">
              الترتيب بعد الجولة {game.roundIndex + 1}
            </h2>
            {game.timer && <Countdown ms={ms} total={game.timer.durationMs} paused={game.paused} />}
          </div>
          <Standings rows={game.standings} />
        </>
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
    if (ok && action === "close") router.push("/host");
  };
  return (
    <div className="flex flex-col gap-6">
      <header className="iv-pop text-center">
        <p className="iv-eyebrow">{game.endedEarly ? "انتهت المباراة قبل وقتها" : "انتهت المباراة"}</p>
        <h1 className="iv-wordmark mt-1 text-5xl sm:text-6xl">
          {names.length === 0 ? "ما أحد جمع نقاط هالمرة" : names.length > 1 ? `فوز مشترك: ${names.join(" و ")} 🏆` : `الفائز: ${names[0]} 🏆`}
        </h1>
      </header>
      <Podium rows={game.standings} />
      <Standings rows={game.standings} showGain={false} />
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" className="iv-btn iv-btn-gold iv-btn-lg" disabled={busy || view.lobby.filter((p) => p.active).length < view.limits.minPlayers} onClick={() => act("rematch")}>
          مباراة جديدة (نفس اللاعبين)
        </button>
        <button type="button" className="iv-btn iv-btn-lg" disabled={busy} onClick={() => act("lobby")}>
          الرجوع للّوبي
        </button>
        <button type="button" className="iv-btn iv-btn-lg" disabled={busy} onClick={() => act("close")}>
          قائمة الألعاب
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Host controls                                                       */
/* ------------------------------------------------------------------ */

const SKIP_LABEL: Record<string, string> = {
  question: "افتح الإجابة الحين",
  answering: "أنهِ الإجابة",
  voting: "أنهِ التصويت",
  reveal: "الترتيب ←",
  leaderboard: "السؤال الجاي ←",
};

function Controls({ view, game, ms, run }: { view: InventHostView; game: InventPublicGame; ms: number | null; run: Run }) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [freeing, setFreeing] = useState<{ id: string; name: string } | null>(null);
  const over = game.phase === "final";
  const active = useMemo(() => view.progress.filter((p) => p.active).length, [view.progress]);

  return (
    <aside className="iv-panel iv-controls" aria-label="لوحة المضيف">
      <h3>لوحة المضيف</h3>
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
          <span>العدّاد</span>
          <b dir="ltr">{ms === null ? "—" : game.paused ? `❚❚ ${Math.ceil(ms / 1000)}` : Math.ceil(ms / 1000)}</b>
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
          <span>اللاعبين المتصلين</span>
          <b>
            {active}/{view.progress.length}
          </b>
        </div>
        <div className="iv-stat">
          <span>الوقت (إجابة/تصويت)</span>
          <b dir="ltr">
            {view.settings.answerSeconds}s / {view.settings.voteSeconds}s
          </b>
        </div>
      </div>

      {!over && (
        <div className="flex flex-wrap gap-2">
          {game.paused ? (
            <button type="button" className="iv-btn iv-btn-gold flex-1" onClick={() => run("host", { move: { type: "resume" } })}>
              ▶ كمّل
            </button>
          ) : (
            <button type="button" className="iv-btn flex-1" onClick={() => run("host", { move: { type: "pause" } })}>
              ⏸ إيقاف مؤقت
            </button>
          )}
          <button
            type="button"
            className="iv-btn flex-1"
            onClick={() => run("host", { move: { type: "skip", phase: game.phase, round: game.roundIndex } })}
          >
            {SKIP_LABEL[game.phase]}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3>تغيير الوقت (يطبّق على المرحلة الحالية فورًا)</h3>
        <NumberField
          label="الإجابة (ثانية)"
          value={view.settings.answerSeconds}
          min={1}
          max={view.limits.maxSeconds}
          onSave={(answerSeconds) => run("host", { move: { type: "timers", answerSeconds } })}
        />
        <NumberField
          label="التصويت (ثانية)"
          value={view.settings.voteSeconds}
          min={1}
          max={view.limits.maxSeconds}
          onSave={(voteSeconds) => run("host", { move: { type: "timers", voteSeconds } })}
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
        <button type="button" className="iv-btn iv-btn-danger" onClick={() => setConfirmEnd(true)}>
          إنهاء المباراة
        </button>
      )}

      {confirmEnd && (
        <Confirm
          title="تنهي المباراة الحين؟"
          text="بتطلع النتيجة النهائية بالنقاط الحالية، وتوقف العدّادات والإجابات."
          action="إيه، أنهِها"
          onCancel={() => setConfirmEnd(false)}
          onConfirm={async () => {
            setConfirmEnd(false);
            await run("host", { move: { type: "end" } });
          }}
        />
      )}
      {freeing && (
        <Confirm
          title={`تحرّر مقعد ${freeing.name}؟`}
          text="ما ننتظره بعدها، ونقاطه تبقى. يقدر يرجع من جهاز ثاني إذا كتب نفس الاسم بالضبط."
          action="حرّر"
          onCancel={() => setFreeing(null)}
          onConfirm={async () => {
            const id = freeing.id;
            setFreeing(null);
            await run("release", { playerId: id });
          }}
        />
      )}
    </aside>
  );
}

function Confirm({ title, text, action, onCancel, onConfirm }: { title: string; text: string; action: string; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="iv-modal" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
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
