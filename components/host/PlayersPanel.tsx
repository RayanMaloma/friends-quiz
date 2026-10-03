"use client";

import { useState } from "react";
import type { HostView } from "@/lib/types";
import { PEOPLE } from "@/lib/people";
import { Avatar } from "@/components/PersonImage";

/**
 * Host-only escape hatch: if a phone died or someone picked the wrong name,
 * free the identity so another device can pick it. Answers/score are kept.
 */
export function PlayersPanel({
  view,
  onClose,
  onRelease,
}: {
  view: HostView;
  onClose: () => void;
  onRelease: (personId: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const byId = new Map(view.players.map((p) => [p.personId, p]));

  return (
    <div className="anim-fade fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-3xl border border-line bg-panel p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-black">اللاعبين</h2>
          <button onClick={onClose} className="btn btn-ghost h-10 rounded-full px-4">
            إغلاق
          </button>
        </div>
        <p className="mb-4 text-sm text-mute">
          «فك الربط» يخلي جهاز ثاني يقدر يختار نفس الاسم (لو الجوال طفى أو أحد اختار غلط). النقاط ما تنمسح.
        </p>
        <ul className="flex flex-col gap-2">
          {PEOPLE.map((p) => {
            const player = byId.get(p.id);
            const status = !player ? "ما دخل" : player.active ? "داخل" : "بانتظار جهاز";
            return (
              <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-panel-2 px-3 py-2">
                <Avatar personId={p.id} className="size-11" />
                <span className="flex-1 text-lg font-bold">{p.name}</span>
                <span className={`text-sm font-bold ${player?.active ? "text-mint" : "text-mute"}`}>{status}</span>
                {player?.active && (
                  <button
                    disabled={pending === p.id}
                    onClick={async () => {
                      if (!window.confirm(`متأكد؟ بيقدر جهاز ثاني يدخل باسم ${p.name}`)) return;
                      setPending(p.id);
                      await onRelease(p.id);
                      setPending(null);
                    }}
                    className="btn h-9 rounded-xl bg-rose/15 px-3 text-sm text-rose"
                  >
                    فك الربط
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
