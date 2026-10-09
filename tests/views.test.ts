import { describe, expect, it } from "vitest";
import {
  buildGuestView,
  buildHostView,
  computeScores,
  isLeaderboardDue,
  rankScores,
} from "@/lib/game/views";
import { DEFAULT_SETTINGS } from "@/lib/game/doc";
import type { AnswerValue, RoundQuestion, Snapshot } from "@/lib/types";

const PEOPLE = [
  { id: "khalid", name: "Khalid", image: null },
  { id: "rayan", name: "Rayan", image: null },
  { id: "chinese", name: "Chinese", image: null },
];
const peopleOptions = PEOPLE.map((p) => ({ id: p.id, label: p.name, image: null }));
const T0 = "2026-10-09T20:00:00.000Z";
const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();

type Round = Snapshot["rounds"][number];

function round(i: number, question: Partial<RoundQuestion>, key: Partial<Round["answer_key"]>, extra: Partial<Round> = {}): Round {
  return {
    id: `r${i}`,
    round_index: i,
    question: { type: "who", prompt: `q${i}`, image: null, options: peopleOptions, peopleOptions: true, note: "", ...question },
    answer_key: { correct: [], accepted: [], numberAnswer: null, pollScoring: "none", ...key },
    about_person_id: null,
    time_limit: 0,
    points: 100,
    status: "REVEALED",
    opened_at: T0,
    eligible_count: null,
    ...extra,
  };
}

function snapshot(
  rounds: Round[],
  answers: [string, string, AnswerValue, number?][],
  session: Partial<Snapshot["session"]> = {},
  settings: Partial<typeof DEFAULT_SETTINGS> = {},
): Snapshot {
  return {
    now: at(5),
    session: {
      id: "s1",
      code: "1234",
      status: "REVEAL",
      current_index: rounds.length - 1,
      total_questions: rounds.length,
      host_token_hash: "h",
      game_id: null,
      config: {
        title: "T",
        tagline: "",
        emoji: "🎉",
        accent: "sun",
        people: PEOPLE,
        settings: { ...DEFAULT_SETTINGS, speedBonus: false, ...settings },
      },
      created_at: T0,
      ...session,
    },
    players: [
      { id: "p-khalid", display_name: "Khalid", person_id: "khalid", token_hash: "t1" },
      { id: "p-rayan", display_name: "Rayan", person_id: "rayan", token_hash: "t2" },
      { id: "p-guest", display_name: "Saad", person_id: null, token_hash: "t3" },
    ],
    rounds,
    answers: answers.map(([r, p, value, s]) => ({ round_id: r, player_id: p, value, created_at: at(s ?? 1) })),
  };
}

describe("scoring", () => {
  it("who: points for picking the right person, only in revealed rounds", () => {
    const s = snapshot(
      [
        round(0, {}, { correct: ["khalid"] }, { about_person_id: "khalid" }),
        round(1, {}, { correct: ["rayan"] }, { about_person_id: "rayan", status: "OPEN" }),
      ],
      [
        ["r0", "p-rayan", { option: "khalid" }],
        ["r0", "p-guest", { option: "chinese" }],
        ["r1", "p-guest", { option: "rayan" }],
      ],
      { status: "QUESTION", current_index: 1 },
    );
    const { totals } = computeScores(s);
    expect(totals.get("p-rayan")).toBe(100);
    expect(totals.get("p-guest")).toBe(0); // r1 correct but not revealed yet
  });

  it("never scores the excluded person even if a row exists", () => {
    const s = snapshot([round(0, {}, { correct: ["khalid"] }, { about_person_id: "khalid" })], [["r0", "p-khalid", { option: "khalid" }]]);
    expect(computeScores(s).totals.get("p-khalid")).toBe(0);
  });

  it("speed bonus: 100% instantly, 50% at the deadline", () => {
    const rounds = [round(0, { type: "choice", peopleOptions: false, options: [{ id: "x", label: "X", image: null }] }, { correct: ["x"] }, { time_limit: 20 })];
    const s = snapshot(rounds, [["r0", "p-rayan", { option: "x" }, 0], ["r0", "p-guest", { option: "x" }, 10], ["r0", "p-khalid", { option: "x" }, 30]], {}, { speedBonus: true });
    const { totals } = computeScores(s);
    expect(totals.get("p-rayan")).toBe(100);
    expect(totals.get("p-guest")).toBe(75);
    expect(totals.get("p-khalid")).toBe(50);
  });

  it("poll majority: everyone with the most popular option scores; ties share", () => {
    const opts = peopleOptions;
    const s = snapshot(
      [round(0, { type: "poll", options: opts }, { pollScoring: "majority" })],
      [
        ["r0", "p-khalid", { option: "rayan" }],
        ["r0", "p-rayan", { option: "chinese" }],
        ["r0", "p-guest", { option: "rayan" }],
      ],
    );
    const { totals } = computeScores(s);
    expect(totals.get("p-khalid")).toBe(100);
    expect(totals.get("p-guest")).toBe(100);
    expect(totals.get("p-rayan")).toBe(0);
    expect(buildHostView(s).reveal).toMatchObject({ winningOptionIds: ["rayan"], scored: true, correctCount: 2 });
  });

  it("poll without scoring gives nobody points", () => {
    const s = snapshot([round(0, { type: "poll" }, { pollScoring: "none" })], [["r0", "p-guest", { option: "rayan" }]]);
    expect(computeScores(s).totals.get("p-guest")).toBe(0);
    expect(buildHostView(s).reveal?.scored).toBe(false);
  });

  it("text: loose matching against accepted answers", () => {
    const s = snapshot(
      [round(0, { type: "text", options: [], peopleOptions: false }, { accepted: ["الرياض"] })],
      [["r0", "p-guest", { text: " رياض " }], ["r0", "p-rayan", { text: "جدة" }]],
    );
    const { totals } = computeScores(s);
    expect(totals.get("p-guest")).toBe(100);
    expect(totals.get("p-rayan")).toBe(0);
    const reveal = buildHostView(s).reveal!;
    expect(reveal.topTexts.map((t) => [t.text, t.correct])).toEqual([["رياض", true], ["جدة", false]]);
  });

  it("number: the closest guess(es) win", () => {
    const s = snapshot(
      [round(0, { type: "number", options: [], peopleOptions: false }, { numberAnswer: 50 })],
      [["r0", "p-guest", { number: 45 }], ["r0", "p-rayan", { number: 55 }], ["r0", "p-khalid", { number: 70 }]],
    );
    const { totals } = computeScores(s);
    expect([totals.get("p-guest"), totals.get("p-rayan"), totals.get("p-khalid")]).toEqual([100, 100, 0]);
    expect(buildHostView(s).reveal).toMatchObject({ numberAnswer: 50, numberAverage: 170 / 3 });
  });

  it("ranks ties with shared rank", () => {
    const ranked = rankScores(new Map([["a", 3], ["b", 5], ["c", 3], ["d", 1]]), ["a", "b", "c", "d"]);
    expect(ranked.map((r) => [r.id, r.rank])).toEqual([["b", 1], ["a", 2], ["c", 2], ["d", 4]]);
  });
});

describe("host view", () => {
  const rounds = [
    round(0, {}, { correct: ["khalid"] }, { about_person_id: "khalid" }),
    round(1, {}, { correct: ["rayan"] }, { about_person_id: "rayan", status: "OPEN", time_limit: 20 }),
  ];

  it("never exposes the answer during QUESTION", () => {
    const view = buildHostView(snapshot(rounds, [["r1", "p-khalid", { option: "rayan" }]], { status: "QUESTION", current_index: 1 }));
    // 3 players, rayan is excluded -> 2 eligible.
    expect(view.question).toMatchObject({ index: 1, answeredCount: 1, eligibleCount: 2, timer: { limit: 20, deadline: at(20) } });
    expect(view.reveal).toBeNull();
    expect(view.leaderboard).toEqual([]);
    const json = JSON.stringify(view);
    expect(json).not.toContain("answer_key");
    expect(json).not.toContain("correct");
    expect(json).not.toContain("about");
  });

  it("shows the reveal with votes after reveal", () => {
    const view = buildHostView(snapshot(rounds.slice(0, 1), [["r0", "p-rayan", { option: "khalid" }], ["r0", "p-guest", { option: "rayan" }]]));
    expect(view.reveal).toMatchObject({ winningOptionIds: ["khalid"], correctCount: 1, answeredCount: 2 });
    expect(view.reveal!.votes).toEqual([
      { optionId: "khalid", count: 1 },
      { optionId: "rayan", count: 1 },
      { optionId: "chinese", count: 0 },
    ]);
    expect(view.leaderboard.find((e) => e.playerId === "p-rayan")).toMatchObject({ score: 100, gained: 100, rank: 1 });
  });

  it("leaderboard cadence", () => {
    const five = Array.from({ length: 5 }, (_, i) => round(i, {}, { correct: ["khalid"] }));
    const due = (idx: number, every: number) =>
      isLeaderboardDue(snapshot(five, [], { current_index: idx }, { leaderboardEvery: every }));
    expect([0, 1, 2, 3].map((i) => due(i, 1))).toEqual([true, true, true, true]);
    expect(due(4, 1)).toBe(false); // last question goes straight to the final results
    expect([0, 1, 2, 3].map((i) => due(i, 2))).toEqual([false, true, false, true]);
    expect([0, 1, 2, 3].map((i) => due(i, 0))).toEqual([false, false, false, false]);
  });

  it("lists upcoming images for preloading", () => {
    const withImages = [
      round(0, {}, { correct: ["khalid"] }, { status: "OPEN" }),
      round(1, { image: "/api/media/one.webp" }, {}, { status: "OPEN" }),
      round(2, { image: "/api/media/two.webp" }, {}, { status: "OPEN" }),
      round(3, { image: "/api/media/three.webp" }, {}, { status: "OPEN" }),
    ];
    const view = buildHostView(snapshot(withImages, [], { status: "QUESTION", current_index: 0 }));
    expect(view.upcomingImages).toEqual(["/api/media/one.webp", "/api/media/two.webp"]);
  });
});

describe("guest view", () => {
  const rounds = [round(0, {}, { correct: ["khalid"] }, { about_person_id: "khalid", status: "OPEN" })];

  it("is a controller: no answers, own name removed, excluded flag", () => {
    const s = snapshot(rounds, [], { status: "QUESTION", current_index: 0 });
    const rayan = buildGuestView(s, "p-rayan")!;
    expect(rayan.question).toMatchObject({ isExcluded: false, submitted: false });
    expect(rayan.question!.options.map((o) => o.id)).toEqual(["khalid", "chinese"]);
    expect(JSON.stringify(rayan)).not.toContain("correct");
    expect(buildGuestView(s, "p-khalid")!.question!.isExcluded).toBe(true);
    expect(buildGuestView(s, "nope")).toBeNull();
  });

  it("hides the question content when the game shows it on the TV only", () => {
    const s = snapshot(rounds, [], { status: "QUESTION", current_index: 0 }, { showQuestionOnPhones: false });
    expect(buildGuestView(s, "p-guest")!.question).toMatchObject({ prompt: "", image: null });
  });

  it("phone feedback only after reveal and only when enabled", () => {
    const revealed = [round(0, {}, { correct: ["khalid"] }, { about_person_id: "khalid" })];
    const s = snapshot(revealed, [["r0", "p-guest", { option: "khalid" }], ["r0", "p-rayan", { option: "chinese" }]]);
    expect(buildGuestView(s, "p-guest")!.feedback).toMatchObject({ correct: true, gained: 100, rank: 1, score: 100 });
    expect(buildGuestView(s, "p-rayan")!.feedback).toMatchObject({ correct: false, gained: 0 });
    expect(buildGuestView(s, "p-khalid")!.feedback).toMatchObject({ excluded: true, answered: false });

    const off = snapshot(revealed, [], {}, { phoneFeedback: false });
    expect(buildGuestView(off, "p-guest")!.feedback).toBeNull();
    const open = snapshot(rounds, [], { status: "QUESTION", current_index: 0 });
    expect(buildGuestView(open, "p-guest")!.feedback).toBeNull();
  });
});
