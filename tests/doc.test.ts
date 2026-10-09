import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  normalizeGameDoc,
  playableQuestions,
  TEMPLATES,
  validateGameDoc,
} from "@/lib/game/doc";
import { buildRounds } from "@/lib/game/rounds";
import { countAdjacentRepeats } from "@/lib/game/shuffle";
import { legacyGameDoc } from "@/lib/server/legacy";

const people = [
  { id: "a", name: "Ali", image: "/people/a.png" },
  { id: "b", name: "Bader", image: null },
  { id: "c", name: "Cee", image: "https://example.com/c.png" },
];

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

describe("normalizeGameDoc", () => {
  it("turns garbage into a valid empty game", () => {
    for (const junk of [null, 42, "x", [], { questions: "nope", people: {} }]) {
      const doc = normalizeGameDoc(junk);
      expect(doc.title).toBeTruthy();
      expect(doc.people).toEqual([]);
      expect(doc.questions).toEqual([]);
      expect(doc.settings).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("drops unknown fields, caps strings and clamps numbers", () => {
    const doc = normalizeGameDoc({
      title: "x".repeat(500),
      evil: "<script>",
      settings: { timeLimit: 99999, points: -5, order: "random?", questionLimit: 0 },
      questions: [{ type: "text", prompt: " hi ", accepted: [" a ", "a", ""], timeLimit: "15", hack: 1 }],
    });
    expect(doc.title.length).toBe(60);
    expect(doc).not.toHaveProperty("evil");
    expect(doc.settings.timeLimit).toBe(600);
    expect(doc.settings.points).toBe(0);
    expect(doc.settings.order).toBe("shuffle");
    expect(doc.settings.questionLimit).toBeNull();
    expect(doc.questions[0]).toMatchObject({ prompt: "hi", accepted: ["a"], timeLimit: 15 });
    expect(doc.questions[0]).not.toHaveProperty("hack");
  });

  it("rejects unsafe image references", () => {
    const doc = normalizeGameDoc({
      people: [
        { id: "a", name: "A", image: "javascript:alert(1)" },
        { id: "b", name: "B", image: "//evil.com/x.png" },
        { id: "c", name: "C", image: "http://insecure.com/x.png" },
        { id: "d", name: "D", image: "/api/media/0b0e7d0c-1234-4abc-9def-000000000000.webp" },
      ],
    });
    expect(doc.people.map((p) => p.image)).toEqual([null, null, null, "/api/media/0b0e7d0c-1234-4abc-9def-000000000000.webp"]);
  });

  it("keeps only answers that reference existing people/options", () => {
    const doc = normalizeGameDoc({
      people,
      questions: [
        { type: "who", prompt: "q", correct: ["a", "ghost"] },
        { type: "choice", prompt: "q", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], correct: ["y", "zzz"] },
        { type: "truefalse", prompt: "q", correct: ["false", "true"] },
        { type: "who", prompt: "q", correct: ["b"], aboutPersonId: null },
      ],
    });
    expect(doc.questions[0].correct).toEqual(["a"]);
    // "who" questions are about the answer by default…
    expect(doc.questions[0].aboutPersonId).toBe("a");
    expect(doc.questions[1].correct).toEqual(["y"]);
    expect(doc.questions[2].correct).toEqual(["false"]);
    // …unless the author explicitly turned it off.
    expect(doc.questions[3].aboutPersonId).toBeNull();
  });

  it("de-duplicates ids", () => {
    const doc = normalizeGameDoc({
      people: [{ id: "a", name: "A" }, { id: "a", name: "A2" }],
      questions: [{ id: "q1", prompt: "1" }, { id: "q1", prompt: "2" }],
    });
    expect(new Set(doc.people.map((p) => p.id)).size).toBe(2);
    expect(new Set(doc.questions.map((q) => q.id)).size).toBe(2);
  });
});

describe("validateGameDoc", () => {
  it("lists what prevents playing", () => {
    const doc = normalizeGameDoc({
      people,
      questions: [
        { type: "who", prompt: "" },
        { type: "choice", prompt: "q", options: [{ id: "x", label: "X" }] },
        { type: "number", prompt: "q" },
        { type: "text", prompt: "q", accepted: ["ok"] },
        { type: "poll", prompt: "q", enabled: false },
      ],
    });
    const issues = validateGameDoc(doc);
    const byQ = (i: number) => issues.filter((x) => x.questionId === doc.questions[i].id).length;
    expect(byQ(0)).toBe(2); // no text/image, no answer
    expect(byQ(1)).toBeGreaterThanOrEqual(2);
    expect(byQ(2)).toBe(1);
    expect(byQ(3)).toBe(0);
    expect(byQ(4)).toBe(0); // disabled questions are not checked
    expect(playableQuestions(doc).map((q) => q.type)).toEqual(["text"]);
  });

  it("requires at least one enabled question", () => {
    expect(validateGameDoc(normalizeGameDoc({}))).toEqual([{ questionId: null, message: expect.any(String) }]);
  });

  it("every template builds a normalized document", () => {
    for (const t of TEMPLATES) {
      const doc = t.build();
      expect(normalizeGameDoc(doc)).toEqual(doc);
    }
  });

  it("the original game converts without issues", () => {
    const doc = legacyGameDoc();
    expect(validateGameDoc(doc)).toEqual([]);
    expect(doc.people.length).toBeGreaterThanOrEqual(6);
    expect(doc.questions.every((q) => q.type === "who" && q.aboutPersonId === q.correct[0])).toBe(true);
    expect(doc.settings).toMatchObject({ timeLimit: 0, points: 1, phoneFeedback: false });
  });
});

describe("buildRounds", () => {
  const doc = normalizeGameDoc({
    people,
    settings: { order: "fixed", timeLimit: 20, points: 100 },
    questions: [
      { id: "q1", type: "who", prompt: "1", correct: ["a"] },
      { id: "q2", type: "choice", prompt: "2", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], correct: ["x"], timeLimit: 0, points: 5 },
      { id: "q3", type: "truefalse", prompt: "3", correct: ["true"] },
      { id: "q4", type: "who", prompt: "broken" },
      { id: "q5", type: "poll", prompt: "5", optionSource: "people", pollScoring: "majority", enabled: false },
    ],
  });

  it("skips broken/disabled questions and keeps the authored order", () => {
    const rounds = buildRounds(doc);
    expect(rounds.map((r) => r.question.prompt)).toEqual(["1", "2", "3"]);
  });

  it("materializes options and separates the answer key", () => {
    const [who, choice, tf] = buildRounds(doc);
    expect(who.question.options.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(who.question.peopleOptions).toBe(true);
    expect(who.about_person_id).toBe("a");
    expect(JSON.stringify(who.question)).not.toContain("correct");
    expect(who.answer_key.correct).toEqual(["a"]);
    expect(tf.question.options.map((o) => o.id)).toEqual(["true", "false"]);
    // Per-question overrides beat the game defaults.
    expect([who.time_limit, who.points]).toEqual([20, 100]);
    expect([choice.time_limit, choice.points]).toEqual([0, 5]);
  });

  it("limits and balances shuffled sessions", () => {
    const many = normalizeGameDoc({
      people,
      settings: { order: "shuffle", questionLimit: 9 },
      questions: Array.from({ length: 30 }, (_, i) => ({
        type: "who",
        prompt: `q${i}`,
        correct: [people[i % 3].id],
      })),
    });
    for (let seed = 1; seed < 20; seed++) {
      const rounds = buildRounds(many, seeded(seed));
      expect(rounds).toHaveLength(9);
      expect(new Set(rounds.map((r) => r.question.prompt)).size).toBe(9);
      const counts = new Map<string, number>();
      for (const r of rounds) counts.set(r.about_person_id!, (counts.get(r.about_person_id!) ?? 0) + 1);
      if (Math.max(...counts.values()) <= 5) {
        expect(countAdjacentRepeats(rounds, (r) => r.about_person_id!)).toBe(0);
      }
    }
  });
});
