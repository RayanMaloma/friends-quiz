"use client";

import { useEffect, useState } from "react";
import { serverOffset } from "@/lib/client/useClock";
import type { Clock, Level3 } from "@/lib/outage/views";

/** Server time, ticking locally (aligned with the view's `serverNow`). */
export function useServerNow(serverNow: string | undefined, receivedAt: number, ms = 250): number {
  const offset = serverOffset(serverNow, receivedAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now + offset;
}

/** Seconds left on the mission clock: the server's deadline, frozen when paused. */
export function secondsLeft(clock: Clock, now: number): number {
  if (clock.endsAt === null) return clock.left;
  return Math.max(0, Math.ceil((clock.endsAt - now) / 1000));
}

export const mmss = (secs: number) => {
  const s = Math.max(0, Math.round(secs));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Polls the server while the station runs (its values change every second). */
export function useLivePoll(active: boolean, refresh: () => void, ms: number) {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(refresh, ms);
    return () => clearInterval(id);
  }, [active, refresh, ms]);
}

/** The station's emblem: a ring, a dish and a broken signal. */
export function Emblem({ size = 40 }: { size?: number }) {
  return (
    <svg className="oc-emblem" width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M15 31a12 12 0 0 1 0-14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M33 17a12 12 0 0 1 0 14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="4 4" />
      <circle cx="24" cy="24" r="4" fill="currentColor" />
    </svg>
  );
}

export function Meter({ label, value, unit, level, frac, big = false }: { label: string; value: string; unit?: string; level: Level3; frac?: number; big?: boolean }) {
  return (
    <div className={`oc-meter is-${level} ${big ? "is-big" : ""}`}>
      <span className="oc-meter-label">{label}</span>
      <span className="oc-meter-value" dir="ltr">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {frac !== undefined && (
        <span className="oc-bar" aria-hidden>
          <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, frac))})` }} />
        </span>
      )}
    </div>
  );
}

/** A short-lived message at the bottom of the phone (refusal reasons). */
export function Toast({ text, onDone }: { text: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!text) return;
    const id = setTimeout(onDone, 3200);
    return () => clearTimeout(id);
  }, [text, onDone]);
  if (!text) return null;
  return (
    <p className="oc-toast" role="alert">
      {text}
    </p>
  );
}

export const LEVEL_NAMES = { easy: "سهل", medium: "متوسط", hard: "صعب" } as const;
