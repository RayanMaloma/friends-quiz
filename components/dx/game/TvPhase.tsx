"use client";

/**
 * The TV's action area for the current phase. The TV never shows a secret:
 * it runs the public steps (the host taps the nomination and power targets
 * the table agreed on out loud) and shows who is acting on their phone.
 */
import React, { useState } from 'react';
import type { Action, MatchState } from '@/lib/dx/types/match';
import { useStore } from '@/components/dx/store';
import { Button, Tip, useConfirm } from '@/components/dx/components/ui';
import { Icon } from '@/components/dx/components/Icon';
import { CardView } from '@/components/dx/components/CardView';
import { playerName, POWER_HELP, POWER_LABELS, voteResult, voters } from '@/lib/dx/engine/helpers';
import { policyBack, RevealCard, voteCard } from './cards';

export interface TvHints {
  eligibleNomineeIds: string[];
  powerTargetIds: string[];
  waitingForIds: string[];
}

function useAct() {
  const { dispatch, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const act = async (a: Action) => {
    if (busy) return;
    setBusy(true);
    const err = await dispatch(a);
    setBusy(false);
    if (err) toast(err, 'error');
  };
  return { act, busy };
}

function names(s: MatchState, ids: string[]) {
  return ids.map(id => playerName(s, id)).join('، ');
}

function PhoneHint({ children }: { children: React.ReactNode }) {
  return <p className="tv-phone-hint"><Icon name="lock" size={16} /> {children}</p>;
}

function RoleReveal({ s, hints }: { s: MatchState; hints: TvHints }) {
  const { act, busy } = useAct();
  const seen = s.players.length - hints.waitingForIds.length;
  return (
    <div className="phase-box">
      <h3><Icon name="lock" size={18} /> الأدوار السرّية</h3>
      <PhoneHint>كل واحد يشوف دوره في جواله: اضغط مطوّل على البطاقة عشان تنقلب، وارفع إصبعك عشان تختفي.</PhoneHint>
      <div className="tv-progress"><span className="num">{seen}</span> / <span className="num">{s.players.length}</span> شافوا أدوارهم</div>
      {hints.waitingForIds.length > 0 && <p className="small muted">ننتظر: {names(s, hints.waitingForIds)}</p>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => act({ type: 'ADMIN_END_REVEAL' })}>ابدأ بدون انتظار</Button>
    </div>
  );
}

function Nominate({ s, hints }: { s: MatchState; hints: TvHints }) {
  const { act, busy } = useAct();
  const m = s.config.mechanics;
  const [pick, setPick] = useState<string | null>(null);
  return (
    <div className="phase-box">
      <h3><Icon name="crown" size={18} /> {playerName(s, s.leaderId)}، رشّح {m.nomineeTitle}</h3>
      <p className="muted small">{m.leaderTitle} يعلن اختياره بصوت عالي، والمضيف يضغط عليه هنا. اللي باهتين ما ينفع يترشحون هالجولة.</p>
      <div className="pick-grid">
        {s.players.filter(p => p.alive && p.id !== s.leaderId).map(p => {
          const ok = hints.eligibleNomineeIds.includes(p.id);
          return (
            <button key={p.id} type="button" className={`pick ${pick === p.id ? 'active' : ''}`} disabled={!ok} aria-pressed={pick === p.id} onClick={() => setPick(p.id)}>
              <span className="strong">{p.name}</span>
              {!ok && <span className="small muted">غير مؤهل</span>}
            </button>
          );
        })}
      </div>
      <Button variant="primary" icon="check" disabled={!pick || busy} onClick={() => pick && act({ type: 'NOMINATE', nomineeId: pick })}>
        رشّح {pick ? playerName(s, pick) : ''}
      </Button>
    </div>
  );
}

function VoteCollect({ s, hints }: { s: MatchState; hints: TvHints }) {
  const { act, busy } = useAct();
  const m = s.config.mechanics;
  const all = voters(s);
  const done = all.length - hints.waitingForIds.length;
  return (
    <div className="phase-box">
      <h3><Icon name="ballot" size={18} /> التصويت على {playerName(s, s.leaderId)} + {playerName(s, s.nomineeId)}</h3>
      <PhoneHint>صوّتوا من جوالاتكم: «{m.yesLabel}» أو «{m.noLabel}». تقدر تغيّر صوتك لين ينكشف.{!(m.leaderVotes ?? true) && <> {m.leaderTitle} ما يصوّت.</>}</PhoneHint>
      <div className="tv-progress"><span className="num">{done}</span> / <span className="num">{all.length}</span> صوّتوا</div>
      {hints.waitingForIds.length > 0 && <p className="small muted">ننتظر: {names(s, hints.waitingForIds)}</p>}
      <Button variant="primary" size="lg" icon="eye" disabled={hints.waitingForIds.length > 0 || busy} onClick={() => act({ type: 'REVEAL_VOTES' })}>
        اكشف الأصوات
      </Button>
    </div>
  );
}

function VoteReveal({ s }: { s: MatchState }) {
  const { act, busy } = useAct();
  const m = s.config.mechanics;
  const t = s.tally ?? voteResult(s);
  const secret = (m.voteReveal ?? 'percent') === 'percent';
  const threshold = m.votePassRule === 'atLeastHalf' ? '٥٠٪ أو أكثر' : 'أكثر من ٥٠٪';
  return (
    <div className="phase-box">
      <h3>النتيجة: <span className={t.passed ? 'ok' : 'bad'}>{t.passed ? 'انتُخبت' : 'انرفضت'}</span></h3>
      {secret ? (
        <div className="vote-meter" role="img" aria-label={`${t.pct}% صوّتوا ${m.yesLabel}`}>
          <div className="vote-meter-num num">{t.pct}%</div>
          <div className="vote-meter-label">صوّتوا «{m.yesLabel}»</div>
          <div className="vote-meter-bar"><span className={t.passed ? 'yes' : 'no'} style={{ width: `${t.pct}%` }} /><i style={{ insetInlineStart: '50%' }} aria-hidden /></div>
          <p className="small muted">{threshold} «{m.yesLabel}» تنتخب {m.governmentTitle}. الأصوات الفردية تبقى سرّية.</p>
        </div>
      ) : (
        <>
          <p className="num strong">{t.yes}–{t.no}</p>
          <div className="vote-reveal">
            {voters(s).filter(p => s.votes[p.id]).map((p, i) => (
              <div key={p.id} className="vote-chip">
                <RevealCard card={voteCard(s, s.votes[p.id])} scale={0.5} compact delay={150 + i * 80} config={s.config} />
                <span className="small strong">{p.name}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {!t.passed && <p className="small muted">{m.electionTrackerTitle} بيتقدم خانة.</p>}
      <Button variant="primary" icon="right" disabled={busy} onClick={() => act({ type: 'RESOLVE_VOTE' })}>كمّل</Button>
    </div>
  );
}

function Choosing({ s, who }: { s: MatchState; who: 'leader' | 'nominee' }) {
  const m = s.config.mechanics;
  const name = playerName(s, who === 'leader' ? s.leaderId : s.nomineeId);
  const back = policyBack(s);
  return (
    <div className="phase-box">
      <h3><Icon name="scroll" size={18} /> {who === 'leader' ? m.leaderTitle : m.nomineeTitle} {name} يختار…</h3>
      <div className="hand tv-hand">
        {s.hand.map((_, i) => <CardView key={i} card={back} flipped scale={0.6} config={s.config} />)}
      </div>
      <PhoneHint>
        {who === 'leader'
          ? `${name} يرمي بطاقة وحدة سرًّا من جواله، والباقي يروح إلى ${m.nomineeTitle} ${playerName(s, s.nomineeId)}.`
          : `${name} يعتمد بطاقة وحدة من جواله.`}
      </PhoneHint>
      {who === 'nominee' && s.vetoDeclined && <p className="small muted">{m.leaderTitle} رفض الفيتو — لازم يعتمد بطاقة.</p>}
    </div>
  );
}

function VetoWait({ s }: { s: MatchState }) {
  const m = s.config.mechanics;
  return (
    <div className="phase-box">
      <h3><Icon name="x" size={18} /> {m.nomineeTitle} {playerName(s, s.nomineeId)} يطلب فيتو</h3>
      <PhoneHint>{m.leaderTitle} {playerName(s, s.leaderId)} يقرر من جواله. إذا وافق، تنرمي البطاقتين ويتقدم {m.electionTrackerTitle}.</PhoneHint>
    </div>
  );
}

function Power({ s, hints }: { s: MatchState; hints: TvHints }) {
  const { act, busy } = useAct();
  const confirm = useConfirm();
  const m = s.config.mechanics;
  const pp = s.pendingPower!;
  const leader = playerName(s, s.leaderId);
  const [pick, setPick] = useState<string | null>(null);

  const privateStep = pp.kind === 'peek' || (pp.kind === 'investigate' && hints.waitingForIds.length > 0);
  if (privateStep) {
    return (
      <div className="phase-box">
        <h3><Icon name={pp.kind === 'peek' ? 'eye' : 'search'} size={18} /> {POWER_LABELS[pp.kind]}</h3>
        <PhoneHint>{pp.kind === 'peek' ? `${leader} يشوف أعلى الرزمة في جواله.` : `${leader} يشوف نتيجة التحقيق في جواله. يقدر يقول للطاولة أي شي — حتى لو كذب.`}</PhoneHint>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act({ type: 'POWER_DONE' })}>كمّل بدون انتظار</Button>
      </div>
    );
  }

  if (pp.kind === 'custom') {
    return (
      <div className="phase-box">
        <h3><Icon name="bolt" size={18} /> {pp.source}</h3>
        <p>{pp.text || POWER_HELP.custom}</p>
        <Button variant="primary" icon="check" disabled={busy} onClick={() => act({ type: 'POWER_DONE' })}>تم — كمّل</Button>
      </div>
    );
  }

  const targets = s.players.filter(p => hints.powerTargetIds.includes(p.id));
  const verb = pp.kind === 'investigate' ? 'حقّق في' : pp.kind === 'execute' ? 'أعدم' : 'اختر';
  return (
    <div className="phase-box">
      <h3><Icon name={pp.kind === 'execute' ? 'dagger' : pp.kind === 'investigate' ? 'search' : 'ballot'} size={18} /> {POWER_LABELS[pp.kind]} <Tip text={POWER_HELP[pp.kind]} /></h3>
      <p className="muted small">{leader} يختار لاعب{pp.kind === 'specialElection' ? ` يكون ${m.leaderTitle} الجاي` : ''} بصوت عالي، والمضيف يضغط عليه. ({pp.source})</p>
      {pp.kind === 'investigate' && <PhoneHint>النتيجة تطلع في جوال {leader} بس.</PhoneHint>}
      {targets.length === 0 ? (
        <>
          <p>ما فيه لاعب ينفع يُختار لهذي الصلاحية.</p>
          <Button variant="primary" disabled={busy} onClick={() => act({ type: 'POWER_DONE' })}>كمّل</Button>
        </>
      ) : (
        <>
          <div className="pick-grid">
            {targets.map(p => (
              <button key={p.id} type="button" className={`pick ${pick === p.id ? 'active' : ''}`} aria-pressed={pick === p.id} onClick={() => setPick(p.id)}>
                <span className="strong">{p.name}</span>
              </button>
            ))}
          </div>
          <Button variant={pp.kind === 'execute' ? 'danger' : 'primary'} disabled={!pick || busy} icon="check" onClick={async () => {
            if (!pick) return;
            if (pp.kind === 'execute' && !(await confirm({ title: `إعدام ${playerName(s, pick)}؟`, message: 'ما ينفع ترجع عنه.', confirmLabel: 'إعدام', danger: true }))) return;
            act({ type: 'POWER_TARGET', targetId: pick });
          }}>{verb} {pick ? playerName(s, pick) : ''}</Button>
        </>
      )}
    </div>
  );
}

export function TvPhase({ s, hints }: { s: MatchState; hints: TvHints }) {
  switch (s.phase) {
    case 'roleReveal': return <RoleReveal s={s} hints={hints} />;
    case 'nominate': return <Nominate key={s.round} s={s} hints={hints} />;
    case 'vote': return <VoteCollect s={s} hints={hints} />;
    case 'voteReveal': return <VoteReveal s={s} />;
    case 'leaderLegislate': return <Choosing s={s} who="leader" />;
    case 'nomineeLegislate': return <Choosing s={s} who="nominee" />;
    case 'vetoResponse': return <VetoWait s={s} />;
    case 'power': return <Power key={`${s.round}-${s.pendingPower?.kind}`} s={s} hints={hints} />;
    default: return null;
  }
}

export function phaseLabel(s: MatchState): string {
  const m = s.config.mechanics;
  return ({
    roleReveal: 'الأدوار السرّية',
    nominate: `${m.leaderTitle} يرشّح`,
    vote: 'التصويت',
    voteReveal: 'كشف الأصوات',
    leaderLegislate: `${m.leaderTitle} يختار`,
    nomineeLegislate: `${m.nomineeTitle} يختار`,
    vetoResponse: 'طلب فيتو',
    power: 'صلاحية تنفيذية',
    gameOver: 'انتهت اللعبة',
  } as const)[s.phase];
}
