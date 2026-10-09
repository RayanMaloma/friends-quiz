import { describe, expect, it } from "vitest";
import { isAcceptedAnswer, normalizeAnswer, parseNumberInput } from "@/lib/game/text";

describe("typed answers", () => {
  it("ignores spacing, case, punctuation and Arabic letter forms", () => {
    expect(normalizeAnswer("  الرياض. ")).toBe(normalizeAnswer("رياض"));
    expect(isAcceptedAnswer("أحمد", ["احمد"])).toBe(true);
    expect(isAcceptedAnswer("مكّة", ["مكه"])).toBe(true);
    expect(isAcceptedAnswer("مستشفى", ["مستشفي"])).toBe(true);
    expect(isAcceptedAnswer("NEW   york!", ["New York"])).toBe(true);
    expect(isAcceptedAnswer("١٩٩٠", ["1990"])).toBe(true);
    expect(isAcceptedAnswer("كتـــاب", ["كتاب"])).toBe(true);
  });

  it("does not accept different words or empty input", () => {
    expect(isAcceptedAnswer("جدة", ["الرياض"])).toBe(false);
    expect(isAcceptedAnswer("   ", ["x"])).toBe(false);
    expect(isAcceptedAnswer("Riyadh", ["الرياض"])).toBe(false);
  });

  it("parses typed numbers", () => {
    expect(parseNumberInput("1,250")).toBe(1250);
    expect(parseNumberInput("٣٫٥")).toBe(3.5);
    expect(parseNumberInput("-12")).toBe(-12);
    expect(parseNumberInput("١٢٣")).toBe(123);
    expect(parseNumberInput("12abc")).toBeNull();
    expect(parseNumberInput("")).toBeNull();
  });
});
