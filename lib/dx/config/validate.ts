/**
 * Import validation & repair.
 * Gives human-readable errors for broken files and fills in missing
 * optional fields so older/hand-edited configs keep working.
 * Runs on the server for every save, and in the browser for imports.
 */
import type { GameConfig } from '../types/config';
import { classicTemplate } from './templates';
import { deepClone } from './ids';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function validateConfig(raw: unknown): { config?: GameConfig; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { errors: ['الملف مو كائن JSON.'], warnings };

  const required: [string, 'object' | 'array'][] = [
    ['identity', 'object'], ['factions', 'array'], ['roles', 'array'], ['cards', 'array'],
    ['tracks', 'array'], ['mechanics', 'object'], ['rules', 'array'], ['distribution', 'array'],
  ];
  for (const [k, t] of required) {
    const v = raw[k];
    if (t === 'array' ? !Array.isArray(v) : !isObj(v)) errors.push(`الجزء "${k}" ناقص أو غير صالح.`);
  }
  if (errors.length) return { errors, warnings };

  // Merge onto a full default so any missing optional keys are filled.
  const def = classicTemplate();
  const c = deepClone(raw) as unknown as GameConfig;
  c.schemaVersion = 1;
  c.identity = { ...def.identity, ...(c.identity || {}) };
  c.mechanics = { ...def.mechanics, ...(c.mechanics || {}) };
  if (!Array.isArray(c.themes) || !c.themes.length) { c.themes = def.themes; warnings.push('ما فيه ثيمات — انضافت الثيمات الجاهزة.'); }
  c.themes = c.themes.map(t => ({ ...def.themes[0], ...t, colors: { ...def.themes[0].colors, ...(t.colors || {}) }, fonts: { ...def.themes[0].fonts, ...(t.fonts || {}) } }));
  if (!c.themes.some(t => t.id === c.activeThemeId)) c.activeThemeId = c.themes[0].id;
  if (!Array.isArray(c.boards) || !c.boards.length) { c.boards = def.boards; warnings.push('ما فيه تصميم لوحة — انضافت اللوحة الأساسية.'); }
  c.boards = c.boards.map(b => ({ ...def.boards[0], ...b, trackPlacements: { ...(b.trackPlacements || {}) } }));
  if (!c.boards.some(b => b.id === c.activeBoardId)) c.activeBoardId = c.boards[0].id;
  if (!Array.isArray(c.cardTypes)) c.cardTypes = def.cardTypes;
  if (!Array.isArray(c.rulesText)) c.rulesText = [];
  c.presetName = typeof c.presetName === 'string' && c.presetName ? c.presetName : (c.identity.name || 'لعبة مستوردة');
  c.baseTemplate = c.baseTemplate || 'classic';

  const ids = (arr: { id?: unknown }[], label: string) => {
    const seen = new Set<string>();
    arr.forEach((x, i) => {
      if (typeof x?.id !== 'string' || !x.id) errors.push(`${label} رقم ${i + 1} ما له معرّف.`);
      else if (seen.has(x.id)) errors.push(`المعرّف "${x.id}" (${label}) مستخدم مرتين.`);
      else seen.add(x.id);
    });
    return seen;
  };
  const facIds = ids(c.factions, 'فريق');
  const roleIds = ids(c.roles, 'دور');
  const cardIds = ids(c.cards, 'بطاقة');
  const trackIds = ids(c.tracks, 'مسار');

  c.roles.forEach(r => {
    if (!facIds.has(r.factionId)) errors.push(`الدور «${r.name}» تابع لفريق غير موجود.`);
    r.knowledge = (r.knowledge || []).map(k => ({ ...k, seesRoleIds: (k.seesRoleIds || []).filter(id => roleIds.has(id)) }));
    r.portrait = r.portrait || {};
  });
  c.cards.forEach(cd => {
    const d = def.cards[0];
    cd.front = { ...d.front, ...(cd.front || {}) };
    cd.back = { ...d.back, ...(cd.back || {}) };
    if (cd.factionId && !facIds.has(cd.factionId)) {
      warnings.push(`البطاقة «${cd.name}» كانت مربوطة بفريق محذوف؛ انشال الربط.`);
      cd.factionId = undefined;
    }
  });
  c.tracks.forEach(t => {
    if (!facIds.has(t.factionId)) errors.push(`المسار «${t.name}» مربوط بفريق غير موجود.`);
    if (!Array.isArray(t.spaces) || t.spaces.length < 1) errors.push(`المسار «${t.name}» يحتاج خانة وحدة على الأقل.`);
    t.powerProfiles = Array.isArray(t.powerProfiles) ? t.powerProfiles : [];
  });
  c.mechanics.deck = (c.mechanics.deck || []).filter(d => {
    if (!cardIds.has(d.cardId)) { warnings.push('عنصر في الرزمة يشير لبطاقة محذوفة وانشال.'); return false; }
    return true;
  });
  c.rules.forEach(r => {
    if (r.params?.trackId && !trackIds.has(r.params.trackId)) warnings.push(`القانون «${r.name}» يشير لمسار محذوف.`);
    if (r.condition?.kind === 'trackAtLeast' && !trackIds.has(r.condition.trackId)) warnings.push(`شرط القانون «${r.name}» على مسار محذوف.`);
    r.condition = r.condition || { kind: 'always' };
    r.params = r.params || {};
  });
  c.distribution.forEach(d => {
    Object.keys(d.counts || {}).forEach(k => { if (!roleIds.has(k)) delete d.counts[k]; });
  });
  if (c.mechanics.minPlayers > c.mechanics.maxPlayers) errors.push('أقل عدد لاعبين أكبر من أكثر عدد.');

  return errors.length ? { errors, warnings } : { config: c, errors, warnings };
}
