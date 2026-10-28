/**
 * Mafia: the fixed rules of the game (approved role table, phase lengths,
 * role names). Shared by the server engine and the screens.
 */

export type Role = "mafia" | "detective" | "doctor" | "citizen";
export type Team = "mafia" | "citizens";

export const ROLES: Role[] = ["mafia", "detective", "doctor", "citizen"];

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;

/** Mafia members per player count. Always exactly one detective and one doctor; the rest are citizens. */
const MAFIA_BY_COUNT: Record<number, number> = { 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 2, 11: 3, 12: 3 };

export function roleCounts(playerCount: number): Record<Role, number> | null {
  const mafia = MAFIA_BY_COUNT[playerCount];
  if (!mafia) return null;
  return { mafia, detective: 1, doctor: 1, citizen: playerCount - mafia - 2 };
}

export const teamOf = (role: Role): Team => (role === "mafia" ? "mafia" : "citizens");

/** Phase lengths in seconds. null = no timer (game over). */
export const SECONDS = {
  /** The opening sequence: exactly 10 seconds, on the server clock. */
  intro: 10,
  roleReveal: 60,
  nightfall: 7,
  mafia: 30,
  detective: 30,
  doctor: 30,
  dawnKilled: 17,
  dawnSaved: 15,
  dawnQuiet: 11,
  discussion: 90,
  voting: 30,
  verdictEliminated: 15,
  verdictNone: 10,
} as const;

/**
 * A night phase (and the role reveal) closes early once everyone who acts in
 * it has acted and nobody changed their mind for this long.
 */
export const SETTLE_MS = 5000;

/** `article`: the form used after «كان» (كان قاتل، كان الشايب، كان مواطن). */
export const ROLE_INFO: Record<Role, { name: string; article: string; team: string; tagline: string; goal: string }> = {
  mafia: {
    name: "القاتل",
    article: "قاتل",
    team: "المافيا",
    tagline: "كل ليلة تختارون ضحية… وبالنهار تمثّل البراءة.",
    goal: "تفوزون إذا صار عددكم يساوي أو أكثر من الباقين.",
  },
  detective: {
    name: "الشايب",
    article: "الشايب",
    team: "المدينة",
    tagline: "كل ليلة تحقق مع شخص وتعرف دوره بالضبط.",
    goal: "ساعد المدينة تطلّع كل القتلة.",
  },
  doctor: {
    name: "الطبيب",
    article: "الطبيب",
    team: "المدينة",
    tagline: "كل ليلة تحمي شخص من القتل. تقدر تحمي نفسك.",
    goal: "ما تقدر تحمي نفس الشخص مرتين في اللعبة كلها.",
  },
  citizen: {
    name: "المواطن",
    article: "مواطن",
    team: "المدينة",
    tagline: "ما عندك قوة بالليل… سلاحك عقلك وصوتك بالنهار.",
    goal: "اكشفوا القتلة وطلّعوهم بالتصويت.",
  },
};

export const TEAM_NAME: Record<Team, string> = { mafia: "المافيا", citizens: "المدينة" };
