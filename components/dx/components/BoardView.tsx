/**
 * BOARD RENDERING — draws tracks, spaces, markers, election tracker and
 * deck counters from a BoardDesign + Tracks. Used by both the live game
 * and the Board Designer (with drag-and-drop editing enabled).
 */
"use client";

import React, { useEffect, useRef, useState } from 'react';
import type { BoardDesign, GameConfig, PowerKind, Rect, Track } from '@/lib/dx/types/config';
import { AssetImage } from './AssetImage';
import { Icon } from './Icon';
import { POWER_HELP, POWER_LABELS, powerAt } from '@/lib/dx/engine/helpers';

export const POWER_ICONS: Record<PowerKind, string> = {
  none: '', investigate: 'search', peek: 'eye', specialElection: 'ballot', execute: 'dagger', custom: 'bolt',
};

export interface BoardState {
  tracks: Record<string, number>;
  electionTracker: number;
  drawPile: number;
  discardPile: number;
  playerCount: number;
}

function useNarrow(px = 640) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < px);
  useEffect(() => {
    const h = () => setNarrow(window.innerWidth < px);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, [px]);
  return narrow;
}

function Marker({ board, color, icon }: { board: BoardDesign; color: string; icon: string }) {
  const c = board.markerColor || color;
  if (board.markerShape === 'image' && board.markerImage.assetId) {
    return <span className="marker marker-image"><AssetImage image={board.markerImage} alt="marker" /></span>;
  }
  return (
    <span className={`marker marker-${board.markerShape}`} style={{ '--mk': c } as React.CSSProperties}>
      <Icon name={board.markerIcon || icon} size="55%" />
    </span>
  );
}

function TrackView({ track, board, filled, playerCount, factionColor, factionIcon, highlight }: {
  track: Track; board: BoardDesign; filled: number; playerCount: number; factionColor: string; factionIcon: string; highlight?: boolean;
}) {
  const color = track.color || factionColor;
  return (
    <div className={`track ${highlight ? 'track-hl' : ''}`} style={{ '--trk': color, '--trk-alpha': board.trackOpacity } as React.CSSProperties}>
      {board.showTrackTitles && (
        <div className="track-title">
          {track.icon && <Icon name={track.icon} size={16} />}
          <span>{track.name}</span>
          <span className="track-count num">{filled}/{track.spaces.length}</span>
        </div>
      )}
      <ol className={`track-spaces shape-${board.spaceShape}`} style={{ gap: Math.max(2, board.spacing / 2) }}>
        {track.spaces.map((sp, i) => {
          const power = powerAt(track, i, playerCount);
          const isFilled = i < filled;
          const last = i === track.spaces.length - 1;
          const tip = [sp.label, sp.description, power.kind !== 'none' ? `${POWER_LABELS[power.kind]}: ${power.text || POWER_HELP[power.kind]}` : ''].filter(Boolean).join(' — ');
          return (
            <li
              key={sp.id}
              className={`space ${isFilled ? 'filled' : ''} ${last ? 'space-last' : ''} ${power.kind !== 'none' ? 'has-power' : ''}`}
              style={sp.color ? ({ '--sp': sp.color } as React.CSSProperties) : undefined}
              title={tip || `الخانة ${i + 1}`}
              aria-label={`${track.name} — الخانة ${i + 1}${isFilled ? '، ممتلئة' : ''}${tip ? `: ${tip}` : ''}`}
            >
              {sp.image.assetId && <AssetImage image={sp.image} alt="" className="space-img" />}
              <span className="space-inner">
                {isFilled ? <Marker board={board} color={color} icon={factionIcon} /> : (
                  <>
                    {power.kind !== 'none' ? <Icon name={POWER_ICONS[power.kind]} size={18} /> : sp.icon ? <Icon name={sp.icon} size={18} /> : <span className="space-num num">{i + 1}</span>}
                    {board.showSpaceLabels && (sp.label || power.kind !== 'none') && <span className="space-label">{sp.label || POWER_LABELS[power.kind]}</span>}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Tracker({ config, value }: { config: GameConfig; value: number }) {
  const n = config.mechanics.electionTrackerLength;
  return (
    <div className="tracker" aria-label={`${config.mechanics.electionTrackerTitle}: ${value} من ${n}`}>
      <span className="tracker-title">{config.mechanics.electionTrackerTitle}</span>
      <ol className="tracker-dots">
        {Array.from({ length: n }, (_, i) => (
          <li key={i} className={`dot ${i < value ? 'on' : ''} ${i === n - 1 ? 'dot-last' : ''}`} title={i === n - 1 ? 'فوضى: تُعتمد البطاقة اللي فوق' : `تصويت فاشل ${i + 1}`}>
            {i === n - 1 ? <Icon name="bolt" size={12} /> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Deck({ config, draw, discard }: { config: GameConfig; draw: number; discard: number }) {
  return (
    <div className="deck-info">
      <span className="deck-stack" title="رزمة السحب"><Icon name="cards" size={16} /><span className="num">{draw}</span><span className="muted small">للسحب</span></span>
      <span className="deck-stack" title="المرمي"><Icon name="archive" size={16} /><span className="num">{discard}</span><span className="muted small">مرمي</span></span>
      <span className="sr-only">رزمة {config.mechanics.policyTitle}</span>
    </div>
  );
}

export function BoardView({ config, board, state, editable, selected, onSelect, onPlacement, highlightTrack }: {
  config: GameConfig; board: BoardDesign; state: BoardState;
  editable?: boolean; selected?: string | null; onSelect?: (id: string | null) => void;
  onPlacement?: (id: string, r: Rect) => void; highlightTrack?: string;
}) {
  const narrow = useNarrow();
  const ref = useRef<HTMLDivElement>(null);
  const freeform = board.layout === 'freeform' && (!narrow || editable);
  const bgStyle: React.CSSProperties = {
    backgroundColor: board.bgColor || 'var(--board-color)',
    backgroundImage: !board.background.assetId && board.useThemeTexture ? 'var(--board-texture)' : undefined,
    padding: board.padding,
    gap: board.spacing,
  };
  const portrait = board.orientation === 'portrait';

  const tracks = config.tracks.map(t => {
    const f = config.factions.find(x => x.id === t.factionId);
    return (
      <TrackView
        key={t.id} track={t} board={board} filled={state.tracks[t.id] ?? 0} playerCount={state.playerCount}
        factionColor={f?.color ?? '#888'} factionIcon={f?.icon ?? 'circle'} highlight={highlightTrack === t.id}
      />
    );
  });
  const tracker = <Tracker config={config} value={state.electionTracker} />;
  const deck = <Deck config={config} draw={state.drawPile} discard={state.discardPile} />;

  /* ---------- drag & resize for freeform ---------- */
  const drag = (id: string, rect: Rect, mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (!editable || !onPlacement || !ref.current) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(id);
    const box = ref.current.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const start = { ...rect };
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - sx) / box.width) * 100;
      const dy = ((ev.clientY - sy) / box.height) * 100;
      const r = mode === 'move'
        ? { ...start, x: Math.round(Math.max(0, Math.min(100 - start.w, start.x + dx))), y: Math.round(Math.max(0, Math.min(100 - start.h, start.y + dy))) }
        : { ...start, w: Math.round(Math.max(8, Math.min(100 - start.x, start.w + dx))), h: Math.round(Math.max(6, Math.min(100 - start.y, start.h + dy))) };
      onPlacement(id, r);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const keyNudge = (id: string, rect: Rect) => (e: React.KeyboardEvent) => {
    if (!editable || !onPlacement) return;
    const step = e.shiftKey ? 5 : 1;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!d[e.key]) return;
    e.preventDefault();
    const [dx, dy] = d[e.key];
    if (e.altKey) onPlacement(id, { ...rect, w: Math.max(8, rect.w + dx), h: Math.max(6, rect.h + dy) });
    else onPlacement(id, { ...rect, x: Math.max(0, Math.min(100 - rect.w, rect.x + dx)), y: Math.max(0, Math.min(100 - rect.h, rect.y + dy)) });
  };

  const freeItem = (id: string, label: string, rect: Rect, child: React.ReactNode) => (
    <div
      key={id}
      className={`free-item ${editable ? 'editable' : ''} ${selected === id ? 'selected' : ''}`}
      style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` }}
      onPointerDown={drag(id, rect, 'move')}
      onKeyDown={keyNudge(id, rect)}
      tabIndex={editable ? 0 : undefined}
      role={editable ? 'button' : undefined}
      aria-label={editable ? `${label}. اسحبه، أو استخدم الأسهم للتحريك (Alt + الأسهم لتغيير الحجم).` : undefined}
    >
      {child}
      {editable && <span className="resize-handle" onPointerDown={drag(id, rect, 'resize')} aria-hidden />}
    </div>
  );

  return (
    <div
      className={`board layout-${freeform ? 'freeform' : board.layout === 'freeform' ? 'stacked' : board.layout} ${portrait ? 'portrait' : ''}`}
      style={{ ...bgStyle, ...(freeform ? { aspectRatio: String(portrait ? 1 / board.aspect : board.aspect) } : {}) }}
      ref={ref}
      onPointerDown={() => editable && onSelect?.(null)}
    >
      {board.background.assetId && <AssetImage image={board.background} alt="" className="board-bg" />}
      {freeform ? (
        <>
          {config.tracks.map((t, i) => freeItem(t.id, t.name, board.trackPlacements[t.id] ?? { x: 4, y: 6 + i * 30, w: 92, h: 26 }, tracks[i]))}
          {freeItem('__tracker', config.mechanics.electionTrackerTitle, board.trackerPlacement, tracker)}
          {freeItem('__deck', 'عدّاد الرزمة', board.deckPlacement, deck)}
        </>
      ) : (
        <>
          <div className="board-tracks" style={{ gap: board.spacing }}>{tracks}</div>
          <div className="board-foot">{tracker}{deck}</div>
        </>
      )}
    </div>
  );
}
