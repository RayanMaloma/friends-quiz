"use client";

import React from 'react';
import type { GameConfig } from '@/lib/dx/types/config';
import { Badge } from '@/components/dx/components/ui';
import { Icon } from '@/components/dx/components/Icon';
import { describeCondition, POWER_HELP, POWER_LABELS } from '@/lib/dx/engine/helpers';
import { POWER_ICONS } from '@/components/dx/components/BoardView';

export function RulesBody({ config }: { config: GameConfig }) {
  const m = config.mechanics;
  const reset = (m.trackerReset ?? 'chaosOnly') === 'chaosOnly'
    ? 'ويحتفظ بعدّه لين ذاك الوقت'
    : m.trackerReset === 'onEnact' ? 'ويتصفّر كل ما انعتمدت بطاقة' : 'ويتصفّر كل ما نجح تصويت';
  return (
    <div className="rules-body">
      {config.rulesText.map(sec => (
        <section key={sec.id} className="rules-sec">
          <h2>{sec.title}</h2>
          {sec.body.split('\n').filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
        </section>
      ))}

      <section className="rules-sec">
        <h2>الفرق والأدوار</h2>
        <div className="role-cards">
          {config.factions.map(f => (
            <div key={f.id} className="faction-block" style={{ '--fc': f.color } as React.CSSProperties}>
              <h3><Icon name={f.icon} size={18} /> {f.name}</h3>
              <p className="small">{f.description}</p>
              <ul>
                {config.roles.filter(r => r.factionId === f.id).map(r => (
                  <li key={r.id}><strong>{r.name}</strong>{r.abilities ? ` — ${r.abilities}` : ''}{r.winCondition ? <span className="muted small"> يفوز: {r.winCondition}</span> : null}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="rules-sec">
        <h2>توزيع الأدوار حسب عدد اللاعبين</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>اللاعبين</th>{config.roles.map(r => <th key={r.id}>{r.name}</th>)}</tr></thead>
            <tbody>{config.distribution.map(d => (
              <tr key={d.players}><td className="num">{d.players}</td>{config.roles.map(r => <td key={r.id} className="num">{d.counts[r.id] ?? 0}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="rules-sec">
        <h2>صلاحيات اللوحة</h2>
        {config.tracks.map(t => (
          <div key={t.id}>
            <h3>{t.name} <span className="muted small">({t.spaces.length} خانات)</span></h3>
            {t.powerProfiles.filter(p => p.powers.some(x => x !== 'none')).length === 0 ? <p className="small muted">ما فيه صلاحيات على هذا المسار.</p> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>اللاعبين</th>{t.spaces.map((_, i) => <th key={i} className="num">{i + 1}</th>)}</tr></thead>
                  <tbody>{t.powerProfiles.map(p => (
                    <tr key={p.id}><td className="num">{p.minPlayers}–{p.maxPlayers}</td>{t.spaces.map((_, i) => {
                      const k = p.powers[i] ?? 'none';
                      return <td key={i} title={POWER_LABELS[k]}>{k !== 'none' ? <span className="power-cell"><Icon name={POWER_ICONS[k]} size={14} /> <span className="small">{POWER_LABELS[k]}</span></span> : <span className="muted">·</span>}</td>;
                    })}</tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        ))}
        <dl className="power-defs">
          {(['investigate', 'peek', 'specialElection', 'execute'] as const).map(k => (
            <div key={k}><dt><Icon name={POWER_ICONS[k]} size={14} /> {POWER_LABELS[k]}</dt><dd className="small">{POWER_HELP[k]}</dd></div>
          ))}
        </dl>
      </section>

      <section className="rules-sec">
        <h2>القوانين وشروط الفوز</h2>
        <ul className="rule-list">
          {config.rules.map(r => (
            <li key={r.id} className={r.enabled ? '' : 'off'}>
              <div className="row gap-s wrap">
                <strong>{r.name}</strong>
                {!r.enabled ? <Badge>متوقف</Badge> : r.automated ? <Badge title="اللعبة تطبقه">تلقائي</Badge> : <Badge title="المضيف يطبقه">يدوي</Badge>}
                <span className="muted small">{describeCondition(r.condition, config)}</span>
              </div>
              <p className="small">{r.params.text || r.description}</p>
            </li>
          ))}
        </ul>
        <p className="small muted">
          التصويت: {(m.leaderVotes ?? true) ? 'كل اللاعبين الأحياء يصوّتون' : `كل الأحياء يصوّتون ما عدا ${m.leaderTitle}`}؛
          {' '}{m.votePassRule === 'majority' ? 'أكثر من ٥٠٪' : '٥٠٪ أو أكثر'} «{m.yesLabel}» تنتخب {m.governmentTitle}.
          {' '}{(m.voteReveal ?? 'percent') === 'percent' ? 'الأصوات سرّية: تنعلن النسبة بس.' : 'الأصوات تنكشف بالأسماء.'}
          {' '}كل جلسة تسحب {m.drawCount} بطاقات. بعد {m.electionTrackerLength} تصويتات فاشلة {m.electionTrackerTitle} يسبب فوضى، {reset}.
        </p>
      </section>
    </div>
  );
}
