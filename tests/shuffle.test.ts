import { describe, expect, it } from "vitest";
import { balancedShuffle, countAdjacentRepeats } from "@/lib/game/shuffle";
import facts from "@/data/facts.json";

type F = { id: string; personId: string };
const byPerson = (f: F) => f.personId;

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe("balancedShuffle", () => {
  it("keeps every fact exactly once", () => {
    const out = balancedShuffle(facts as F[], byPerson);
    expect(out).toHaveLength(facts.length);
    expect(new Set(out.map((f) => f.id)).size).toBe(facts.length);
  });

  it("never puts the same person back-to-back on the real dataset", () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const out = balancedShuffle(facts as F[], byPerson, seeded(seed));
      expect(countAdjacentRepeats(out, byPerson)).toBe(0);
    }
  });

  it("produces different orders across games", () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) {
      orders.add(balancedShuffle(facts as F[], byPerson, seeded(seed)).map((f) => f.id).join(","));
    }
    expect(orders.size).toBeGreaterThan(40);
  });

  it("handles the tight case (max group = ceil(n/2))", () => {
    const items = [..."AAAABBC"].map((g, i) => ({ id: String(i), personId: g }));
    for (let seed = 1; seed <= 500; seed++) {
      const out = balancedShuffle(items, byPerson, seeded(seed));
      expect(countAdjacentRepeats(out, byPerson)).toBe(0);
    }
  });

  it("minimizes repeats when perfection is impossible", () => {
    const items = [..."AAAAAB"].map((g, i) => ({ id: String(i), personId: g }));
    const out = balancedShuffle(items, byPerson, seeded(7));
    expect(out).toHaveLength(6);
    // Best possible is A B A A A A -> 3 repeats; greedy must not do worse than 4.
    expect(countAdjacentRepeats(out, byPerson)).toBeLessThanOrEqual(4);
  });
});
