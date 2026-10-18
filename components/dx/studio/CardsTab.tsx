"use client";

import React, { useMemo, useState } from 'react';
import type { CardDef, CardFace, CardFrame, PowerKind } from '@/lib/dx/types/config';
import { useStore } from '@/components/dx/store';
import { Badge, Button, ColorField, Field, IconButton, NumberInput, Panel, Range, Select, TextArea, TextInput, Toggle, moveItem, useConfirm } from '@/components/dx/components/ui';
import { IconPicker, ImagePicker } from '@/components/dx/components/AssetImage';
import { CardView } from '@/components/dx/components/CardView';
import { FONT_OPTIONS } from '@/lib/dx/config/themes';
import { POWER_LABELS } from '@/lib/dx/engine/helpers';
import { deepClone, uid } from '@/lib/dx/config/ids';
import { face, cardBackFace, makeCard } from '@/lib/dx/config/defaults';
const CARD_TYPE_LABELS: Record<string, string> = { policy: 'قانون', role: 'دور', faction: 'عضوية', vote: 'تصويت', reference: 'مرجع', event: 'حدث' };export const cardTypeLabel = (t: string) => CARD_TYPE_LABELS[t] ?? t;
import { Icon } from '@/components/dx/components/Icon';

const FRAMES: { value: CardFace['frame']; label: string }[] = [
  { value: 'theme', label: 'افتراضي الثيم' }, { value: 'none', label: 'بدون' }, { value: 'simple', label: 'بسيط' },
  { value: 'double', label: 'خط مزدوج' }, { value: 'ornate', label: 'مزخرف' }, { value: 'neon', label: 'نيون' }, { value: 'stamp', label: 'حافة طابع' },
];

function FaceEditor({ value, onChange, side }: { value: CardFace; onChange: (fn: (f: CardFace) => void) => void; side: 'front' | 'back' }) {
  return (
    <div className="face-editor">
      <ImagePicker label={`صورة ${side === 'front' ? 'الوجه' : 'الظهر'}`} value={value.image} onChange={v => onChange(f => { f.image = v; })} aspect={0.7}
        hint={side === 'back' ? 'فاضي = ظهر بطاقة الثيم' : 'تحل محل الأيقونة'} />
      <div className="grid-2">
        <ColorField label="الخلفية" value={value.bgColor} onChange={v => onChange(f => { f.bgColor = v; })} allowEmpty emptyLabel={side === 'back' ? 'ظهر بطاقة الثيم' : 'لوحة الثيم'} />
        <ColorField label="لون النص" value={value.textColor} onChange={v => onChange(f => { f.textColor = v; })} allowEmpty emptyLabel="نص الثيم" />
        <ColorField label="لون الإطار" value={value.borderColor} onChange={v => onChange(f => { f.borderColor = v; })} allowEmpty emptyLabel="إطار الثيم" />
        <Range label="عرض الإطار" value={value.borderWidth} min={0} max={8} onChange={v => onChange(f => { f.borderWidth = v; })} suffix="px" />
        <Field label="الإطار"><Select<CardFace['frame']> value={value.frame} onChange={v => onChange(f => { f.frame = v as CardFrame | 'theme'; })} options={FRAMES} /></Field>
        <Field label="الخط"><Select value={value.font} onChange={v => onChange(f => { f.font = v; })} options={[{ value: '', label: 'خط الثيم' }, ...FONT_OPTIONS]} /></Field>
        <IconPicker label="الأيقونة" value={value.icon} onChange={v => onChange(f => { f.icon = v; })} hint={side === 'back' ? 'فاضي = شعار الثيم' : undefined} />
      </div>
      <div className="row gap-m wrap">
        <Toggle checked={value.showTitle} onChange={v => onChange(f => { f.showTitle = v; })} label="أظهر الاسم" />
        <Toggle checked={value.showText} onChange={v => onChange(f => { f.showText = v; })} label="أظهر النص" />
        <Toggle checked={value.ornaments} onChange={v => onChange(f => { f.ornaments = v; })} label="زخارف الزوايا" />
      </div>
    </div>
  );
}

export function CardsTab() {
  const { config, update } = useStore();
  const confirm = useConfirm();
  const [sel, setSel] = useState(config.cards[0]?.id ?? '');
  const [typeFilter, setTypeFilter] = useState('all');
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [newType, setNewType] = useState('');
  const card = config.cards.find(c => c.id === sel);

  const list = useMemo(() => config.cards
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => (typeFilter === 'all' || c.type === typeFilter) && (showArchived || !c.archived) && c.name.toLowerCase().includes(q.toLowerCase())), [config.cards, typeFilter, showArchived, q]);

  const set = (fn: (c: CardDef) => void) => update(c => { const x = c.cards.find(y => y.id === sel); if (x) fn(x); });
  const deckCount = (id: string) => config.mechanics.deck.find(d => d.cardId === id)?.count ?? 0;
  const deckTotal = config.mechanics.deck.reduce((a, d) => a + d.count, 0);
  const usedBy = (id: string) => [
    ...config.roles.filter(r => r.cardId === id).map(r => `الدور «${r.name}»`),
    ...(deckCount(id) ? [`الرزمة (${deckCount(id)} نسخ)`] : []),
    ...(config.mechanics.yesCardId === id || config.mechanics.noCardId === id ? ['voting'] : []),
  ];

  const addCard = (type: string) => {
    const id = uid('card');
    update(c => { c.cards.push(makeCard({ id, name: `بطاقة ${cardTypeLabel(type)} جديدة`, type, front: face(), back: cardBackFace(), width: type === 'vote' ? 160 : 180, height: type === 'vote' ? 110 : 260, orientation: type === 'vote' ? 'landscape' : 'portrait' })); });
    setSel(id); setTypeFilter('all'); setQ('');
  };

  return (
    <div className="studio-split cards-split">
      <div className="studio-form">
        <Panel title="مكتبة البطاقات" actions={
          <Select value="" onChange={v => v && addCard(v)} aria-label="إضافة بطاقة" options={[{ value: '', label: '+ إضافة بطاقة…' }, ...config.cardTypes.map(t => ({ value: t, label: `بطاقة ${cardTypeLabel(t)}` }))]} />
        }>
          <div className="row gap-s wrap">
            <TextInput value={q} onChange={setQ} placeholder="بحث في البطاقات" aria-label="بحث في البطاقات" />
            <Select value={typeFilter} onChange={setTypeFilter} aria-label="تصفية حسب النوع" options={[{ value: 'all', label: 'كل الأنواع' }, ...config.cardTypes.map(t => ({ value: t, label: cardTypeLabel(t) }))]} />
            <Toggle checked={showArchived} onChange={setShowArchived} label="أظهر المؤرشف" />
          </div>
          <div className="card-list">
            {list.length === 0 && <p className="muted small">ما فيه بطاقات مطابقة.</p>}
            {list.map(({ c, i }) => (
              <div key={c.id} className={`list-row ${c.id === sel ? 'active' : ''} ${c.archived ? 'archived' : ''}`}>
                <span className="swatch" style={{ background: c.front.bgColor || 'var(--c-surface)' }}><Icon name={c.front.icon} size={12} /></span>
                <button type="button" className="grow list-btn" onClick={() => setSel(c.id)} aria-pressed={c.id === sel}>
                  {c.name} <span className="muted small">{cardTypeLabel(c.type)}{c.archived ? ' · مؤرشفة' : ''}{deckCount(c.id) ? ` · ×${deckCount(c.id)} في الرزمة` : ''}</span>
                </button>
                <IconButton icon="up" label="تحريك لفوق" disabled={i === 0} onClick={() => update(cf => { cf.cards = moveItem(cf.cards, i, i - 1); })} />
                <IconButton icon="down" label="تحريك لتحت" disabled={i === config.cards.length - 1} onClick={() => update(cf => { cf.cards = moveItem(cf.cards, i, i + 1); })} />
              </div>
            ))}
          </div>
          <details className="type-manager">
            <summary className="small">أنواع البطاقات ({config.cardTypes.length})</summary>
            <div className="row gap-s wrap">
              {config.cardTypes.map(t => <Badge key={t}>{cardTypeLabel(t)}</Badge>)}
            </div>
            <div className="row gap-s">
              <TextInput value={newType} onChange={setNewType} placeholder="نوع جديد، مثلًا: أداة" aria-label="نوع بطاقة جديد" />
              <Button size="sm" icon="plus" disabled={!newType.trim() || config.cardTypes.includes(newType.trim().toLowerCase())} onClick={() => { update(c => { c.cardTypes.push(newType.trim().toLowerCase()); }); setNewType(''); }}>إضافة نوع</Button>
            </div>
          </details>
        </Panel>

        <Panel title={`رزمة ${config.mechanics.policyTitle}`}>
          <p className="small muted">كم نسخة من كل بطاقة تنخلط في رزمة السحب. المجموع: <strong className="num">{deckTotal}</strong> (كل جلسة تسحب {config.mechanics.drawCount}).</p>
          {config.cards.filter(c => !c.archived && (c.type === 'policy' || c.type === 'event' || deckCount(c.id) > 0)).map(c => (
            <div key={c.id} className="row gap-s adjust-row">
              <span className="grow small">{c.name}{!c.factionId && c.type === 'policy' && <span className="warn"> (بدون فريق — ما يحرّك مسار)</span>}</span>
              <NumberInput value={deckCount(c.id)} min={0} max={60} aria-label={`نسخ ${c.name}`} onChange={v => update(cf => {
                const d = cf.mechanics.deck.find(x => x.cardId === c.id);
                if (d) d.count = v; else cf.mechanics.deck.push({ cardId: c.id, count: v });
                cf.mechanics.deck = cf.mechanics.deck.filter(x => x.count > 0);
              })} />
            </div>
          ))}
        </Panel>

        {card ? (
          <Panel title={`تعديل «${card.name}»`} actions={<>
            <IconButton icon="copy" label="نسخ البطاقة" onClick={() => { const n = deepClone(card); n.id = uid('card'); n.name = `${card.name} copy`; update(c => { const i = c.cards.findIndex(x => x.id === card.id); c.cards.splice(i + 1, 0, n); }); setSel(n.id); }} />
            <IconButton icon="archive" label={card.archived ? 'استرجاع البطاقة' : 'أرشفة البطاقة'} onClick={() => set(c => { c.archived = !c.archived; })} />
            <IconButton icon="trash" label="حذف البطاقة" onClick={async () => {
              const used = usedBy(card.id);
              if (!(await confirm({ title: `حذف «${card.name}»؟`, message: used.length ? <>البطاقة مستخدمة في: {used.join('، ')}. الروابط هذي بتنشال. الأرشفة تشيلها من اللعب بدون حذف.</> : 'ما ينفع التراجع.', confirmLabel: 'حذف', danger: true }))) return;
              update(c => {
                c.cards = c.cards.filter(x => x.id !== card.id);
                c.mechanics.deck = c.mechanics.deck.filter(d => d.cardId !== card.id);
                c.roles.forEach(r => { if (r.cardId === card.id) r.cardId = undefined; });
                if (c.mechanics.yesCardId === card.id) c.mechanics.yesCardId = undefined;
                if (c.mechanics.noCardId === card.id) c.mechanics.noCardId = undefined;
              });
              setSel(config.cards.find(x => x.id !== card.id)?.id ?? '');
            }} />
          </>}>
            {card.archived && <p className="warn small">مؤرشفة: مخفية وما تنوزع أبدًا. استرجعها عشان تستخدمها.</p>}
            <div className="grid-2">
              <Field label="اسم البطاقة"><TextInput value={card.name} onChange={v => set(c => { c.name = v; })} /></Field>
              <Field label="النوع"><Select value={card.type} onChange={v => set(c => { c.type = v; })} options={config.cardTypes.map(t => ({ value: t, label: cardTypeLabel(t) }))} /></Field>
              <Field label="الفريق" hint="لبطاقات القوانين هذا يحدد أي مسار يتحرك."><Select value={card.factionId ?? ''} onChange={v => set(c => { c.factionId = v || undefined; })} options={[{ value: '', label: 'بدون' }, ...config.factions.map(f => ({ value: f.id, label: f.name }))]} /></Field>
              <Field label="التصنيف"><TextInput value={card.category} onChange={v => set(c => { c.category = v; })} placeholder="optional" /></Field>
              <Field label="الندرة"><TextInput value={card.rarity} onChange={v => set(c => { c.rarity = v; })} placeholder="optional" /></Field>
              <Field label="مرجع القانون"><TextInput value={card.ruleRef} onChange={v => set(c => { c.ruleRef = v; })} placeholder="مثلًا: الجلسة التشريعية" /></Field>
            </div>
            <Field label="الوصف"><TextArea rows={2} value={card.description} onChange={v => set(c => { c.description = v; })} /></Field>
            <Field label="نص زخرفي"><TextInput value={card.flavor} onChange={v => set(c => { c.flavor = v; })} /></Field>
            <Field label="نص التأثير" hint="يظهر للاعبين؛ اشرح وش تسوي البطاقة."><TextArea rows={2} value={card.effect} onChange={v => set(c => { c.effect = v; })} /></Field>
            {(card.type === 'policy' || card.type === 'event' || deckCount(card.id) > 0) && (
              <div className="grid-2">
                <Field label="صلاحية عند الاعتماد" hint="تأثير تلقائي لما تُعتمد هذي البطاقة من الرزمة (غير خانات المسار)."><Select<PowerKind> value={card.onEnact ?? 'none'} onChange={v => set(c => { c.onEnact = v; })} options={(Object.keys(POWER_LABELS) as PowerKind[]).map(k => ({ value: k, label: POWER_LABELS[k] }))} /></Field>
                {card.onEnact === 'custom' && <Field label="التأثير المخصص المعروض"><TextInput value={card.onEnactText ?? ''} onChange={v => set(c => { c.onEnactText = v; })} /></Field>}
              </div>
            )}
            {card.type === 'vote' && (
              <Field label="مستخدم كـ"><Select value={config.mechanics.yesCardId === card.id ? 'yes' : config.mechanics.noCardId === card.id ? 'no' : ''} onChange={v => update(c => {
                if (c.mechanics.yesCardId === card.id) c.mechanics.yesCardId = undefined;
                if (c.mechanics.noCardId === card.id) c.mechanics.noCardId = undefined;
                if (v === 'yes') c.mechanics.yesCardId = card.id; if (v === 'no') c.mechanics.noCardId = card.id;
              })} options={[{ value: '', label: 'غير مستخدمة' }, { value: 'yes', label: `صوت «${config.mechanics.yesLabel}»` }, { value: 'no', label: `صوت «${config.mechanics.noLabel}»` }]} /></Field>
            )}
            <h4>الحجم</h4>
            <div className="grid-3">
              <Field label="العرض"><NumberInput value={card.width} min={60} max={600} onChange={v => set(c => { c.width = v; })} /></Field>
              <Field label="الارتفاع"><NumberInput value={card.height} min={60} max={600} onChange={v => set(c => { c.height = v; })} /></Field>
              <Field label="الاتجاه"><Select value={card.orientation} onChange={v => set(c => { c.orientation = v; })} options={[{ value: 'portrait', label: 'عمودي' }, { value: 'landscape', label: 'أفقي' }]} /></Field>
            </div>
            <div className="seg" role="group" aria-label="وجه البطاقة">
              <button type="button" className={side === 'front' ? 'on' : ''} aria-pressed={side === 'front'} onClick={() => { setSide('front'); setFlipped(false); }}>تصميم الوجه</button>
              <button type="button" className={side === 'back' ? 'on' : ''} aria-pressed={side === 'back'} onClick={() => { setSide('back'); setFlipped(true); }}>تصميم الظهر</button>
            </div>
            <FaceEditor key={side} side={side} value={card[side]} onChange={fn => set(c => fn(c[side]))} />
          </Panel>
        ) : <Panel><p className="muted">اختار بطاقة أو أضف وحدة عشان تعدّلها.</p></Panel>}
      </div>

      <div className="studio-preview">
        <p className="eyebrow">معاينة مباشرة</p>
        {card && (
          <div className="card-preview">
            <CardView card={card} flipped={flipped} scale={1.2} onClick={() => setFlipped(f => !f)} label={`${card.name} — اضغط للقلب`} />
            <Button icon="flip" onClick={() => setFlipped(f => !f)}>اقلب البطاقة</Button>
            <div className="row gap-s wrap center">
              <CardView card={card} scale={0.5} compact />
              <CardView card={card} scale={0.5} compact flipped />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
