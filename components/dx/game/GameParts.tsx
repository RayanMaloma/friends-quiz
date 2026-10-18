"use client";

import React, { useMemo, useState } from 'react';
import type { MatchState } from '@/lib/dx/types/match';
import { useStore } from '@/components/dx/store';
import { Button, Field, IconButton, Modal, Panel, Select, TextInput, Toggle, useConfirm } from '@/components/dx/components/ui';
import { Icon } from '@/components/dx/components/Icon';
import { cardById, describeCondition, factionById, manualRuleNotes, playerName, roleById } from '@/lib/dx/engine/helpers';

/* ---------- player seats ---------- */
export function Seats({ s, eligibleIds, waitingIds = [], offlineIds = [] }: {
  s: MatchState;
  /** During nomination: who may be nominated (computed by the server, which knows the roles). */
  eligibleIds?: string[];
  waitingIds?: string[];
  offlineIds?: string[];
}) {
  const m = s.config.mechanics;
  const board = s.config.boards.find(b => b.id === s.config.activeBoardId) ?? s.config.boards[0];
  const showVotes = s.phase === 'voteReveal' && (m.voteReveal ?? 'percent') === 'names';
  return (
    <ol className="seats" aria-label="اللاعبين بالترتيب">
      {[...s.players].sort((a, b) => a.seat - b.seat).map(p => {
        const leader = p.id === s.leaderId;
        const nominee = p.id === s.nomineeId;
        const ineligible = s.phase === 'nominate' && !leader && p.alive && !!eligibleIds && !eligibleIds.includes(p.id);
        const marker = board.playerMarker === 'number' ? String(p.seat + 1) : board.playerMarker === 'icon' ? null : p.name.charAt(0);
        return (
          <li key={p.id} className={`seat-chip ${leader ? 'is-leader' : ''} ${nominee ? 'is-nominee' : ''} ${p.alive ? '' : 'is-dead'} ${waitingIds.includes(p.id) ? 'is-waiting' : ''}`}>
            <span className="seat-token" aria-hidden>{marker ?? <Icon name={board.playerMarkerIcon || 'user'} size={16} />}</span>
            <span className="seat-name">{p.name}</span>
            <span className="seat-tags">
              {leader && <span className="tag tag-leader" title={m.leaderTitle}><Icon name="crown" size={12} />{m.leaderTitle}</span>}
              {nominee && <span className="tag tag-nominee" title={m.nomineeTitle}><Icon name="gavel" size={12} />{m.nomineeTitle}</span>}
              {!p.alive && <span className="tag tag-dead"><Icon name="skull" size={12} />خارج</span>}
              {p.id === s.lastElected.leaderId && !leader && <span className="tag tag-soft" title={`آخر ${m.leaderTitle} منتخب`}>{m.leaderTitle} السابق</span>}
              {p.id === s.lastElected.nomineeId && !nominee && <span className="tag tag-soft" title={`آخر ${m.nomineeTitle} منتخب`}>{m.nomineeTitle} السابق</span>}
              {ineligible && <span className="tag tag-soft">غير مؤهل</span>}
              {p.investigated && <span className="tag tag-soft" title="انحقق فيه"><Icon name="search" size={11} /></span>}
              {showVotes && p.alive && s.votes[p.id] && <span className={`tag ${s.votes[p.id] === 'yes' ? 'tag-yes' : 'tag-no'}`}>{s.votes[p.id] === 'yes' ? m.yesLabel : m.noLabel}</span>}
              {s.phase === 'vote' && p.alive && s.votes[p.id] && <span className="tag tag-soft"><Icon name="check" size={11} />صوّت</span>}
              {offlineIds.includes(p.id) && <span className="tag tag-dead" title="جواله طلع من اللعبة">غير متصل</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- log & round summaries ---------- */
export function LogPanel({ s }: { s: MatchState }) {
  const [view, setView] = useState<'log' | 'rounds'>('log');
  const grouped = useMemo(() => {
    const g = new Map<number, typeof s.log>();
    s.log.forEach(e => g.set(e.round, [...(g.get(e.round) ?? []), e]));
    return [...g.entries()].reverse();
  }, [s.log]);
  return (
    <Panel title="سجل اللعبة" className="log-panel" actions={
      <div className="seg small" role="group" aria-label="عرض السجل">
        <button type="button" className={view === 'log' ? 'on' : ''} aria-pressed={view === 'log'} onClick={() => setView('log')}>الأحداث</button>
        <button type="button" className={view === 'rounds' ? 'on' : ''} aria-pressed={view === 'rounds'} onClick={() => setView('rounds')}>الجولات</button>
      </div>
    }>
      {view === 'log' ? (
        <div className="log-scroll">
          {grouped.map(([round, entries]) => (
            <div key={round} className="log-round">
              <div className="log-round-head">الجولة {round}</div>
              <ul>{[...entries].reverse().map(e => <li key={e.id} className={`log-${e.kind}`}>{e.text}</li>)}</ul>
            </div>
          ))}
        </div>
      ) : (
        <div className="log-scroll">
          {s.rounds.length === 0 ? <p className="muted small">ما فيه جولات مكتملة.</p> : (
            <table className="rounds-table">
              <thead><tr><th>#</th><th>{s.config.mechanics.leaderTitle}</th><th>{s.config.mechanics.nomineeTitle}</th><th>النتيجة</th></tr></thead>
              <tbody>{[...s.rounds].reverse().map((r, i) => (
                <tr key={i}><td className="num">{r.round}</td><td>{playerName(s, r.leaderId)}</td><td>{r.nomineeId ? playerName(s, r.nomineeId) : '—'}</td><td>{r.result}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ---------- manual rules & reminders ---------- */
export function RuleNotes({ s, canDismiss }: { s: MatchState; canDismiss: boolean }) {
  const { dispatch } = useStore();
  const manual = manualRuleNotes(s);
  if (!manual.length && !s.reminders.length) return null;
  return (
    <Panel title={<><Icon name="info" size={16} /> قوانين يطبقها المضيف</>} className="notes-panel">
      {s.reminders.map(r => (
        <div key={r.ruleId} className="reminder" role="status">
          <span>{r.text}</span>
          {canDismiss && <IconButton icon="x" label="إخفاء التذكير" onClick={() => dispatch({ type: 'DISMISS_REMINDER', ruleId: r.ruleId })} />}
        </div>
      ))}
      {manual.length > 0 && (
        <ul className="manual-list">
          {manual.map(r => <li key={r.id}><strong>{r.name}</strong> <span className="muted small">({describeCondition(r.condition, s.config)})</span><br /><span className="small">{r.params.text || r.description}</span></li>)}
        </ul>
      )}
    </Panel>
  );
}

/* ---------- host override panel ---------- */
export function HostPanel({ s, open, onClose }: { s: MatchState; open: boolean; onClose: () => void }) {
  const { dispatch } = useStore();
  const confirm = useConfirm();
  const m = s.config.mechanics;
  const [leader, setLeader] = useState(s.leaderId);
  const [winFaction, setWinFaction] = useState(s.config.factions[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const act = async (title: string, msg: string, fn: () => void, danger = false) => {
    if (await confirm({ title, message: msg, confirmLabel: 'تطبيق', danger })) fn();
  };
  return (
    <Modal open={open} onClose={onClose} title="تحكم المضيف" wide>
      <p className="small muted">كل تعديل ينكتب في سجل اللعبة. استخدمها لتصليح الأخطاء أو لتطبيق القوانين اليدوية.</p>
      <div className="host-grid">
        <Panel title="إنقاذ">
          <div className="col gap-s">
            {s.phase === 'roleReveal' && (
              <Button icon="play" onClick={() => act('نبدأ بدون ما الكل يأكد؟', 'بعض اللاعبين ما ضغطوا «شفت دوري». يقدرون يشوفون دورهم بأي وقت من جوالهم.', () => dispatch({ type: 'ADMIN_END_REVEAL' }))}>ابدأ الجولة الأولى الحين</Button>
            )}
            <Button icon="right" disabled={s.phase === 'roleReveal'} onClick={() => act('تخطي باقي هذا الدور؟', `البطاقات اللي في اليد تنرمي و${m.leaderTitle} اللي بعده يستلم.`, () => dispatch({ type: 'ADMIN_SKIP_TURN' }))}>تخطي الدور</Button>
            <Button icon="x" disabled={s.phase !== 'power'} onClick={() => dispatch({ type: 'ADMIN_SKIP_POWER' })}>تخطي الصلاحية الحالية</Button>
          </div>
        </Panel>
        <Panel title={`تعيين ${m.leaderTitle}`}>
          <div className="col gap-s">
            <Select value={leader} onChange={setLeader} aria-label={`${m.leaderTitle} الجديد`} options={s.players.filter(p => p.alive).map(p => ({ value: p.id, label: p.name }))} />
            <Button disabled={s.phase !== 'nominate' && s.phase !== 'vote'} onClick={() => dispatch({ type: 'ADMIN_SET_LEADER', playerId: leader })}>خلّ {playerName(s, leader)} {m.leaderTitle}</Button>
            <span className="small muted">متاح قبل كشف الأصوات.</span>
          </div>
        </Panel>
        <Panel title="اللوحة">
          {s.config.tracks.map(t => (
            <div key={t.id} className="row gap-s adjust-row">
              <span className="grow small">{t.name}</span>
              <IconButton icon="minus" label={`إنقاص ${t.name}`} onClick={() => dispatch({ type: 'ADMIN_ADJUST_TRACK', trackId: t.id, delta: -1 })} />
              <span className="num strong">{s.tracks[t.id]}</span>
              <IconButton icon="plus" label={`زيادة ${t.name}`} onClick={() => dispatch({ type: 'ADMIN_ADJUST_TRACK', trackId: t.id, delta: 1 })} />
            </div>
          ))}
          <div className="row gap-s adjust-row">
            <span className="grow small">{m.electionTrackerTitle}</span>
            <IconButton icon="minus" label="إنقاص المتتبع" onClick={() => dispatch({ type: 'ADMIN_ADJUST_TRACKER', delta: -1 })} />
            <span className="num strong">{s.electionTracker}</span>
            <IconButton icon="plus" label="زيادة المتتبع" onClick={() => dispatch({ type: 'ADMIN_ADJUST_TRACKER', delta: 1 })} />
          </div>
        </Panel>
        <Panel title="اللاعبين">
          {s.players.map(p => (
            <div key={p.id} className="row gap-s adjust-row">
              <span className="grow small">{p.name}</span>
              <Button size="sm" variant={p.alive ? 'ghost' : 'secondary'} onClick={() => act(p.alive ? `إخراج ${p.name}؟` : `إرجاع ${p.name}؟`, 'هذا ما يفعّل أي شرط فوز.', () => dispatch({ type: 'ADMIN_TOGGLE_ALIVE', playerId: p.id }))}>{p.alive ? 'إخراج' : 'إرجاع'}</Button>
            </div>
          ))}
        </Panel>
        <Panel title="إنهاء اللعبة">
          <div className="col gap-s">
            <Field label="الفريق الفائز"><Select value={winFaction} onChange={setWinFaction} options={s.config.factions.map(f => ({ value: f.id, label: f.name }))} /></Field>
            <Field label="السبب"><TextInput value={reason} onChange={setReason} placeholder="مثلًا: تطبيق قانون يدوي" /></Field>
            <Button variant="danger" icon="crown" onClick={() => act('إعلان الفائز؟', 'اللعبة بتخلص فورًا.', () => { dispatch({ type: 'ADMIN_DECLARE_WINNER', factionId: winFaction, reason }); onClose(); }, true)}>إعلان الفائز</Button>
          </div>
        </Panel>
      </div>
    </Modal>
  );
}

/* ---------- results (game over) ---------- */
export function ResultsBody({ s }: { s: MatchState }) {
  const [showRoles, setShowRoles] = useState(true);
  if (!s.winner) return null;
  const f = factionById(s.config, s.winner.factionId);
  const m = s.config.mechanics;
  const passed = s.log.filter(l => l.kind === 'election' && l.text.startsWith('نجح التصويت')).length;
  const failed = s.log.filter(l => l.kind === 'election' && l.text.startsWith('فشل التصويت')).length;
  return (
    <div className="results">
      <div className="victory" style={{ '--fc': f?.color } as React.CSSProperties}>
        <Icon name={f?.icon} size={54} stroke={1.3} />
        <p className="eyebrow">الفوز</p>
        <h1>فاز {f?.name ?? 'فريق'}</h1>
        <p className="victory-reason">{s.winner.reason}</p>
      </div>

      <div className="results-grid">
        <Panel title="الملخص">
          <dl className="stats">
            <div><dt>الجولات</dt><dd className="num">{s.round}</dd></div>
            <div><dt>تصويتات ناجحة</dt><dd className="num">{passed}/{passed + failed}</dd></div>
            {s.config.tracks.map(t => <div key={t.id}><dt>{t.name}</dt><dd className="num">{s.tracks[t.id]}/{t.spaces.length}</dd></div>)}
            <div><dt>لاعبين خرجوا</dt><dd className="num">{s.players.filter(p => !p.alive).length}</dd></div>
          </dl>
          <h4 className="mt">تاريخ {m.policyTitle}</h4>
          <div className="history-strip">
            {s.enacted.length === 0 ? <span className="muted small">ما انعتمد شي.</span> : s.enacted.map((e, i) => {
              const c = cardById(s.config, e.cardId);
              const fc = factionById(s.config, c?.factionId);
              return <span key={i} className="history-chip" style={{ '--fc': fc?.color ?? '#888' } as React.CSSProperties} title={`الجولة ${e.round}: ${c?.name}${e.chaos ? ' (فوضى)' : ''}`}><Icon name={fc?.icon ?? 'circle'} size={12} />{e.chaos && '!'}</span>;
            })}
          </div>
        </Panel>

        <Panel title="اللاعبين" actions={<Toggle checked={showRoles} onChange={setShowRoles} label="أظهر الأدوار" />}>
          <ul className="role-reveal-list">
            {s.players.map(p => {
              const r = roleById(s.config, p.roleId);
              const rf = factionById(s.config, r?.factionId);
              const won = rf?.id === s.winner!.factionId;
              return (
                <li key={p.id} className={won && showRoles ? 'won' : ''}>
                  <span className="strong">{p.name}</span>{!p.alive && <span className="tag tag-dead"><Icon name="skull" size={11} />خارج</span>}
                  {showRoles ? <span className="faction-chip" style={{ '--fc': rf?.color } as React.CSSProperties}><Icon name={r?.icon} size={13} />{r?.name}</span> : <span className="muted small">مخفي</span>}
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <LogPanel s={s} />
    </div>
  );
}
