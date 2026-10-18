"use client";

/**
 * A player's phone. Everything secret happens here and only here:
 * the role card (hold to flip — let go and it hides), the ballot, the
 * legislative cards, the veto answer and the leader's private powers.
 * Everything public is on the TV; the phone just says "look at the TV".
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, MatchState } from '@/lib/dx/types/match';
import { useStore } from '@/components/dx/store';
import { Button } from '@/components/dx/components/ui';
import { Icon } from '@/components/dx/components/Icon';
import { CardView } from '@/components/dx/components/CardView';
import { cardById, factionById, playerName, roleById, vetoAvailable, voters } from '@/lib/dx/engine/helpers';
import { membershipCard, policyBack, roleCard, voteCard } from './cards';

export interface Known { playerId: string; name: string; roleId: string }

function useAct() {
  const { dispatch, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const act = useCallback(async (a: Action) => {
    setBusy(true);
    const err = await dispatch(a);
    setBusy(false);
    if (err) toast(err, 'error');
    return !err;
  }, [dispatch, toast]);
  return { act, busy };
}

/* ------------------------------------------------------------------ */
/* Role card: press and hold to see it. Releasing (or leaving the app)  */
/* hides it again, so nobody can peek at a phone left on the table.     */
/* ------------------------------------------------------------------ */

export function HoldCard({ s, meId, known, big, onSeen }: {
  s: MatchState; meId: string; known: Known[]; big?: boolean; onSeen?: () => void;
}) {
  const me = s.players.find(p => p.id === meId);
  const role = roleById(s.config, me?.roleId);
  const [held, setHeld] = useState(false);
  const seenRef = useRef(false);

  useEffect(() => {
    const hide = () => setHeld(false);
    const onVis = () => { if (document.visibilityState !== 'visible') hide(); };
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('blur', hide); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const show = () => {
    setHeld(true);
    if (!seenRef.current) { seenRef.current = true; onSeen?.(); }
  };

  if (!me || !role) return null;
  const fac = factionById(s.config, role.factionId);
  // Not held: render a blank stand-in, so the role is not even in the page.
  const real = roleCard(s, role);
  const card = held ? real : { ...real, name: '', description: '', flavor: '', rarity: '', category: '', factionId: undefined, front: real.back };

  return (
    <div className={`hold-card ${big ? 'hold-card-big' : ''} ${held ? 'is-held' : ''}`}>
      <button
        type="button"
        className="hold-card-btn"
        aria-label="اضغط مطوّل عشان تشوف دورك"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); show(); }}
        onPointerUp={() => setHeld(false)}
        onPointerCancel={() => setHeld(false)}
        onLostPointerCapture={() => setHeld(false)}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); show(); } }}
        onKeyUp={() => setHeld(false)}
        onBlur={() => setHeld(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <CardView card={card} flipped={!held} scale={big ? 1.25 : 0.62} config={s.config} label={held ? role.name : 'بطاقتك (مقلوبة)'} />
      </button>
      {held ? (
        <div className="hold-card-info" aria-live="polite">
          <p className="eyebrow">أنت</p>
          <h2 className="reveal-role">{role.name}</h2>
          <p><span className="faction-chip" style={{ '--fc': fac?.color } as React.CSSProperties}><Icon name={fac?.icon} size={14} />{fac?.name}</span></p>
          {big && role.secretInfo && <p className="secret small"><Icon name="lock" size={13} /> {role.secretInfo}</p>}
          {known.length > 0 && (
            <div className="known">
              <strong>تعرف:</strong>
              <ul>{known.map(k => <li key={k.playerId}><span className="strong">{k.name}</span> — {roleById(s.config, k.roleId)?.name}</li>)}</ul>
            </div>
          )}
          {big && role.winCondition && <p className="small"><strong>تفوز:</strong> {role.winCondition}</p>}
        </div>
      ) : (
        <p className="hold-card-hint"><Icon name="eye" size={15} /> اضغط مطوّل على البطاقة عشان تشوف دورك</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LookAtTv({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="phone-wait">
      <Icon name="eye" size={34} stroke={1.4} />
      <h2>{title}</h2>
      {sub && <p className="muted">{sub}</p>}
    </div>
  );
}

/** Secret cards stay face-down until the player taps "show", so a lit-up phone doesn't leak them. */
function SecretHand({ s, title, sub, confirmLabel, onConfirm, busy, extra }: {
  s: MatchState; title: string; sub: string; confirmLabel: string; onConfirm: (index: number) => void; busy: boolean; extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const back = policyBack(s);
  return (
    <div className="phone-action">
      <h2>{title}</h2>
      <p className="muted small">{sub}</p>
      <div className="hand phone-hand">
        {s.hand.map((cid, i) => {
          const c = open ? cardById(s.config, cid) : back;
          if (!c) return null;
          return (
            <CardView key={i} card={c} flipped={!open} scale={0.62} config={s.config}
              onClick={open ? () => setPick(i) : () => setOpen(true)} selected={open && pick === i}
              label={open ? `${c.name}${pick === i ? ' (مختارة)' : ''}` : 'بطاقة مقلوبة — اضغط للعرض'} />
          );
        })}
      </div>
      {!open ? (
        <Button variant="primary" size="lg" icon="eye" onClick={() => setOpen(true)}>اعرض البطاقات</Button>
      ) : (
        <div className="col gap-s">
          <Button variant="primary" size="lg" icon="check" disabled={pick === null || busy} onClick={() => pick !== null && onConfirm(pick)}>{confirmLabel}</Button>
          <Button size="sm" variant="ghost" icon="eyeoff" onClick={() => { setOpen(false); setPick(null); }}>اخفِ</Button>
        </div>
      )}
      {extra}
    </div>
  );
}

function Ballot({ s, meId }: { s: MatchState; meId: string }) {
  const { act, busy } = useAct();
  const m = s.config.mechanics;
  const mine = s.votes[meId] as 'yes' | 'no' | 'hidden' | undefined;
  const cast = mine === 'yes' || mine === 'no' ? mine : null;
  return (
    <div className="phone-action">
      <h2>توافق على تشكيل {m.governmentTitle}؟</h2>
      <p className="muted small">{m.leaderTitle}: <strong>{playerName(s, s.leaderId)}</strong> · {m.nomineeTitle}: <strong>{playerName(s, s.nomineeId)}</strong></p>
      <div className="ballot-cards">
        {(['yes', 'no'] as const).map(v => (
          <CardView key={v} card={voteCard(s, v)} scale={1} compact config={s.config} disabled={busy}
            onClick={() => act({ type: 'CAST_VOTE', playerId: meId, vote: v })} selected={cast === v}
            label={`صوّت ${v === 'yes' ? m.yesLabel : m.noLabel}`} />
        ))}
      </div>
      <p className={`small ${cast ? 'ok' : 'muted'}`}>
        {cast ? `صوّتت «${cast === 'yes' ? m.yesLabel : m.noLabel}» ✓ — تقدر تغيّر لين تنكشف الأصوات.` : 'اختار بطاقة. الأصوات تنكشف كلها مع بعض.'}
      </p>
    </div>
  );
}

function VetoAnswer({ s }: { s: MatchState }) {
  const { act, busy } = useAct();
  const m = s.config.mechanics;
  return (
    <div className="phone-action">
      <h2>{m.nomineeTitle} {playerName(s, s.nomineeId)} يطلب فيتو</h2>
      <p className="muted small">إذا وافقت، تنرمي البطاقتين ويتقدم {m.electionTrackerTitle}. إذا رفضت، لازم يعتمد بطاقة.</p>
      <div className="col gap-s">
        <Button variant="danger" size="lg" icon="check" disabled={busy} onClick={() => act({ type: 'VETO_RESPONSE', accept: true })}>أوافق على الفيتو</Button>
        <Button variant="primary" size="lg" icon="x" disabled={busy} onClick={() => act({ type: 'VETO_RESPONSE', accept: false })}>أرفض — لازم يعتمد</Button>
      </div>
    </div>
  );
}

function PrivatePower({ s }: { s: MatchState }) {
  const { act, busy } = useAct();
  const [open, setOpen] = useState(false);
  const m = s.config.mechanics;
  const pp = s.pendingPower!;
  const done = <Button variant="primary" size="lg" icon="check" disabled={busy} onClick={() => act({ type: 'POWER_DONE' })}>خلصت — كمّل</Button>;
  if (!open) {
    return (
      <div className="phone-action">
        <h2>{pp.kind === 'peek' ? 'نظرة على الرزمة' : 'نتيجة التحقيق'}</h2>
        <p className="muted small">تأكد إن ما أحد يشوف جوالك.</p>
        <Button variant="primary" size="lg" icon="eye" onClick={() => setOpen(true)}>اعرض</Button>
      </div>
    );
  }
  if (pp.kind === 'peek') {
    return (
      <div className="phone-action">
        <h2>أعلى رزمة {m.policyTitle}</h2>
        <p className="muted small">بالترتيب، الأولى على اليمين. تبقى بنفس الترتيب.</p>
        <div className="hand phone-hand">{(pp.peek ?? []).map((cid, i) => { const c = cardById(s.config, cid); return c ? <CardView key={i} card={c} scale={0.6} config={s.config} /> : null; })}</div>
        {done}
      </div>
    );
  }
  const f = factionById(s.config, pp.result?.factionId);
  const card = f ? membershipCard(s, f.id) : undefined;
  return (
    <div className="phone-action">
      <p className="eyebrow">التحقيق</p>
      <h2>{playerName(s, pp.result?.targetId)} هو</h2>
      {card && <CardView card={card} scale={0.8} config={s.config} />}
      <p><span className="faction-chip big" style={{ '--fc': f?.color } as React.CSSProperties}><Icon name={f?.icon} size={18} />{f?.membershipLabel || f?.name}</span></p>
      <p className="small muted">تقدر تقول للطاولة أي شي — حتى لو كذبت.</p>
      {done}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function PhoneGame({ s, meId, known }: { s: MatchState; meId: string; known: Known[] }) {
  const { act, busy } = useAct();
  const m = s.config.mechanics;
  const me = s.players.find(p => p.id === meId)!;
  const isLeader = s.leaderId === meId;
  const isNominee = s.nomineeId === meId;
  const [seenNow, setSeenNow] = useState(false);

  if (s.phase === 'roleReveal') {
    const confirmed = s.roleSeen.includes(meId);
    return (
      <div className="phone-stack">
        <HoldCard s={s} meId={meId} known={known} big onSeen={() => setSeenNow(true)} />
        {confirmed ? (
          <p className="ok center">تمام ✓ ننتظر الباقين…</p>
        ) : (
          <Button variant="primary" size="lg" icon="check" disabled={busy || !seenNow} onClick={() => act({ type: 'SEE_ROLE', playerId: meId })}>
            {seenNow ? 'شفت دوري' : 'شوف دورك أول'}
          </Button>
        )}
      </div>
    );
  }

  let main: React.ReactNode;
  if (s.phase === 'gameOver' && s.winner) {
    const f = factionById(s.config, s.winner.factionId);
    const myFaction = roleById(s.config, me.roleId)?.factionId;
    main = (
      <div className="victory phone-victory" style={{ '--fc': f?.color } as React.CSSProperties}>
        <Icon name={f?.icon} size={44} stroke={1.3} />
        <h1>{myFaction === f?.id ? 'فزت! 🎉' : 'خسرت'}</h1>
        <p>فاز {f?.name}: {s.winner.reason}</p>
        <p className="small">الأدوار كلها على الشاشة.</p>
      </div>
    );
  } else if (!me.alive) {
    main = <LookAtTv title="خرجت من اللعبة 💀" sub="ما تصوّت ولا تتكلم. تابع من الشاشة." />;
  } else if (s.phase === 'vote' && voters(s).some(p => p.id === meId)) {
    main = <Ballot s={s} meId={meId} />;
  } else if (s.phase === 'leaderLegislate' && isLeader) {
    main = (
      <SecretHand key={`l-${s.round}-${s.hand.length}`} s={s} busy={busy}
        title="ارمِ بطاقة وحدة"
        sub={`الباقي يروح إلى ${m.nomineeTitle} ${playerName(s, s.nomineeId)}.`}
        confirmLabel="ارمِ البطاقة المختارة"
        onConfirm={(i) => act({ type: 'LEADER_DISCARD', index: i })} />
    );
  } else if (s.phase === 'nomineeLegislate' && isNominee) {
    const veto = vetoAvailable(s);
    main = (
      <SecretHand key={`n-${s.round}-${s.vetoDeclined}`} s={s} busy={busy}
        title="اعتمد بطاقة وحدة"
        sub={s.vetoDeclined ? `${m.leaderTitle} رفض الفيتو — لازم تعتمد وحدة.` : 'البطاقة الثانية تنرمي مقلوبة.'}
        confirmLabel="اعتمد البطاقة المختارة"
        onConfirm={(i) => act({ type: 'NOMINEE_ENACT', index: i })}
        extra={veto ? (
          <div className="veto-box">
            <span className="small">الفيتو متاح: تقترح ترمي البطاقتين.</span>
            <Button variant="danger" icon="x" disabled={busy} onClick={() => act({ type: 'REQUEST_VETO' })}>اطلب فيتو</Button>
          </div>
        ) : null} />
    );
  } else if (s.phase === 'vetoResponse' && isLeader) {
    main = <VetoAnswer s={s} />;
  } else if (s.phase === 'power' && isLeader && s.pendingPower && (s.pendingPower.kind === 'peek' || s.pendingPower.result)) {
    main = <PrivatePower key={`${s.round}-${s.pendingPower.kind}`} s={s} />;
  } else {
    main = <LookAtTv {...statusLine(s, meId)} />;
  }

  return (
    <div className="phone-stack">
      {main}
      <HoldCard s={s} meId={meId} known={known} />
    </div>
  );
}

/** What a phone with nothing to do says. */
function statusLine(s: MatchState, meId: string): { title: string; sub?: string } {
  const m = s.config.mechanics;
  const leader = playerName(s, s.leaderId);
  switch (s.phase) {
    case 'nominate':
      return s.leaderId === meId
        ? { title: `أنت ${m.leaderTitle} 👑`, sub: `اختار ${m.nomineeTitle} وقوله بصوت عالي — المضيف يسجله على الشاشة.` }
        : { title: `${leader} يرشّح ${m.nomineeTitle}`, sub: 'تناقشوا! الترشيح يتسجل على الشاشة.' };
    case 'vote':
      return { title: 'التصويت شغّال', sub: `${m.leaderTitle} ما يصوّت هالمرة.` };
    case 'voteReveal':
      return { title: 'النتيجة على الشاشة 👀' };
    case 'leaderLegislate':
      return { title: `${leader} يختار البطاقات…` };
    case 'nomineeLegislate':
      return { title: `${playerName(s, s.nomineeId)} يعتمد بطاقة…` };
    case 'vetoResponse':
      return { title: `${leader} يقرر الفيتو…` };
    case 'power':
      return s.leaderId === meId
        ? { title: 'عندك صلاحية!', sub: 'قول اختيارك بصوت عالي — المضيف يسجله على الشاشة.' }
        : { title: `${leader} يستخدم صلاحية…`, sub: 'تابع الشاشة.' };
    default:
      return { title: 'شوف الشاشة 📺' };
  }
}
