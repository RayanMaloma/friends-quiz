import type { GuestView, HostView, LeaderboardEntry, Snapshot } from "@/lib/types";

/**
 * Scores are derived, never stored: a player earns 1 point for each REVEALED
 * round where they picked the fact owner. Fact owners can't have answers for
 * their own facts (DB guard), and we exclude them here again for safety.
 * Because nothing is incremented, nothing can be scored twice.
 */
export function computeScores(snapshot: Snapshot): Map<string, number> {
  const roundsById = new Map(snapshot.rounds.map((r) => [r.id, r]));
  const playersById = new Map(snapshot.players.map((p) => [p.id, p]));
  const scores = new Map<string, number>();
  for (const p of snapshot.players) scores.set(p.person_id, 0);

  for (const a of snapshot.answers) {
    const round = roundsById.get(a.round_id);
    const player = playersById.get(a.player_id);
    if (!round || !player || round.status !== "REVEALED") continue;
    if (player.person_id === round.owner_person_id) continue;
    if (a.chosen_person_id === round.owner_person_id) {
      scores.set(player.person_id, (scores.get(player.person_id) ?? 0) + 1);
    }
  }
  return scores;
}

/**
 * Sorted by score desc. Ties share a rank ("1, 1, 3" style); within a tie the
 * order is stable by `tieOrder` (join order) so the screen doesn't jump around.
 */
export function rankScores(scores: Map<string, number>, tieOrder: string[]): LeaderboardEntry[] {
  const orderIndex = new Map(tieOrder.map((id, i) => [id, i]));
  const entries = [...scores.entries()].map(([personId, score]) => ({ personId, score }));
  entries.sort(
    (a, b) =>
      b.score - a.score ||
      (orderIndex.get(a.personId) ?? 999) - (orderIndex.get(b.personId) ?? 999),
  );
  return entries.map((e) => ({
    ...e,
    rank: 1 + entries.filter((o) => o.score > e.score).length,
  }));
}

function currentRound(snapshot: Snapshot) {
  return snapshot.rounds.find((r) => r.round_index === snapshot.session.current_index) ?? null;
}

export function buildHostView(snapshot: Snapshot): HostView {
  const { session } = snapshot;
  const round = currentRound(snapshot);
  const roundAnswers = round ? snapshot.answers.filter((a) => a.round_id === round.id) : [];

  let question: HostView["question"] = null;
  let reveal: HostView["reveal"] = null;

  if (round && session.status === "QUESTION") {
    question = {
      index: round.round_index,
      factText: round.fact_text,
      answeredCount: roundAnswers.length,
      // Live eligible count: everyone who joined except the fact owner.
      // The owner id is used only for counting; it is not sent.
      eligibleCount: snapshot.players.filter((p) => p.person_id !== round.owner_person_id).length,
    };
  }

  if (
    round &&
    round.status === "REVEALED" &&
    (session.status === "REVEAL" || session.status === "LEADERBOARD" || session.status === "FINISHED")
  ) {
    const counts = new Map<string, number>();
    for (const a of roundAnswers) {
      counts.set(a.chosen_person_id, (counts.get(a.chosen_person_id) ?? 0) + 1);
    }
    reveal = {
      index: round.round_index,
      factText: round.fact_text,
      ownerPersonId: round.owner_person_id,
      correctCount: counts.get(round.owner_person_id) ?? 0,
      answeredCount: roundAnswers.length,
      eligibleCount: round.eligible_count ?? roundAnswers.length,
      distribution: [...counts.entries()]
        .map(([personId, count]) => ({ personId, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  const showScores = session.status !== "LOBBY" && session.status !== "QUESTION";

  return {
    role: "host",
    sessionId: session.id,
    code: session.code,
    status: session.status,
    currentIndex: session.current_index,
    totalQuestions: session.total_questions,
    isLastQuestion:
      session.total_questions > 0 && session.current_index >= session.total_questions - 1,
    players: snapshot.players.map((p) => ({ personId: p.person_id, active: p.token_hash !== null })),
    question,
    reveal,
    leaderboard: showScores
      ? rankScores(computeScores(snapshot), snapshot.players.map((p) => p.person_id))
      : [],
  };
}

/**
 * Guest phones are controllers: they get the fact text while the question is
 * open, whether it is their own fact, and whether they already answered.
 * Nothing about owners, correctness, scores or rankings — ever.
 */
export function buildGuestView(snapshot: Snapshot, playerId: string): GuestView | null {
  const player = snapshot.players.find((p) => p.id === playerId);
  if (!player) return null;
  const { session } = snapshot;
  const round = currentRound(snapshot);

  let question: GuestView["question"] = null;
  if (round && session.status === "QUESTION" && round.status === "OPEN") {
    question = {
      index: round.round_index,
      factText: round.fact_text,
      isOwner: round.owner_person_id === player.person_id,
      submitted: snapshot.answers.some((a) => a.round_id === round.id && a.player_id === player.id),
    };
  }

  return {
    role: "guest",
    sessionId: session.id,
    code: session.code,
    status: session.status,
    currentIndex: session.current_index,
    totalQuestions: session.total_questions,
    me: { personId: player.person_id },
    question,
  };
}
