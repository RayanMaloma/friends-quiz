/**
 * GAME ENGINE
 * ------------------------------------------------------------------
 * A pure reducer:  (state, action) -> { state, error? }
 *
 * - Never mutates its input (works on a clone).
 * - Validates every action against the current phase and rules,
 *   returning a readable error instead of corrupting state.
 * - Knows nothing about rendering or about who sent the action: the
 *   server checks that (lib/dx/server.ts) before calling reduce().
 */
import type { CardDef, GameConfig, ID } from '../types/config';
import type { Action, EngineResult, LogEntry, MatchState, PendingPower, Player } from '../types/match';
import { deepClone, uid } from '../config/ids';
import {
  voteResult, voters,
  activeRules, alivePlayers, cardById, distributionFor, factionById, nextLeaderAfter, nomineeEligibility,
  playerById, playerName, powerAt, powerTargets, POWER_LABELS, roleById, roleOf, shuffle, trackById, trackForCard,
  vetoAvailable,
} from './helpers';

/* ------------------------------------------------------------------ */
/* SETUP                                                               */
/* ------------------------------------------------------------------ */

export interface SetupOptions {
  /** Seats in order: the id is the player's game_players id. */
  players: { id: ID; name: string }[];
  /** Optional per-match override of how many of each role to deal. */
  roleCounts?: Record<ID, number>;
  rnd?: () => number;
}

export function validateSetup(config: GameConfig, playerCount: number, roleCounts?: Record<ID, number>): string[] {
  const errors: string[] = [];
  const n = playerCount;
  const m = config.mechanics;
  if (n < m.minPlayers || n > m.maxPlayers) errors.push(`اللعبة تحتاج من ${m.minPlayers} إلى ${m.maxPlayers} لاعبين (الموجود ${n}).`);
  const counts = roleCounts ?? distributionFor(config, n)?.counts;
  if (!counts) errors.push(`ما فيه توزيع أدوار لـ ${n} لاعبين. أضفه من لوحة التحكم ← الفرق والأدوار.`);
  else {
    const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
    if (total !== n) errors.push(`توزيع الأدوار يعطي ${total} أدوار لـ ${n} لاعبين.`);
    for (const id of Object.keys(counts)) if (counts[id] && !roleById(config, id)) errors.push('التوزيع فيه دور محذوف.');
  }
  const deckSize = m.deck.reduce((a, d) => a + (cardById(config, d.cardId) ? d.count : 0), 0);
  if (deckSize < m.drawCount) errors.push(`رزمة «${m.policyTitle}» فيها ${deckSize} بطاقات وكل جلسة تسحب ${m.drawCount}.`);
  if (m.drawCount < 2) errors.push('كل جلسة لازم تسحب بطاقتين على الأقل (القائد يرمي وحدة والمرشّح يعتمد وحدة).');
  if (!config.tracks.length) errors.push('اللعبة تحتاج مسار واحد على الأقل.');
  if (!config.roles.some(r => r.canBeLeader)) errors.push(`لازم دور واحد على الأقل يقدر يكون ${m.leaderTitle}.`);
  return errors;
}

export function createMatch(config: GameConfig, opts: SetupOptions): EngineResult {
  const rnd = opts.rnd ?? Math.random;
  const cfg = deepClone(config);
  const errors = validateSetup(cfg, opts.players.length, opts.roleCounts);
  const empty = {} as MatchState;
  if (errors.length) return { state: empty, error: errors.join(' ') };

  const counts = opts.roleCounts ?? distributionFor(cfg, opts.players.length)!.counts;
  const pool: ID[] = [];
  Object.entries(counts).forEach(([roleId, k]) => { for (let i = 0; i < k; i++) pool.push(roleId); });
  const dealt = shuffle(pool, rnd);
  const players: Player[] = opts.players.map((p, i) => ({
    id: p.id, name: p.name.trim(), seat: i, roleId: dealt[i], alive: true, investigated: false,
  }));

  const deck: ID[] = [];
  cfg.mechanics.deck.forEach(d => { if (cardById(cfg, d.cardId)) for (let i = 0; i < d.count; i++) deck.push(d.cardId); });

  const tracks: Record<ID, number> = {};
  cfg.tracks.forEach(t => (tracks[t.id] = 0));

  const leaders = players.filter(p => roleById(cfg, p.roleId)?.canBeLeader ?? true);
  const first = leaders[Math.floor(rnd() * leaders.length)] ?? players[0];

  const s: MatchState = {
    id: uid('match'), version: 1, createdAt: Date.now(), config: cfg, players,
    phase: 'roleReveal', round: 1, roleSeen: [], leaderId: first.id, rotationAnchorId: first.id,
    inSpecialRound: false, lastElected: {}, votes: {}, drawPile: shuffle(deck, rnd), discardPile: [], hand: [],
    tracks, electionTracker: 0, enacted: [], vetoDeclined: false, reminders: [], log: [], rounds: [],
  };
  log(s, 'info', `بدأت اللعبة بـ ${players.length} لاعبين. ${first.name} هو أول ${cfg.mechanics.leaderTitle}.`);
  return { state: s };
}

/* ------------------------------------------------------------------ */
/* INTERNAL HELPERS (mutate the working clone)                         */
/* ------------------------------------------------------------------ */

function log(s: MatchState, kind: LogEntry['kind'], text: string) {
  s.log.push({ id: uid('log'), round: s.round, kind, text });
}

function reshuffleIfNeeded(s: MatchState, need: number) {
  if (s.drawPile.length < need) {
    s.drawPile = shuffle([...s.drawPile, ...s.discardPile]);
    s.discardPile = [];
    log(s, 'info', `انخلطت رزمة «${s.config.mechanics.policyTitle}» من جديد.`);
  }
}

function draw(s: MatchState, n: number): ID[] {
  reshuffleIfNeeded(s, n);
  return s.drawPile.splice(0, Math.min(n, s.drawPile.length));
}

function setWinner(s: MatchState, factionId: ID, reason: string, ruleId?: ID) {
  s.winner = { factionId, reason, ruleId };
  s.phase = 'gameOver';
  log(s, 'win', `فاز ${factionById(s.config, factionId)?.name ?? 'فريق'}: ${reason}`);
}

function remind(s: MatchState, ruleId: ID, text: string) {
  if (!s.reminders.some(r => r.ruleId === ruleId)) s.reminders.push({ ruleId, text });
}

function startRound1(s: MatchState) {
  s.phase = 'nominate';
  log(s, 'info', 'الكل شاف دوره. بدأت الجولة الأولى.');
}

/** Check track-completion victory rules. Returns true if the game ended. */
function checkTrackWins(s: MatchState): boolean {
  for (const r of activeRules(s, 'trackCompleteWin')) {
    const t = trackById(s.config, r.params.trackId);
    if (!t || !r.params.factionId) continue;
    if ((s.tracks[t.id] ?? 0) >= t.spaces.length) {
      if (r.automated) { setWinner(s, r.params.factionId, `اكتمل مسار «${t.name}».`, r.id); return true; }
      remind(s, r.id, `تحقّق شرط «${r.name}» (مسار ${t.name} اكتمل). هذا القانون يدوي — المضيف يقرر النتيجة.`);
    }
  }
  return false;
}

/** Place a card on its track. Returns the power to resolve, if any. */
function enact(s: MatchState, cardId: ID, chaos: boolean): PendingPower | undefined {
  const card = cardById(s.config, cardId) as CardDef | undefined;
  const track = trackForCard(s.config, card);
  s.enacted.push({ cardId, round: s.round, chaos });
  s.discardPile.push(cardId);
  let power: PendingPower | undefined;
  if (track) {
    const before = s.tracks[track.id] ?? 0;
    const after = Math.min(before + 1, track.spaces.length);
    s.tracks[track.id] = after;
    log(s, chaos ? 'chaos' : 'policy', `${chaos ? 'فوضى! ' : ''}اعتُمدت «${card?.name ?? 'بطاقة'}» — ${track.name} ${after}/${track.spaces.length}.`);
    // The card is on the board now, not in the discard pile.
    s.discardPile.pop();
    const chaosRule = activeRules(s, 'chaos')[0];
    const powersAllowed = !chaos || !!chaosRule?.params.chaosTriggersPowers;
    if (after > before && powersAllowed) {
      const p = powerAt(track, after - 1, s.players.length);
      if (p.kind !== 'none') power = { kind: p.kind, source: `${track.name} — الخانة ${after}`, text: p.text };
    }
  } else {
    log(s, chaos ? 'chaos' : 'policy', `انلعبت «${card?.name ?? 'بطاقة'}» (بدون مسار).`);
  }
  if (!power && card?.onEnact && card.onEnact !== 'none' && (!chaos || activeRules(s, 'chaos')[0]?.params.chaosTriggersPowers)) {
    power = { kind: card.onEnact, source: card.name, text: card.onEnactText || card.effect };
  }
  if (checkTrackWins(s)) return undefined;
  return power;
}

function beginPower(s: MatchState, power: PendingPower) {
  if (power.kind === 'peek') {
    reshuffleIfNeeded(s, s.config.mechanics.drawCount);
    power.peek = s.drawPile.slice(0, s.config.mechanics.drawCount);
  }
  s.pendingPower = power;
  s.phase = 'power';
  log(s, 'power', `${s.config.mechanics.leaderTitle} ${playerName(s, s.leaderId)} حصل على صلاحية: ${POWER_LABELS[power.kind]}.`);
}

/** A failed election / accepted veto. Advances the tracker and may cause chaos. */
function failedGovernment(s: MatchState): 'continue' | 'power' | 'over' {
  const m = s.config.mechanics;
  s.electionTracker += 1;
  if (s.electionTracker < m.electionTrackerLength) return 'continue';
  const chaos = activeRules(s, 'chaos')[0];
  if (!chaos) { s.electionTracker = m.electionTrackerLength - 1; return 'continue'; }
  if (!chaos.automated) {
    remind(s, chaos.id, `«${chaos.name}»: ${m.electionTrackerTitle} امتلأ. هذا القانون يدوي — المضيف يتصرف.`);
    s.electionTracker = 0;
    return 'continue';
  }
  s.electionTracker = 0;
  const [top] = draw(s, 1);
  if (chaos.params.chaosResetsTermLimits !== false) s.lastElected = {};
  if (!top) return 'continue';
  const power = enact(s, top, true);
  if (s.phase === 'gameOver') return 'over';
  if (power) { beginPower(s, power); return 'power'; }
  return 'continue';
}

function endRound(s: MatchState) {
  reshuffleIfNeeded(s, s.config.mechanics.drawCount);
  if (s.specialNextLeaderId) {
    s.leaderId = s.specialNextLeaderId;
    s.specialNextLeaderId = undefined;
    s.inSpecialRound = true;
  } else if (s.inSpecialRound) {
    s.leaderId = nextLeaderAfter(s, s.rotationAnchorId);
    s.rotationAnchorId = s.leaderId;
    s.inSpecialRound = false;
  } else {
    s.leaderId = nextLeaderAfter(s, s.leaderId);
    s.rotationAnchorId = s.leaderId;
  }
  s.round += 1;
  s.nomineeId = undefined;
  s.votes = {};
  s.tally = undefined;
  s.hand = [];
  s.vetoDeclined = false;
  s.pendingPower = undefined;
  s.phase = 'nominate';
}

function summary(s: MatchState, result: string) {
  s.rounds.push({ round: s.round, leaderId: s.leaderId, nomineeId: s.nomineeId, result });
}

/* ------------------------------------------------------------------ */
/* REDUCER                                                             */
/* ------------------------------------------------------------------ */

export function reduce(prev: MatchState, action: Action): EngineResult {
  const s = deepClone(prev);
  const m = s.config.mechanics;
  const fail = (error: string): EngineResult => ({ state: prev, error });
  const isAdmin = action.type.startsWith('ADMIN_') || action.type === 'DISMISS_REMINDER';

  if (s.phase === 'gameOver' && !isAdmin) return fail('اللعبة خلصت.');

  switch (action.type) {
    case 'SEE_ROLE': {
      if (s.phase !== 'roleReveal') return { state: prev }; // late tap: harmless
      if (!playerById(s, action.playerId)) return fail('لاعب غير معروف.');
      if (!s.roleSeen.includes(action.playerId)) s.roleSeen.push(action.playerId);
      if (s.players.every(p => s.roleSeen.includes(p.id))) startRound1(s);
      return { state: s };
    }

    case 'NOMINATE': {
      if (s.phase !== 'nominate') return fail('مو وقت الترشيح.');
      const elig = nomineeEligibility(s, action.nomineeId);
      if (!elig.ok) return fail(`ما ينفع ترشيح ${playerName(s, action.nomineeId)}: ${elig.reason}.`);
      s.nomineeId = action.nomineeId;
      s.votes = {};
      s.phase = 'vote';
      log(s, 'election', `${playerName(s, s.leaderId)} رشّح ${playerName(s, s.nomineeId)} ${m.nomineeTitle}.`);
      return { state: s };
    }

    case 'CAST_VOTE': {
      if (s.phase !== 'vote') return fail('التصويت مقفل.');
      const p = playerById(s, action.playerId);
      if (!p || !p.alive) return fail('بس اللاعبين الأحياء يصوّتون.');
      if (!voters(s).some(v => v.id === p.id)) return fail(`${m.leaderTitle} ما يصوّت.`);
      s.votes[p.id] = action.vote;
      return { state: s };
    }

    case 'REVEAL_VOTES': {
      if (s.phase !== 'vote') return fail('التصويت مقفل.');
      const missing = voters(s).filter(p => !s.votes[p.id]);
      if (missing.length) return fail(`باقي يصوّت: ${missing.map(p => p.name).join('، ')}.`);
      s.tally = voteResult(s);
      // Secret ballots: only the percentage survives the count.
      if ((m.voteReveal ?? 'percent') === 'percent') s.votes = {};
      s.phase = 'voteReveal';
      return { state: s };
    }

    case 'RESOLVE_VOTE': {
      if (s.phase !== 'voteReveal') return fail('الأصوات ما انكشفت.');
      const { yes, no, pct, passed } = s.tally ?? voteResult(s);
      const secret = (m.voteReveal ?? 'percent') === 'percent';
      const tally = secret ? `${pct}% موافقين` : `${yes}–${no}`;
      if (passed) {
        log(s, 'election', `نجح التصويت (${tally}). ${playerName(s, s.leaderId)} و${playerName(s, s.nomineeId)} شكّلوا ${m.governmentTitle}.`);
        if (m.trackerReset === 'onElection') s.electionTracker = 0;
        s.lastElected = { leaderId: s.leaderId, nomineeId: s.nomineeId };
        for (const r of activeRules(s, 'roleElectedWin')) {
          const role = roleOf(s, s.nomineeId);
          if (role && role.id === r.params.roleId && r.params.factionId) {
            if (r.automated) {
              summary(s, `انتُخبت ${m.governmentTitle} — ${role.name} استلم المنصب`);
              setWinner(s, r.params.factionId, `انتُخب ${role.name} ${m.nomineeTitle}.`, r.id);
              return { state: s };
            }
            remind(s, r.id, `ممكن ينطبق «${r.name}» — هذا القانون يدوي، المضيف يقرر.`);
          }
        }
        s.hand = draw(s, m.drawCount);
        s.phase = 'leaderLegislate';
      } else {
        log(s, 'election', `فشل التصويت (${tally}).`);
        summary(s, `فشل التصويت (${tally})`);
        const r = failedGovernment(s);
        if (r === 'over' || r === 'power') return { state: s };
        endRound(s);
      }
      return { state: s };
    }

    case 'LEADER_DISCARD': {
      if (s.phase !== 'leaderLegislate') return fail(`${m.leaderTitle} مو في دوره الحين.`);
      if (action.index < 0 || action.index >= s.hand.length) return fail('بطاقة غير صالحة.');
      const [gone] = s.hand.splice(action.index, 1);
      s.discardPile.push(gone);
      // Keep passing until only 2 remain (supports drawCount > 3).
      if (s.hand.length <= 2) s.phase = 'nomineeLegislate';
      return { state: s };
    }

    case 'NOMINEE_ENACT': {
      if (s.phase !== 'nomineeLegislate') return fail(`${m.nomineeTitle} مو في دوره الحين.`);
      if (action.index < 0 || action.index >= s.hand.length) return fail('بطاقة غير صالحة.');
      const chosen = s.hand[action.index];
      s.hand.forEach((c, i) => { if (i !== action.index) s.discardPile.push(c); });
      s.hand = [];
      if (m.trackerReset === 'onEnact' || m.trackerReset === 'onElection') s.electionTracker = 0;
      const power = enact(s, chosen, false);
      summary(s, `اعتُمدت ${cardById(s.config, chosen)?.name ?? 'بطاقة'}`);
      if ((s.phase as string) === 'gameOver') return { state: s };
      if (power) { beginPower(s, power); return { state: s }; }
      endRound(s);
      return { state: s };
    }

    case 'REQUEST_VETO': {
      if (s.phase !== 'nomineeLegislate') return fail('ما فيه شي ينرفض.');
      if (!vetoAvailable(s)) return fail('الفيتو مو متاح.');
      s.phase = 'vetoResponse';
      log(s, 'election', `${m.nomineeTitle} ${playerName(s, s.nomineeId)} طلب فيتو.`);
      return { state: s };
    }

    case 'VETO_RESPONSE': {
      if (s.phase !== 'vetoResponse') return fail('ما فيه طلب فيتو.');
      if (!action.accept) {
        s.vetoDeclined = true;
        s.phase = 'nomineeLegislate';
        log(s, 'election', `${m.leaderTitle} ${playerName(s, s.leaderId)} رفض الفيتو.`);
        return { state: s };
      }
      s.discardPile.push(...s.hand);
      s.hand = [];
      log(s, 'election', 'انقبل الفيتو. البطاقتين انرمت.');
      summary(s, 'فيتو على الجلسة');
      const veto = activeRules(s, 'veto')[0];
      if (veto?.params.vetoAdvancesTracker !== false) {
        const r = failedGovernment(s);
        if (r === 'over' || r === 'power') return { state: s };
      }
      endRound(s);
      return { state: s };
    }

    case 'POWER_TARGET': {
      const pp = s.pendingPower;
      if (s.phase !== 'power' || !pp) return fail('ما فيه صلاحية تُستخدم.');
      if (!powerTargets(s).some(p => p.id === action.targetId)) return fail('ما ينفع تختار هذا اللاعب.');
      const target = playerById(s, action.targetId)!;
      if (pp.kind === 'investigate') {
        if (pp.result) return fail('تم التحقيق خلاص.');
        target.investigated = true;
        pp.result = { targetId: target.id, factionId: roleOf(s, target.id)?.factionId ?? '' };
        log(s, 'power', `${playerName(s, s.leaderId)} حقّق في ولاء ${target.name}.`);
        return { state: s };
      }
      if (pp.kind === 'specialElection') {
        s.specialNextLeaderId = target.id;
        log(s, 'power', `انتخاب خاص: ${target.name} بيكون ${m.leaderTitle} الجاي.`);
        endRound(s);
        return { state: s };
      }
      if (pp.kind === 'execute') {
        target.alive = false;
        log(s, 'power', `تم إعدام ${target.name}.`);
        for (const r of activeRules(s, 'roleKilledWin')) {
          if (target.roleId === r.params.roleId && r.params.factionId) {
            if (r.automated) {
              setWinner(s, r.params.factionId, `تم إعدام ${roleById(s.config, target.roleId)?.name ?? 'الدور المهم'}.`, r.id);
              return { state: s };
            }
            remind(s, r.id, `ممكن ينطبق «${r.name}» — هذا القانون يدوي، المضيف يقرر.`);
          }
        }
        endRound(s);
        return { state: s };
      }
      return fail('هذي الصلاحية ما تحتاج اختيار لاعب.');
    }

    case 'POWER_DONE': {
      if (s.phase !== 'power' || !s.pendingPower) return fail('ما فيه صلاحية تخلص.');
      const pp = s.pendingPower;
      const needsTarget = pp.kind === 'investigate' ? !pp.result : pp.kind === 'execute' || pp.kind === 'specialElection';
      if (needsTarget && powerTargets(s).length > 0) return fail('اختار لاعب أول.');
      if (pp.kind === 'peek') log(s, 'power', `${playerName(s, s.leaderId)} شاف أعلى الرزمة.`);
      endRound(s);
      return { state: s };
    }

    /* ---------------- host overrides ---------------- */

    case 'ADMIN_END_REVEAL': {
      if (s.phase !== 'roleReveal') return fail('كشف الأدوار انتهى.');
      log(s, 'admin', 'المضيف بدأ اللعب قبل ما يأكد الكل.');
      startRound1(s);
      return { state: s };
    }
    case 'ADMIN_DECLARE_WINNER': {
      if (!factionById(s.config, action.factionId)) return fail('فريق غير معروف.');
      log(s, 'admin', 'المضيف أعلن النتيجة.');
      setWinner(s, action.factionId, action.reason || 'بقرار المضيف.');
      return { state: s };
    }
    case 'ADMIN_SKIP_POWER': {
      if (s.phase !== 'power') return fail('ما فيه صلاحية الحين.');
      log(s, 'admin', 'المضيف تخطّى الصلاحية.');
      endRound(s);
      return { state: s };
    }
    case 'ADMIN_SET_LEADER': {
      if (s.phase !== 'nominate' && s.phase !== 'vote') return fail('تغيير القائد بس قبل كشف الأصوات.');
      const p = playerById(s, action.playerId);
      if (!p?.alive) return fail('اختار لاعب حي.');
      s.leaderId = p.id;
      s.rotationAnchorId = p.id;
      s.inSpecialRound = false;
      s.nomineeId = undefined;
      s.votes = {};
      s.phase = 'nominate';
      log(s, 'admin', `المضيف خلّى ${p.name} ${m.leaderTitle}.`);
      return { state: s };
    }
    case 'ADMIN_ADJUST_TRACK': {
      const t = trackById(s.config, action.trackId);
      if (!t) return fail('مسار غير معروف.');
      s.tracks[t.id] = Math.max(0, Math.min(t.spaces.length, (s.tracks[t.id] ?? 0) + action.delta));
      log(s, 'admin', `المضيف عدّل ${t.name} إلى ${s.tracks[t.id]}.`);
      checkTrackWins(s);
      return { state: s };
    }
    case 'ADMIN_ADJUST_TRACKER': {
      s.electionTracker = Math.max(0, Math.min(m.electionTrackerLength - 1, s.electionTracker + action.delta));
      log(s, 'admin', `المضيف عدّل ${m.electionTrackerTitle} إلى ${s.electionTracker}.`);
      return { state: s };
    }
    case 'ADMIN_TOGGLE_ALIVE': {
      const p = playerById(s, action.playerId);
      if (!p) return fail('لاعب غير معروف.');
      if (p.alive && alivePlayers(s).length <= 2) return fail('لازم يبقى لاعبين على الأقل.');
      p.alive = !p.alive;
      log(s, 'admin', `المضيف ${p.alive ? 'أرجع' : 'أخرج'} ${p.name}.`);
      if (!p.alive && s.leaderId === p.id && s.phase === 'nominate') s.leaderId = nextLeaderAfter(s, p.id);
      return { state: s };
    }
    case 'ADMIN_SKIP_TURN': {
      if (s.phase === 'roleReveal') return fail('خلّص كشف الأدوار أول.');
      s.discardPile.push(...s.hand);
      s.hand = [];
      log(s, 'admin', 'المضيف تخطّى باقي هذا الدور.');
      summary(s, 'المضيف تخطّى الدور');
      endRound(s);
      return { state: s };
    }
    case 'DISMISS_REMINDER': {
      s.reminders = s.reminders.filter(r => r.ruleId !== action.ruleId);
      return { state: s };
    }
  }
  return fail('إجراء غير معروف.');
}

/**
 * The view of the match a given player is allowed to see. The server
 * sends only this to a device ('public' = the TV).
 */
export function redactFor(s: MatchState, viewerId: ID | 'public'): MatchState {
  const r = deepClone(s);
  const over = s.phase === 'gameOver';
  r.players = r.players.map(p => ({ ...p, roleId: over || p.id === viewerId ? p.roleId : 'hidden' }));
  r.drawPile = r.drawPile.map(() => 'hidden');
  r.discardPile = r.discardPile.map(() => 'hidden');
  const holdsHand = (s.phase === 'leaderLegislate' && viewerId === s.leaderId) ||
    ((s.phase === 'nomineeLegislate' || s.phase === 'vetoResponse') && viewerId === s.nomineeId);
  if (!holdsHand && !over) r.hand = r.hand.map(() => 'hidden');
  if (s.phase === 'vote') r.votes = Object.fromEntries(Object.keys(s.votes).map(k => [k, k === viewerId ? s.votes[k] : 'hidden'])) as MatchState['votes'];
  if (r.pendingPower && viewerId !== s.leaderId) { r.pendingPower.result = undefined; r.pendingPower.peek = undefined; }
  return r;
}
