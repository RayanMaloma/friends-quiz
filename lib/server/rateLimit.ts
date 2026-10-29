import "server-only";

/**
 * Fixed-window counters per key (per server instance). Enough to stop
 * password guessing and signup floods from one source; Supabase Auth applies
 * its own project-wide limits on top.
 */
export function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    allowed(key: string): boolean {
      const entry = hits.get(key);
      return !entry || entry.resetAt < Date.now() || entry.count < max;
    },
    record(key: string) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.resetAt < now) hits.set(key, { count: 1, resetAt: now + windowMs });
      else entry.count += 1;
      if (hits.size > 5000) hits.clear();
    },
  };
}
