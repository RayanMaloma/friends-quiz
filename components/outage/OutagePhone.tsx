"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { api, errorMessage, resultMessage } from "@/lib/client/api";
import type { PlayerCreds } from "@/lib/client/storage";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import { PANEL_ICONS, PANEL_NAMES, type PanelId } from "@/lib/outage/roles";
import type { Command } from "@/lib/outage/sim";
import type { OutageGuestView, PhoneGame } from "@/lib/outage/views";
import { Emblem, mmss, secondsLeft, Toast, useLivePoll, useServerNow } from "./parts";
import { Panel } from "./panels";

export type Send = (command: Command) => Promise<boolean>;

/** A player's phone: only the panels they hold right now. */
export function OutagePhone({ creds }: { creds: PlayerCreds }) {
  const { sessionId, playerToken } = creds;
  const fetchView = useCallback(
    () => api<{ view: OutageGuestView }>("/api/outage", { action: "state", as: "guest", sessionId, playerToken }),
    [sessionId, playerToken],
  );
  const { view, receivedAt, fatalError, connected, mutate, refresh } = useGameSync<OutageGuestView>(sessionId, fetchView);
  const g = view?.game ?? null;
  useLivePoll(!!g && !g.outcome, refresh, 1500);
  useWakeLock();
  const [toast, setToast] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  const send = useCallback<Send>(
    async (command) => {
      const res = await mutate(() => api<{ view: OutageGuestView }>("/api/outage", { action: "act", as: "guest", sessionId, playerToken, command }));
      if (!res.ok) {
        setToast(resultMessage(res));
        refresh();
      }
      return res.ok;
    },
    [mutate, refresh, sessionId, playerToken],
  );

  if (fatalError || !view) {
    return (
      <div className="oc oc-page oc-center">
        {!fatalError ? (
          <span className="oc-loader" aria-label="جاري التحميل" />
        ) : (
          <div className="oc-card oc-stack">
            <p className="oc-error">{errorMessage(fatalError)}</p>
            <Link href="/join" className="oc-btn oc-btn-primary">
              انضم لغرفة
            </Link>
          </div>
        )}
      </div>
    );
  }

  if (view.status === "FINISHED") {
    return (
      <div className="oc oc-page oc-center">
        <div className="oc-card oc-stack">
          <Emblem size={48} />
          <p>انتهت الجلسة</p>
        </div>
      </div>
    );
  }

  return (
    <div className="oc oc-phone">
      {!connected && <p className="oc-offline oc-phone-offline">الاتصال ضعيف…</p>}
      {!g ? (
        <div className="oc-center oc-grow">
          <div className="oc-card oc-stack">
            <Emblem size={56} />
            <p className="oc-me">{view.me.name}</p>
            <p className="oc-muted">بانتظار بدء المهمة</p>
          </div>
        </div>
      ) : !view.seated ? (
        <div className="oc-center oc-grow">
          <div className="oc-card oc-stack">
            <p className="oc-muted">المهمة بدأت بدونك</p>
          </div>
        </div>
      ) : g.outcome ? (
        <PhoneResults game={g} />
      ) : (
        <Console view={view} game={g} receivedAt={receivedAt} send={send} />
      )}
      <Toast text={toast} onDone={clearToast} />
    </div>
  );
}

function Console({ view, game: g, receivedAt, send }: { view: OutageGuestView; game: PhoneGame; receivedAt: number; send: Send }) {
  const now = useServerNow(view.serverNow, receivedAt, 500);
  const left = secondsLeft(g.clock, now);
  const [picked, setPicked] = useState<PanelId | null>(null);
  const tab = picked && g.panels.includes(picked) ? picked : g.panels[0];

  return (
    <>
      <header className="oc-phone-head">
        <span className={`oc-clock is-small ${left <= 60 ? "is-urgent" : ""}`} dir="ltr">
          {mmss(left)}
        </span>
        <span className="oc-roles">{g.specialty.map((r) => `${r.icon} ${r.name}`).join(" · ")}</span>
        <span className="oc-progress-mini" dir="ltr">
          {g.progress.done}/{g.progress.total}
        </span>
      </header>

      {g.blackout !== null && (
        <p className="oc-blackout is-me" role="alert">
          📵 انقطاع الاتصال — لا تتكلم <span dir="ltr">{g.blackout}ث</span>
        </p>
      )}
      {(g.paused || g.held) && <p className="oc-alert is-warn">{g.paused ? "⏸ متوقفة" : "بانتظار المهندسين"}</p>}

      {g.faults.length > 0 && (
        <ul className="oc-fault-chips" aria-label="الأعطال">
          {g.faults.map((f) => (
            <li key={f.id} className={f.eta !== null && f.eta < 45 ? "is-danger" : ""}>
              {f.title}
              {f.eta !== null && <span dir="ltr"> {mmss(f.eta)}</span>}
            </li>
          ))}
        </ul>
      )}

      {g.panels.length > 1 && (
        <nav className="oc-tabs" role="tablist">
          {g.panels.map((p) => (
            <button key={p} type="button" role="tab" aria-selected={p === tab} className={`oc-tab ${p === tab ? "is-on" : ""}`} onClick={() => setPicked(p)}>
              <span aria-hidden>{PANEL_ICONS[p]}</span>
              {PANEL_NAMES[p]}
            </button>
          ))}
        </nav>
      )}

      <main className="oc-panel-wrap">{tab ? <Panel id={tab} data={g.data} send={send} /> : <p className="oc-muted">بانتظار إعادة التوزيع</p>}</main>
    </>
  );
}

function PhoneResults({ game: g }: { game: PhoneGame }) {
  const success = g.outcome === "success";
  return (
    <div className="oc-center oc-grow">
      <div className={`oc-card oc-stack oc-verdict ${success ? "is-ok" : "is-bad"}`}>
        <h2 className="oc-verdict-title">{success ? "تم إنقاذ المنشأة" : "فشلت المهمة"}</h2>
        {!success && g.reason && <p className="oc-reason">{g.reason}</p>}
        {g.score && <span className={`oc-grade is-${g.score.grade}`}>{g.score.grade}</span>}
        <p className="oc-muted" dir="ltr">
          {g.score?.score ?? 0}
        </p>
      </div>
    </div>
  );
}
