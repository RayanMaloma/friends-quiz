import { SECONDS } from "@/lib/mafia/rules";

/** Choreography inside the dawn and verdict phases (ms after the phase starts). */
export const DAWN_REVEAL_MS = 5600;
export const VERDICT_REVEAL_MS = 3800;
/** The role of a player who is out appears this long after their name. */
export const ROLE_REVEAL_DELAY_MS = 1800;

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
