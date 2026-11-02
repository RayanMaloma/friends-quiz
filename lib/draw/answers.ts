/**
 * Is a typed guess a correct name for the drawn word? Run only on the server.
 *
 * Layers, in order:
 * 1. Normalization: diacritics, tatweel, hamza/alef forms, ى/ي, ة/ه, spaces,
 *    punctuation and a leading «ال» (shared with «اخترع إجابتك»), plus the
 *    letters people swap when typing fast (ظ/ض, ذ/ز, ث/س) and doubled letters
 *    («حصانن» = «حصان»).
 * 2. Accepted answers: the word and its listed synonyms («خيل», «فرس»).
 * 3. Typos: a small edit distance, allowed only on longer answers (none up to
 *    four letters, one from five, two from eight) and never when the guess is
 *    itself another known word («حمار» is not «حصان», «طيار» is not «طيارة»).
 *
 * There is no semantic (AI) layer: related words that are not a name for the
 * thing («إسطبل» for «حصان») are simply not accepted.
 */
import { normalizeAnswer } from "@/lib/invent/engine";

/** Real words close to bank words: a guess that is one of these is never a typo. */
const DISTRACTORS = [
  "حمار", "بغل", "حصار", "حصا", "حسان", "طيار", "سيار", "جمال", "جبال", "حمل", "جميل", "قطار", "قطر", "قطن",
  "كلبه", "اسود", "فيلم", "سمك", "فار", "فارة", "ثعلب", "ذئب", "نمر", "دب", "غزال", "ماعز", "تيس", "ديك", "حمامة",
  "نسر", "غراب", "عصفور", "بطة", "وزة", "بقال", "تمرين", "شايب", "موس", "كيس", "خبر", "خبزة", "مكتب", "قلب",
  "علم", "ساحة", "ساعي", "باص", "بحار", "بحيرة", "نهر", "وادي", "تل", "قصر", "سجن", "شارع", "سوق", "مطعم",
  "شمسي", "قمري", "نجار", "مطرقه", "مكينة", "مفتاحين", "مقصلة", "كراسي", "سرير", "باب", "بوابة", "نافذة", "شباك",
  "دراجه", "حافة", "حارة", "ارنبة", "جرس", "جرة", "كاسة", "كوب", "صحن", "ملعقة", "شوكة", "سكين", "قدر", "ابريق",
  "اسطبل", "مزرعة", "حديقة", "زهرة", "وردة", "ورقة", "قلعه", "قلع", "شبح", "شبك", "شبكة", "روح", "جني",
] as const;

/** Normalized, with fast-typing swaps folded and doubled letters collapsed. */
export function squash(raw: string): string {
  return normalizeAnswer(raw)
    .replace(/ظ/g, "ض")
    .replace(/ذ/g, "ز")
    .replace(/ث/g, "س")
    .replace(/(.)\1+/gu, "$1");
}

/** Optimal-string-alignment distance (insert, delete, substitute, swap neighbours), stopping past `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  const s = [...a];
  const t = [...b];
  if (Math.abs(s.length - t.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[t.length];
}

/** Typos allowed for an answer of this (squashed) length. */
export const typoTolerance = (length: number) => (length >= 8 ? 2 : length >= 5 ? 1 : 0);

/** Every accepted answer of every word, plus the distractors, squashed: what counts as "a real word". */
export function knownWords(bank: readonly { word: string; also: readonly string[] }[]): Set<string> {
  const known = new Set<string>(DISTRACTORS.map(squash));
  for (const w of bank) for (const a of [w.word, ...w.also]) known.add(squash(a));
  return known;
}

/** True when `guess` names `word` (see the layers above). `known`: from knownWords(bank). */
export function isCorrectGuess(guess: string, word: { word: string; also: readonly string[] }, known: ReadonlySet<string>): boolean {
  const g = squash(guess);
  if ([...g].length < 2) return false;
  const accepted = [word.word, ...word.also].map(squash);
  if (accepted.includes(g)) return true;
  // Another real word, however close in spelling.
  if (known.has(g)) return false;
  return accepted.some((a) => {
    const tol = typoTolerance([...a].length);
    if (tol === 0) return false;
    // ة dropped or added («طيار» / «طيارة») changes the meaning: not a typo.
    if (g + "ه" === a || a + "ه" === g) return false;
    return editDistance(g, a, tol) <= tol;
  });
}
