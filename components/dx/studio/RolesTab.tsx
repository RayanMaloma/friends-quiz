"use client";

import React, { useState } from 'react';
import type { Faction, Role } from '@/lib/dx/types/config';
import { useStore } from '@/components/dx/store';
import { Button, ColorField, Field, IconButton, NumberInput, Panel, Select, TextArea, TextInput, Toggle, moveItem, useConfirm } from '@/components/dx/components/ui';
import { AssetImage, IconPicker, ImagePicker } from '@/components/dx/components/AssetImage';
import { Icon } from '@/components/dx/components/Icon';
import { uid, deepClone } from '@/lib/dx/config/ids';
import { CardView } from '@/components/dx/components/CardView';

export function RolesTab() {
  const { config, update } = useStore();
  const confirm = useConfirm();
  const [facSel, setFacSel] = useState(config.factions[0]?.id ?? '');
  const [roleSel, setRoleSel] = useState(config.roles[0]?.id ?? '');
  const fac = config.factions.find(f => f.id === facSel);
  const role = config.roles.find(r => r.id === roleSel);
  const setF = (fn: (f: Faction) => void) => update(c => { const x = c.factions.find(y => y.id === facSel); if (x) fn(x); });
  const setR = (fn: (r: Role) => void) => update(c => { const x = c.roles.find(y => y.id === roleSel); if (x) fn(x); });
  const m = config.mechanics;
  const roleCards = config.cards.filter(c => c.type === 'role');

  return (
    <div className="studio-stack">
      <div className="studio-split">
        <Panel title="الفرق" actions={<Button size="sm" icon="plus" onClick={() => {
          const id = uid('fac');
          update(c => { c.factions.push({ id, name: 'فريق جديد', color: '#7a6a9a', icon: 'star', emblem: {}, description: '', membershipLabel: 'فريق جديد' }); });
          setFacSel(id);
        }}>إضافة فريق</Button>}>
          <div className="list-compact">
            {config.factions.map(f => (
              <div key={f.id} className={`list-row ${f.id === facSel ? 'active' : ''}`}>
                <span className="swatch" style={{ background: f.color }}><Icon name={f.icon} size={12} /></span>
                <button type="button" className="grow list-btn" onClick={() => setFacSel(f.id)} aria-pressed={f.id === facSel}>{f.name} <span className="muted small">({config.roles.filter(r => r.factionId === f.id).length} roles)</span></button>
                <IconButton icon="trash" label={`حذف ${f.name}`} disabled={config.factions.length <= 1} onClick={async () => {
                  const roles = config.roles.filter(r => r.factionId === f.id);
                  if (roles.length) { await confirm({ title: 'الفريق فيه أدوار', message: `انقل أو احذف هذي الأدوار أول: ${roles.map(r => r.name).join('، ')}.`, confirmLabel: 'تمام', cancelLabel: 'إغلاق' }); return; }
                  if (!(await confirm({ title: `حذف «${f.name}»؟`, message: 'المسارات والبطاقات والقوانين المرتبطة فيه بتحتاج فريق جديد.', confirmLabel: 'حذف', danger: true }))) return;
                  update(c => {
                    c.factions = c.factions.filter(x => x.id !== f.id);
                    const fallback = c.factions[0].id;
                    c.tracks.forEach(t => { if (t.factionId === f.id) t.factionId = fallback; });
                    c.cards.forEach(cd => { if (cd.factionId === f.id) cd.factionId = undefined; });
                  });
                  setFacSel(config.factions.find(x => x.id !== f.id)!.id);
                }} />
              </div>
            ))}
          </div>
          {fac && (
            <div className="sub-editor">
              <div className="grid-2">
                <Field label="اسم الفريق"><TextInput value={fac.name} onChange={v => setF(x => { x.name = v; })} /></Field>
                <Field label="اسم نتيجة التحقيق" hint="اللي يعرفه القائد لما يحقق، مثل «ليبرالي»."><TextInput value={fac.membershipLabel} onChange={v => setF(x => { x.membershipLabel = v; })} /></Field>
                <ColorField label="اللون" value={fac.color} onChange={v => setF(x => { x.color = v; })} />
                <IconPicker label="الأيقونة" value={fac.icon} onChange={v => setF(x => { x.icon = v; })} />
              </div>
              <Field label="الوصف والهدف"><TextArea rows={3} value={fac.description} onChange={v => setF(x => { x.description = v; })} /></Field>
              <ImagePicker label="صورة الشعار" value={fac.emblem} onChange={v => setF(x => { x.emblem = v; })} />
            </div>
          )}
        </Panel>

        <Panel title="الأدوار (الشخصيات)" actions={<Button size="sm" icon="plus" onClick={() => {
          const id = uid('role');
          update(c => {
            c.roles.push({ id, name: 'دور جديد', factionId: facSel || c.factions[0].id, portrait: {}, icon: 'user', description: '', secretInfo: '', abilities: '', winCondition: '', loseCondition: '', knowledge: [], canBeLeader: true, canBeNominee: true, canBeTargeted: true });
            c.distribution.forEach(d => { d.counts[id] = 0; });
          });
          setRoleSel(id);
        }}>إضافة دور</Button>}>
          <div className="list-compact">
            {config.roles.map((r, i) => {
              const f = config.factions.find(x => x.id === r.factionId);
              return (
                <div key={r.id} className={`list-row ${r.id === roleSel ? 'active' : ''}`}>
                  <span className="swatch" style={{ background: f?.color }}><Icon name={r.icon} size={12} /></span>
                  <button type="button" className="grow list-btn" onClick={() => setRoleSel(r.id)} aria-pressed={r.id === roleSel}>{r.name} <span className="muted small">{f?.name}</span></button>
                  <IconButton icon="up" label="تحريك لفوق" disabled={i === 0} onClick={() => update(c => { c.roles = moveItem(c.roles, i, i - 1); })} />
                  <IconButton icon="copy" label={`Duplicate ${r.name}`} onClick={() => { const n = deepClone(r); n.id = uid('role'); n.name = `${r.name} copy`; update(c => { c.roles.push(n); c.distribution.forEach(d => { d.counts[n.id] = 0; }); }); setRoleSel(n.id); }} />
                  <IconButton icon="trash" label={`حذف ${r.name}`} disabled={config.roles.length <= 1} onClick={async () => {
                    if (!(await confirm({ title: `حذف الدور «${r.name}»؟`, message: 'بينشال من توزيع الأدوار ومن معرفة الأدوار الثانية. القوانين اللي تذكره توقف.', confirmLabel: 'حذف', danger: true }))) return;
                    update(c => {
                      c.roles = c.roles.filter(x => x.id !== r.id);
                      c.distribution.forEach(d => delete d.counts[r.id]);
                      c.roles.forEach(x => x.knowledge.forEach(k => { k.seesRoleIds = k.seesRoleIds.filter(id => id !== r.id); }));
                    });
                    setRoleSel(config.roles.find(x => x.id !== r.id)!.id);
                  }} />
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {role && (
        <Panel title={`تعديل الدور «${role.name}»`}>
          <div className="role-editor">
            <div className="role-editor-form">
              <div className="grid-2">
                <Field label="اسم الدور"><TextInput value={role.name} onChange={v => setR(x => { x.name = v; })} /></Field>
                <Field label="الفريق"><Select value={role.factionId} onChange={v => setR(x => { x.factionId = v; })} options={config.factions.map(f => ({ value: f.id, label: f.name }))} /></Field>
                <IconPicker label="الأيقونة" value={role.icon} onChange={v => setR(x => { x.icon = v; })} />
                <Field label="بطاقة الدور" hint="البطاقة اللي تظهر عند كشف الدور. صمّمها من تبويب البطاقات."><Select value={role.cardId ?? ''} onChange={v => setR(x => { x.cardId = v || undefined; })} options={[{ value: '', label: 'تلقائي (لون الفريق + أيقونته)' }, ...roleCards.map(c => ({ value: c.id, label: c.name }))]} /></Field>
              </div>
              <ImagePicker label="صورة / رسمة" value={role.portrait} onChange={v => setR(x => { x.portrait = v; })} aspect={0.8} />
              <Field label="الوصف العام"><TextArea rows={2} value={role.description} onChange={v => setR(x => { x.description = v; })} /></Field>
              <Field label="معلومة سرّية" hint="يظهر بس للاعب اللي معه هذا الدور، على جواله."><TextArea rows={2} value={role.secretInfo} onChange={v => setR(x => { x.secretInfo = v; })} /></Field>
              <Field label="قدرات خاصة"><TextArea rows={2} value={role.abilities} onChange={v => setR(x => { x.abilities = v; })} /></Field>
              <div className="grid-2">
                <Field label="يفوز لما"><TextArea rows={2} value={role.winCondition} onChange={v => setR(x => { x.winCondition = v; })} /></Field>
                <Field label="يخسر لما"><TextArea rows={2} value={role.loseCondition} onChange={v => setR(x => { x.loseCondition = v; })} /></Field>
              </div>
              <p className="small muted">شروط الفوز والخسارة التلقائية تنضبط من تبويب القوانين (مثل «انتخاب هذا الدور» أو «إعدام هذا الدور»).</p>
              <h4>الأهلية</h4>
              <div className="row gap-m wrap">
                <Toggle checked={role.canBeLeader} onChange={v => setR(x => { x.canBeLeader = v; })} label={`يقدر يكون ${m.leaderTitle}`} />
                <Toggle checked={role.canBeNominee} onChange={v => setR(x => { x.canBeNominee = v; })} label={`يقدر يكون ${m.nomineeTitle}`} />
                <Toggle checked={role.canBeTargeted} onChange={v => setR(x => { x.canBeTargeted = v; })} label="ينفع التحقيق فيه أو إعدامه" />
              </div>

              <h4>وش يعرف هذا الدور في البداية</h4>
              {role.knowledge.length === 0 && <p className="small muted">هذا الدور ما يعرف هوية أحد.</p>}
              {role.knowledge.map((k, ki) => (
                <div key={k.id} className="knowledge-row">
                  <div className="row gap-s wrap">
                    <span className="small">يشوف اللاعبين اللي هم:</span>
                    {config.roles.map(r => (
                      <label key={r.id} className="check">
                        <input type="checkbox" checked={k.seesRoleIds.includes(r.id)} onChange={e => setR(x => {
                          const kk = x.knowledge[ki];
                          kk.seesRoleIds = e.target.checked ? [...kk.seesRoleIds, r.id] : kk.seesRoleIds.filter(id => id !== r.id);
                        })} />
                        {r.name}
                      </label>
                    ))}
                  </div>
                  <div className="row gap-s wrap">
                    <Field label="بس مع على الأقل" inline><NumberInput value={k.minPlayers ?? 0} min={0} max={99} onChange={v => setR(x => { x.knowledge[ki].minPlayers = v || undefined; })} /></Field>
                    <Field label="وعلى الأكثر" inline><NumberInput value={k.maxPlayers ?? 0} min={0} max={99} onChange={v => setR(x => { x.knowledge[ki].maxPlayers = v || undefined; })} /></Field>
                    <span className="small muted grow">لاعبين (٠ = بدون حد)</span>
                    <IconButton icon="trash" label="إزالة" onClick={() => setR(x => { x.knowledge.splice(ki, 1); })} />
                  </div>
                </div>
              ))}
              <Button size="sm" variant="ghost" icon="plus" onClick={() => setR(x => { x.knowledge.push({ id: uid('k'), seesRoleIds: [] }); })}>إضافة قاعدة معرفة</Button>
            </div>
            <div className="role-editor-preview">
              <p className="eyebrow">معاينة الكشف</p>
              {role.portrait.assetId && <AssetImage image={role.portrait} alt={role.name} className="reveal-portrait" />}
              {(() => { const c = config.cards.find(x => x.id === role.cardId); return c ? <CardView card={c} scale={0.8} /> : null; })()}
              <strong>{role.name}</strong>
              <p className="small">{role.secretInfo}</p>
            </div>
          </div>
        </Panel>
      )}

      <Panel title="توزيع الأدوار حسب عدد اللاعبين">
        <div className="row gap-m wrap">
          <Field label="أقل عدد لاعبين" inline><NumberInput value={m.minPlayers} min={2} max={m.maxPlayers} onChange={v => update(c => { c.mechanics.minPlayers = v; })} /></Field>
          <Field label="أكثر عدد لاعبين" inline><NumberInput value={m.maxPlayers} min={m.minPlayers} max={30} onChange={v => update(c => { c.mechanics.maxPlayers = v; })} /></Field>
        </div>
        <div className="table-wrap">
          <table className="data-table dist-table">
            <thead><tr><th>اللاعبين</th>{config.roles.map(r => <th key={r.id}>{r.name}</th>)}<th>المجموع</th><th /></tr></thead>
            <tbody>
              {Array.from({ length: m.maxPlayers - m.minPlayers + 1 }, (_, i) => m.minPlayers + i).map(n => {
                const row = config.distribution.find(d => d.players === n);
                const total = row ? Object.values(row.counts).reduce((a, b) => a + b, 0) : 0;
                return (
                  <tr key={n} className={!row || total !== n ? 'bad-row' : ''}>
                    <td className="num strong">{n}</td>
                    {config.roles.map(r => (
                      <td key={r.id}>
                        <NumberInput value={row?.counts[r.id] ?? 0} min={0} max={n} aria-label={`${r.name} مع ${n} لاعبين`} onChange={v => update(c => {
                          let d = c.distribution.find(x => x.players === n);
                          if (!d) { d = { players: n, counts: {} }; c.distribution.push(d); c.distribution.sort((a, b) => a.players - b.players); }
                          d.counts[r.id] = v;
                        })} />
                      </td>
                    ))}
                    <td className={`num ${total !== n ? 'bad' : 'ok'}`}>{total}/{n}</td>
                    <td>{total !== n && <span className="small bad">{!row ? 'ناقص' : 'لازم يساوي عدد اللاعبين'}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
