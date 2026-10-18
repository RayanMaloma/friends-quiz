import type { Accent } from "@/lib/types";
import type { Asset, GameConfig } from "@/lib/dx/types/config";
import { validateConfig } from "@/lib/dx/config/validate";
import { classicTemplate, TEMPLATES } from "@/lib/dx/config/templates";
import { validateSetup } from "@/lib/dx/engine/engine";
import { ACCENTS, imageRef } from "@/lib/game/doc";

/**
 * A deduction game as stored in `games.doc` (kind = "deduction").
 * `config` is the whole design; `assets` is its image library (files live in
 * media storage, the doc only keeps their URLs and metadata).
 * title/emoji/accent/cover are copies for the game lists.
 */
export interface DxDoc {
  kind: "deduction";
  title: string;
  emoji: string;
  accent: Accent;
  cover: string | null;
  config: GameConfig;
  assets: Asset[];
}

export const DX_LIMITS = {
  /** Serialized doc size. Images are not inside, so this is generous. */
  docBytes: 1_500_000,
  assets: 400,
} as const;

export function isDxDoc(v: unknown): boolean {
  return !!v && typeof v === "object" && (v as { kind?: unknown }).kind === "deduction";
}

function str(v: unknown, max: number, fallback = ""): string {
  return typeof v === "string" ? v.trim().slice(0, max) : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function normalizeAssets(input: unknown): Asset[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Asset[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    const id = str(a.id, 64);
    const url = imageRef(a.url);
    if (!id || !url || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      url,
      name: str(a.name, 80, "صورة") || "صورة",
      folder: str(a.folder, 40, "عام") || "عام",
      mime: str(a.mime, 40, "image/jpeg"),
      width: num(a.width),
      height: num(a.height),
      bytes: num(a.bytes),
      createdAt: num(a.createdAt, Date.now()),
      updatedAt: num(a.updatedAt, Date.now()),
    });
    if (out.length >= DX_LIMITS.assets) break;
  }
  return out;
}

/**
 * Turns any input into a well-formed DxDoc. Returns errors when the design
 * itself is broken (unknown factions, duplicate ids…) — those saves are refused.
 */
export function normalizeDxDoc(input: unknown): { doc: DxDoc | null; errors: string[] } {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const res = validateConfig(o.config);
  if (!res.config) return { doc: null, errors: res.errors };
  const config = res.config;
  config.identity.name = str(config.identity.name, 60, "لعبة") || "لعبة";
  const doc: DxDoc = {
    kind: "deduction",
    title: config.identity.name,
    emoji: str(o.emoji, 16, "🕵️") || "🕵️",
    accent: ACCENTS.includes(o.accent as Accent) ? (o.accent as Accent) : "grape",
    cover: imageRef(o.cover),
    config,
    assets: normalizeAssets(o.assets),
  };
  if (JSON.stringify(doc).length > DX_LIMITS.docBytes) return { doc: null, errors: ["اللعبة كبيرة جدًا"] };
  return { doc, errors: [] };
}

export function newDxDoc(template: string): DxDoc {
  const config = (TEMPLATES[template] ?? TEMPLATES.classic).make();
  return { kind: "deduction", title: config.identity.name, emoji: "🕵️", accent: "grape", cover: null, config, assets: [] };
}

/** What prevents publishing: player counts that can't actually be dealt, an empty deck… */
export function validateDxDoc(doc: DxDoc): { questionId: null; message: string }[] {
  const { minPlayers, maxPlayers } = doc.config.mechanics;
  const messages = new Set<string>();
  for (let n = minPlayers; n <= Math.min(maxPlayers, minPlayers + 30); n++) {
    for (const e of validateSetup(doc.config, n)) messages.add(e);
  }
  return [...messages].map((message) => ({ questionId: null, message }));
}

export function fallbackDxDoc(): DxDoc {
  const config = classicTemplate();
  return { kind: "deduction", title: config.identity.name, emoji: "🕵️", accent: "grape", cover: null, config, assets: [] };
}
