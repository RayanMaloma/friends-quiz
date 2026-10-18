/**
 * Pure query helpers over (config, match state). No React, no DOM.
 */
import type { CardDef, Condition, GameConfig, ID, PowerKind, Role, Rule, RuleKind, Track } from '../types/config';
import type { MatchState, Player } from '../types/match';

export const POWER_LABELS: Record<PowerKind, string> = {
  none: 'بدون صلاحية',
  investigate: 'التحقيق في الولاء',
  peek: 'نظرة على الرزمة',
  specialElection: 'انتخاب خاص',
  execute: 'إعدام',
  custom: 'إجراء مخصص',
};

export const POWER_HELP: Record<PowerKind, string> = {
  none: 'ما يصير شي.',
  investigate: 'القائد يعرف سرًّا فريق لاعب ما انحقق فيه قبل.',
  peek: 'القائد يشوف سرًّا أعلى بطاقات الرزمة بدون ما يغيّر ترتيبها.',
  specialElection: 'القائد يختار أي لاعب ثاني يقود الجولة الجاية؛ بعدها يرجع الترتيب الطبيعي.',
  execute: 'القائد يُخرج لاعب من اللعبة. اللاعب المُخرج ما يصوّت ولا يتكلم ولا يستلم منصب.',
  custom: 'إجراء مخصص مكتوب على الخانة أو البطاقة. الطاولة تنفذه وبعدين تكمل.',
};

export function shuffle<T>(arr: T[], rnd: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const cardById = (c: GameConfig, id?: ID): CardDef | undefined => c.cards.find(x => x.id === id);
export const roleById = (c: GameConfig, id?: ID): Role | undefined => c.roles.find(x => x.id === id);
export const factionById = (c: GameConfig, id?: ID) => c.factions.find(x => x.id === id);
export const trackById = (c: GameConfig, id?: ID) => c.tracks.find(x => x.id === id);

export function playerById(s: MatchState, id?: ID): Player | undefined {
  return s.players.find(p => p.id === id);
}
export function playerName(s: MatchState, id?: ID): string {
  return playerById(s, id)?.name ?? '—';
}
export function alivePlayers(s: MatchState): Player[] {
  return s.players.filter(p => p.alive);
}
/** Players who vote this round (alive; the leader only if the rules allow). */
export function voters(s: MatchState): Player[] {
  const leaderVotes = s.config.mechanics.leaderVotes ?? true;
  return s.players.filter(p => p.alive && (leaderVotes || p.id !== s.leaderId));
}

/** Tally of the current votes. */
export function voteResult(s: MatchState) {
  const v = voters(s);
  const yes = v.filter(p => s.votes[p.id] === 'yes').length;
  const total = v.length;
  const pct = total ? Math.round((yes / total) * 100) : 0;
  const passed = s.config.mechanics.votePassRule === 'atLeastHalf' ? yes * 2 >= total : yes * 2 > total;
  return { yes, no: total - yes, total, pct, passed };
}

export function roleOf(s: MatchState, playerId?: ID): Role | undefined {
  return roleById(s.config, playerById(s, playerId)?.roleId);
}
export function factionOfPlayer(s: MatchState, playerId?: ID) {
  return factionById(s.config, roleOf(s, playerId)?.factionId);
}

export function conditionMet(cond: Condition, s: MatchState): boolean {
  switch (cond.kind) {
    case 'always': return true;
    case 'trackAtLeast': return (s.tracks[cond.trackId] ?? 0) >= cond.count;
    case 'playerCount': return s.players.length >= cond.min && s.players.length <= cond.max;
    case 'aliveAtMost': return alivePlayers(s).length <= cond.count;
    case 'roundAtLeast': return s.round >= cond.count;
    default: return false;
  }
}

/** Enabled rules of a kind whose condition currently holds. */
export function activeRules(s: MatchState, kind: RuleKind): Rule[] {
  return s.config.rules.filter(r => r.kind === kind && r.enabled && conditionMet(r.condition, s));
}

export function describeCondition(cond: Condition, c: GameConfig): string {
  switch (cond.kind) {
    case 'always': return 'دائمًا';
    case 'trackAtLeast': return `لما «${trackById(c, cond.trackId)?.name ?? '?'}» يوصل ${cond.count} أو أكثر`;
    case 'playerCount': return `مع ${cond.min}–${cond.max} لاعبين`;
    case 'aliveAtMost': return `لما يبقى ${cond.count} لاعبين أحياء أو أقل`;
    case 'roundAtLeast': return `من الجولة ${cond.count}`;
  }
}

/** The power profile of a track for the number of players in this match. */
export function profileFor(track: Track, playerCount: number) {
  return track.powerProfiles.find(p => playerCount >= p.minPlayers && playerCount <= p.maxPlayers);
}

export function powerAt(track: Track, spaceIndex: number, playerCount: number): { kind: PowerKind; text: string } {
  const prof = profileFor(track, playerCount);
  return { kind: prof?.powers[spaceIndex] ?? 'none', text: prof?.customText[spaceIndex] ?? '' };
}

export function trackForCard(c: GameConfig, card?: CardDef): Track | undefined {
  if (!card?.factionId) return undefined;
  return c.tracks.find(t => t.factionId === card.factionId);
}

/** Whether a player could be nominated, with the reason if not. */
export function nomineeEligibility(s: MatchState, candidateId: ID): { ok: boolean; reason?: string } {
  const p = playerById(s, candidateId);
  const m = s.config.mechanics;
  if (!p) return { ok: false, reason: 'لاعب غير معروف' };
  if (!p.alive) return { ok: false, reason: 'خارج اللعبة' };
  if (p.id === s.leaderId) return { ok: false, reason: `هو ${m.leaderTitle}` };
  const role = roleById(s.config, p.roleId);
  if (role && !role.canBeNominee) return { ok: false, reason: `دوره ما يسمح يكون ${m.nomineeTitle}` };
  for (const r of activeRules(s, 'termLimits')) {
    if (!r.automated) continue;
    if (p.id === s.lastElected.nomineeId) return { ok: false, reason: `ممنوع هالدور (كان ${m.nomineeTitle} آخر مرة)` };
    const threshold = r.params.aliveThreshold ?? 5;
    if (p.id === s.lastElected.leaderId && alivePlayers(s).length > threshold) {
      return { ok: false, reason: `ممنوع هالدور (كان ${m.leaderTitle} آخر مرة)` };
    }
  }
  return { ok: true };
}

export function eligibleNominees(s: MatchState): Player[] {
  return s.players.filter(p => nomineeEligibility(s, p.id).ok);
}

export function canLead(s: MatchState, p: Player): boolean {
  return p.alive && (roleById(s.config, p.roleId)?.canBeLeader ?? true);
}

/** Next leader clockwise from a seat. */
export function nextLeaderAfter(s: MatchState, fromId: ID): ID {
  const ordered = [...s.players].sort((a, b) => a.seat - b.seat);
  const start = ordered.findIndex(p => p.id === fromId);
  if (s.config.mechanics.rotation === 'random') {
    const pool = ordered.filter(p => canLead(s, p) && p.id !== fromId);
    return (pool[Math.floor(Math.random() * pool.length)] ?? ordered.find(p => p.alive) ?? ordered[0]).id;
  }
  for (let i = 1; i <= ordered.length; i++) {
    const p = ordered[(start + i + ordered.length) % ordered.length];
    if (canLead(s, p)) return p.id;
  }
  return (ordered.find(p => p.alive) ?? ordered[0]).id;
}

/** Roles the given player is told about at the start of the game. */
export function knownPlayers(s: MatchState, viewerId: ID): { player: Player; roleId: ID }[] {
  const viewer = playerById(s, viewerId);
  const role = roleById(s.config, viewer?.roleId);
  if (!viewer || !role) return [];
  const n = s.players.length;
  const seen = new Set<ID>();
  for (const k of role.knowledge) {
    if (k.minPlayers && n < k.minPlayers) continue;
    if (k.maxPlayers && n > k.maxPlayers) continue;
    k.seesRoleIds.forEach(r => seen.add(r));
  }
  return s.players
    .filter(p => p.id !== viewerId && seen.has(p.roleId))
    .map(p => ({ player: p, roleId: p.roleId }));
}

export function vetoAvailable(s: MatchState): boolean {
  return !s.vetoDeclined && activeRules(s, 'veto').some(r => r.automated);
}

/** Enabled-but-manual rules relevant right now — shown as reminders to the table. */
export function manualRuleNotes(s: MatchState): Rule[] {
  return s.config.rules.filter(r => r.enabled && !r.automated && conditionMet(r.condition, s));
}

export function powerTargets(s: MatchState): Player[] {
  const pp = s.pendingPower;
  if (!pp) return [];
  return s.players.filter(p => {
    if (!p.alive || p.id === s.leaderId) return false;
    const role = roleById(s.config, p.roleId);
    if (pp.kind === 'investigate') return !p.investigated && (role?.canBeTargeted ?? true);
    if (pp.kind === 'execute') return role?.canBeTargeted ?? true;
    if (pp.kind === 'specialElection') return canLead(s, p);
    return false;
  });
}

export function distributionFor(c: GameConfig, players: number) {
  return c.distribution.find(d => d.players === players);
}
