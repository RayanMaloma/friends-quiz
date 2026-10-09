/**
 * Loose comparison for typed answers: case, spacing, punctuation, Arabic
 * diacritics/tatweel, alef/yaa/taa-marbuta forms, a leading "ال" and
 * Arabic-Indic digits don't matter: " الرياض " matches "رياض." — but
 * different scripts stay different ("Riyadh" must be its own accepted answer).
 */
export function normalizeAnswer(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "") // harakat, superscript alef, tatweel
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ی/g, "ي")
    .replace(/ک/g, "ك")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/^ال(?=\S)/, "") // leading definite article
    .replace(/\s+ال(?=\S)/g, " ")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isAcceptedAnswer(answer: string, accepted: string[]): boolean {
  const a = normalizeAnswer(answer);
  if (!a) return false;
  return accepted.some((x) => normalizeAnswer(x) === a);
}

/** Parse a typed number: Arabic-Indic digits, Arabic decimal/thousands separators. */
export function parseNumberInput(s: string): number | null {
  const t = s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٬,\s]/g, "")
    .replace(/٫/g, ".")
    .trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
