/** Arabic count of points: نقطة / نقطتين / ٣ نقاط / ١١ نقطة */
export function pointsLabel(n: number): string {
  if (n === 0) return "ولا نقطة";
  if (n === 1) return "نقطة وحدة";
  if (n === 2) return "نقطتين";
  if (n <= 10) return `${n} نقاط`;
  return `${n} نقطة`;
}

/** Arabic count + noun: سؤال / سؤالين / ٣ أسئلة / ١١ سؤال. */
export function countLabel(n: number, forms: { one: string; two: string; few: string; many: string }): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}

export const questionsLabel = (n: number) =>
  n === 0 ? "ولا سؤال" : countLabel(n, { one: "سؤال واحد", two: "سؤالين", few: "أسئلة", many: "سؤال" });

export const peopleLabel = (n: number) =>
  countLabel(n, { one: "شخص واحد", two: "شخصين", few: "أشخاص", many: "شخص" });

export const playersLabel = (n: number) =>
  n === 0 ? "ولا لاعب" : countLabel(n, { one: "لاعب واحد", two: "لاعبين", few: "لاعبين", many: "لاعب" });

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
