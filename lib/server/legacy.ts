import "server-only";
import peopleJson from "@/data/people.json";
import factsJson from "@/data/facts.json";
import type { GameDoc } from "@/lib/types";
import { DEFAULT_SETTINGS, normalizeGameDoc } from "@/lib/game/doc";

/**
 * The original single game ("عن مين؟" with the friends' facts), turned into a
 * platform game so nothing is lost. Offered once from the dashboard.
 */
export function legacyGameDoc(): GameDoc {
  const people = (peopleJson as { id: string; name: string; image: string }[]).map((p) => ({
    id: p.id,
    name: p.name,
    image: p.image,
  }));
  const questions = (factsJson as { id: string; personId: string; text: string }[]).map((f) => ({
    id: f.id,
    type: "who",
    prompt: f.text,
    correct: [f.personId],
    aboutPersonId: f.personId,
  }));
  return normalizeGameDoc({
    title: "عن مين؟",
    tagline: "معلومات عن الشلة… خمّن كل وحدة عن مين 🤔",
    emoji: "🤫",
    accent: "sun",
    people,
    questions,
    settings: {
      ...DEFAULT_SETTINGS,
      timeLimit: 0,
      autoReveal: false,
      points: 1,
      speedBonus: false,
      phoneFeedback: false,
      leaderboardEvery: 1,
    },
  });
}
