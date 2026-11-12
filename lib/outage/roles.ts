/**
 * «انقطاع الاتصال» — panels, specialties and who may send what.
 *
 * The station is operated through eight panels. A specialty is a set of
 * panels; every player holds one or more panels and the server accepts a
 * command only from the player who currently holds its panel.
 *
 *   breakers  مولدات وقواطع     ┐ مهندس الكهرباء
 *   grid      توزيع الطاقة       ┘ (split in two at 7–8 players)
 *   cooling   التبريد             مهندس التبريد
 *   doors     الأبواب والأقفال    ┐ مسؤول الأمان
 *   valves    صمامات العزل        ┘ (split in two at 8 players)
 *   comms     الاتصالات           مسؤول الاتصالات
 *   monitor   المراقبة            مسؤول المراقبة
 *   maint     الصيانة             مهندس الصيانة
 */
import type { Command } from "./sim";
import { MISSIONS, type MissionId } from "./missions";

export type PanelId = "breakers" | "grid" | "cooling" | "doors" | "valves" | "comms" | "monitor" | "maint";
export const PANELS: readonly PanelId[] = ["breakers", "grid", "cooling", "doors", "valves", "comms", "monitor", "maint"];

export const PANEL_NAMES: Record<PanelId, string> = {
  breakers: "المولدات والقواطع",
  grid: "توزيع الطاقة",
  cooling: "التبريد",
  doors: "الأبواب",
  valves: "الصمامات",
  comms: "الاتصالات",
  monitor: "المراقبة",
  maint: "الصيانة",
};

/** Specialty names, for whoever holds these panels. */
export const SPECIALTIES: { name: string; icon: string; panels: PanelId[] }[] = [
  { name: "الكهرباء", icon: "⚡", panels: ["breakers", "grid"] },
  { name: "التبريد", icon: "❄", panels: ["cooling"] },
  { name: "الأمان", icon: "🛡", panels: ["doors", "valves"] },
  { name: "الاتصالات", icon: "📡", panels: ["comms"] },
  { name: "المراقبة", icon: "📈", panels: ["monitor"] },
  { name: "الصيانة", icon: "🔧", panels: ["maint"] },
];

export const PANEL_ICONS: Record<PanelId, string> = {
  breakers: "⚡",
  grid: "🔀",
  cooling: "❄",
  doors: "🚪",
  valves: "🛡",
  comms: "📡",
  monitor: "📈",
  maint: "🔧",
};

/**
 * Seats for 3–8 players (index = seat). Fewer than six merges specialties,
 * more than six splits electrical and security into independent sub-panels.
 */
export const LAYOUTS: Record<number, PanelId[][]> = {
  3: [["breakers", "grid", "comms"], ["cooling", "doors", "valves"], ["monitor", "maint"]],
  4: [["breakers", "grid"], ["cooling"], ["doors", "valves", "maint"], ["comms", "monitor"]],
  5: [["breakers", "grid"], ["cooling"], ["doors", "valves"], ["comms"], ["monitor", "maint"]],
  6: [["breakers", "grid"], ["cooling"], ["doors", "valves"], ["comms"], ["monitor"], ["maint"]],
  7: [["breakers"], ["grid"], ["cooling"], ["doors", "valves"], ["comms"], ["monitor"], ["maint"]],
  8: [["breakers"], ["grid"], ["cooling"], ["doors"], ["valves"], ["comms"], ["monitor"], ["maint"]],
};

export type Assignment = Record<PanelId, string>;

/** Seat `players` (already in seat order) on the layout for their number. */
export function baseAssignment(players: readonly string[]): Assignment {
  const layout = LAYOUTS[players.length];
  if (!layout) throw new Error(`no layout for ${players.length} players`);
  const a = {} as Assignment;
  layout.forEach((panels, seat) => panels.forEach((p) => (a[p] = players[seat])));
  return a;
}

/** Which panel a command belongs to. */
export function panelOf(c: Command): PanelId {
  switch (c.type) {
    case "main":
    case "backup":
    case "breaker":
      return "breakers";
    case "alloc":
      return "grid";
    case "pump":
    case "pumpPower":
    case "loop":
      return "cooling";
    case "door":
    case "override":
      return "doors";
    case "valve":
    case "purge":
      return "valves";
    case "tune":
    case "decrypt":
    case "handshake":
      return "comms";
    case "calibrate":
      return "monitor";
    case "repair":
    case "scrubber":
    case "refill":
      return "maint";
  }
}

export const panelsOf = (a: Assignment, playerId: string): PanelId[] => PANELS.filter((p) => a[p] === playerId);

/**
 * Redistribute the panels of players who are gone (past the grace period)
 * among those still here: each orphan panel goes to the present player with
 * the fewest panels (seat order breaks ties). Owners who are present keep
 * their panels, and a returning player gets theirs back.
 * Among equally balanced options, it keeps every mission needing two players.
 */
export function redistribute(base: Assignment, seats: readonly string[], present: ReadonlySet<string>): Assignment {
  const here = seats.filter((id) => present.has(id));
  if (here.length === 0 || here.length === seats.length) return { ...base };
  const orphans = PANELS.filter((p) => !present.has(base[p]));
  // Try each rotation of the receivers; keep the first that preserves cooperation.
  let fallback: Assignment | null = null;
  for (let r = 0; r < here.length; r++) {
    const order = [...here.slice(r), ...here.slice(0, r)];
    const a = { ...base };
    const load = new Map(order.map((id) => [id, PANELS.filter((p) => base[p] === id).length]));
    for (const p of orphans) {
      let best = order[0];
      for (const id of order) if (load.get(id)! < load.get(best)!) best = id;
      a[p] = best;
      load.set(best, load.get(best)! + 1);
    }
    fallback ??= a;
    if (here.length < 2 || cooperative(a)) return a;
  }
  return fallback!;
}

/** True when no mission can be solved by one player alone (all its panels on one person). */
export function cooperative(a: Assignment, missions: readonly MissionId[] = Object.keys(MISSIONS) as MissionId[]): boolean {
  return missions.every((m) => new Set(MISSIONS[m].panels.map((p) => a[p])).size >= 2);
}

/** The specialty names a set of panels adds up to (a split specialty is named by its panel). */
export function titleOf(panels: readonly PanelId[]): { name: string; icon: string }[] {
  const out: { name: string; icon: string }[] = [];
  const left = new Set(panels);
  for (const s of SPECIALTIES) {
    if (s.panels.every((p) => left.has(p))) {
      out.push({ name: s.name, icon: s.icon });
      s.panels.forEach((p) => left.delete(p));
    }
  }
  for (const p of PANELS) if (left.has(p)) out.push({ name: PANEL_NAMES[p], icon: PANEL_ICONS[p] });
  return out;
}
