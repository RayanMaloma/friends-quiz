"use client";

import React from 'react';
import { useStore } from '@/components/dx/store';
import { Field, Panel, Select, TextArea, TextInput, Button } from '@/components/dx/components/ui';
import { AssetImage, IconPicker, ImagePicker } from '@/components/dx/components/AssetImage';
import { Icon } from '@/components/dx/components/Icon';
import { FONT_OPTIONS } from '@/lib/dx/config/themes';
import type { ButtonShape, ShadowStyle, PagePattern } from '@/lib/dx/types/config';
import { ColorField } from '@/components/dx/components/ui';

export function IdentityTab() {
  const { config, update, theme, go } = useStore();
  const id = config.identity;
  const t = theme;
  const setT = (fn: (th: typeof t) => void) => update(c => { const th = c.themes.find(x => x.id === t.id); if (th) fn(th); });

  return (
    <div className="studio-split">
      <div className="studio-form">
        <Panel title="الاسم">
          <Field label="اسم اللعبة"><TextInput value={id.name} onChange={v => update(c => { c.identity.name = v; })} maxLength={60} /></Field>
          <Field label="العنوان الفرعي"><TextInput value={id.subtitle} onChange={v => update(c => { c.identity.subtitle = v; })} maxLength={90} /></Field>
          <Field label="الشعار النصي" hint="سطر قصير تحت العنوان الفرعي."><TextArea rows={2} value={id.tagline} onChange={v => update(c => { c.identity.tagline = v; })} /></Field>
        </Panel>
        <Panel title="الصور">
          <ImagePicker label="الشعار" value={id.logo} onChange={v => update(c => { c.identity.logo = v; })} hint="المربعة أفضل" />
          <IconPicker label="رمز الشعار" hint="يُستخدم لما ما فيه صورة شعار" value={id.logoGlyph} onChange={v => update(c => { c.identity.logoGlyph = v; })} />
          <ImagePicker label="أيقونة المتصفح" value={id.favicon} onChange={v => update(c => { c.identity.favicon = v; })} hint="أيقونة تبويب المتصفح" allowPosition={false} />
          <ImagePicker label="خلفية الشاشة الرئيسية" value={id.homeBackground} onChange={v => update(c => { c.identity.homeBackground = v; })} aspect={16 / 9} />
        </Panel>
        <Panel title={<>شكل الواجهة <span className="muted small">— تعديل ثيم «{t.name}»</span></>} actions={<Button size="sm" variant="ghost" icon="palette" onClick={() => go('theme')}>كل خيارات الثيم</Button>}>
          <div className="grid-2">
            <Field label="خط العناوين"><Select value={t.fonts.heading} onChange={v => setT(x => { x.fonts.heading = v; })} options={withCurrent(t.fonts.heading)} /></Field>
            <Field label="خط النص"><Select value={t.fonts.body} onChange={v => setT(x => { x.fonts.body = v; })} options={withCurrent(t.fonts.body)} /></Field>
            <ColorField label="الأساسي" value={t.colors.primary} onChange={v => setT(x => { x.colors.primary = v; })} />
            <ColorField label="الثانوي" value={t.colors.secondary} onChange={v => setT(x => { x.colors.secondary = v; })} />
            <ColorField label="لون مميّز" value={t.colors.accent} onChange={v => setT(x => { x.colors.accent = v; })} />
            <ColorField label="خلفية الصفحة" value={t.colors.bg} onChange={v => setT(x => { x.colors.bg = v; })} />
            <Field label="شكل الأزرار"><Select<ButtonShape> value={t.buttonShape} onChange={v => setT(x => { x.buttonShape = v; })} options={[{ value: 'square', label: 'مربع' }, { value: 'rounded', label: 'مدوّر' }, { value: 'pill', label: 'كبسولة' }, { value: 'cut', label: 'زوايا مقصوصة' }]} /></Field>
            <Field label="الظلال والتأثيرات"><Select<ShadowStyle> value={t.shadow} onChange={v => setT(x => { x.shadow = v; })} options={[{ value: 'none', label: 'مسطّح' }, { value: 'soft', label: 'ظل ناعم' }, { value: 'hard', label: 'ظل حاد (مطبوع)' }, { value: 'glow', label: 'توهّج' }]} /></Field>
            <Field label="نقشة الخلفية"><Select<PagePattern> value={t.pagePattern} onChange={v => setT(x => { x.pagePattern = v; })} options={PATTERNS} /></Field>
            <Field label="سماكة الإطار"><Select value={String(t.borderWidth)} onChange={v => setT(x => { x.borderWidth = Number(v); })} options={['0', '1', '2', '3'].map(v => ({ value: v, label: `${v}px` }))} /></Field>
          </div>
        </Panel>
      </div>

      <div className="studio-preview">
        <p className="eyebrow">معاينة مباشرة — الشاشة الرئيسية</p>
        <div className="mini-home">
          {id.homeBackground.assetId && <AssetImage image={id.homeBackground} alt="" className="home-bg" />}
          <div className="mini-home-inner">
            <div className="home-logo small-logo">
              {id.logo.assetId ? <AssetImage image={id.logo} alt="logo" /> : <span className="logo-glyph"><Icon name={id.logoGlyph || 'eye'} size="60%" stroke={1.4} /></span>}
            </div>
            <h2 className="home-title">{id.name || 'لعبة بدون اسم'}</h2>
            <p className="home-sub">{id.subtitle}</p>
            <div className="col gap-s mini-menu">
              <button type="button" className="dbtn dbtn-primary dbtn-md" tabIndex={-1}>لعبة جديدة</button>
              <button type="button" className="dbtn dbtn-secondary dbtn-md" tabIndex={-1}>تخصيص اللعبة</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const PATTERNS: { value: PagePattern; label: string }[] = [
  { value: 'none', label: 'بدون' }, { value: 'paper', label: 'ورق' }, { value: 'dots', label: 'نقاط' },
  { value: 'grid', label: 'شبكة' }, { value: 'stripes', label: 'خطوط' }, { value: 'diamonds', label: 'معيّنات' },
];

export function withCurrent(v: string) {
  return FONT_OPTIONS.some(f => f.value === v) ? FONT_OPTIONS : [{ label: 'خط مخصص', value: v }, ...FONT_OPTIONS];
}
