// ---------------------------------------------------------------------------
// Game content (authored in the admin dashboard, stored as one JSON document)
// ---------------------------------------------------------------------------

export type GameStatus = "LOBBY" | "QUESTION" | "REVEAL" | "LEADERBOARD" | "FINISHED";

export type QuestionType = "who" | "choice" | "truefalse" | "poll" | "text" | "number";

export type Accent = "sun" | "pink" | "sky" | "mint" | "grape" | "orange";

/** A person the game is about (a possible answer for "who" questions). */
export interface Person {
  id: string;
  name: string;
  /** Portrait URL (transparent cutout works best) or null. */
  image: string | null;
}

export interface ChoiceOption {
  id: string;
  label: string;
  image: string | null;
}

export interface Question {
  id: string;
  type: QuestionType;
  /** Text shown on the TV (may be empty when there is an image). */
  prompt: string;
  image: string | null;
  /** choice: the answer options. poll: options when optionSource = "custom". */
  options: ChoiceOption[];
  /** poll only: vote between the game's people or custom options. */
  optionSource: "people" | "custom";
  /** who/choice/truefalse: ids of the correct option(s) (person ids for "who"). */
  correct: string[];
  /** text: accepted answers (matched loosely: case, spaces, Arabic letter forms). */
  accepted: string[];
  /** number: the correct value. The closest guess(es) win. */
  numberAnswer: number | null;
  /** poll: "majority" gives points to everyone who voted with the most popular option. */
  pollScoring: "none" | "majority";
  /** A player linked to this person sits this question out ("this one is about you"). */
  aboutPersonId: string | null;
  /** Seconds. null = use the game default. 0 = no timer. */
  timeLimit: number | null;
  /** null = use the game default. 0 = no points. */
  points: number | null;
  /** Optional story/explanation shown on the TV at reveal. */
  note: string;
  enabled: boolean;
}

export interface GameSettings {
  order: "shuffle" | "fixed";
  /** Play a random subset of N questions. null = all enabled questions. */
  questionLimit: number | null;
  /** Default seconds per question. 0 = no timer (host reveals). */
  timeLimit: number;
  /** Reveal automatically when the timer runs out or everyone has answered. */
  autoReveal: boolean;
  /** Default points for a correct answer. */
  points: number;
  /** Faster correct answers earn more (needs a timer): from 100% down to 50%. */
  speedBonus: boolean;
  /** Show the question text/image on phones too (not only on the TV). */
  showQuestionOnPhones: boolean;
  /** Phones show ✓/✗, points and rank after each reveal. */
  phoneFeedback: boolean;
  /** Show how everyone voted at reveal. */
  showVotes: boolean;
  /** Show the leaderboard every N questions. 0 = only at the end. */
  leaderboardEvery: number;
  /** On join, ask "are you one of the people in this game?". */
  askPersonOnJoin: boolean;
  /** Allow joining after the game started. */
  lateJoin: boolean;
  /** Decorative portraits peeking into the TV lobby. */
  lobbyPeek: boolean;
}

export interface GameDoc {
  title: string;
  tagline: string;
  emoji: string;
  cover: string | null;
  accent: Accent;
  people: Person[];
  questions: Question[];
  settings: GameSettings;
}

export type GameRecordStatus = "draft" | "published" | "archived";

export interface GameSummary {
  id: string;
  title: string;
  emoji: string;
  cover: string | null;
  accent: Accent;
  status: GameRecordStatus;
  questionCount: number;
  peopleCount: number;
  updatedAt: string;
  sessionCount: number;
}

export interface GameRecord {
  id: string;
  status: GameRecordStatus;
  version: number;
  doc: GameDoc;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Live sessions
// ---------------------------------------------------------------------------

/** What every round shows (no answers). Snapshotted when a session is created. */
export interface RoundQuestion {
  type: QuestionType;
  prompt: string;
  image: string | null;
  /** Materialized options (people become options for who/poll-people). */
  options: ChoiceOption[];
  /** True when options are the game's people. */
  peopleOptions: boolean;
  note: string;
}

/** The secret part of a round. Never sent to a browser before reveal. */
export interface RoundAnswerKey {
  correct: string[];
  accepted: string[];
  numberAnswer: number | null;
  pollScoring: "none" | "majority";
}

/** Settings snapshotted into a session (a running game ignores later edits). */
export interface SessionConfig {
  title: string;
  tagline: string;
  emoji: string;
  accent: Accent;
  people: Person[];
  settings: GameSettings;
}

export type AnswerValue = { option: string } | { text: string } | { number: number };

/** Raw DB snapshot (server only — contains token hashes and answer keys). */
export interface Snapshot {
  now: string;
  session: {
    id: string;
    code: string;
    status: GameStatus;
    current_index: number;
    total_questions: number;
    host_token_hash: string;
    game_id: string | null;
    config: SessionConfig;
    created_at: string;
  };
  players: { id: string; display_name: string; person_id: string | null; token_hash: string | null }[];
  rounds: {
    id: string;
    round_index: number;
    question: RoundQuestion;
    answer_key: RoundAnswerKey;
    about_person_id: string | null;
    time_limit: number;
    points: number;
    status: "OPEN" | "REVEALED";
    opened_at: string | null;
    eligible_count: number | null;
  }[];
  answers: { round_id: string; player_id: string; value: AnswerValue; created_at: string }[];
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  /** Set only if this player is one of the game's people (used for the winner portrait). */
  personId: string | null;
  score: number;
  /** Points earned in the most recent revealed round. */
  gained: number;
  rank: number;
}

export interface HostPlayer {
  playerId: string;
  name: string;
  personId: string | null;
  active: boolean;
}

/** Timer info. Clients compute the remaining time with their clock offset to serverNow. */
export interface RoundTimer {
  limit: number;
  deadline: string;
}

export interface RevealSummary {
  index: number;
  question: RoundQuestion;
  aboutPersonId: string | null;
  answeredCount: number;
  eligibleCount: number;
  correctCount: number;
  /** Whether this round has a right answer (polls without scoring do not). */
  scored: boolean;
  /** Option ids that are "the answer" (correct options, or the poll winners). */
  winningOptionIds: string[];
  /** Option votes, in option order (choice-like questions). */
  votes: { optionId: string; count: number }[];
  /** text questions: accepted answers + the most common submissions. */
  accepted: string[];
  topTexts: { text: string; count: number; correct: boolean }[];
  /** number questions. */
  numberAnswer: number | null;
  closest: { playerId: string; name: string; value: number }[];
  numberAverage: number | null;
}

/** What the TV/host browser receives. Never contains the answer before reveal. */
export interface HostView {
  role: "host";
  serverNow: string;
  sessionId: string;
  code: string;
  status: GameStatus;
  config: SessionConfig;
  currentIndex: number;
  totalQuestions: number;
  isLastQuestion: boolean;
  /** After this reveal, show the leaderboard before the next question. */
  leaderboardDue: boolean;
  players: HostPlayer[];
  question: {
    index: number;
    question: RoundQuestion;
    answeredCount: number;
    eligibleCount: number;
    timer: RoundTimer | null;
    points: number;
  } | null;
  reveal: RevealSummary | null;
  leaderboard: LeaderboardEntry[];
  /** Images of the next rounds, so the TV can preload them. */
  upcomingImages: string[];
}

/** What a guest phone receives. Never contains answers before reveal. */
export interface GuestView {
  role: "guest";
  serverNow: string;
  sessionId: string;
  code: string;
  status: GameStatus;
  title: string;
  emoji: string;
  accent: Accent;
  currentIndex: number;
  totalQuestions: number;
  /** personId is set only if this player is linked to one of the game's people. */
  me: { playerId: string; name: string; personId: string | null };
  question: {
    index: number;
    type: QuestionType;
    /** Empty when the game hides questions on phones. */
    prompt: string;
    image: string | null;
    options: ChoiceOption[];
    peopleOptions: boolean;
    isExcluded: boolean;
    submitted: boolean;
    timer: RoundTimer | null;
  } | null;
  /** Only when the game enables phone feedback. */
  feedback: {
    index: number;
    /** The question was about this player, so they sat it out. */
    excluded: boolean;
    answered: boolean;
    correct: boolean | null;
    gained: number;
    score: number;
    rank: number;
    playerCount: number;
  } | null;
}
