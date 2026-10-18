/**
 * CONFIG BUILDING BLOCKS (the templates are in ./templates.ts)
 * ------------------------------------------------------------------
 * The names "Liberal", "Fascist", "Hitler", "President" … below are
 * just editable *data*. The engine never references them; it only sees
 * IDs, faction links and rule definitions. Every value here can be
 * changed in the Customization Studio.
 */
import type { BoardDesign, CardDef, CardFace, PowerKind } from '../types/config';

export function face(p: Partial<CardFace> = {}): CardFace {
  return {
    image: {}, bgColor: '#f3e7cc', textColor: '#2a1d14', font: '', borderColor: '#2a1d14', borderWidth: 2,
    frame: 'theme', icon: 'star', showTitle: true, showText: true, ornaments: false, ...p,
  };
}

export function cardBackFace(p: Partial<CardFace> = {}): CardFace {
  return face({ bgColor: '', textColor: '#f5ecd6', icon: '', showTitle: false, showText: false, ornaments: true, ...p });
}

export function makeCard(p: Partial<CardDef> & { id: string; name: string; type: string }): CardDef {
  return {
    front: face(), back: cardBackFace(), description: '', flavor: '', effect: '', ruleRef: '',
    width: 180, height: 260, orientation: 'portrait', rarity: '', category: '', archived: false,
    ...p,
  };
}

export function spaces(prefix: string, n: number, labels: string[] = [], icons: string[] = []) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}_s${i + 1}`,
    label: labels[i] ?? '',
    description: '',
    color: '',
    icon: icons[i] ?? '',
    image: {},
  }));
}

export function profile(id: string, min: number, max: number, powers: PowerKind[]) {
  return { id, minPlayers: min, maxPlayers: max, powers, customText: powers.map(() => '') };
}

export function defaultBoard(trackIds: string[], name = 'الطاولة الأساسية'): BoardDesign {
  const placements: BoardDesign['trackPlacements'] = {};
  trackIds.forEach((id, i) => {
    placements[id] = { x: 4, y: 6 + i * 38, w: 92, h: 34 };
  });
  return {
    id: 'board_standard',
    name,
    layout: 'stacked',
    background: {},
    bgColor: '',
    useThemeTexture: true,
    aspect: 1.6,
    orientation: 'landscape',
    spacing: 14,
    padding: 18,
    trackPlacements: placements,
    trackerPlacement: { x: 22, y: 84, w: 56, h: 12 },
    deckPlacement: { x: 82, y: 84, w: 14, h: 12 },
    spaceShape: 'card',
    showSpaceLabels: true,
    showTrackTitles: true,
    markerShape: 'token',
    markerColor: '',
    markerImage: {},
    markerIcon: '',
    playerMarker: 'initial',
    playerMarkerIcon: 'user',
    trackOpacity: 0.92,
  };
}

