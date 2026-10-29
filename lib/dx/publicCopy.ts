import type { DxDoc } from "@/lib/dx/doc";
import type { GameConfig } from "@/lib/dx/types/config";

/**
 * A public, group-neutral copy of a private hidden-role game (e.g. the
 * group's «المقيم السري» → «المهرب السري»), for any group to play.
 *
 * Kept exactly (so the gameplay is identical): factions, every role with its
 * id, team, knowledge and permissions, the role distribution per player
 * count, cards and deck, tracks, boards, mechanics, rules and rule text.
 *
 * Removed: every uploaded image (photos of the group: role portraits, card
 * art, board art, logo…) and every role name that isn't part of the game's
 * theme. Roles that rules refer to (the hidden leader) keep their name;
 * every other role becomes "<team word> <n>" (e.g. «مواطن ١»), and role
 * cards take the name of the role they belong to. Any leftover occurrence of
 * a removed name anywhere in the texts is replaced too, and reported.
 *
 * The private game is never modified: this returns a new document.
 */
export function publicCopy(source: DxDoc, title: string): { doc: DxDoc; removedNames: string[] } {
  const config = structuredClone(source.config) as GameConfig;
  stripImages(config);

  const keepName = new Set(config.rules.map((r) => r.params?.roleId).filter((id): id is string => !!id));
  const label = new Map(config.factions.map((f) => [f.id, (f.membershipLabel || f.name || "لاعب").trim()]));
  const counter = new Map<string, number>();
  const removed = new Map<string, string>();
  for (const role of config.roles) {
    if (keepName.has(role.id)) continue;
    const n = (counter.get(role.factionId) ?? 0) + 1;
    counter.set(role.factionId, n);
    const name = `${label.get(role.factionId) ?? "لاعب"} ${toArabicDigits(n)}`;
    const old = role.name.trim();
    if (old && old !== name && !removed.has(old)) removed.set(old, name);
    role.name = name;
  }

  // Role cards carry the name of their role (several roles may share a card: the first one wins).
  const cardRole = new Map<string, string>();
  for (const role of config.roles) if (role.cardId && !cardRole.has(role.cardId)) cardRole.set(role.cardId, role.name);
  for (const card of config.cards) {
    if (card.type !== "role") continue;
    card.name = cardRole.get(card.id) ?? "بطاقة دور";
  }
  config.mechanics.randomNames = [];

  config.identity.name = title;
  config.presetName = title;
  config.id = `${config.id}_public`.slice(0, 64);
  config.updatedAt = Date.now();

  replaceLeftovers(config, removed);
  return {
    doc: { kind: "deduction", title, emoji: source.emoji, accent: source.accent, cover: null, config, assets: [] },
    removedNames: [...removed.keys()],
  };
}

function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

/** Deletes every reference to an uploaded image (ImageRef.assetId), wherever it sits. */
function stripImages(node: unknown) {
  if (Array.isArray(node)) {
    for (const item of node) stripImages(item);
  } else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if ("assetId" in o) delete o.assetId;
    for (const v of Object.values(o)) stripImages(v);
  }
}

/** Replaces removed names left in any text (descriptions, rules…) with their neutral name. */
function replaceLeftovers(config: GameConfig, removed: Map<string, string>) {
  // Whole words only (a name inside a longer word stays), longest names first.
  const patterns = [...removed.keys()]
    .filter((n) => [...n].length >= 2)
    .sort((a, b) => b.length - a.length)
    .map((n) => ({ re: new RegExp(`(?<![\p{L}\p{M}])${escapeRe(n)}(?![\p{L}\p{M}])`, "gu"), to: removed.get(n)! }));
  const visit = (node: unknown): unknown => {
    if (typeof node === "string") return patterns.reduce((s, p) => s.replace(p.re, p.to), node);
    if (Array.isArray(node)) return node.map(visit);
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        // Ids are never names.
        if (k === "id" || k.endsWith("Id") || k.endsWith("Ids")) continue;
        (node as Record<string, unknown>)[k] = visit(v);
      }
    }
    return node;
  };
  visit(config);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
