import type { Accent } from "@/lib/types";

/**
 * The game catalog, as the browser sees it.
 *
 * A *game definition* is shared: the built-in games' rules (Mafia, «اخترع
 * إجابتك», the drawing game, the court), or a game authored in the dashboard (`games` row). Only the super
 * admin edits definitions or their visibility. A *game session* (room) is one
 * instance a signed-in user creates from a definition, with its own settings
 * (and, for «اخترع إجابتك», its own questions); it never changes the definition.
 */

export type BuiltinKey = "mafia" | "invent" | "invent_ahaji" | "draw" | "court" | "outage";
export type Visibility = "public" | "private";
export type CatalogKind = "mafia" | "invent" | "draw" | "court" | "outage" | "quiz" | "deduction";

export interface CatalogEntry {
  /** A built-in key or a game id. */
  key: string;
  kind: CatalogKind;
  builtin: boolean;
  title: string;
  emoji: string;
  accent: Accent;
  visibility: Visibility;
  /** Authored games: only published ones can be opened by regular users. */
  status: "published" | "draft";
  minPlayers: number | null;
  maxPlayers: number | null;
  /** Quiz games / the «اخترع إجابتك» question bank. */
  questionCount: number | null;
}

export const BUILTINS: Record<BuiltinKey, Omit<CatalogEntry, "visibility">> = {
  mafia: {
    key: "mafia", kind: "mafia", builtin: true, title: "المافيا", emoji: "🌒", accent: "grape",
    status: "published", minPlayers: 4, maxPlayers: 12, questionCount: null,
  },
  invent: {
    key: "invent", kind: "invent", builtin: true, title: "اخترع إجابتك", emoji: "💡", accent: "sun",
    status: "published", minPlayers: 3, maxPlayers: 16, questionCount: 25,
  },
  invent_ahaji: {
    key: "invent_ahaji", kind: "invent", builtin: true, title: "اخترع إجابتك · أحاجي", emoji: "💡", accent: "sun",
    status: "published", minPlayers: 3, maxPlayers: 16, questionCount: 25,
  },
  draw: {
    key: "draw", kind: "draw", builtin: true, title: "وزارة المقيمين للفنون والرسم", emoji: "🎨", accent: "mint",
    status: "published", minPlayers: 3, maxPlayers: 16, questionCount: null,
  },
  court: {
    key: "court", kind: "court", builtin: true, title: "المحكمة", emoji: "⚖️", accent: "orange",
    status: "published", minPlayers: 5, maxPlayers: 12, questionCount: null,
  },
  outage: {
    key: "outage", kind: "outage", builtin: true, title: "انقطاع الاتصال", emoji: "🛰", accent: "sky",
    status: "published", minPlayers: 3, maxPlayers: 8, questionCount: null,
  },
};

export const isBuiltinKey = (v: unknown): v is BuiltinKey => v === "mafia" || v === "invent" || v === "invent_ahaji" || v === "draw" || v === "court" || v === "outage";
