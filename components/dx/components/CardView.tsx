/**
 * CARD RENDERING — one component draws every card type from its
 * CardDef. Front and back are fully data-driven; flipping animates.
 */
"use client";

import React from 'react';
import type { CardDef, CardFace, Faction } from '@/lib/dx/types/config';
import { useStore } from '@/components/dx/store';
import { AssetImage } from './AssetImage';
import { Icon } from './Icon';

export function CardFaceView({ card, face, side, faction, compact }: { card: CardDef; face: CardFace; side: 'front' | 'back'; faction?: Faction; compact?: boolean }) {
  const { theme } = useStore();
  const isBack = side === 'back';
  const frame = face.frame === 'theme' ? theme.cardFrame : face.frame;
  const bg = face.bgColor || (isBack ? 'var(--card-back-color)' : 'var(--c-surface)');
  const hasImage = !!face.image.assetId;
  const backImage = isBack && !hasImage && theme.cardBack.assetId ? theme.cardBack : undefined;
  const icon = face.icon || (isBack ? theme.emblemIcon : '');
  return (
    <div
      className={`card-face card-${side} frame-${frame} ${compact ? 'compact' : ''}`}
      style={{
        background: bg,
        color: face.textColor || 'var(--c-text)',
        borderColor: face.borderColor || 'var(--c-border)',
        borderWidth: face.borderWidth,
        fontFamily: face.font || undefined,
      } as React.CSSProperties}
    >
      {(hasImage || backImage) && <AssetImage image={backImage ?? face.image} alt={`${card.name} — ${side === 'back' ? 'الظهر' : 'الوجه'}`} className="card-art" />}
      {face.ornaments && <span className="card-ornaments" aria-hidden><i /><i /><i /><i /></span>}
      <div className="card-content">
        {!hasImage && icon && <span className="card-icon"><Icon name={icon} size={compact ? 26 : 44} stroke={1.5} /></span>}
        {face.showTitle && <span className="card-title">{card.name}</span>}
        {face.showText && !compact && card.description && <span className="card-text">{card.description}</span>}
        {face.showText && !compact && card.flavor && <span className="card-flavor">{card.flavor}</span>}
        {!isBack && !compact && (card.rarity || card.category || faction) && (
          <span className="card-labels">
            {faction && <span>{faction.name}</span>}
            {card.category && <span>{card.category}</span>}
            {card.rarity && <span>{card.rarity}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

export function CardView({ card, flipped = false, scale = 1, onClick, selected, disabled, label, compact, className = '', config }: {
  card: CardDef; flipped?: boolean; scale?: number; onClick?: () => void; selected?: boolean; disabled?: boolean; label?: string; compact?: boolean; className?: string;
  config?: { factions: Faction[] };
}) {
  const store = useStore();
  const factions = config?.factions ?? store.config.factions;
  const faction = factions.find(f => f.id === card.factionId);
  const landscape = card.orientation === 'landscape';
  const w = (landscape ? Math.max(card.width, card.height) : Math.min(card.width, card.height)) * scale;
  const h = (landscape ? Math.min(card.width, card.height) : Math.max(card.width, card.height)) * scale;
  const inner = (
    <div className={`card-flip ${flipped ? 'is-flipped' : ''}`}>
      <CardFaceView card={card} face={card.front} side="front" faction={faction} compact={compact} />
      <CardFaceView card={card} face={card.back} side="back" faction={faction} compact={compact} />
    </div>
  );
  const style = { width: w, maxWidth: '100%', aspectRatio: `${w} / ${h}`, fontSize: `${Math.max(0.55, scale) * 15}px` } as React.CSSProperties;
  if (onClick) {
    return (
      <button type="button" className={`card ${selected ? 'selected' : ''} ${className}`} style={style} onClick={onClick} disabled={disabled} aria-pressed={selected} aria-label={label ?? card.name}>
        {inner}
      </button>
    );
  }
  return <div className={`card ${className}`} style={style} role="img" aria-label={label ?? (flipped ? 'بطاقة مقلوبة' : card.name)}>{inner}</div>;
}
