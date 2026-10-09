"use client";

import { useState } from "react";
import type { HostView } from "@/lib/types";
import { NameBadge } from "@/components/ui";

/**
 * Host-only escape hatch: if a phone died or someone needs to switch device,
 * free the player so a new device can rejoin with the same name. Score is kept.
 */
export function PlayersPanel({
  view,
  onClose,
  onRelease,
}: {
  view: HostView;
  onClose: () => void;
  onRelease: (playerId: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const inLobby = view.status === "LOBBY";
  const personName = (id: string) => view.config.people.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="anim-fade fixed inset-0 z-40 flex items-center justify-center bg-ink/50 p-6" onClick={onClose}>
      <div
        className="chunk flex max-h-[85vh] w-full max-w-xl flex-col bg-cream p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-3xl">اللاعبين ({view.players.length})</h2>
          <button onClick={onClose} className="btn btn-ghost h-11 px-4 text-lg">
            إغلاق
          </button>
        </div>
        <p className="mb-4 text-sm font-bold text-mute">
          {inLobby
            ? "«إزالة» يطلع اللاعب من اللعبة."
            : "«فك الربط» يخلي اللاعب يدخل من جهاز ثاني بنفس الاسم. النقاط ما تنمسح."}
        </p>
        {view.players.length === 0 && <p className="font-bold text-mute">ما أحد دخل للحين</p>}
        <ul className="no-scrollbar flex flex-col gap-2 overflow-y-auto pb-2">
          {view.players.map((p) => (
            <li key={p.playerId} className="chunk-sm flex items-center gap-3 bg-card px-3 py-2">
              <NameBadge playerId={p.playerId} name={p.name} className="size-10 text-xl" />
              <span className="flex-1 truncate text-lg font-extrabold">
                {p.name}
                {p.personId && <span className="ms-2 text-sm text-mute">({personName(p.personId)})</span>}
              </span>
              <span className={`text-sm font-bold ${p.active ? "text-mint" : "text-mute"}`}>
                {p.active ? "متصل" : "بانتظار جهاز"}
              </span>
              {p.active && (
                <button
                  disabled={pending === p.playerId}
                  onClick={async () => {
                    if (!window.confirm(`متأكد؟ (${p.name})`)) return;
                    setPending(p.playerId);
                    await onRelease(p.playerId);
                    setPending(null);
                  }}
                  className="btn h-9 bg-pink px-3 text-sm text-white"
                >
                  {inLobby ? "إزالة" : "فك الربط"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
