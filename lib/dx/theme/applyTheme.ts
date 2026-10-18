/**
 * THEME MANAGEMENT
 * Converts a Theme object into CSS custom properties on the .dx container.
 * Every component styles itself only through these variables, so
 * switching theme restyles menus, board, cards and status chips at
 * once — and never touches game rules.
 */
import type React from 'react';
import type { Asset, Theme } from '../types/config';

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Readable text colour (near-black or near-white) for a background. */
export function readableOn(bg: string) {
  return luminance(bg) > 0.4 ? '#14110d' : '#fbf7ef';
}

function pattern(t: Theme): string {
  const ink = rgba(t.colors.text, 0.06);
  switch (t.pagePattern) {
    case 'dots': return `radial-gradient(${ink} 1.2px, transparent 1.4px) 0 0 / 18px 18px`;
    case 'grid': return `linear-gradient(${ink} 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(90deg, ${ink} 1px, transparent 1px) 0 0 / 28px 28px`;
    case 'stripes': return `repeating-linear-gradient(135deg, ${ink} 0 2px, transparent 2px 14px)`;
    case 'diamonds': return `linear-gradient(45deg, ${ink} 25%, transparent 25%, transparent 75%, ${ink} 75%) 0 0 / 26px 26px, linear-gradient(45deg, ${ink} 25%, transparent 25%, transparent 75%, ${ink} 75%) 13px 13px / 26px 26px`;
    case 'paper': return `radial-gradient(ellipse at 20% 10%, ${rgba('#ffffff', 0.25)}, transparent 60%), radial-gradient(ellipse at 80% 90%, ${rgba(t.colors.text, 0.07)}, transparent 55%)`;
    default: return 'none';
  }
}

const SHADOWS = (t: Theme) => ({
  none: 'none',
  soft: `0 6px 24px ${rgba('#000000', 0.18)}`,
  hard: `3px 3px 0 ${t.colors.border}`,
  glow: `0 0 0 1px ${rgba(t.colors.primary, 0.5)}, 0 0 18px ${rgba(t.colors.primary, 0.35)}`,
}[t.shadow]);

export function themeVars(t: Theme, assets: Record<string, Asset>): Record<string, string> {
  const img = (id?: string) => (id && assets[id] ? `url("${assets[id].url}")` : 'none');
  const dark = luminance(t.colors.bg) < 0.2;
  const btnRadius = { square: '0px', rounded: `${Math.max(4, t.radius)}px`, pill: '999px', cut: '0px' }[t.buttonShape];
  const anim = { full: '1', reduced: '0.4', none: '0' }[t.animations];
  return {
    '--c-primary': t.colors.primary,
    '--c-secondary': t.colors.secondary,
    '--c-accent': t.colors.accent,
    '--c-bg': t.colors.bg,
    '--c-surface': t.colors.surface,
    '--c-surface-alt': t.colors.surfaceAlt,
    '--c-text': t.colors.text,
    '--c-muted': t.colors.textMuted,
    '--c-border': t.colors.border,
    '--c-danger': t.colors.danger,
    '--c-success': t.colors.success,
    '--c-on-primary': t.colors.onPrimary,
    '--c-on-secondary': readableOn(t.colors.secondary),
    '--c-on-accent': readableOn(t.colors.accent),
    '--c-panel': rgba(t.colors.surface, t.panelOpacity),
    '--c-primary-soft': rgba(t.colors.primary, 0.14),
    '--c-ring': rgba(t.colors.accent, 0.75),
    '--c-overlay': rgba(dark ? '#000000' : '#1a1410', 0.6),
    '--font-heading': t.fonts.heading,
    '--font-body': t.fonts.body,
    '--heading-weight': String(t.fonts.headingWeight),
    '--heading-case': t.fonts.headingCase,
    '--radius': `${t.radius}px`,
    '--btn-radius': btnRadius,
    '--btn-clip': t.buttonShape === 'cut' ? 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)' : 'none',
    '--shadow': SHADOWS(t),
    '--bw': `${t.borderWidth}px`,
    '--page-image': img(t.pageBackground.assetId),
    '--page-pattern': pattern(t),
    '--board-color': t.boardColor,
    '--board-texture': img(t.boardTexture.assetId),
    '--card-back-color': t.cardBackColor,
    '--card-back-image': img(t.cardBack.assetId),
    '--modal-blur': `${t.modalBlur}px`,
    '--anim': anim,
    'color-scheme': dark ? 'dark' : 'light',
  };
}

/** Inline style + data attributes for the .dx container that wraps every game screen. */
export function themeContainerProps(t: Theme, assets: Record<string, Asset>) {
  const vars = themeVars(t, assets);
  const style: Record<string, string> = {};
  Object.entries(vars).forEach(([k, v]) => {
    if (k === 'color-scheme') style.colorScheme = v;
    else style[k] = v;
  });
  return { style: style as React.CSSProperties, 'data-anim': t.animations, 'data-frame': t.cardFrame };
}
