import { PEOPLE } from "@/lib/people";

/** Party palette: background + readable text color. */
export const SWATCHES = [
  { bg: "bg-sun", fg: "text-ink" },
  { bg: "bg-pink", fg: "text-white" },
  { bg: "bg-sky", fg: "text-white" },
  { bg: "bg-mint", fg: "text-ink" },
  { bg: "bg-grape", fg: "text-white" },
  { bg: "bg-orange", fg: "text-ink" },
] as const;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable color per player (by id). */
export function playerSwatch(playerId: string) {
  return SWATCHES[hash(playerId) % SWATCHES.length];
}

/** Stable color per answer option (people.json order). */
export function personSwatch(personId: string) {
  const i = PEOPLE.findIndex((p) => p.id === personId);
  return SWATCHES[(i < 0 ? hash(personId) : i) % SWATCHES.length];
}

/** First visible character of a name, for badges. */
export function initial(name: string): string {
  return [...name.trim()][0] ?? "؟";
}
