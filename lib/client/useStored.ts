"use client";

import { useMemo, useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Reads a JSON value from localStorage without hydration mismatches.
 * Returns `undefined` while rendering on the server / before hydration,
 * `null` if nothing is stored.
 */
export function useStored<T>(key: string | null): T | null | undefined {
  const raw = useSyncExternalStore(
    subscribe,
    () => (key ? safeGet(key) : null),
    () => undefined,
  );
  return useMemo(() => {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }, [raw]);
}
