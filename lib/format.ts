/** Arabic count of points: نقطة / نقطتين / ٣ نقاط / ١١ نقطة */
export function pointsLabel(n: number): string {
  if (n === 0) return "ولا نقطة";
  if (n === 1) return "نقطة وحدة";
  if (n === 2) return "نقطتين";
  if (n <= 10) return `${n} نقاط`;
  return `${n} نقطة`;
}

/**
 * Font size for a fact on the TV. Short facts are huge; long stories get
 * smaller — but still readable from the couch — sized by both width and height.
 */
export function tvFactFontSize(text: string): string {
  const len = text.length;
  if (len <= 30) return "min(6.4vw, 12vh)";
  if (len <= 70) return "min(5vw, 9.5vh)";
  if (len <= 150) return "min(3.8vw, 6.8vh)";
  if (len <= 350) return "min(2.8vw, 5vh)";
  if (len <= 600) return "min(2.3vw, 4.1vh)";
  return "min(1.95vw, 3.45vh)";
}

/** Tailwind class for a fact on a phone. */
export function phoneFactClass(text: string): string {
  const len = text.length;
  if (len <= 40) return "text-3xl leading-snug font-black";
  if (len <= 120) return "text-2xl leading-snug font-black";
  if (len <= 350) return "text-xl leading-relaxed font-bold";
  return "text-lg leading-relaxed font-bold";
}

export function isLongFact(text: string): boolean {
  return text.length > 150;
}
