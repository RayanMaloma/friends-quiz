/**
 * What each device may see of a «انقطاع الاتصال» room.
 *
 * - The TV (host): the station's public state — time, power, reactor, cooling,
 *   O₂, security, active faults and their countdowns, progress, who is
 *   connected and who is in a blackout. Never a code, a cipher key, the
 *   leaking section, a diagnosis, the backup generator's heat or the signal.
 * - A phone: the public header plus the data of the panels its player holds
 *   right now, and nothing of the others. Comms sees the messages, the
 *   monitor sees the sensors, maintenance sees fault codes, etc.
 * Every number comes from the one server-side simulation, so all screens
 * show the same state.
 */
import type { Snapshot } from "@/lib/types";
import {
  ALLOC_MAX,
  ALLOC_STEP,
  breachLoss,
  delivered,
  DEVICE_NAMES,
  DEVICES,
  DOORS,
  efficiency,
  flow,
  linked,
  need,
  NEED,
  o2Production,
  O2_LOW,
  O2_WARN,
  pressureReading,
  PROCEDURE_NAMES,
  PROCEDURES,
  reactorCooling,
  REACTOR_CRITICAL,
  REACTOR_WARN,
  reserved,
  SCRUBBER_WINDOW,
  SECTIONS,
  securityUp,
  commsUp,
  supply,
  SYSTEMS,
  VALVES,
  type DeviceId,
  type DoorId,
  type LogEntry,
  type Part,
  type Procedure,
  type SectionId,
  type Sim,
  type SysId,
  type ValveId,
} from "./sim";
import {
  activeMs,
  blackoutOf,
  LEVELS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  onlineIds,
  type Difficulty,
  type OutageDoc,
  type OutageGame,
  type OutageSettings,
  type RosterEntry,
  type ScoreCard,
} from "./engine";
import { MISSIONS, type Ctx, type MissionId } from "./missions";
import { panelsOf, titleOf, type PanelId } from "./roles";

/** game_sessions.config of a room. */
export interface OutageSessionConfig {
  kind: "outage";
  title: string;
  emoji: string;
  accent: "sky";
  /** Nobody joins a running mission (a released player can come back by name). */
  settings: { lateJoin: false; askPersonOnJoin: false };
  people: [];
}

export type OutageStatus = "LOBBY" | "PLAYING" | "FINISHED";
export type Level3 = "ok" | "warn" | "danger";

export interface FaultCard {
  id: MissionId;
  title: string;
  goal: string;
  /** Seconds until it turns fatal at the current trend (null = under control / no deadline). */
  eta: number | null;
  /** Seconds since it started. */
  age: number;
  /** Stable for this many of the required seconds. */
  held: number;
  hold: number;
}

export interface Clock {
  /** Seconds left. */
  left: number;
  total: number;
  /** Server epoch ms at which the clock reaches 0 (null while frozen or over). */
  endsAt: number | null;
}

export interface CrewMember {
  id: string;
  name: string;
  online: boolean;
  roles: { name: string; icon: string }[];
  /** Seconds left in their blackout, null if none. */
  blackout: number | null;
}

export interface PublicGame {
  matchId: string;
  difficulty: Difficulty;
  paused: boolean;
  held: boolean;
  outcome: "success" | "failed" | "aborted" | null;
  reason: string | null;
  clock: Clock;
  faults: FaultCard[];
  progress: { done: number; total: number };
  crew: CrewMember[];
  score: ScoreCard | null;
  /** Results: every mission and when it ended. */
  missions: { id: MissionId; title: string; status: "waiting" | "active" | "done" }[];
}

export interface TvGame extends PublicGame {
  station: {
    power: { pct: number; level: Level3 };
    reactor: { temp: number; level: Level3 };
    cooling: { state: "running" | "stopped" | "fault"; level: Level3 };
    o2: { pct: number; level: Level3 };
    security: { state: "stable" | "lockdown" | "down" | "breach"; level: Level3 };
  };
  /** The most urgent problem, if any. */
  alert: { text: string; level: Level3 } | null;
}

/* Panels as each phone sees them. */

export interface BreakersPanel {
  main: "on" | "off" | "fault";
  mainCap: number;
  backup: "on" | "off" | "fault";
  supply: number;
  breakers: Record<SysId, boolean>;
  /** The system gets all it needs. */
  powered: Record<SysId, boolean>;
}

export interface GridPanel {
  supply: number;
  free: number;
  alloc: Record<SysId, number>;
  need: Record<SysId, number>;
  delivered: Record<SysId, number>;
  breakers: Record<SysId, boolean>;
  max: Record<SysId, number>;
  step: number;
}

export interface CoolingPanel {
  temp: number;
  /** °C per second, negative = cooling down. */
  trend: number;
  pump: "on" | "off" | "fault";
  power: number;
  coolant: number;
  loops: { reactor: boolean; gen: boolean };
  flow: number;
  powered: boolean;
  isolated: boolean;
}

export interface DoorsPanel {
  up: boolean;
  down: string | null;
  lockdown: boolean;
  doors: Record<DoorId, { open: boolean; locked: boolean; lost: boolean }>;
  overrideLocked: boolean;
  keypadWait: number;
}

export interface ValvesPanel {
  lockdown: boolean;
  valves: Record<ValveId, { open: boolean; lost: boolean }>;
  /** Section doors (to know what purge needs). */
  sectionDoors: Record<SectionId, boolean>;
}

export interface CommsMessage {
  id: string;
  sig: string;
  label: string;
  digits: string;
  cipher: boolean;
  decoded: { key: number; digits: string } | null;
  text: string | null;
  age: number;
}

export interface CommsPanel {
  up: boolean;
  linked: boolean;
  freq: number;
  messages: CommsMessage[];
  /** Command asked for the confirmation code. */
  handshake: boolean;
  confirmed: boolean;
}

export interface MonitorPanel {
  reactor: { temp: number; trend: number };
  coolant: number;
  flow: number;
  backupHeat: number;
  backup: "on" | "off" | "fault";
  o2: { pct: number; trend: number };
  pressure: Record<SectionId, number>;
  calibrating: SectionId | null;
  peak: number;
  sig: string;
  key: number | null;
  handshake: string | null;
  /** Second half of a split code (hard). */
  codeHalf: string | null;
  diagnoses: { device: DeviceId; name: string; code: string; fix: string }[];
  warnings: string[];
  log: LogEntry[];
}

export interface MaintPanel {
  faults: { device: DeviceId; name: string; code: string; fix: string | null }[];
  parts: Record<Part, number>;
  store: boolean;
  job: { device: DeviceId; name: string; procedure: Procedure; left: number; total: number } | null;
  procedures: { id: Procedure; name: string }[];
  coolant: number;
  pump: "on" | "off";
  scrubber: "running" | "stopped";
  /** Seconds left to restart the scrubber after its breaker closed (null = not now). */
  scrubberWindow: number | null;
}

export interface PanelData {
  breakers?: BreakersPanel;
  grid?: GridPanel;
  cooling?: CoolingPanel;
  doors?: DoorsPanel;
  valves?: ValvesPanel;
  comms?: CommsPanel;
  monitor?: MonitorPanel;
  maint?: MaintPanel;
}

export interface PhoneGame extends PublicGame {
  panels: PanelId[];
  specialty: { name: string; icon: string }[];
  data: PanelData;
  /** Seconds left of my own blackout (don't talk), null if none. */
  blackout: number | null;
}

interface BaseView {
  kind: "outage";
  serverNow: string;
  sessionId: string;
  code: string;
  status: OutageStatus;
  version: number;
  settings: OutageSettings;
  limits: { minPlayers: number; maxPlayers: number };
  levels: Record<Difficulty, { missions: number; minutes: number }>;
  lobby: { id: string; name: string; active: boolean }[];
}

export interface OutageHostView extends BaseView {
  role: "host";
  game: TvGame | null;
}

export interface OutageGuestView extends BaseView {
  role: "guest";
  me: { playerId: string; name: string };
  seated: boolean;
  game: PhoneGame | null;
}

/* ------------------------------------------------------------------ */

export function outageDocOf(snapshot: Snapshot): OutageDoc | null {
  const m = snapshot.session.match;
  return m && typeof m === "object" && (m as OutageDoc).kind === "outage" && (m as OutageDoc).v === 1 ? (m as OutageDoc) : null;
}

export const rosterOf = (snapshot: Snapshot): RosterEntry[] =>
  snapshot.players.map((p) => ({ id: p.id, name: p.display_name, active: p.token_hash !== null }));

/** Cooling at full pump power + life + comms + security. */
const FULL_LOAD = ALLOC_MAX.cooling + NEED.life + NEED.comms + NEED.security;

const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
const ctxOf = (g: OutageGame): Ctx => {
  const l = LEVELS[g.difficulty];
  return { ph: l.ph, cipher: l.cipher, window: l.window, backupWarm: l.backupWarm };
};

function clockOf(g: OutageGame, now: number): Clock {
  const left = Math.max(0, g.totalTicks - g.sim.t);
  const running = !g.outcome && !g.paused && !g.held;
  // Fractional part of the current second, so screens count down smoothly.
  const remainingMs = g.totalTicks * 1000 - activeMs(g, now);
  return { left, total: g.totalTicks, endsAt: running ? now + Math.max(0, remainingMs) : null };
}

const reactorTrend = (s: Sim, g: OutageGame) => round(LEVELS[g.difficulty].ph.heat - reactorCooling(s), 2);
const o2Trend = (s: Sim, g: OutageGame) => {
  const ph = LEVELS[g.difficulty].ph;
  return round(o2Production(s) - ph.o2Use - SECTIONS.reduce((n, id) => n + breachLoss(s, id, ph.leak), 0), 2);
};

function faultsOf(g: OutageGame): FaultCard[] {
  const ctx = ctxOf(g);
  const s = g.sim;
  return g.missions
    .filter((m) => m.status === "active")
    .map((m) => {
      const def = MISSIONS[m.id];
      const age = s.t - (m.startTick ?? s.t);
      return { id: m.id, title: def.title, goal: def.goal, eta: def.eta?.(s, m.params, ctx, age) ?? null, age, held: m.held, hold: def.hold };
    })
    .sort((a, b) => (a.eta ?? 1e9) - (b.eta ?? 1e9));
}

function crewOf(g: OutageGame, roster: readonly RosterEntry[], now: number): CrewMember[] {
  const online = onlineIds(g, roster, now);
  return g.players.map((p) => {
    const b = blackoutOf(g, p.id);
    return { id: p.id, name: p.name, online: online.has(p.id), roles: titleOf(panelsOf(g.assignment, p.id)), blackout: b ? b.to - g.sim.t : null };
  });
}

function publicGame(g: OutageGame, roster: readonly RosterEntry[], now: number): PublicGame {
  return {
    matchId: g.id,
    difficulty: g.difficulty,
    paused: g.paused,
    held: g.held,
    outcome: g.outcome,
    reason: g.reason,
    clock: clockOf(g, now),
    faults: g.outcome ? [] : faultsOf(g),
    progress: { done: g.missions.filter((m) => m.status === "done").length, total: g.missions.length },
    crew: crewOf(g, roster, now),
    score: g.score,
    missions: g.missions.map((m) => ({ id: m.id, title: MISSIONS[m.id].title, status: m.status })),
  };
}

/* ------------------------------------------------------------------ */
/* TV                                                                  */
/* ------------------------------------------------------------------ */

function station(g: OutageGame): TvGame["station"] {
  const s = g.sim;
  // Supply against what the whole station needs at full load.
  const pct = Math.min(100, Math.round((supply(s) / FULL_LOAD) * 100));
  const temp = Math.round(s.reactor.temp);
  const cooling = s.faults.pump ? "fault" : s.cooling.pump === "on" && flow(s) > 0 ? "running" : "stopped";
  const o2 = Math.round(s.life.o2);
  const breach = SECTIONS.some((id) => s.sections[id].breach);
  const secState = s.lockdown ? "lockdown" : !securityUp(s) ? "down" : breach ? "breach" : "stable";
  return {
    power: { pct, level: pct >= 70 ? "ok" : pct >= 40 ? "warn" : "danger" },
    reactor: { temp, level: temp >= REACTOR_CRITICAL ? "danger" : temp >= REACTOR_WARN - 15 ? "warn" : "ok" },
    cooling: { state: cooling, level: cooling === "running" ? "ok" : cooling === "fault" ? "danger" : "warn" },
    o2: { pct: o2, level: o2 < O2_LOW ? "danger" : o2 < 60 ? "warn" : "ok" },
    security: { state: secState, level: secState === "stable" ? "ok" : secState === "breach" || secState === "lockdown" ? "danger" : "warn" },
  };
}

/** A station-wide emergency only: fault titles already have their own cards (no repetition). */
function alertOf(g: OutageGame): TvGame["alert"] {
  const s = g.sim;
  if (s.reactor.temp >= REACTOR_CRITICAL) return { text: "المفاعل في المنطقة الحرجة", level: "danger" };
  if (s.life.o2 < O2_WARN) return { text: "الأكسجين ينفد", level: "danger" };
  if (supply(s) <= 0) return { text: "انقطاع كامل للطاقة", level: "danger" };
  return null;
}

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

const bySys = <T>(f: (k: SysId) => T) => Object.fromEntries(SYSTEMS.map((k) => [k, f(k)])) as Record<SysId, T>;

function breakersPanel(s: Sim): BreakersPanel {
  return {
    main: s.power.main,
    mainCap: s.power.mainCap,
    backup: s.power.backup,
    supply: supply(s),
    breakers: { ...s.power.breakers },
    powered: bySys((k) => s.power.breakers[k] && efficiency(s, k) >= 0.999),
  };
}

function gridPanel(s: Sim): GridPanel {
  return {
    supply: supply(s),
    free: supply(s) - reserved(s),
    alloc: { ...s.power.alloc },
    need: bySys((k) => round(need(s, k))),
    delivered: bySys((k) => round(delivered(s, k))),
    breakers: { ...s.power.breakers },
    max: { ...ALLOC_MAX },
    step: ALLOC_STEP,
  };
}

function coolingPanel(s: Sim, g: OutageGame): CoolingPanel {
  return {
    temp: round(s.reactor.temp, 1),
    trend: reactorTrend(s, g),
    pump: s.faults.pump ? "fault" : s.cooling.pump,
    power: s.cooling.power,
    coolant: Math.round(s.cooling.coolant),
    loops: { ...s.cooling.valves },
    flow: round(flow(s), 2),
    powered: s.power.breakers.cooling && delivered(s, "cooling") > 0,
    isolated: !s.valves.coolant,
  };
}

function doorsPanel(s: Sim): DoorsPanel {
  const lost = (d: DoorId) => d !== "gate" && d !== "store" && s.sections[d].lost;
  return {
    up: securityUp(s),
    down: securityUp(s) ? null : s.faults.controller ? "وحدة التحكم معطلة" : "بلا طاقة",
    lockdown: s.lockdown,
    doors: Object.fromEntries(DOORS.map((d) => [d, { open: s.doors[d], locked: !!s.locks[d], lost: lost(d) }])) as DoorsPanel["doors"],
    overrideLocked: !!s.locks.override,
    keypadWait: Math.max(0, s.wrong.until - s.t),
  };
}

function valvesPanel(s: Sim): ValvesPanel {
  const lost = (v: ValveId) => v !== "coolant" && v !== "fuel" && s.sections[v].lost;
  return {
    lockdown: s.lockdown,
    valves: Object.fromEntries(VALVES.map((v) => [v, { open: s.valves[v], lost: lost(v) }])) as ValvesPanel["valves"],
    sectionDoors: { A: s.doors.A, B: s.doors.B, C: s.doors.C },
  };
}

function commsPanel(s: Sim): CommsPanel {
  return {
    up: commsUp(s),
    linked: linked(s),
    freq: s.comms.freq,
    messages: s.messages
      .filter((m) => m.got !== null)
      .map((m) => ({ id: m.id, sig: m.sig, label: m.label, digits: m.digits, cipher: m.cipher, decoded: m.decoded, text: m.text ?? null, age: s.t - (m.got ?? s.t) }))
      .reverse(),
    handshake: s.comms.handshake !== null,
    confirmed: s.comms.confirmed,
  };
}

function warningsOf(s: Sim, g: OutageGame): string[] {
  const w: string[] = [];
  if (s.power.backupHeat >= 65) w.push(`المولد الاحتياطي ${Math.round(s.power.backupHeat)}°`);
  for (const id of SECTIONS) if (!s.sections[id].lost && pressureReading(s, id) < 90) w.push(`ضغط القسم ${id} ينخفض`);
  const rt = reactorTrend(s, g);
  if (rt > 0 && s.reactor.temp > 80) w.push("المفاعل يسخن");
  if (o2Trend(s, g) < 0 && s.life.o2 < 80) w.push("الأكسجين يقل");
  if (reserved(s) > supply(s) || SYSTEMS.some((k) => s.power.breakers[k] && delivered(s, k) < s.power.alloc[k] - 0.01)) w.push("حمل زائد على الطاقة");
  if (s.comms.freq !== s.comms.peak && !s.faults.relay) w.push("الاتصالات خارج النطاق");
  if (s.cooling.coolant < 25) w.push("سائل التبريد منخفض");
  return w;
}

function monitorPanel(s: Sim, g: OutageGame): MonitorPanel {
  const sec = g.missions.find((m) => m.id === "security" && m.status === "active");
  return {
    reactor: { temp: round(s.reactor.temp, 1), trend: reactorTrend(s, g) },
    coolant: Math.round(s.cooling.coolant),
    flow: round(flow(s), 2),
    backupHeat: Math.round(s.power.backupHeat),
    backup: s.power.backup,
    o2: { pct: round(s.life.o2, 1), trend: o2Trend(s, g) },
    pressure: { A: pressureReading(s, "A"), B: pressureReading(s, "B"), C: pressureReading(s, "C") },
    calibrating: s.calibrating?.section ?? null,
    peak: s.comms.peak,
    sig: s.comms.sig,
    key: LEVELS[g.difficulty].cipher ? s.comms.key : null,
    handshake: s.comms.handshake,
    codeHalf: sec?.params.split && s.lockdown ? sec.params.code.slice(2) : null,
    diagnoses: DEVICES.filter((d) => s.faults[d]).map((d) => ({ device: d, name: DEVICE_NAMES[d], code: s.faults[d]!.code, fix: PROCEDURE_NAMES[s.faults[d]!.fix] })),
    warnings: warningsOf(s, g),
    log: s.log.slice(-12).reverse(),
  };
}

function maintPanel(s: Sim, g: OutageGame): MaintPanel {
  const showFix = LEVELS[g.difficulty].ph.diagnosisForMaintenance;
  const win = s.life.scrubber === "stopped" && s.power.breakers.life && s.power.lifeOnAt !== null ? SCRUBBER_WINDOW - (s.t - s.power.lifeOnAt) : null;
  return {
    faults: DEVICES.filter((d) => s.faults[d]).map((d) => ({ device: d, name: DEVICE_NAMES[d], code: s.faults[d]!.code, fix: showFix ? PROCEDURE_NAMES[s.faults[d]!.fix] : null })),
    parts: { ...s.parts },
    store: s.doors.store,
    job: s.job ? { device: s.job.device, name: DEVICE_NAMES[s.job.device], procedure: s.job.procedure, left: s.job.left, total: s.job.total } : null,
    procedures: PROCEDURES.map((id) => ({ id, name: PROCEDURE_NAMES[id] })),
    coolant: Math.round(s.cooling.coolant),
    pump: s.cooling.pump,
    scrubber: s.life.scrubber,
    scrubberWindow: win !== null && win >= 0 ? win : null,
  };
}

function panelData(g: OutageGame, panels: readonly PanelId[]): PanelData {
  const s = g.sim;
  const d: PanelData = {};
  for (const p of panels) {
    if (p === "breakers") d.breakers = breakersPanel(s);
    else if (p === "grid") d.grid = gridPanel(s);
    else if (p === "cooling") d.cooling = coolingPanel(s, g);
    else if (p === "doors") d.doors = doorsPanel(s);
    else if (p === "valves") d.valves = valvesPanel(s);
    else if (p === "comms") d.comms = commsPanel(s);
    else if (p === "monitor") d.monitor = monitorPanel(s, g);
    else if (p === "maint") d.maint = maintPanel(s, g);
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function base(snapshot: Snapshot, doc: OutageDoc): BaseView {
  const s = snapshot.session;
  return {
    kind: "outage",
    serverNow: snapshot.now,
    sessionId: s.id,
    code: s.code,
    status: (s.status === "LOBBY" || s.status === "FINISHED" ? s.status : "PLAYING") as OutageStatus,
    version: s.match_version ?? 0,
    settings: doc.settings,
    limits: { minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS },
    levels: {
      easy: { missions: LEVELS.easy.missions, minutes: LEVELS.easy.seconds / 60 },
      medium: { missions: LEVELS.medium.missions, minutes: LEVELS.medium.seconds / 60 },
      hard: { missions: LEVELS.hard.missions, minutes: LEVELS.hard.seconds / 60 },
    },
    lobby: snapshot.players.map((p) => ({ id: p.id, name: p.display_name, active: p.token_hash !== null })),
  };
}

/** `doc` is the state after `advance`. */
export function buildOutageHostView(snapshot: Snapshot, doc: OutageDoc): OutageHostView {
  const now = Date.parse(snapshot.now);
  const g = doc.game;
  let game: TvGame | null = null;
  if (g) {
    const pub = publicGame(g, rosterOf(snapshot), now);
    const st = station(g);
    game = { ...pub, station: st, alert: g.outcome ? null : alertOf(g) };
  }
  return { ...base(snapshot, doc), role: "host", game };
}

export function buildOutageGuestView(snapshot: Snapshot, doc: OutageDoc, playerId: string): OutageGuestView | null {
  const player = snapshot.players.find((p) => p.id === playerId);
  if (!player) return null;
  const now = Date.parse(snapshot.now);
  const g = doc.game;
  const seated = !!g?.players.some((p) => p.id === playerId);
  let game: PhoneGame | null = null;
  if (g && seated) {
    const panels = g.outcome ? [] : panelsOf(g.assignment, playerId);
    const mine = blackoutOf(g, playerId);
    game = {
      ...publicGame(g, rosterOf(snapshot), now),
      panels,
      specialty: titleOf(panelsOf(g.assignment, playerId)),
      data: panelData(g, panels),
      blackout: mine ? mine.to - g.sim.t : null,
    };
  } else if (g) {
    game = { ...publicGame(g, rosterOf(snapshot), now), panels: [], specialty: [], data: {}, blackout: null };
  }
  return { ...base(snapshot, doc), role: "guest", me: { playerId, name: player.display_name }, seated, game };
}

