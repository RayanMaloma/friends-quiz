"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { api, errorMessage, resultMessage } from "@/lib/client/api";
import type { HostCreds } from "@/lib/client/storage";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import type { DrawHostView, DrawPublicGame } from "@/lib/draw/views";
import { InventSound, readSoundSettings, writeSoundSettings, type SoundSettings } from "@/components/invent/sound";
import { Stamp } from "./DrawPhone";
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
} from "./parts";

type Run = (action: string, extra?: Record<string, unknown>) => Promise<boolean>;

/** The host screen (TV / laptop): lobby with the QR, the turn on screen, results. Host controls live in a drawer. */
export function DrawHost({ creds }: { creds: HostCreds }) {
  const { sessionId, hostToken } = creds;
  const fetchView = useCallback(
    () => api<{ view: DrawHostView }>("/api/draw", { action: "state", as: "host", sessionId, hostToken }),
    [sessionId, hostToken],
  );
  const { view, receivedAt, fatalError, connected, mutate, refresh } = useGameSync<DrawHostView>(sessionId, fetchView);
  useDeadlineRefresh(view?.game?.timer, view?.serverNow, receivedAt, refresh);
  useWakeLock();
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const run = useCallback<Run>(
    async (action, extra = {}) => {
      setError(null);
      const res = await mutate(() => api<{ view: DrawHostView }>("/api/draw", { action, as: "host", sessionId, hostToken, ...extra }));
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

  if (fatalError || !view || view.status === "FINISHED") {
    return (
      <div className="mw mw-page mw-center-page">
        {!view && !fatalError ? (
          <span className="mw-loader" aria-label="جاري التحميل" />
        ) : (
          <div className="mw-card mw-stack">
            <Seal size={72} />
            {fatalError && <p className="mw-error">{errorMessage(fatalError)}</p>}
            <Link href="/games" className="mw-btn mw-btn-primary">قائمة الألعاب</Link>
          </div>
        )}
      </div>
    );
  }

  const g = view.game;
  return (
    <div className="mw mw-tv">
      <header className="mw-tv-head">
        <Letterhead />
        {g && g.phase !== "final" && (
          <span className="mw-turn" dir="ltr" aria-label={`الدور ${g.turnNumber} من ${g.totalTurns}`}>
            {g.turnNumber}/{g.totalTurns}
          </span>
        )}
        <span className="ms-auto" />
        {!connected && <span className="mw-offline">الاتصال ضعيف…</span>}
        <button type="button" className="mw-icon-btn" aria-pressed={soundSettings.muted} aria-label={soundSettings.muted ? "تشغيل الصوت" : "كتم الصوت"} onClick={toggleMute}>
          {soundSettings.muted ? "🔇" : "🔊"}
        </button>
        {g && (
          <button type="button" className="mw-icon-btn" aria-label="الإعدادات" aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
            ⚙
          </button>
        )}
      </header>
      {error && (
        <p className="mw-error mw-tv-error" role="alert">
          {error}
        </p>
      )}
      {g ? (
        <>
          <Stage view={view} game={g} receivedAt={receivedAt} run={run} creds={creds} />
          {panelOpen && <HostPanel view={view} game={g} run={run} onClose={() => setPanelOpen(false)} />}
        </>
      ) : (
        <Lobby view={view} run={run} onStart={() => void sound.current?.unlock()} />
      )}
    </div>
  );
}

/** One cue per moment (match, turn, phase), never repeated by a refetch. */
function useCues(game: DrawPublicGame | null, sound: React.RefObject<InventSound | null>, serverNow: string | undefined, receivedAt: number) {
  const last = useRef<string | null>(null);
  const solved = useRef(0);
  const tick = useRef<number | null>(null);
  const now = useServerNow(serverNow, receivedAt, 250);
  const key = game ? `${game.matchId}:${game.turn}:${game.phase}` : null;

  useEffect(() => {
    if (!game) {
      last.current = "lobby";
      return;
    }
    if (key === last.current) return;
    const first = last.current === null;
    last.current = key;
    solved.current = game.solvedCount;
    if (first) return;
    const s = sound.current;
    if (game.phase === "intro") s?.play(game.turn === 0 ? "start" : "points");
    else if (game.phase === "guessing") s?.play("close");
    else if (game.phase === "reveal") s?.play("reveal");
    else if (game.phase === "final") s?.play("winner");
  }, [key, game, sound]);

  useEffect(() => {
    if (!game) return;
    if (game.solvedCount > solved.current) sound.current?.play("submit");
    solved.current = game.solvedCount;
  }, [game, sound]);

  const ms = game && (game.phase === "drawing" || game.phase === "guessing") ? timeLeft(game.timer, now) : null;
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

function Lobby({ view, run, onStart }: { view: DrawHostView; run: Run; onStart: () => void }) {
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    QRCode.toString(`${window.location.origin}/join?code=${view.code}`, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0b3d2e", light: "#ffffff" },
    })
      .then((svg) => alive && setQr(svg))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [view.code]);

  const players = view.lobby.filter((p) => p.active);
  const n = players.length;
  const { minPlayers, maxPlayers } = view.limits;
  const ready = n >= minPlayers && n <= maxPlayers;

  async function start() {
    if (busy) return;
    setBusy(true);
    onStart();
    await run("start");
    setBusy(false);
  }

  return (
    <main className="mw-lobby">
      <section className="mw-card mw-join" aria-label="الدخول">
        <div className="mw-qr" role="img" aria-label={`رمز QR للغرفة ${view.code}`} dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="mw-code" dir="ltr">
          {view.code}
        </p>
      </section>

      <section className="mw-lobby-side">
        <div className="mw-card mw-roster-card" aria-live="polite">
          <span className={`mw-count is-big ${ready ? "is-ready" : ""}`} dir="ltr" aria-label={`${n} لاعبين`}>
            {n}
            <small>/{maxPlayers}</small>
          </span>
          {n === 0 ? (
            <p className="mw-empty">📱</p>
          ) : (
            <ul className="mw-roster">
              {players.map((p, i) => (
                <li key={p.id} className="mw-rise" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                  <span className="mw-roster-no" dir="ltr">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="mw-roster-name">{p.name}</span>
                  <button type="button" className="mw-x" aria-label={`شيل ${p.name}`} onClick={() => void run("release", { playerId: p.id })}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mw-settings-row">
          <Stepper icon="🔁" label="الدورات" value={view.settings.laps} min={1} max={view.limits.maxLaps} onSave={(laps) => run("settings", { laps })} />
          <Stepper icon="✏️" label="وقت الرسم" unit="ث" value={view.settings.drawSeconds} min={view.limits.minSeconds} max={view.limits.maxSeconds} step={10} onSave={(drawSeconds) => run("settings", { drawSeconds })} />
          <Stepper icon="🔍" label="وقت التخمين" unit="ث" value={view.settings.guessSeconds} min={view.limits.minSeconds} max={view.limits.maxSeconds} step={5} onSave={(guessSeconds) => run("settings", { guessSeconds })} />
        </div>

        <button type="button" className="mw-btn mw-btn-primary mw-btn-xl" disabled={!ready || busy} onClick={start}>
          {busy && <span className="mw-loader is-small" />}
          ابدأ
        </button>
        {!ready && (
          <p className="mw-mute mw-hint" dir="ltr">
            {n}/{minPlayers}+
          </p>
        )}
      </section>
    </main>
  );
}

/** − value + : one number, two buttons, the icon says what it is. */
function Stepper({
  icon,
  label,
  unit,
  value,
  min,
  max,
  step = 1,
  onSave,
}: {
  icon: string;
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onSave: (v: number) => Promise<boolean> | void;
}) {
  const set = (v: number) => {
    const next = Math.max(min, Math.min(max, v));
    if (next !== value) void onSave(next);
  };
  return (
    <div className="mw-stepper" role="group" aria-label={label} title={label}>
      <span className="mw-stepper-icon" aria-hidden>
        {icon}
      </span>
      <button type="button" aria-label={`${label} أقل`} disabled={value <= min} onClick={() => set(value - step)}>
        −
      </button>
      <span className="mw-stepper-value" dir="ltr">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <button type="button" aria-label={`${label} أكثر`} disabled={value >= max} onClick={() => set(value + step)}>
        +
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Match                                                               */
/* ------------------------------------------------------------------ */

function Stage({ view, game, receivedAt, run, creds }: { view: DrawHostView; game: DrawPublicGame; receivedAt: number; run: Run; creds: HostCreds }) {
  const now = useServerNow(view.serverNow, receivedAt);
  const ms = timeLeft(game.timer, now);
  const strokes = useApprovedDrawing(game.drawingRev, `${game.matchId}:${game.turn}`, drawingRequest(creds));
  const { colors, sizes } = view.limits;

  switch (game.phase) {
    case "intro":
      return (
        <main className="mw-stage mw-intro" key={`i${game.matchId}${game.turn}`}>
          <Seal size={140} className="mw-stamp-in" />
          <p className="mw-label">معالي الرسّام</p>
          <h1 className="mw-hero">{game.drawer.name}</h1>
        </main>
      );
    case "drawing":
      return (
        <main className="mw-stage mw-drawing" key={`d${game.matchId}${game.turn}`}>
          <span className="mw-pencil is-busy is-huge" aria-hidden>
            ✏️
          </span>
          <h1 className="mw-hero">{game.drawer.name}</h1>
          <div className="mw-tv-timer">
            <TimerBar ms={ms} timer={game.timer} />
          </div>
        </main>
      );
    case "guessing":
      return (
        <main className="mw-stage mw-gallery">
          <div className="mw-gallery-meta">
            <span className="mw-chip is-drawer">✏️ {game.drawer.name}</span>
            <TimerBar ms={ms} timer={game.timer} />
            <span className="mw-count is-big" aria-label={`${game.solvedCount} من ${game.guesserCount} عرفوها`}>
              ✓ {game.solvedCount}
              <small>/{game.guesserCount}</small>
            </span>
          </div>
          <div className="mw-frame">
            <Sketch strokes={strokes} colors={colors} sizes={sizes} />
          </div>
        </main>
      );
    case "reveal": {
      const r = game.reveal;
      return (
        <main className="mw-stage mw-reveal">
          <div className="mw-frame is-small">
            {game.drawingRev !== null ? <Sketch strokes={strokes} colors={colors} sizes={sizes} /> : <div className="mw-sketch mw-paper-blank" />}
            <Stamp text={r?.word ?? ""} skipped={r?.skipped ?? null} />
          </div>
          <div className="mw-verdict">
            {r && r.correct.length > 0 ? (
              <ul className="mw-winners">
                {r.correct.map((c, i) => (
                  <li key={c.id} className="mw-rise" style={{ animationDelay: `${i * 70}ms` }}>
                    <span className="name">{c.name}</span>
                    <span className="pts" dir="ltr">
                      +{c.points}
                    </span>
                  </li>
                ))}
                <li className="is-drawer mw-rise" style={{ animationDelay: `${r.correct.length * 70}ms` }}>
                  <span className="name">✏️ {game.drawer.name}</span>
                  <span className="pts" dir="ltr">
                    +{r.drawerPoints}
                  </span>
                </li>
              </ul>
            ) : (
              <p className="mw-nobody">✗</p>
            )}
            <Standings rows={game.standings} limit={6} />
          </div>
        </main>
      );
    }
    case "final":
      return <Final view={view} game={game} run={run} />;
  }
}

function Final({ view, game, run }: { view: DrawHostView; game: DrawPublicGame; run: Run }) {
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
    <main className="mw-stage mw-final">
      <section className="mw-certificate mw-rise">
        <Seal size={96} className="is-gold" />
        <p className="mw-label">شهادة تقدير</p>
        <h1 className="mw-hero">{names.length ? names.join(" و ") : "—"}</h1>
        {names.length > 0 && (
          <p className="mw-cert-score" dir="ltr">
            {game.standings[0].score}
          </p>
        )}
      </section>
      <Standings rows={game.standings} showGain={false} />
      <div className="mw-actions">
        <button type="button" className="mw-btn mw-btn-primary mw-btn-lg" disabled={busy || view.lobby.filter((p) => p.active).length < view.limits.minPlayers} onClick={() => act("rematch")}>
          مباراة جديدة
        </button>
        <button type="button" className="mw-btn mw-btn-lg" disabled={busy} onClick={() => act("lobby")}>
          الإعدادات
        </button>
        <button type="button" className="mw-btn mw-btn-lg" disabled={busy} onClick={() => act("close")}>
          قائمة الألعاب
        </button>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Host panel (opened from ⚙, never takes layout space)                */
/* ------------------------------------------------------------------ */

function HostPanel({ view, game, run, onClose }: { view: DrawHostView; game: DrawPublicGame; run: Run; onClose: () => void }) {
  const [confirm, setConfirm] = useState<null | "end" | { id: string; name: string }>(null);
  const over = game.phase === "final";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (confirm ? setConfirm(null) : onClose());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirm]);

  return (
    <div className="mw-backdrop" onClick={onClose}>
      <aside className="mw-panel" role="dialog" aria-modal="true" aria-label="إعدادات المضيف" onClick={(e) => e.stopPropagation()}>
        <header className="mw-panel-head">
          <span className="mw-code is-small" dir="ltr">
            {view.code}
          </span>
          <button type="button" className="mw-x" aria-label="إغلاق" onClick={onClose}>
            ✕
          </button>
        </header>

        {!over && (
          <button type="button" className="mw-btn mw-btn-primary" onClick={() => run("host", { move: { type: "skip", phase: game.phase, turn: game.turn } })}>
            التالي ⏭
          </button>
        )}

        <Stepper icon="✏️" label="وقت الرسم" unit="ث" value={view.settings.drawSeconds} min={view.limits.minSeconds} max={view.limits.maxSeconds} step={10} onSave={(drawSeconds) => run("host", { move: { type: "timers", drawSeconds } })} />
        <Stepper icon="🔍" label="وقت التخمين" unit="ث" value={view.settings.guessSeconds} min={view.limits.minSeconds} max={view.limits.maxSeconds} step={5} onSave={(guessSeconds) => run("host", { move: { type: "timers", guessSeconds } })} />

        {!over && (
          <ul className="mw-panel-players">
            {view.lobby.map((p) => (
              <li key={p.id} className={p.active ? "" : "is-gone"}>
                <span>{p.name}</span>
                {p.active && (
                  <button type="button" className="mw-x" aria-label={`حرّر مقعد ${p.name}`} title="حرّر المقعد" onClick={() => setConfirm({ id: p.id, name: p.name })}>
                    ⏏
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!over && (
          <button type="button" className="mw-btn mw-btn-danger mt-auto" onClick={() => setConfirm("end")}>
            إنهاء المباراة
          </button>
        )}

        {confirm && (
          <div className="mw-confirm is-panel" role="alertdialog" aria-label="تأكيد">
            <p>{confirm === "end" ? "إنهاء المباراة؟" : `تحرير مقعد ${confirm.name}؟`}</p>
            <button
              type="button"
              className="mw-btn mw-btn-danger"
              autoFocus
              onClick={async () => {
                const c = confirm;
                setConfirm(null);
                if (c === "end") {
                  onClose();
                  await run("host", { move: { type: "end" } });
                } else {
                  await run("release", { playerId: c.id });
                }
              }}
            >
              نعم
            </button>
            <button type="button" className="mw-btn" onClick={() => setConfirm(null)}>
              لا
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
