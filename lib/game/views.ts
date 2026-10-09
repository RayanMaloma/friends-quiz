import type {
  AnswerValue,
  GuestView,
  HostView,
  LeaderboardEntry,
  RevealSummary,
  RoundTimer,
  Snapshot,
} from "@/lib/types";
import { isAcceptedAnswer, normalizeAnswer } from "@/lib/game/text";

type SnapshotRound = Snapshot["rounds"][number];
type SnapshotPlayer = Snapshot["players"][number];
type SnapshotAnswer = Snapshot["answers"][number];

/**
 * Can this player answer this round? Everyone can, except the player linked
 * to the person the question is about. Unlinked players answer everything.
 */
export function isEligible(player: SnapshotPlayer, round: SnapshotRound): boolean {
  return player.person_id === null || player.person_id !== round.about_person_id;
}

function optionOf(v: AnswerValue): string | null {
  return "option" in v && typeof v.option === "string" ? v.option : null;
}
function textOf(v: AnswerValue): string | null {
  return "text" in v && typeof v.text === "string" ? v.text : null;
}
function numberOf(v: AnswerValue): number | null {
  return "number" in v && typeof v.number === "number" && Number.isFinite(v.number) ? v.number : null;
}

export interface RoundResult {
  /** null = this round has no right answer (unscored poll). */
  correct: boolean | null;
  points: number;
}

/** Speed bonus: 100% of the points at 0s, falling linearly to 50% at the deadline. */
export function speedFactor(round: SnapshotRound, answer: SnapshotAnswer, enabled: boolean): number {
  if (!enabled || round.time_limit <= 0 || !round.opened_at) return 1;
  const elapsed = (Date.parse(answer.created_at) - Date.parse(round.opened_at)) / 1000;
  if (!Number.isFinite(elapsed)) return 1;
  const ratio = Math.min(1, Math.max(0, elapsed / round.time_limit));
  return 1 - 0.5 * ratio;
}

/** Poll winners: the option(s) with the most votes (none if nobody voted). */
function pollWinners(answers: SnapshotAnswer[]): string[] {
  const counts = new Map<string, number>();
  for (const a of answers) {
    const o = optionOf(a.value);
    if (o) counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  const max = Math.max(0, ...counts.values());
  return max === 0 ? [] : [...counts.entries()].filter(([, c]) => c === max).map(([o]) => o);
}

/** Smallest distance to the right number among the given answers. */
function closestDistance(answers: SnapshotAnswer[], target: number): number | null {
  let best: number | null = null;
  for (const a of answers) {
    const n = numberOf(a.value);
    if (n === null) continue;
    const d = Math.abs(n - target);
    if (best === null || d < best) best = d;
  }
  return best;
}

/**
 * Per-player result of one round. Only eligible players' answers count
 * (a stray row from an excluded player can never score).
 */
export function scoreRound(
  snapshot: Snapshot,
  round: SnapshotRound,
): Map<string, RoundResult> {
  const playersById = new Map(snapshot.players.map((p) => [p.id, p]));
  const answers = snapshot.answers.filter((a) => {
    if (a.round_id !== round.id) return false;
    const p = playersById.get(a.player_id);
    return !!p && isEligible(p, round);
  });
  const key = round.answer_key;
  const type = round.question.type;
  const speed = snapshot.session.config.settings.speedBonus;
  const results = new Map<string, RoundResult>();

  const winners = type === "poll" && key.pollScoring === "majority" ? pollWinners(answers) : [];
  const closest =
    type === "number" && key.numberAnswer !== null ? closestDistance(answers, key.numberAnswer) : null;

  for (const a of answers) {
    let correct: boolean | null = false;
    let withSpeed = true;
    switch (type) {
      case "who":
      case "choice":
      case "truefalse": {
        const o = optionOf(a.value);
        correct = o !== null && key.correct.includes(o);
        break;
      }
      case "poll": {
        if (key.pollScoring !== "majority") correct = null;
        else {
          const o = optionOf(a.value);
          correct = o !== null && winners.includes(o);
          withSpeed = false;
        }
        break;
      }
      case "text": {
        const t = textOf(a.value);
        correct = t !== null && isAcceptedAnswer(t, key.accepted);
        break;
      }
      case "number": {
        const n = numberOf(a.value);
        correct = n !== null && closest !== null && key.numberAnswer !== null && Math.abs(n - key.numberAnswer) === closest;
        withSpeed = false;
        break;
      }
    }
    const points = correct ? Math.round(round.points * (withSpeed ? speedFactor(round, a, speed) : 1)) : 0;
    results.set(a.player_id, { correct, points });
  }
  return results;
}

/**
 * Scores are derived, never stored: the sum of every REVEALED round's points.
 * Because nothing is incremented, nothing can be scored twice.
 */
export function computeScores(snapshot: Snapshot): { totals: Map<string, number>; lastGained: Map<string, number> } {
  const totals = new Map<string, number>();
  const lastGained = new Map<string, number>();
  for (const p of snapshot.players) totals.set(p.id, 0);

  const revealed = snapshot.rounds.filter((r) => r.status === "REVEALED");
  const lastIndex = Math.max(-1, ...revealed.map((r) => r.round_index));
  for (const round of revealed) {
    for (const [playerId, res] of scoreRound(snapshot, round)) {
      if (!totals.has(playerId)) continue;
      totals.set(playerId, (totals.get(playerId) ?? 0) + res.points);
      if (round.round_index === lastIndex) lastGained.set(playerId, res.points);
    }
  }
  return { totals, lastGained };
}

/**
 * Sorted by score desc. Ties share a rank ("1, 1, 3" style); within a tie the
 * order is stable by `tieOrder` (join order) so the screen doesn't jump around.
 */
export function rankScores(
  scores: Map<string, number>,
  tieOrder: string[],
): { id: string; score: number; rank: number }[] {
  const orderIndex = new Map(tieOrder.map((id, i) => [id, i]));
  const entries = [...scores.entries()].map(([id, score]) => ({ id, score }));
  entries.sort(
    (a, b) =>
      b.score - a.score || (orderIndex.get(a.id) ?? 1e9) - (orderIndex.get(b.id) ?? 1e9),
  );
  return entries.map((e) => ({
    ...e,
    rank: 1 + entries.filter((o) => o.score > e.score).length,
  }));
}

export function buildLeaderboard(snapshot: Snapshot): LeaderboardEntry[] {
  const byId = new Map(snapshot.players.map((p) => [p.id, p]));
  const { totals, lastGained } = computeScores(snapshot);
  return rankScores(totals, snapshot.players.map((p) => p.id)).map((e) => {
    const p = byId.get(e.id)!;
    return {
      playerId: p.id,
      name: p.display_name,
      personId: p.person_id,
      score: e.score,
      gained: lastGained.get(p.id) ?? 0,
      rank: e.rank,
    };
  });
}

function currentRound(snapshot: Snapshot) {
  return snapshot.rounds.find((r) => r.round_index === snapshot.session.current_index) ?? null;
}

function timerOf(round: SnapshotRound): RoundTimer | null {
  if (round.time_limit <= 0 || !round.opened_at) return null;
  return {
    limit: round.time_limit,
    deadline: new Date(Date.parse(round.opened_at) + round.time_limit * 1000).toISOString(),
  };
}

function isRevealPhase(snapshot: Snapshot, round: SnapshotRound | null): round is SnapshotRound {
  const s = snapshot.session.status;
  return !!round && round.status === "REVEALED" && (s === "REVEAL" || s === "LEADERBOARD" || s === "FINISHED");
}

export function buildRevealSummary(snapshot: Snapshot, round: SnapshotRound): RevealSummary {
  const playersById = new Map(snapshot.players.map((p) => [p.id, p]));
  const answers = snapshot.answers.filter((a) => {
    if (a.round_id !== round.id) return false;
    const p = playersById.get(a.player_id);
    return !!p && isEligible(p, round);
  });
  const results = scoreRound(snapshot, round);
  const q = round.question;
  const key = round.answer_key;

  const counts = new Map<string, number>();
  for (const a of answers) {
    const o = optionOf(a.value);
    if (o) counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  const votes = q.options.map((o) => ({ optionId: o.id, count: counts.get(o.id) ?? 0 }));

  let winningOptionIds: string[] = [];
  if (q.type === "who" || q.type === "choice" || q.type === "truefalse") winningOptionIds = key.correct;
  if (q.type === "poll") winningOptionIds = pollWinners(answers);

  const topTexts: RevealSummary["topTexts"] = [];
  if (q.type === "text") {
    const groups = new Map<string, { text: string; count: number }>();
    for (const a of answers) {
      const t = textOf(a.value);
      if (!t) continue;
      const k = normalizeAnswer(t) || t;
      const g = groups.get(k) ?? { text: t.trim(), count: 0 };
      g.count += 1;
      groups.set(k, g);
    }
    for (const g of [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 6)) {
      topTexts.push({ ...g, correct: isAcceptedAnswer(g.text, key.accepted) });
    }
  }

  const closest: RevealSummary["closest"] = [];
  let numberAverage: number | null = null;
  if (q.type === "number") {
    const nums = answers.map((a) => numberOf(a.value)).filter((n): n is number => n !== null);
    numberAverage = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null;
    for (const a of answers) {
      const n = numberOf(a.value);
      if (n !== null && results.get(a.player_id)?.correct) {
        closest.push({ playerId: a.player_id, name: playersById.get(a.player_id)!.display_name, value: n });
      }
    }
  }

  const scored = !(q.type === "poll" && key.pollScoring !== "majority");
  return {
    index: round.round_index,
    question: q,
    aboutPersonId: round.about_person_id,
    answeredCount: answers.length,
    eligibleCount: round.eligible_count ?? answers.length,
    correctCount: [...results.values()].filter((r) => r.correct === true).length,
    scored,
    winningOptionIds,
    votes,
    accepted: q.type === "text" ? key.accepted : [],
    topTexts,
    numberAnswer: q.type === "number" ? key.numberAnswer : null,
    closest,
    numberAverage,
  };
}

export function isLeaderboardDue(snapshot: Snapshot): boolean {
  const { session } = snapshot;
  const every = session.config.settings.leaderboardEvery;
  const isLast = session.current_index >= session.total_questions - 1;
  return every > 0 && !isLast && (session.current_index + 1) % every === 0;
}

export function buildHostView(snapshot: Snapshot): HostView {
  const { session } = snapshot;
  const round = currentRound(snapshot);
  const roundAnswers = round ? snapshot.answers.filter((a) => a.round_id === round.id) : [];

  let question: HostView["question"] = null;
  if (round && session.status === "QUESTION") {
    question = {
      index: round.round_index,
      question: round.question,
      answeredCount: roundAnswers.length,
      // Live eligible count. The "about" person is used only for counting; it is not sent.
      eligibleCount: snapshot.players.filter((p) => isEligible(p, round)).length,
      timer: timerOf(round),
      points: round.points,
    };
  }

  const reveal = isRevealPhase(snapshot, round) ? buildRevealSummary(snapshot, round) : null;
  const showScores = session.status !== "LOBBY" && session.status !== "QUESTION";

  const upcomingImages = snapshot.rounds
    .filter((r) => r.round_index > session.current_index && r.round_index <= session.current_index + 2)
    .map((r) => r.question.image)
    .filter((i): i is string => !!i);

  return {
    role: "host",
    serverNow: snapshot.now,
    sessionId: session.id,
    code: session.code,
    status: session.status,
    config: session.config,
    currentIndex: session.current_index,
    totalQuestions: session.total_questions,
    isLastQuestion:
      session.total_questions > 0 && session.current_index >= session.total_questions - 1,
    leaderboardDue: isLeaderboardDue(snapshot),
    players: snapshot.players.map((p) => ({
      playerId: p.id,
      name: p.display_name,
      personId: p.person_id,
      active: p.token_hash !== null,
    })),
    question,
    reveal,
    leaderboard: showScores ? buildLeaderboard(snapshot) : [],
    upcomingImages,
  };
}

/**
 * Guest phones are controllers: they get what they need to answer the open
 * question, whether it is about them, and whether they already answered.
 * Results reach the phone only after reveal, and only if the game enables it.
 */
export function buildGuestView(snapshot: Snapshot, playerId: string): GuestView | null {
  const player = snapshot.players.find((p) => p.id === playerId);
  if (!player) return null;
  const { session } = snapshot;
  const { settings } = session.config;
  const round = currentRound(snapshot);

  let question: GuestView["question"] = null;
  if (round && session.status === "QUESTION" && round.status === "OPEN") {
    const q = round.question;
    const showContent = settings.showQuestionOnPhones;
    question = {
      index: round.round_index,
      type: q.type,
      prompt: showContent ? q.prompt : "",
      image: showContent ? q.image : null,
      // You can't pick yourself as the answer to a "who" question.
      options: q.type === "who" ? q.options.filter((o) => o.id !== player.person_id) : q.options,
      peopleOptions: q.peopleOptions,
      isExcluded: !isEligible(player, round),
      submitted: snapshot.answers.some((a) => a.round_id === round.id && a.player_id === player.id),
      timer: timerOf(round),
    };
  }

  let feedback: GuestView["feedback"] = null;
  if (settings.phoneFeedback && isRevealPhase(snapshot, round)) {
    const result = scoreRound(snapshot, round).get(player.id);
    const board = buildLeaderboard(snapshot);
    const me = board.find((e) => e.playerId === player.id);
    feedback = {
      index: round.round_index,
      excluded: !isEligible(player, round),
      answered: !!result,
      correct: result ? result.correct : null,
      gained: result?.points ?? 0,
      score: me?.score ?? 0,
      rank: me?.rank ?? board.length,
      playerCount: board.length,
    };
  }

  return {
    role: "guest",
    serverNow: snapshot.now,
    sessionId: session.id,
    code: session.code,
    status: session.status,
    title: session.config.title,
    emoji: session.config.emoji,
    accent: session.config.accent,
    currentIndex: session.current_index,
    totalQuestions: session.total_questions,
    me: { playerId: player.id, name: player.display_name, personId: player.person_id },
    question,
    feedback,
  };
}
