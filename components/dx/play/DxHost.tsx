"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import type { GameConfig } from "@/lib/dx/types/config";
import type { Action, MatchState } from "@/lib/dx/types/match";
import type { DxHostView } from "@/lib/dx/views";
import { api, errorMessage, resultMessage } from "@/lib/client/api";
import type { HostCreds } from "@/lib/client/storage";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import { DxRoot, PlayProvider } from "@/components/dx/store";
import { Button, ConfirmProvider, IconButton, Modal, useConfirm } from "@/components/dx/components/ui";
import { Icon } from "@/components/dx/components/Icon";
import { BoardView } from "@/components/dx/components/BoardView";
import { HostPanel, LogPanel, ResultsBody, RuleNotes, Seats } from "@/components/dx/game/GameParts";
import { phaseLabel, TvPhase } from "@/components/dx/game/TvPhase";
import { RulesBody } from "@/components/dx/game/Rules";
import { playerName } from "@/lib/dx/engine/helpers";
import { useDxConfig } from "./useDxConfig";

export function DxHost({ creds }: { creds: HostCreds }) {
  useWakeLock();
  const { sessionId, hostToken } = creds;
  const fetchView = useCallback(
    () => api<{ view: DxHostView }>("/api/dx", { action: "state", as: "host", sessionId, hostToken }),
    [sessionId, hostToken],
  );
  const { view, fatalError, connected, mutate } = useGameSync<DxHostView>(sessionId, fetchView);
  const design = useDxConfig({ as: "host", sessionId, hostToken });

  const dispatch = useCallback(
    async (move: Action) => {
      const res = await mutate(() => api<{ view: DxHostView }>("/api/dx", { action: "act", as: "host", sessionId, hostToken, move }));
      return res.ok ? null : resultMessage(res);
    },
    [mutate, sessionId, hostToken],
  );

  if (fatalError) return <Plain>{errorMessage(fatalError)}</Plain>;
  if (!view || !design) return <Plain>…</Plain>;

  return (
    <PlayProvider config={design.game} assets={design.assets} dispatch={dispatch}>
      <DxRoot className="dx-tv">
        <ConfirmProvider>
          {!connected && <div className="conn-banner">في مشكلة بالاتصال… نحاول نرجع</div>}
          {view.status === "LOBBY" || !view.match ? (
            <Lobby view={view} game={design.game} creds={creds} mutate={mutate} />
          ) : (
            <Table view={view} game={design.game} />
          )}
        </ConfirmProvider>
      </DxRoot>
    </PlayProvider>
  );
}

function Plain({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh items-center justify-center p-8 text-center font-display text-3xl">{children}</main>;
}

/* ------------------------------------------------------------------ */
/* LOBBY                                                               */
/* ------------------------------------------------------------------ */

function Lobby({ view, game, creds, mutate }: {
  view: DxHostView;
  game: GameConfig;
  creds: HostCreds;
  mutate: ReturnType<typeof useGameSync<DxHostView>>["mutate"];
}) {
  const confirm = useConfirm();
  const [qr, setQr] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toString(`${window.location.origin}/join?code=${view.code}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
      .then((svg) => { if (alive) setQr(svg); })
      .catch(() => {});
    return () => { alive = false; };
  }, [view.code]);

  // Seat order: keep the host's arrangement, append newcomers, drop leavers.
  const ids = view.players.map((p) => p.id);
  const seated = [...order.filter((id) => ids.includes(id)), ...ids.filter((id) => !order.includes(id))];
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const move = (i: number, d: number) => {
    const next = seated.slice();
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  const shuffle = () => setOrder([...seated].sort(() => Math.random() - 0.5));

  async function start() {
    setBusy(true);
    setError(null);
    const res = await mutate(() => api<{ view: DxHostView }>("/api/dx", { action: "start", as: "host", sessionId: creds.sessionId, hostToken: creds.hostToken, order: seated }));
    if (!res.ok) setError(resultMessage(res));
    setBusy(false);
  }

  async function release(playerId: string, name: string) {
    if (!(await confirm({ title: `إخراج ${name}؟`, message: "يطلع من الغرفة ويقدر يدخل من جديد.", confirmLabel: "إخراج", danger: true }))) return;
    await mutate(() => api("/api/dx", { action: "release", as: "host", sessionId: creds.sessionId, hostToken: creds.hostToken, playerId }));
  }

  const n = view.players.length;
  return (
    <div className="dx-lobby">
      <header className="dx-lobby-head">
        <h1>{game.identity.name}</h1>
        {game.identity.subtitle && <p className="muted">{game.identity.subtitle}</p>}
      </header>
      <div className="dx-lobby-grid">
        <section className="dx-lobby-join dpanel">
          <p className="eyebrow">ادخلوا من جوالاتكم</p>
          <div className="dx-code" dir="ltr">{view.code}</div>
          <div className="dx-qr" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="small muted">امسح الرمز أو افتح «دخول لعبة» واكتب الرمز.</p>
        </section>
        <section className="dx-lobby-players dpanel">
          <header className="dpanel-head">
            <h3><Icon name="users" size={18} /> اللاعبين <span className="num">{n}</span> <span className="muted small">(من {view.minPlayers} إلى {view.maxPlayers})</span></h3>
            <Button size="sm" variant="ghost" icon="refresh" onClick={shuffle} disabled={n < 2}>ترتيب عشوائي</Button>
          </header>
          <p className="small muted">رتّبهم حسب جلستكم حول الطاولة — هذا ترتيب الأدوار.</p>
          {n === 0 ? (
            <p className="muted center dx-lobby-empty">ما دخل أحد للحين…</p>
          ) : (
            <ol className="dx-seat-list">
              {seated.map((id, i) => {
                const p = byId.get(id)!;
                return (
                  <li key={id}>
                    <span className="num seat-no">{i + 1}</span>
                    <span className="grow strong">{p.name}</span>
                    <IconButton icon="up" label="قدّم" onClick={() => move(i, -1)} disabled={i === 0} />
                    <IconButton icon="down" label="أخّر" onClick={() => move(i, 1)} disabled={i === seated.length - 1} />
                    <IconButton icon="x" label={`إخراج ${p.name}`} onClick={() => release(id, p.name)} />
                  </li>
                );
              })}
            </ol>
          )}
          {view.startIssues.length > 0 && n > 0 && <p className="small bad">{view.startIssues[0]}</p>}
          {error && <p className="small bad">{error}</p>}
          <Button variant="primary" size="lg" icon="play" disabled={busy || view.startIssues.length > 0} onClick={start}>
            وزّع الأدوار وابدأ
          </Button>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* GAME TABLE (the TV during play)                                     */
/* ------------------------------------------------------------------ */

function Table({ view, game }: { view: DxHostView; game: GameConfig }) {
  const [host, setHost] = useState(false);
  const [rules, setRules] = useState(false);
  const s = useMemo<MatchState>(() => ({ ...view.match!, config: game }), [view.match, game]);
  const m = game.mechanics;
  const board = game.boards.find((b) => b.id === game.activeBoardId) ?? game.boards[0];
  const offline = view.players.filter((p) => !p.active).map((p) => p.id);
  const hints = { eligibleNomineeIds: view.eligibleNomineeIds, powerTargetIds: view.powerTargetIds, waitingForIds: view.waitingForIds };

  if (s.phase === "gameOver") {
    return (
      <div className="page">
        <ResultsBody s={s} />
        <div className="results-actions">
          <Link className="dbtn dbtn-primary dbtn-lg" href="/host"><span>لعبة جديدة</span></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="game">
      <header className="game-bar">
        <div className="game-bar-title">
          <div className="col">
            <strong className="game-name">{game.identity.name}</strong>
            <span className="small muted">الجولة <span className="num">{s.round}</span> · {phaseLabel(s)}</span>
          </div>
        </div>
        <div className="row gap-xs">
          <span className="small muted">الرمز <span className="num" dir="ltr">{view.code}</span></span>
          <Button size="sm" variant="ghost" icon="book" onClick={() => setRules(true)}>القوانين</Button>
          <Button size="sm" icon="gavel" onClick={() => setHost(true)}>تحكم المضيف</Button>
        </div>
      </header>

      <div className="game-status" aria-live="polite">
        <span className="status-pill leader"><Icon name="crown" size={15} /> {m.leaderTitle}: <strong>{playerName(s, s.leaderId)}</strong>{s.inSpecialRound && <em className="small"> (انتخاب خاص)</em>}</span>
        {s.nomineeId && <span className="status-pill nominee"><Icon name="gavel" size={15} /> {m.nomineeTitle}: <strong>{playerName(s, s.nomineeId)}</strong></span>}
        <span className="status-pill"><Icon name="users" size={15} /> <span className="num">{s.players.filter((p) => p.alive).length}</span> باقين</span>
      </div>

      <div className="game-grid">
        <main className="game-main">
          <BoardView config={game} board={board} state={{
            tracks: s.tracks, electionTracker: s.electionTracker, drawPile: s.drawPile.length, discardPile: s.discardPile.length, playerCount: s.players.length,
          }} />
          <div className="phase-area">
            <TvPhase s={s} hints={hints} />
          </div>
        </main>
        <aside className="game-side">
          <Seats s={s} eligibleIds={view.eligibleNomineeIds} waitingIds={view.waitingForIds} offlineIds={offline} />
          <RuleNotes s={s} canDismiss />
          <LogPanel s={s} />
        </aside>
      </div>

      <HostPanel s={s} open={host} onClose={() => setHost(false)} />
      <Modal open={rules} onClose={() => setRules(false)} title={`${game.identity.name} — القوانين`} wide>
        <RulesBody config={game} />
      </Modal>
    </div>
  );
}

