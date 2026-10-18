"use client";

import React, { useState } from 'react';
import type { BoardDesign, BoardLayout, MarkerShape, PowerKind, Rect, SpaceShape, Track } from '@/lib/dx/types/config';
import { useStore } from '@/components/dx/store';
import { Badge, Button, ColorField, Field, IconButton, NumberInput, Panel, Range, Select, TextArea, TextInput, Toggle, moveItem, useConfirm } from '@/components/dx/components/ui';
import { IconPicker, ImagePicker } from '@/components/dx/components/AssetImage';
import { BoardView } from '@/components/dx/components/BoardView';
import { POWER_LABELS } from '@/lib/dx/engine/helpers';
import { deepClone, uid } from '@/lib/dx/config/ids';
import { defaultBoard } from '@/lib/dx/config/defaults';

const POWER_OPTIONS = (Object.keys(POWER_LABELS) as PowerKind[]).map(k => ({ value: k, label: POWER_LABELS[k] }));

export function BoardTab() {
  const { config, update } = useStore();
  const confirm = useConfirm();
  const [boardSel, setBoardSel] = useState(config.activeBoardId);
  const b = config.boards.find(x => x.id === boardSel) ?? config.boards[0];
  const [trackSel, setTrackSel] = useState(config.tracks[0]?.id ?? '');
  const track = config.tracks.find(t => t.id === trackSel) ?? config.tracks[0];
  const [spaceSel, setSpaceSel] = useState(0);
  const [elSel, setElSel] = useState<string | null>(null);
  const [players, setPlayers] = useState(Math.min(config.mechanics.maxPlayers, Math.max(config.mechanics.minPlayers, 7)));
  const [fill, setFill] = useState(2);

  const setB = (fn: (x: BoardDesign) => void) => update(c => { const x = c.boards.find(y => y.id === b.id); if (x) fn(x); });
  const setTr = (fn: (x: Track) => void) => update(c => { const x = c.tracks.find(y => y.id === track.id); if (x) fn(x); });
  const placement = (id: string, r: Rect) => setB(x => {
    if (id === '__tracker') x.trackerPlacement = r; else if (id === '__deck') x.deckPlacement = r; else x.trackPlacements[id] = r;
  });
  const rectOf = (id: string): Rect | undefined => id === '__tracker' ? b.trackerPlacement : id === '__deck' ? b.deckPlacement : b.trackPlacements[id];
  const align = (mode: 'left' | 'center' | 'right' | 'fullwidth' | 'distribute') => setB(x => {
    const ids = [...config.tracks.map(t => t.id), '__tracker', '__deck'];
    const get = (id: string) => (id === '__tracker' ? x.trackerPlacement : id === '__deck' ? x.deckPlacement : (x.trackPlacements[id] ??= { x: 4, y: 4, w: 92, h: 25 }));
    if (mode === 'distribute') {
      const items = ids.map(get).sort((a, c) => a.y - c.y);
      const total = items.reduce((s, r) => s + r.h, 0);
      const gap = Math.max(0, (100 - total) / (items.length + 1));
      let y = gap;
      items.forEach(r => { r.y = Math.round(y); y += r.h + gap; });
      return;
    }
    const target = elSel ? [elSel] : ids;
    target.forEach(id => {
      const r = get(id);
      if (mode === 'left') r.x = 3;
      if (mode === 'right') r.x = 97 - r.w;
      if (mode === 'center') r.x = Math.round((100 - r.w) / 2);
      if (mode === 'fullwidth') { r.x = 3; r.w = 94; }
    });
  });

  const sp = track?.spaces[Math.min(spaceSel, (track?.spaces.length ?? 1) - 1)];

  return (
    <div className="studio-split board-split">
      <div className="studio-form">
        <Panel title="تصاميم اللوحة المحفوظة" actions={<Button size="sm" icon="plus" onClick={() => {
          const n = deepClone(b); n.id = uid('board'); n.name = `${b.name} copy`;
          update(c => { c.boards.push(n); }); setBoardSel(n.id);
        }}>نسخ</Button>}>
          <div className="list-compact">
            {config.boards.map(x => (
              <div key={x.id} className={`list-row ${x.id === b.id ? 'active' : ''}`}>
                <button type="button" className="grow list-btn" onClick={() => setBoardSel(x.id)} aria-pressed={x.id === b.id}>{x.name}</button>
                {x.id === config.activeBoardId ? <Badge>مستخدمة</Badge> : <Button size="sm" variant="ghost" onClick={() => update(c => { c.activeBoardId = x.id; })}>استخدم</Button>}
                <IconButton icon="trash" label={`حذف ${x.name}`} disabled={config.boards.length <= 1} onClick={async () => {
                  if (!(await confirm({ title: `حذف اللوحة «${x.name}»؟`, message: 'المسارات والقوانين تبقى؛ بس هذا التصميم ينحذف.', confirmLabel: 'حذف', danger: true }))) return;
                  update(c => { c.boards = c.boards.filter(y => y.id !== x.id); if (c.activeBoardId === x.id) c.activeBoardId = c.boards[0].id; });
                  setBoardSel(config.boards.find(y => y.id !== x.id)!.id);
                }} />
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" icon="plus" onClick={() => {
            const n = defaultBoard(config.tracks.map(t => t.id), 'لوحة جديدة'); n.id = uid('board');
            update(c => { c.boards.push(n); }); setBoardSel(n.id);
          }}>لوحة جديدة فاضية</Button>
        </Panel>

        <Panel title="التخطيط">
          <Field label="اسم اللوحة"><TextInput value={b.name} onChange={v => setB(x => { x.name = v; })} /></Field>
          <div className="grid-2">
            <Field label="التخطيط" hint="«صفوف» و«جنب بعض» يناسبون أي شاشة. «حر» يخليك تسحب العناصر لأي مكان."><Select<BoardLayout> value={b.layout} onChange={v => setB(x => { x.layout = v; })} options={[{ value: 'stacked', label: 'صفوف' }, { value: 'split', label: 'جنب بعض' }, { value: 'freeform', label: 'حر (سحب وإفلات)' }]} /></Field>
            <Field label="الاتجاه"><Select value={b.orientation} onChange={v => setB(x => { x.orientation = v; })} options={[{ value: 'landscape', label: 'أفقي' }, { value: 'portrait', label: 'عمودي' }]} /></Field>
            <Range label="نسبة الأبعاد (حر)" value={b.aspect} min={0.8} max={2.4} step={0.05} onChange={v => setB(x => { x.aspect = v; })} suffix=":1" />
            <Range label="المسافات" value={b.spacing} min={0} max={40} onChange={v => setB(x => { x.spacing = v; })} suffix="px" />
            <Range label="الهامش الداخلي" value={b.padding} min={0} max={60} onChange={v => setB(x => { x.padding = v; })} suffix="px" />
            <Range label="شفافية لوحة المسار" value={Math.round(b.trackOpacity * 100)} min={0} max={100} onChange={v => setB(x => { x.trackOpacity = v / 100; })} suffix="%" />
          </div>
          {b.layout === 'freeform' && (
            <div className="align-tools">
              <span className="small muted">{elSel ? 'محاذاة المحدد:' : 'محاذاة الكل:'}</span>
              <Button size="sm" onClick={() => align('left')}>يسار</Button>
              <Button size="sm" onClick={() => align('center')}>وسط</Button>
              <Button size="sm" onClick={() => align('right')}>يمين</Button>
              <Button size="sm" onClick={() => align('fullwidth')}>عرض كامل</Button>
              <Button size="sm" onClick={() => align('distribute')}>توزيع عمودي</Button>
              {elSel && rectOf(elSel) && (
                <div className="grid-4">
                  {(['x', 'y', 'w', 'h'] as const).map(k => (
                    <Field key={k} label={{ x: 'يسار %', y: 'أعلى %', w: 'العرض %', h: 'الارتفاع %' }[k]}>
                      <NumberInput value={rectOf(elSel)![k]} min={0} max={100} onChange={v => placement(elSel, { ...rectOf(elSel)!, [k]: v })} />
                    </Field>
                  ))}
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel title="الصور والألوان">
          <ImagePicker label="خلفية اللوحة" value={b.background} onChange={v => setB(x => { x.background = v; })} aspect={b.aspect} />
          <ColorField label="لون اللوحة" value={b.bgColor} onChange={v => setB(x => { x.bgColor = v; })} allowEmpty emptyLabel="لون الثيم" />
          <Toggle checked={b.useThemeTexture} onChange={v => setB(x => { x.useThemeTexture = v; })} label="استخدم خامة لوحة الثيم" />
        </Panel>

        <Panel title="الخانات والعلامات">
          <div className="grid-2">
            <Field label="شكل الخانة"><Select<SpaceShape> value={b.spaceShape} onChange={v => setB(x => { x.spaceShape = v; })} options={[{ value: 'card', label: 'خانة البطاقة' }, { value: 'square', label: 'مربع' }, { value: 'circle', label: 'دائرة' }, { value: 'hex', label: 'سداسي' }]} /></Field>
            <Field label="علامة التقدم"><Select<MarkerShape> value={b.markerShape} onChange={v => setB(x => { x.markerShape = v; })} options={[{ value: 'token', label: 'قطعة' }, { value: 'circle', label: 'دائرة' }, { value: 'square', label: 'مربع' }, { value: 'diamond', label: 'معيّن' }, { value: 'image', label: 'صورة مخصصة' }]} /></Field>
            <ColorField label="لون العلامة" value={b.markerColor} onChange={v => setB(x => { x.markerColor = v; })} allowEmpty emptyLabel="لون المسار" />
            <IconPicker label="أيقونة العلامة" hint="فاضي = أيقونة الفريق" value={b.markerIcon} onChange={v => setB(x => { x.markerIcon = v; })} />
            <Field label="علامة اللاعب"><Select value={b.playerMarker} onChange={v => setB(x => { x.playerMarker = v; })} options={[{ value: 'initial', label: 'الحرف الأول' }, { value: 'number', label: 'رقم المقعد' }, { value: 'icon', label: 'الأيقونة' }]} /></Field>
            {b.playerMarker === 'icon' && <IconPicker label="أيقونة اللاعب" value={b.playerMarkerIcon} onChange={v => setB(x => { x.playerMarkerIcon = v; })} />}
          </div>
          {b.markerShape === 'image' && <ImagePicker label="صورة العلامة" value={b.markerImage} onChange={v => setB(x => { x.markerImage = v; })} />}
          <Toggle checked={b.showSpaceLabels} onChange={v => setB(x => { x.showSpaceLabels = v; })} label="أظهر أسماء الخانات" />
          <Toggle checked={b.showTrackTitles} onChange={v => setB(x => { x.showTrackTitles = v; })} label="أظهر أسماء المسارات" />
        </Panel>

        <Panel title="المسارات" actions={<Button size="sm" icon="plus" onClick={() => {
          const id = uid('trk');
          const fac = config.factions.find(f => !config.tracks.some(t => t.factionId === f.id)) ?? config.factions[0];
          update(c => {
            c.tracks.push({ id, name: 'مسار جديد', factionId: fac.id, color: fac.color, icon: fac.icon, spaces: Array.from({ length: 5 }, (_, i) => ({ id: uid('sp'), label: '', description: '', color: '', icon: '', image: {} })), powerProfiles: [{ id: uid('pp'), minPlayers: 1, maxPlayers: 99, powers: Array(5).fill('none'), customText: Array(5).fill('') }] });
            c.boards.forEach(bd => { bd.trackPlacements[id] = { x: 4, y: 4, w: 92, h: 25 }; });
          });
          setTrackSel(id);
        }}>إضافة مسار</Button>}>
          <p className="small muted">المسارات جزء من القوانين: بطاقة {config.mechanics.policyTitle} من فريق تقدّم مسار ذاك الفريق. التعديل يطبّق على كل تصاميم اللوحة.</p>
          <div className="list-compact">
            {config.tracks.map((t, i) => (
              <div key={t.id} className={`list-row ${t.id === track?.id ? 'active' : ''}`}>
                <span className="swatch" style={{ background: t.color }} />
                <button type="button" className="grow list-btn" onClick={() => { setTrackSel(t.id); setSpaceSel(0); }} aria-pressed={t.id === track?.id}>{t.name} <span className="muted small">({t.spaces.length})</span></button>
                <IconButton icon="up" label="تحريك لفوق" disabled={i === 0} onClick={() => update(c => { c.tracks = moveItem(c.tracks, i, i - 1); })} />
                <IconButton icon="down" label="تحريك لتحت" disabled={i === config.tracks.length - 1} onClick={() => update(c => { c.tracks = moveItem(c.tracks, i, i + 1); })} />
                <IconButton icon="trash" label={`حذف ${t.name}`} disabled={config.tracks.length <= 1} onClick={async () => {
                  if (!(await confirm({ title: `حذف المسار «${t.name}»؟`, message: 'القوانين المرتبطة بهذا المسار بتوقف لين تربطها بمسار ثاني.', confirmLabel: 'حذف', danger: true }))) return;
                  update(c => { c.tracks = c.tracks.filter(x => x.id !== t.id); c.boards.forEach(bd => delete bd.trackPlacements[t.id]); });
                  setTrackSel(config.tracks.find(x => x.id !== t.id)?.id ?? '');
                }} />
              </div>
            ))}
          </div>

          {track && (
            <div className="sub-editor">
              <div className="grid-2">
                <Field label="اسم المسار"><TextInput value={track.name} onChange={v => setTr(x => { x.name = v; })} /></Field>
                <Field label="يتقدم بـ" hint="اعتماد بطاقة من هذا الفريق يحرّك هذا المسار."><Select value={track.factionId} onChange={v => setTr(x => { x.factionId = v; })} options={config.factions.map(f => ({ value: f.id, label: `بطاقات ${f.name}` }))} /></Field>
                <ColorField label="لون المسار" value={track.color} onChange={v => setTr(x => { x.color = v; })} />
                <IconPicker label="أيقونة المسار" value={track.icon} onChange={v => setTr(x => { x.icon = v; })} />
                <Field label="عدد الخانات">
                  <NumberInput value={track.spaces.length} min={1} max={15} onChange={n => setTr(x => {
                    while (x.spaces.length < n) x.spaces.push({ id: uid('sp'), label: '', description: '', color: '', icon: '', image: {} });
                    x.spaces.length = n;
                    x.powerProfiles.forEach(p => { while (p.powers.length < n) { p.powers.push('none'); p.customText.push(''); } p.powers.length = n; p.customText.length = n; });
                  })} />
                </Field>
              </div>

              <h4>الخانات <span className="muted small">— اضغط على وحدة عشان تعدلها</span></h4>
              <div className="space-picker" role="listbox" aria-label="الخانات">
                {track.spaces.map((s, i) => (
                  <button key={s.id} type="button" role="option" aria-selected={i === spaceSel} className={`space-pick ${i === spaceSel ? 'active' : ''}`} onClick={() => setSpaceSel(i)}>
                    <span className="num">{i + 1}</span><span className="small">{s.label || '—'}</span>
                  </button>
                ))}
              </div>
              {sp && (
                <div className="space-editor">
                  <div className="grid-2">
                    <Field label={`اسم الخانة ${spaceSel + 1}`}><TextInput value={sp.label} onChange={v => setTr(x => { x.spaces[spaceSel].label = v; })} /></Field>
                    <IconPicker label="الأيقونة" value={sp.icon} onChange={v => setTr(x => { x.spaces[spaceSel].icon = v; })} />
                    <ColorField label="اللون" value={sp.color} onChange={v => setTr(x => { x.spaces[spaceSel].color = v; })} allowEmpty emptyLabel="لون المسار" />
                  </div>
                  <Field label="الوصف (يظهر عند التأشير)"><TextArea rows={2} value={sp.description} onChange={v => setTr(x => { x.spaces[spaceSel].description = v; })} /></Field>
                  <ImagePicker label="صورة الخانة" value={sp.image} onChange={v => setTr(x => { x.spaces[spaceSel].image = v; })} />
                  <h4>إجراء خاص على هذي الخانة</h4>
                  {track.powerProfiles.map((p, pi) => (
                    <div key={p.id} className="grid-2">
                      <Field label={`${p.minPlayers}–${p.maxPlayers} لاعبين`}>
                        <Select<PowerKind> value={p.powers[spaceSel] ?? 'none'} onChange={v => setTr(x => { x.powerProfiles[pi].powers[spaceSel] = v; })} options={POWER_OPTIONS} />
                      </Field>
                      {p.powers[spaceSel] === 'custom' && (
                        <Field label="نص الإجراء المخصص"><TextInput value={p.customText[spaceSel] ?? ''} onChange={v => setTr(x => { x.powerProfiles[pi].customText[spaceSel] = v; })} placeholder="مثلًا: الكل يمرر بطاقة لليسار" /></Field>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <h4>فئات عدد اللاعبين <span className="muted small">— الصلاحيات ممكن تختلف حسب عدد اللاعبين</span></h4>
              {track.powerProfiles.map((p, pi) => (
                <div key={p.id} className="row gap-s wrap profile-row">
                  <Field label="من" inline><NumberInput value={p.minPlayers} min={1} max={99} onChange={v => setTr(x => { x.powerProfiles[pi].minPlayers = v; })} /></Field>
                  <Field label="to" inline><NumberInput value={p.maxPlayers} min={1} max={99} onChange={v => setTr(x => { x.powerProfiles[pi].maxPlayers = v; })} /></Field>
                  <span className="small muted grow">{p.powers.filter(x => x !== 'none').length} power(s)</span>
                  <IconButton icon="trash" label="حذف الفئة" disabled={track.powerProfiles.length <= 1} onClick={() => setTr(x => { x.powerProfiles.splice(pi, 1); })} />
                </div>
              ))}
              <Button size="sm" variant="ghost" icon="plus" onClick={() => setTr(x => { x.powerProfiles.push({ id: uid('pp'), minPlayers: 1, maxPlayers: 99, powers: x.spaces.map(() => 'none'), customText: x.spaces.map(() => '') }); })}>إضافة فئة</Button>
            </div>
          )}
        </Panel>

        <Panel title="متتبع الانتخابات">
          <div className="grid-2">
            <Field label="الاسم"><TextInput value={config.mechanics.electionTrackerTitle} onChange={v => update(c => { c.mechanics.electionTrackerTitle = v; })} /></Field>
            <Field label="تصويتات فاشلة قبل الفوضى"><NumberInput value={config.mechanics.electionTrackerLength} min={1} max={10} onChange={v => update(c => { c.mechanics.electionTrackerLength = v; })} /></Field>
          </div>
        </Panel>
      </div>

      <div className="studio-preview">
        <div className="row gap-s wrap preview-controls">
          <span className="eyebrow grow">معاينة مباشرة{b.layout === 'freeform' ? ' — اسحب للتحريك، والزاوية لتغيير الحجم' : ''}</span>
          <Field label="اللاعبين" inline><NumberInput value={players} min={1} max={99} onChange={setPlayers} /></Field>
          <Field label="ممتلئة" inline><NumberInput value={fill} min={0} max={15} onChange={setFill} /></Field>
        </div>
        <BoardView
          config={config} board={b} editable={b.layout === 'freeform'} selected={elSel} onSelect={setElSel} onPlacement={placement}
          highlightTrack={track?.id}
          state={{ tracks: Object.fromEntries(config.tracks.map(t => [t.id, Math.min(fill, t.spaces.length)])), electionTracker: 1, drawPile: 14, discardPile: 3, playerCount: players }}
        />
      </div>
    </div>
  );
}
