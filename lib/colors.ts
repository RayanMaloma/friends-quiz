import type { Accent } from "@/lib/types";

/** Party palette: background + readable text color. */
export const SWATCHES = [
  { bg: "bg-sun", fg: "text-ink" },
  { bg: "bg-pink", fg: "text-white" },
  { bg: "bg-sky", fg: "text-white" },
  { bg: "bg-mint", fg: "text-ink" },
  { bg: "bg-grape", fg: "text-white" },
  { bg: "bg-orange", fg: "text-ink" },
] as const;

/** Answer tiles (Kahoot-style): a color and a shape per option position. */
export const OPTION_STYLES = [
  { bg: "bg-pink", fg: "text-white", shape: "▲" },
  { bg: "bg-sky", fg: "text-white", shape: "◆" },
  // Literal yellow: the game accent overrides --color-sun, answer colors must not change.
  { bg: "bg-[#ffc72c]", fg: "text-ink", shape: "●" },
  { bg: "bg-mint", fg: "text-ink", shape: "■" },
  { bg: "bg-grape", fg: "text-white", shape: "★" },
  { bg: "bg-orange", fg: "text-ink", shape: "♥" },
] as const;

export function optionStyle(index: number) {
  return OPTION_STYLES[index % OPTION_STYLES.length];
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable color per player (by id). */
export function playerSwatch(playerId: string) {
  return SWATCHES[hash(playerId) % SWATCHES.length];
}

/** First visible character of a name, for badges. */
export function initial(name: string): string {
  return [...name.trim()][0] ?? "؟";
}

/**
 * Each game picks an accent. It replaces the theme's "sun" color (primary
 * buttons, highlights) on the TV and phones. All accents are light enough for
 * ink text.
 */
export const ACCENT_HEX: Record<Accent, string> = {
  sun: "#ffc72c",
  pink: "#ff94b8",
  sky: "#8fbcff",
  mint: "#62e0a9",
  grape: "#c3a9ff",
  orange: "#ffb072",
};

export const ACCENT_LABEL: Record<Accent, string> = {
  sun: "أصفر",
  pink: "وردي",
  sky: "أزرق",
  mint: "أخضر",
  grape: "بنفسجي",
  orange: "برتقالي",
};

export function accentStyle(accent: Accent | undefined): React.CSSProperties {
  return { "--color-sun": ACCENT_HEX[accent ?? "sun"] ?? ACCENT_HEX.sun } as React.CSSProperties;
}
