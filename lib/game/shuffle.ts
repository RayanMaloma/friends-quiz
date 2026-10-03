/**
 * Balanced shuffle: random order where items with the same group key are never
 * adjacent whenever such an order exists.
 *
 * Greedy with a feasibility check: at each step we only pick a group if the
 * remaining items can still be arranged without adjacent repeats. For a multiset
 * of n items whose first item must differ from `last`, that is possible iff every
 * group g satisfies count(g) <= ceil(n/2), and count(last) <= floor(n/2).
 * Among feasible groups we pick randomly, weighted by remaining count, so big
 * groups get spread out instead of piling up at the end.
 */
export function balancedShuffle<T>(
  items: readonly T[],
  groupOf: (item: T) => string,
  random: () => number = Math.random,
): T[] {
  const queues = new Map<string, T[]>();
  for (const item of items) {
    const key = groupOf(item);
    const q = queues.get(key) ?? [];
    q.push(item);
    queues.set(key, q);
  }
  // Randomize order inside each group.
  for (const q of queues.values()) shuffleInPlace(q, random);

  const result: T[] = [];
  let last: string | null = null;
  let remaining = items.length;

  while (remaining > 0) {
    const nonEmpty = [...queues.entries()].filter(([, q]) => q.length > 0);
    const feasible = nonEmpty.filter(
      ([key]) => key !== last && isFeasibleAfterPick(queues, key, remaining),
    );

    let pool = feasible;
    if (pool.length === 0) {
      // No perfect arrangement exists (e.g. one person owns most facts):
      // prefer anything that isn't a repeat, else take the biggest group.
      pool = nonEmpty.filter(([key]) => key !== last);
      if (pool.length === 0) pool = nonEmpty;
    }

    const key = weightedPick(pool, random);
    const item = queues.get(key)!.pop()!;
    result.push(item);
    last = key;
    remaining -= 1;
  }
  return result;
}

function isFeasibleAfterPick(queues: Map<string, unknown[]>, picked: string, remaining: number) {
  const n = remaining - 1;
  if (n === 0) return true;
  for (const [key, q] of queues) {
    const count = key === picked ? q.length - 1 : q.length;
    const limit = key === picked ? Math.floor(n / 2) : Math.ceil(n / 2);
    if (count > limit) return false;
  }
  return true;
}

function weightedPick(pool: [string, unknown[]][], random: () => number): string {
  const total = pool.reduce((sum, [, q]) => sum + q.length, 0);
  let r = random() * total;
  for (const [key, q] of pool) {
    r -= q.length;
    if (r < 0) return key;
  }
  return pool[pool.length - 1][0];
}

function shuffleInPlace<T>(arr: T[], random: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Number of adjacent pairs with the same group (0 = perfectly balanced). */
export function countAdjacentRepeats<T>(items: readonly T[], groupOf: (item: T) => string): number {
  let repeats = 0;
  for (let i = 1; i < items.length; i++) {
    if (groupOf(items[i]) === groupOf(items[i - 1])) repeats++;
  }
  return repeats;
}
