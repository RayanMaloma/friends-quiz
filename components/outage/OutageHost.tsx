"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { api, errorMessage, resultMessage } from "@/lib/client/api";
import type { HostCreds } from "@/lib/client/storage";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import type { Difficulty } from "@/lib/outage/engine";
import type { OutageHostView, TvGame } from "@/lib/outage/views";
import { InventSound, readSoundSettings, writeSoundSettings, type SoundSettings } from "@/components/invent/sound";
import { Emblem, LEVEL_NAMES, Meter, mmss, secondsLeft, useLivePoll, useServerNow } from "./parts";

type Run = (action: string, extra?: Record<string, unknown>) => Promise<boolean>;

/** The TV: the shared command center. The host manages the session only — no system controls here. */
export function OutageHost({ creds }: { creds: HostCreds }) {
  const { sessionId, hostToken } = creds;
  const fetchView = useCallback(
    () => api<{ view: OutageHostView }>("/api/outage", { action: "state", as: "host", sessionId, hostToken }),
    [sessionId, hostToken],
  );
  const { view, receivedAt, fatalError, connected, mutate, refresh } = useGameSync<OutageHostView>(sessionId, fetchView);
  const g = view?.game ?? null;
  useLivePoll(!!g && !g.outcome, refresh, 1000);
  useWakeLock();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback<Run>(
    async (action, extra = {}) => {
      setError(null);
      const res = await mutate(() => api<{ view: OutageHostView }>("/api/outage", { action, as: "host", sessionId, hostToken, ...extra }));
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
  useCues(g, sound);

  if (fatalError || !view || view.status === "FINISHED") {
    return (
      <div className="oc oc-page oc-center">
        {!view && !fatalError ? (
          <span className="oc-loader" aria-label="جاري التحميل" />
        ) : (
          <div className="oc-card oc-stack">
            <Emblem size={56} />
            {fatalError && <p className="oc-error">{errorMessage(fatalError)}</p>}
            <Link href="/games" className="oc-btn oc-btn-primary">
              قائمة الألعاب
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="oc oc-tv">
      <header className="oc-tv-head">
        <Emblem size={38} />
        <h1 className="oc-title">المحطة 07 — مركز التحكم</h1>
        <span className="oc-spacer" />
        {!connected && <span className="oc-offline">الاتصال ضعيف…</span>}
        <button type="button" className="oc-icon-btn" aria-pressed={soundSettings.muted} aria-label={soundSettings.muted ? "تشغيل الصوت" : "كتم الصوت"} onClick={toggleMute}>
          {soundSettings.muted ? "🔇" : "🔊"}
        </button>
      </header>
      {error && (
        <p className="oc-error oc-tv-error" role="alert">
          {error}
        </p>
      )}
      {!g ? (
        <Lobby view={view} run={run} onStart={() => void sound.current?.unlock()} />
      ) : g.outcome ? (
        <Results game={g} run={run} />
      ) : (
        <Dashboard view={view} game={g} receivedAt={receivedAt} run={run} />
      )}
    </div>
  );
}

/** One cue per moment: a fault starts, a fault is fixed, the end. */
function useCues(game: TvGame | null, sound: React.RefObject<InventSound | null>) {
  const last = useRef<{ id: string; done: number; faults: string; outcome: string | null } | null>(null);
  useEffect(() => {
    if (!game) {
      last.current = null;
      return;
    }
    const cur = { id: game.matchId, done: game.progress.done, faults: game.faults.map((f) => f.id).join(","), outcome: game.outcome };
    const prev = last.current;
    last.current = cur;
    if (!prev || prev.id !== cur.id) {
      if (prev) sound.current?.play("start");
      return;
    }
    const s = sound.current;
    if (cur.outcome !== prev.outcome && cur.outcome) s?.play(cur.outcome === "success" ? "winner" : "close");
    else if (cur.done > prev.done) s?.play("points");
    else if (cur.faults !== prev.faults && cur.faults.split(",").some((f) => f && !prev.faults.split(",").includes(f))) s?.play("tick");
  }, [game, sound]);
}

/* ------------------------------------------------------------------ */
/* Lobby                                                               */
/* ------------------------------------------------------------------ */

function Lobby({ view, run, onStart }: { view: OutageHostView; run: Run; onStart: () => void }) {
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    QRCode.toString(`${window.location.origin}/join?code=${view.code}`, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#05080f", light: "#ffffff" },
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
    if (busy || !ready) return;
    setBusy(true);
    onStart();
    await run("start");
    setBusy(false);
  }

  return (
    <main className="oc-lobby">
      <section className="oc-card oc-join">
        <div className="oc-qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label="رمز QR للانضمام" />
        <span className="oc-code" dir="ltr" aria-label={`رمز الغرفة ${view.code}`}>
          {view.code}
        </span>
      </section>

      <section className="oc-card oc-crew-list">
        <p className="oc-count" dir="ltr">
          {n}/{maxPlayers}
        </p>
        <ul className="oc-names">
          {players.map((p) => (
            <li key={p.id} className="oc-name">
              <span>{p.name}</span>
              <button type="button" className="oc-x" aria-label={`إخراج ${p.name}`} onClick={() => void run("release", { playerId: p.id })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="oc-card oc-setup">
        <div className="oc-seg" role="radiogroup" aria-label="الصعوبة">
          {(Object.keys(LEVEL_NAMES) as Difficulty[]).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={view.settings.difficulty === d}
              className={`oc-seg-btn ${view.settings.difficulty === d ? "is-on" : ""}`}
              onClick={() => void run("settings", { difficulty: d })}
            >
              <b>{LEVEL_NAMES[d]}</b>
              <small dir="rtl">
                {view.levels[d].missions} مهام · {view.levels[d].minutes} د
              </small>
            </button>
          ))}
        </div>
        <button type="button" className="oc-btn oc-btn-primary oc-btn-lg" disabled={!ready || busy} onClick={() => void start()}>
          {busy && <span className="oc-loader is-small" />}
          {n < minPlayers ? `بانتظار ${minPlayers - n}` : n > maxPlayers ? `الحد ${maxPlayers}` : "ابدأ المهمة"}
        </button>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

const COOLING_TEXT = { running: "يعمل", stopped: "متوقف", fault: "معطل" } as const;
const SECURITY_TEXT = { stable: "مستقر", lockdown: "إغلاق طارئ", down: "متعطل", breach: "تسريب" } as const;

function Dashboard({ view, game: g, receivedAt, run }: { view: OutageHostView; game: TvGame; receivedAt: number; run: Run }) {
  const now = useServerNow(view.serverNow, receivedAt);
  const left = secondsLeft(g.clock, now);
  const st = g.station;
  const online = g.crew.filter((c) => c.online).length;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const blackouts = g.crew.filter((c) => c.blackout !== null);
  const top = g.faults[0];

  return (
    <main className={`oc-dash ${g.alert?.level === "danger" ? "is-danger" : ""}`}>
      <div className="oc-dash-top">
        <div className={`oc-clock ${left <= 60 ? "is-urgent" : ""}`} role="timer" aria-label={`الوقت المتبقي ${mmss(left)}`}>
          <span dir="ltr">{mmss(left)}</span>
        </div>
        <ol className="oc-progress" aria-label={`المهام ${g.progress.done} من ${g.progress.total}`}>
          {g.missions.map((m) => (
            <li key={m.id} className={`is-${m.status}`} title={m.title} />
          ))}
        </ol>
        <span className="oc-crew-count" aria-label="المهندسون المتصلون">
          👷 <b dir="ltr">{online}/{g.crew.length}</b>
        </span>
      </div>

      {g.alert && (
        <p className={`oc-alert is-${g.alert.level}`} role="status">
          ⚠ {g.alert.text}
        </p>
      )}
      {blackouts.map((c) => (
        <p key={c.id} className="oc-blackout" role="status">
          📵 انقطاع الاتصال مع {c.name} — <span dir="ltr">{c.blackout}ث</span>
        </p>
      ))}
      {(g.paused || g.held) && <p className="oc-alert is-warn">{g.paused ? "⏸ متوقفة" : "بانتظار المهندسين"}</p>}

      <section className="oc-gauges">
        <Meter big label="الطاقة" value={String(st.power.pct)} unit="%" level={st.power.level} frac={st.power.pct / 100} />
        <Meter big label="المفاعل" value={String(st.reactor.temp)} unit="°C" level={st.reactor.level} frac={(st.reactor.temp - 40) / 110} />
        <Meter big label="التبريد" value={COOLING_TEXT[st.cooling.state]} level={st.cooling.level} />
        <Meter big label="الأكسجين" value={String(st.o2.pct)} unit="%" level={st.o2.level} frac={st.o2.pct / 100} />
        <Meter big label="الأمان" value={SECURITY_TEXT[st.security.state]} level={st.security.level} />
      </section>

      <section className="oc-faults" aria-label="الأعطال النشطة">
        {g.faults.length === 0 ? (
          <p className="oc-calm">✓ مستقر</p>
        ) : (
          g.faults.map((f) => (
            <article key={f.id} className={`oc-fault ${f === top ? "is-top" : ""} ${f.eta !== null && f.eta < 45 ? "is-danger" : ""}`}>
              <h2>{f.title}</h2>
              <p>{f.goal}</p>
              <span className="oc-fault-eta" dir="ltr">
                {f.eta !== null ? mmss(f.eta) : f.held > 0 ? `✓ ${f.held}/${f.hold}` : "—"}
              </span>
            </article>
          ))
        )}
      </section>

      <footer className="oc-tv-foot">
        <ul className="oc-chips">
          {g.crew.map((c) => (
            <li key={c.id} className={`oc-chip ${c.online ? "" : "is-off"} ${c.blackout !== null ? "is-mute" : ""}`}>
              <span className="oc-dot" aria-hidden />
              {c.name}
              <small>{c.roles.map((r) => r.icon).join(" ")}</small>
            </li>
          ))}
        </ul>
        <div className="oc-host-ctl">
          {g.paused ? (
            <button type="button" className="oc-btn" onClick={() => void run("host", { move: { type: "resume" } })}>
              ▶ استئناف
            </button>
          ) : (
            <button type="button" className="oc-btn" onClick={() => void run("host", { move: { type: "pause" } })}>
              ⏸ إيقاف
            </button>
          )}
          {confirmEnd ? (
            <>
              <button type="button" className="oc-btn oc-btn-danger" onClick={() => void run("host", { move: { type: "end" } })}>
                تأكيد الإنهاء
              </button>
              <button type="button" className="oc-btn" onClick={() => setConfirmEnd(false)}>
                إلغاء
              </button>
            </>
          ) : (
            <button type="button" className="oc-btn" onClick={() => setConfirmEnd(true)}>
              إنهاء
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

function Results({ game: g, run }: { game: TvGame; run: Run }) {
  const router = useRouter();
  const sc = g.score;
  const success = g.outcome === "success";
  const survived = g.clock.total - g.clock.left;
  return (
    <main className="oc-results">
      <section className={`oc-card oc-verdict ${success ? "is-ok" : "is-bad"}`}>
        <h2 className="oc-verdict-title">{success ? "تم إنقاذ المنشأة" : "فشلت المهمة"}</h2>
        {!success && g.reason && <p className="oc-reason">{g.reason}</p>}
        {sc && <span className={`oc-grade is-${sc.grade}`}>{sc.grade}</span>}
        <dl className="oc-stats">
          <div>
            <dt>النقاط</dt>
            <dd dir="ltr">{sc?.score ?? 0}</dd>
          </div>
          <div>
            <dt>المهام</dt>
            <dd dir="ltr">
              {g.progress.done}/{g.progress.total}
            </dd>
          </div>
          <div>
            <dt>{success ? "المتبقي" : "صمدتم"}</dt>
            <dd dir="ltr">{mmss(success ? g.clock.left : survived)}</dd>
          </div>
          <div>
            <dt>الأخطاء</dt>
            <dd dir="ltr">{sc?.errors ?? 0}</dd>
          </div>
        </dl>
      </section>
      <div className="oc-row">
        <button type="button" className="oc-btn oc-btn-primary oc-btn-lg" onClick={() => void run("lobby")}>
          مهمة جديدة
        </button>
        <button
          type="button"
          className="oc-btn oc-btn-lg"
          onClick={async () => {
            if (await run("close")) router.push("/games");
          }}
        >
          الألعاب
        </button>
      </div>
    </main>
  );
}
