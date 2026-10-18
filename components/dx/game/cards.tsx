"use client";

import React, { useEffect, useState } from 'react';
import type { CardDef, Role } from '@/lib/dx/types/config';
import type { MatchState } from '@/lib/dx/types/match';
import { CardView } from '@/components/dx/components/CardView';
import { cardById, factionById } from '@/lib/dx/engine/helpers';
import { face, makeCard } from '@/lib/dx/config/defaults';

/** Card that starts face-down and flips over on mount. */
export function RevealCard(props: React.ComponentProps<typeof CardView> & { delay?: number }) {
  const { delay, ...rest } = props;
  const [flipped, setFlipped] = useState(true);
  useEffect(() => { const t = window.setTimeout(() => setFlipped(false), delay ?? 250); return () => window.clearTimeout(t); }, [delay]);
  return <CardView {...rest} flipped={flipped} />;
}

export function roleCard(s: MatchState, role: Role): CardDef {
  const c = cardById(s.config, role.cardId);
  if (c) return c;
  const f = factionById(s.config, role.factionId);
  return makeCard({ id: `virtual_${role.id}`, name: role.name, type: 'role', factionId: role.factionId, front: face({ bgColor: f?.color ?? '#555', textColor: '#fff', icon: role.icon, ornaments: true }) });
}

export function voteCard(s: MatchState, v: 'yes' | 'no'): CardDef {
  const m = s.config.mechanics;
  const c = cardById(s.config, v === 'yes' ? m.yesCardId : m.noCardId);
  return c ?? makeCard({ id: `virtual_vote_${v}`, name: v === 'yes' ? m.yesLabel : m.noLabel, type: 'vote', width: 160, height: 110, orientation: 'landscape', front: face({ icon: v === 'yes' ? 'check' : 'x' }) });
}

/** The membership card shown to an investigating leader. */
export function membershipCard(s: MatchState, factionId: string): CardDef | undefined {
  return s.config.cards.find(c => c.type === 'faction' && c.factionId === factionId);
}

/** A face-down policy card. Blank on both sides, so a hidden card never carries a real name. */
export function policyBack(s: MatchState): CardDef {
  const first = s.config.mechanics.deck.map(d => cardById(s.config, d.cardId)).find(Boolean);
  const base = first ?? makeCard({ id: 'virtual_back', name: '', type: 'policy' });
  return { ...base, id: 'virtual_back', name: '', description: '', flavor: '', rarity: '', category: '', factionId: undefined, front: base.back };
}
