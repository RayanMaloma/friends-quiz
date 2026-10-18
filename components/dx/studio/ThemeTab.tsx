"use client";

import React, { useEffect, useState } from 'react';
import type { AnimationPref, ButtonShape, CardFrame, ShadowStyle, Theme, ThemeColors, PagePattern } from '@/lib/dx/types/config';
import { useStore } from '@/components/dx/store';
import { Badge, Button, ColorField, Field, IconButton, Panel, Range, Select, TextInput, useConfirm } from '@/components/dx/components/ui';
import { IconPicker, ImagePicker } from '@/components/dx/components/AssetImage';
import { CardView } from '@/components/dx/components/CardView';
import { BoardView } from '@/components/dx/components/BoardView';
import { FONT_OPTIONS, SAMPLE_THEMES } from '@/lib/dx/config/themes';
import { deepClone, uid } from '@/lib/dx/config/ids';
import { contrastRatio } from '@/lib/dx/theme/applyTheme';
import { PATTERNS } from './IdentityTab';
import { Icon } from '@/components/dx/components/Icon';

const COLOR_LABELS: [keyof ThemeColors, string][] = [
  ['primary', 'الأساسي'], ['onPrimary', 'النص على الأساسي'], ['secondary', 'الثانوي'], ['accent', 'المميّز'],
  ['bg', 'خلفية الصفحة'], ['surface', 'اللوحات'], ['surfaceAlt', 'اللوحات (بديل)'], ['text', 'النص'],
  ['textMuted', 'النص الباهت'], ['border', 'الإطارات'], ['success', 'نجاح'], ['danger', 'خطر'],
];

export function ThemeTab() {
  const { config, update, setPreviewTheme } = useStore();
  const confirm = useConfirm();
  const [sel, setSel] = useState(config.activeThemeId);
  const t = config.themes.find(x => x.id === sel) ?? config.themes[0];
  useEffect(() => {
    setPreviewTheme(t.id !== config.activeThemeId ? t.id : null);
  }, [t.id, config.activeThemeId, setPreviewTheme]);
  useEffect(() => () => setPreviewTheme(null), [setPreviewTheme]);

  const set = (fn: (th: Theme) => void) => update(c => { const th = c.themes.find(x => x.id === t.id); if (th) fn(th); });
  const contrast = contrastRatio(t.colors.text, t.colors.surface);
  const contrastPrimary = contrastRatio(t.colors.onPrimary, t.colors.primary);
  const sampleCard = config.cards.find(c => c.type === 'policy' && !c.archived) ?? config.cards[0];
  const board = config.boards.find(b => b.id === config.activeBoardId) ?? config.boards[0];

  return (
    <div className="studio-split">
      <div className="studio-form">
        <Panel title="الثيمات" actions={<>
          <Button size="sm" icon="plus" onClick={() => {
            const n = deepClone(t); n.id = uid('theme'); n.name = `${t.name} (مخصص)`; n.builtIn = false;
            update(c => { c.themes.push(n); }); setSel(n.id);
          }}>جديد من هذا</Button>
        </>}>
          <div className="theme-list">
            {config.themes.map(th => (
              <div key={th.id} className={`theme-item ${th.id === sel ? 'active' : ''}`}>
                <button type="button" className="theme-pick" onClick={() => setSel(th.id)} aria-pressed={th.id === sel}>
                  <span className="theme-swatches">{[th.colors.bg, th.colors.surface, th.colors.primary, th.colors.secondary, th.colors.accent].map((c, i) => <i key={i} style={{ background: c }} />)}</span>
                  <span className="theme-name" style={{ fontFamily: th.fonts.heading }}>{th.name}</span>
                  {th.id === config.activeThemeId && <Badge>المفعّل</Badge>}
                </button>
                <IconButton icon="copy" label={`نسخ ${th.name}`} onClick={() => { const n = deepClone(th); n.id = uid('theme'); n.name = `${th.name} نسخة`; n.builtIn = false; update(c => { c.themes.push(n); }); setSel(n.id); }} />
                <IconButton icon="trash" label={`حذف ${th.name}`} disabled={config.themes.length <= 1} onClick={async () => {
                  if (!(await confirm({ title: `حذف الثيم «${th.name}»؟`, message: 'القوانين والبطاقات ما تتأثر.', confirmLabel: 'حذف', danger: true }))) return;
                  update(c => { c.themes = c.themes.filter(x => x.id !== th.id); if (c.activeThemeId === th.id) c.activeThemeId = c.themes[0].id; });
                  setSel(config.activeThemeId === th.id ? config.themes.find(x => x.id !== th.id)!.id : config.activeThemeId);
                }} />
              </div>
            ))}
          </div>
          <div className="row gap-s wrap">
            <Button size="sm" variant="ghost" icon="refresh" onClick={async () => {
              if (!(await confirm({ title: 'استرجاع الثيمات الجاهزة؟', message: 'يرجّع أي ثيم جاهز حذفته، ويرجّع الثيمات الجاهزة المعدّلة لأصلها.', confirmLabel: 'استرجاع' }))) return;
              update(c => { SAMPLE_THEMES.forEach(st => { const i = c.themes.findIndex(x => x.id === st.id); if (i >= 0) c.themes[i] = deepClone(st); else c.themes.push(deepClone(st)); }); });
            }}>استرجاع الثيمات الجاهزة</Button>
          </div>
        </Panel>

        {sel !== config.activeThemeId && (
          <div className="preview-banner" role="status">
            <Icon name="eye" size={16} /> معاينة «{t.name}» على كل الشاشات.
            <Button size="sm" variant="primary" onClick={() => update(c => { c.activeThemeId = t.id; })}>استخدم هذا الثيم</Button>
          </div>
        )}

        <Panel title="الاسم">
          <Field label="اسم الثيم"><TextInput value={t.name} onChange={v => set(x => { x.name = v; })} /></Field>
        </Panel>

        <Panel title="الألوان">
          <div className="grid-2">
            {COLOR_LABELS.map(([k, label]) => <ColorField key={k} label={label} value={t.colors[k]} onChange={v => set(x => { x.colors[k] = v; })} />)}
          </div>
          <p className={`small ${contrast < 4.5 ? 'warn' : 'muted'}`}>تباين النص على اللوحات: {contrast.toFixed(1)}:1 {contrast < 4.5 ? '— أقل من حد الوضوح 4.5:1' : '✓'}</p>
          <p className={`small ${contrastPrimary < 4.5 ? 'warn' : 'muted'}`}>تباين نص الأزرار: {contrastPrimary.toFixed(1)}:1 {contrastPrimary < 4.5 ? '— جرّب «النص على الأساسي» أفتح أو أغمق' : '✓'}</p>
        </Panel>

        <Panel title="الخطوط">
          <div className="grid-2">
            <Field label="خط العناوين"><Select value={t.fonts.heading} onChange={v => set(x => { x.fonts.heading = v; })} options={FONT_OPTIONS} /></Field>
            <Field label="خط النص"><Select value={t.fonts.body} onChange={v => set(x => { x.fonts.body = v; })} options={FONT_OPTIONS} /></Field>
            <Field label="سماكة العناوين"><Select value={String(t.fonts.headingWeight)} onChange={v => set(x => { x.fonts.headingWeight = Number(v); })} options={['400', '500', '600', '700', '800'].map(v => ({ value: v, label: v }))} /></Field>
            <Field label="حالة العناوين"><Select value={t.fonts.headingCase} onChange={v => set(x => { x.fonts.headingCase = v; })} options={[{ value: 'none', label: 'مثل ما هو مكتوب' }, { value: 'uppercase', label: 'أحرف كبيرة' }]} /></Field>
          </div>
        </Panel>

        <Panel title="الأزرار واللوحات والنوافذ">
          <div className="grid-2">
            <Field label="شكل الأزرار"><Select<ButtonShape> value={t.buttonShape} onChange={v => set(x => { x.buttonShape = v; })} options={[{ value: 'square', label: 'مربع' }, { value: 'rounded', label: 'مدوّر' }, { value: 'pill', label: 'كبسولة' }, { value: 'cut', label: 'زوايا مقصوصة' }]} /></Field>
            <Field label="الظلال والتأثيرات"><Select<ShadowStyle> value={t.shadow} onChange={v => set(x => { x.shadow = v; })} options={[{ value: 'none', label: 'مسطّح' }, { value: 'soft', label: 'ناعم' }, { value: 'hard', label: 'ظل حاد' }, { value: 'glow', label: 'توهّج' }]} /></Field>
            <Range label="تدوير الزوايا" value={t.radius} min={0} max={24} onChange={v => set(x => { x.radius = v; })} suffix="px" />
            <Range label="عرض الإطار" value={t.borderWidth} min={0} max={4} onChange={v => set(x => { x.borderWidth = v; })} suffix="px" />
            <Range label="شفافية اللوحات" value={Math.round(t.panelOpacity * 100)} min={50} max={100} onChange={v => set(x => { x.panelOpacity = v / 100; })} suffix="%" />
            <Range label="تغبيش خلفية النوافذ" value={t.modalBlur} min={0} max={16} onChange={v => set(x => { x.modalBlur = v; })} suffix="px" />
          </div>
        </Panel>

        <Panel title="الخلفيات واللوحة">
          <Field label="نقشة الصفحة"><Select<PagePattern> value={t.pagePattern} onChange={v => set(x => { x.pagePattern = v; })} options={PATTERNS} /></Field>
          <ImagePicker label="صورة خلفية الصفحة" value={t.pageBackground} onChange={v => set(x => { x.pageBackground = v; })} aspect={16 / 9} allowPosition={false} />
          <ColorField label="لون اللوحة" value={t.boardColor} onChange={v => set(x => { x.boardColor = v; })} />
          <ImagePicker label="خامة اللوحة" value={t.boardTexture} onChange={v => set(x => { x.boardTexture = v; })} hint="تتكرر تحت اللوحة" allowPosition={false} />
        </Panel>

        <Panel title="البطاقات والعلامات">
          <div className="grid-2">
            <Field label="إطار البطاقة"><Select<CardFrame> value={t.cardFrame} onChange={v => set(x => { x.cardFrame = v; })} options={[{ value: 'none', label: 'بدون' }, { value: 'simple', label: 'بسيط' }, { value: 'double', label: 'خط مزدوج' }, { value: 'ornate', label: 'زوايا مزخرفة' }, { value: 'neon', label: 'نيون' }, { value: 'stamp', label: 'حافة طابع' }]} /></Field>
            <ColorField label="لون ظهر البطاقة" value={t.cardBackColor} onChange={v => set(x => { x.cardBackColor = v; })} />
          </div>
          <ImagePicker label="صورة ظهر البطاقة" value={t.cardBack} onChange={v => set(x => { x.cardBack = v; })} aspect={0.7} hint="لكل بطاقة ما لها ظهر خاص" />
          <IconPicker label="أيقونة الشعار" hint="ظهور البطاقات والعلامات الافتراضية" value={t.emblemIcon} onChange={v => set(x => { x.emblemIcon = v; })} />
        </Panel>

        <Panel title="الحركة">
          <Field label="الحركة"><Select<AnimationPref> value={t.animations} onChange={v => set(x => { x.animations = v; })} options={[{ value: 'full', label: 'كاملة' }, { value: 'reduced', label: 'مخففة' }, { value: 'none', label: 'بدون' }]} /></Field>
          <p className="small muted">الأجهزة اللي تطلب حركة أقل تاخذ حركة مخففة دائمًا.</p>
        </Panel>
      </div>

      <div className="studio-preview">
        <p className="eyebrow">معاينة مباشرة — {t.name}</p>
        <div className="theme-preview">
          <h2>مثال على العنوان</h2>
          <p>مثال على النص. <span className="muted">نص باهت.</span></p>
          <div className="row gap-s wrap">
            <button type="button" className="dbtn dbtn-primary dbtn-md" tabIndex={-1}>الأساسي</button>
            <button type="button" className="dbtn dbtn-secondary dbtn-md" tabIndex={-1}>الثانوي</button>
            <button type="button" className="dbtn dbtn-accent dbtn-md" tabIndex={-1}>لون مميّز</button>
          </div>
          <div className="row gap-m wrap center">
            {sampleCard && <CardView card={sampleCard} scale={0.6} />}
            {sampleCard && <CardView card={sampleCard} scale={0.6} flipped />}
          </div>
          <BoardView config={config} board={board} state={{ tracks: Object.fromEntries(config.tracks.map(tr => [tr.id, Math.min(2, tr.spaces.length)])), electionTracker: 1, drawPile: 12, discardPile: 3, playerCount: config.mechanics.minPlayers + 2 }} />
        </div>
      </div>
    </div>
  );
}
