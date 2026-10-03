export type GameStatus = "LOBBY" | "QUESTION" | "REVEAL" | "LEADERBOARD" | "FINISHED";

export interface Person {
  id: string;
  name: string;
  image: string;
}

export interface Fact {
  id: string;
  personId: string;
  text: string;
}

/** Raw DB snapshot (server only — contains token hashes and fact owners). */
export interface Snapshot {
  session: {
    id: string;
    code: string;
    status: GameStatus;
    current_index: number;
    total_questions: number;
    host_token_hash: string;
  };
  players: { id: string; display_name: string; person_id: string | null; token_hash: string | null }[];
  rounds: {
    id: string;
    round_index: number;
    fact_id: string;
    fact_text: string;
    owner_person_id: string;
    status: "OPEN" | "REVEALED";
    eligible_count: number | null;
  }[];
  answers: { round_id: string; player_id: string; chosen_person_id: string }[];
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  /** Set only if this player is one of the fact owners (used for the winner portrait). */
  personId: string | null;
  score: number;
  rank: number;
}

export interface HostPlayer {
  playerId: string;
  name: string;
  personId: string | null;
  active: boolean;
}

/** What the TV/host browser receives. Never contains the fact owner before reveal. */
export interface HostView {
  role: "host";
  sessionId: string;
  code: string;
  status: GameStatus;
  currentIndex: number;
  totalQuestions: number;
  isLastQuestion: boolean;
  players: HostPlayer[];
  question: {
    index: number;
    factText: string;
    answeredCount: number;
    eligibleCount: number;
  } | null;
  reveal: {
    index: number;
    factText: string;
    ownerPersonId: string;
    correctCount: number;
    answeredCount: number;
    eligibleCount: number;
    distribution: { personId: string; count: number }[];
  } | null;
  leaderboard: LeaderboardEntry[];
}

/** What a guest phone receives. Never contains owners, results, scores or rankings. */
export interface GuestView {
  role: "guest";
  sessionId: string;
  code: string;
  status: GameStatus;
  currentIndex: number;
  totalQuestions: number;
  /** personId is set only if this player is linked to a fact owner. */
  me: { playerId: string; name: string; personId: string | null };
  question: {
    index: number;
    factText: string;
    isOwner: boolean;
    submitted: boolean;
  } | null;
}
