import { describe, expect, it } from "vitest";
import { buildGuestView, buildHostView, computeScores, rankScores } from "@/lib/game/views";
import type { Snapshot } from "@/lib/types";

function snapshot(overrides: Partial<Snapshot["session"]> = {}): Snapshot {
  return {
    session: {
      id: "s1",
      code: "1234",
      status: "QUESTION",
      current_index: 1,
      total_questions: 3,
      host_token_hash: "h",
      ...overrides,
    },
    players: [
      { id: "p-khalid", display_name: "Khalid", person_id: "khalid", token_hash: "t1" },
      { id: "p-rayan", display_name: "Rayan", person_id: "rayan", token_hash: "t2" },
      { id: "p-chinese", display_name: "Chinese", person_id: "chinese", token_hash: "t3" },
      { id: "p-guest", display_name: "Saad", person_id: null, token_hash: "t4" },
    ],
    rounds: [
      { id: "r0", round_index: 0, fact_id: "f0", fact_text: "zero", owner_person_id: "khalid", status: "REVEALED", eligible_count: 2 },
      { id: "r1", round_index: 1, fact_id: "f1", fact_text: "one", owner_person_id: "rayan", status: "OPEN", eligible_count: null },
      { id: "r2", round_index: 2, fact_id: "f2", fact_text: "two", owner_person_id: "chinese", status: "OPEN", eligible_count: null },
    ],
    answers: [
      { round_id: "r0", player_id: "p-rayan", chosen_person_id: "khalid" },
      { round_id: "r0", player_id: "p-chinese", chosen_person_id: "rayan" },
      { round_id: "r1", player_id: "p-khalid", chosen_person_id: "rayan" },
    ],
  };
}

describe("scoring", () => {
  it("counts only revealed rounds", () => {
    const scores = computeScores(snapshot());
    expect(scores.get("p-rayan")).toBe(1);
    expect(scores.get("p-khalid")).toBe(0); // r1 correct but not revealed yet
    expect(scores.get("p-chinese")).toBe(0);
  });

  it("never gives the owner a point even if an answer row exists", () => {
    const s = snapshot();
    s.answers.push({ round_id: "r0", player_id: "p-khalid", chosen_person_id: "khalid" });
    expect(computeScores(s).get("p-khalid")).toBe(0);
  });

  it("scores unlinked (non fact-owner) players on every round", () => {
    const s = snapshot({ status: "REVEAL", current_index: 0 });
    s.answers.push({ round_id: "r0", player_id: "p-guest", chosen_person_id: "khalid" });
    expect(computeScores(s).get("p-guest")).toBe(1);
  });

  it("ranks ties with shared rank", () => {
    const ranked = rankScores(
      new Map([["a", 3], ["b", 5], ["c", 3], ["d", 1]]),
      ["a", "b", "c", "d"],
    );
    expect(ranked.map((r) => [r.id, r.rank])).toEqual([
      ["b", 1], ["a", 2], ["c", 2], ["d", 4],
    ]);
  });
});

describe("host view", () => {
  it("does not expose the owner or scores during QUESTION", () => {
    const view = buildHostView(snapshot());
    // 4 players, rayan owns the fact -> 3 eligible (including the unlinked guest).
    expect(view.question).toEqual({ index: 1, factText: "one", answeredCount: 1, eligibleCount: 3 });
    expect(view.reveal).toBeNull();
    expect(view.leaderboard).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("owner");
  });

  it("shows reveal details after reveal", () => {
    const s = snapshot({ status: "REVEAL", current_index: 0 });
    const view = buildHostView(s);
    expect(view.reveal).toMatchObject({
      ownerPersonId: "khalid",
      correctCount: 1,
      answeredCount: 2,
      eligibleCount: 2,
    });
    expect(view.reveal!.distribution).toHaveLength(2);
    expect(view.leaderboard[0]).toMatchObject({ playerId: "p-rayan", name: "Rayan", score: 1, rank: 1 });
  });
});

describe("guest view", () => {
  it("never contains owner ids, scores or results", () => {
    for (const status of ["QUESTION", "REVEAL", "LEADERBOARD", "FINISHED"] as const) {
      const s = snapshot({ status, current_index: status === "QUESTION" ? 1 : 0 });
      const view = buildGuestView(s, "p-chinese")!;
      const json = JSON.stringify({ ...view, status: undefined });
      expect(json).not.toMatch(/ownerPersonId|owner_person_id|score|rank|correct|distribution|leaderboard/i);
      // The only person id in the payload is the guest's own.
      expect(json).not.toContain("khalid");
      expect(json).not.toContain("rayan");
    }
  });

  it("only sends the question while it is open", () => {
    expect(buildGuestView(snapshot(), "p-chinese")!.question).toEqual({
      index: 1, factText: "one", isOwner: false, submitted: false,
    });
    expect(buildGuestView(snapshot({ status: "REVEAL" }), "p-chinese")!.question).toBeNull();
  });

  it("flags the owner and submitted state", () => {
    expect(buildGuestView(snapshot(), "p-rayan")!.question!.isOwner).toBe(true);
    expect(buildGuestView(snapshot(), "p-guest")!.question!.isOwner).toBe(false);
    expect(buildGuestView(snapshot(), "p-khalid")!.question!.submitted).toBe(true);
  });
});
