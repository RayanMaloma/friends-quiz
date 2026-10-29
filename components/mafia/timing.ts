import { SECONDS } from "@/lib/mafia/rules";

/** Choreography inside the dawn and verdict phases (ms after the phase starts): set by the server's public reveal. */
export { DAWN_REVEAL_MS, VERDICT_REVEAL_MS } from "@/lib/mafia/rules";

/**
 * The 10-second opening sequence (the server's `intro` phase), in ms from its start:
 * darkness and the title → crimson suspense and the narrator → 3, 2, 1.
 */
export const INTRO = {
  suspenseAt: 3000,
  narrateAt: 3300,
  countAt: 7000,
  end: SECONDS.intro * 1000,
} as const;

const ARABIC_DIGITS = ["٠", "١", "٢", "٣"];

/** The countdown digit showing at `t` ms into the intro (٣ ٢ ١), or null before it starts. */
export function introDigit(t: number): string | null {
  if (t < INTRO.countAt || t >= INTRO.end) return null;
  return ARABIC_DIGITS[3 - Math.floor((t - INTRO.countAt) / 1000)];
}
