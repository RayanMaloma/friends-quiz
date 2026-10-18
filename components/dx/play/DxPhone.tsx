"use client";

import React, { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Action, MatchState } from "@/lib/dx/types/match";
import type { DxGuestView } from "@/lib/dx/views";
import { api, errorMessage, resultMessage } from "@/lib/client/api";
import { playerStore, type PlayerCreds } from "@/lib/client/storage";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import { DxRoot, PlayProvider } from "@/components/dx/store";
import { Button, ConfirmProvider } from "@/components/dx/components/ui";
import { Icon } from "@/components/dx/components/Icon";
import { PhoneGame } from "@/components/dx/game/PhoneGame";
import { phaseLabel } from "@/components/dx/game/TvPhase";
import { useDxConfig } from "./useDxConfig";

export function DxPhone({ creds }: { creds: PlayerCreds }) {
  useWakeLock();
  const router = useRouter();
  const { sessionId, playerToken } = creds;
  const fetchView = useCallback(
    () => api<{ view: DxGuestView }>("/api/dx", { action: "state", as: "guest", sessionId, playerToken }),
    [sessionId, playerToken],
  );
  const { view, fatalError, connected, mutate } = useGameSync<DxGuestView>(sessionId, fetchView);
  const design = useDxConfig({ as: "guest", sessionId, playerToken });

  const dispatch = useCallback(
    async (move: Action) => {
      const res = await mutate(() => api<{ view: DxGuestView }>("/api/dx", { action: "act", as: "guest", sessionId, playerToken, move }));
      return res.ok ? null : resultMessage(res);
    },
    [mutate, sessionId, playerToken],
  );

  const match = view?.match;
  const s = useMemo<MatchState | null>(
    () => (match && design ? { ...match, config: design.game } : null),
    [match, design],
  );

  if (fatalError) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="font-display text-3xl">{errorMessage(fatalError)}</p>
        <Link href="/join" onClick={() => playerStore.clear(sessionId)} className="btn btn-primary h-14 px-6 text-xl">ادخل من جديد</Link>
      </main>
    );
  }
  if (!view || !design) {
    return <main className="flex min-h-dvh items-center justify-center font-display text-3xl">…</main>;
  }

  return (
    <PlayProvider config={design.game} assets={design.assets} dispatch={dispatch}>
      <ConfirmProvider>
        <DxRoot className="dx-phone">
          {!connected && <div className="conn-banner">في مشكلة بالاتصال… نحاول نرجع</div>}
          <header className="phone-head">
            <span className="strong">{view.me.name}</span>
            <span className="small muted">{s ? `الجولة ${s.round} · ${phaseLabel(s)}` : <>رمز <span dir="ltr">{view.code}</span></>}</span>
          </header>

          {view.status === "LOBBY" || !s ? (
            <div className="phone-wait">
              <Icon name="check" size={34} />
              <h2>دخلت ✓</h2>
              <p className="muted">بانتظار المضيف يبدأ «{design.game.identity.name}»</p>
              <Button size="sm" variant="ghost" onClick={async () => {
                const res = await mutate(() => api("/api/guest", { action: "leave", sessionId, playerToken }));
                if (res.ok) {
                  playerStore.clear(sessionId);
                  router.replace(`/join?code=${view.code}`);
                }
              }}>مو أنا؟ اطلع</Button>
            </div>
          ) : !view.seated ? (
            <div className="phone-wait">
              <h2>اللعبة بدأت بدونك</h2>
              <p className="muted">تابع من الشاشة، وادخل الجولة الجاية.</p>
            </div>
          ) : (
            <PhoneGame s={s} meId={view.me.playerId} known={view.known} />
          )}
        </DxRoot>
      </ConfirmProvider>
    </PlayProvider>
  );
}
