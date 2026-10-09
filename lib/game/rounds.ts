import type { GameDoc, Question, RoundAnswerKey, RoundQuestion, SessionConfig } from "@/lib/types";
import { playableQuestions, TRUE_FALSE_OPTIONS } from "@/lib/game/doc";
import { balancedShuffle } from "@/lib/game/shuffle";

export interface RoundSeed {
  question: RoundQuestion;
  answer_key: RoundAnswerKey;
  about_person_id: string | null;
  time_limit: number;
  points: number;
}

export function buildSessionConfig(doc: GameDoc): SessionConfig {
  return {
    title: doc.title,
    tagline: doc.tagline,
    emoji: doc.emoji,
    accent: doc.accent,
    people: doc.people,
    settings: doc.settings,
  };
}

function roundQuestion(q: Question, doc: GameDoc): RoundQuestion {
  const peopleOptions = q.type === "who" || (q.type === "poll" && q.optionSource === "people");
  const options = peopleOptions
    ? doc.people.map((p) => ({ id: p.id, label: p.name, image: p.image }))
    : q.type === "truefalse"
      ? TRUE_FALSE_OPTIONS
      : q.type === "choice" || q.type === "poll"
        ? q.options
        : [];
  return { type: q.type, prompt: q.prompt, image: q.image, options, peopleOptions, note: q.note };
}

/**
 * The play order for a new session: only valid, enabled questions; shuffled
 * (never the same person's questions back-to-back when possible) or in the
 * authored order; optionally limited to N questions.
 */
export function buildRounds(doc: GameDoc, random: () => number = Math.random): RoundSeed[] {
  let questions = playableQuestions(doc);
  const { settings } = doc;

  if (settings.order === "shuffle") {
    // Pick the subset first (uniformly), then balance the order.
    if (settings.questionLimit && settings.questionLimit < questions.length) {
      questions = sample(questions, settings.questionLimit, random);
    }
    questions = balancedShuffle(questions, (q) => q.aboutPersonId ?? `q:${q.id}`, random);
  } else if (settings.questionLimit) {
    questions = questions.slice(0, settings.questionLimit);
  }

  return questions.map((q) => ({
    question: roundQuestion(q, doc),
    answer_key: {
      correct: q.correct,
      accepted: q.accepted,
      numberAnswer: q.numberAnswer,
      pollScoring: q.pollScoring,
    },
    about_person_id: q.aboutPersonId,
    time_limit: q.timeLimit ?? settings.timeLimit,
    points: q.points ?? settings.points,
  }));
}

function sample<T>(items: T[], n: number, random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}
