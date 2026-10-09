"use client";

import { useEffect, useState } from "react";
import type { RoundTimer } from "@/lib/types";

/**
 * Milliseconds to add to Date.now() to get the server's time, from a view's
 * `serverNow` and the local time it arrived. Response latency makes local
 * timers end a moment late; the server's 2s answer grace covers that.
 */
export function serverOffset(serverNow: string | undefined, receivedAt: number): number {
  const t = serverNow ? Date.parse(serverNow) : NaN;
  return Number.isFinite(t) && receivedAt > 0 ? t - receivedAt : 0;
}

/** Seconds left on a round timer (null = no timer). Ticks 5×/s. */
export function useCountdown(timer: RoundTimer | null, offset: number): number | null {
  const deadline = timer ? Date.parse(timer.deadline) : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.max(0, (deadline - (now + offset)) / 1000);
}
