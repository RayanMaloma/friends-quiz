"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { FATAL_ERRORS, type ApiResult } from "@/lib/client/api";
import { getBrowserSupabase, isRealtimeConfigured } from "@/lib/client/supabase";
import { gameChannelName, SYNC_EVENT } from "@/lib/realtime-config";

type ViewResult<V> = ApiResult<{ view: V }>;

/**
 * Keeps a role-specific view of the game in sync with the server.
 *
 * - The server (DB) is the source of truth. Realtime broadcasts are just
 *   "something changed" pings that trigger a refetch.
 * - All requests from this device run through one serial queue, so responses
 *   apply in order and a slow old response can never overwrite a newer one.
 * - Also resyncs on (re)subscribe, tab focus/visibility, network "online",
 *   and a slow safety poll (fast poll if Realtime is unavailable).
 */
export function useGameSync<V>(
  sessionId: string | null,
  fetchView: () => Promise<ViewResult<V>>,
) {
  const [view, setView] = useState<V | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [realtimeUp, setRealtimeUp] = useState(false);

  const fetchRef = useRef(fetchView);
  useEffect(() => {
    fetchRef.current = fetchView;
  });

  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const refreshQueued = useRef(false);

  const apply = useCallback((res: ViewResult<V>) => {
    if (res.ok) {
      setView(res.view);
      setConnected(true);
      setFatalError(null);
    } else if (FATAL_ERRORS.has(res.error)) {
      setFatalError(res.error);
    } else if (res.error === "NETWORK" || res.status >= 500) {
      setConnected(false);
    }
  }, []);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = chain.current.then(task, task);
    chain.current = run.catch(() => undefined);
    return run;
  }, []);

  const refresh = useCallback(() => {
    if (refreshQueued.current) return;
    refreshQueued.current = true;
    void enqueue(async () => {
      refreshQueued.current = false;
      apply(await fetchRef.current());
    });
  }, [enqueue, apply]);

  /** Run a mutation in the same queue; applies the returned view if any. */
  const mutate = useCallback(
    <T extends ViewResult<V> | ApiResult<Record<string, unknown>>>(task: () => Promise<T>) =>
      enqueue(async () => {
        const res = await task();
        if (res.ok && "view" in res) apply(res as ViewResult<V>);
        else if (!res.ok) apply(res as ViewResult<V>);
        return res;
      }),
    [enqueue, apply],
  );

  // Initial load + realtime subscription.
  useEffect(() => {
    if (!sessionId) return;
    refresh();
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let channel: RealtimeChannel | null = supabase
      .channel(gameChannelName(sessionId))
      .on("broadcast", { event: SYNC_EVENT }, () => refresh())
      .subscribe((status) => {
        const up = status === "SUBSCRIBED";
        setRealtimeUp(up);
        // (Re)subscribed after a drop/sleep: we may have missed pings.
        if (up) refresh();
      });
    return () => {
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  }, [sessionId, refresh]);

  // Resync when the device wakes up / comes back online.
  useEffect(() => {
    if (!sessionId) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sessionId, refresh]);

  // Safety-net poll. Realtime is the primary mechanism when configured.
  // Kept modest even with Realtime up, so a missed ping costs seconds, not minutes.
  const pollMs = !isRealtimeConfigured ? 1500 : realtimeUp && connected ? 5000 : 2000;
  useEffect(() => {
    if (!sessionId || fatalError) return;
    // Not gated on visibility: browsers already throttle hidden tabs, and a
    // TV/laptop page that reports "hidden" must still keep up.
    const timer = setInterval(refresh, pollMs);
    return () => clearInterval(timer);
  }, [sessionId, refresh, pollMs, fatalError]);

  return { view, fatalError, connected, realtimeUp, refresh, mutate };
}
