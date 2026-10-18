/**
 * GAME CONFIGURATION MODEL
 * ------------------------------------------------------------------
 * Everything that describes *what game is being played* lives here.
 * Nothing in the engine refers to a role, faction or card by name —
 * only by ID. Names, images and colours are pure presentation and can
 * be changed freely without affecting rules.
 */

export type ID = string;

/** A reference to an image in the asset library plus how it is framed. */
export interface ImageRef {
  assetId?: ID;
  fit?: 'cover' | 'contain';
  /** 0–100 — object-position percentages (used for cropping/positioning). */
  posX?: number;
  posY?: number;
  /** 1 = natural, 2 = 200% zoom (crop in). */
  zoom?: number;
}

export interface Identity {
  name: string;
  subtitle: string;
  tagline: string;
  logo: ImageRef;
  favicon: ImageRef;
  homeBackground: ImageRef;
  /** Short glyph shown when no logo image is set. */
  logoGlyph: string;
}

/* ------------------------------------------------------------------ */
/* THEMES                                                              */
/* ------------------------------------------------------------------ */

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  danger: string;
  success: string;
  onPrimary: string;
}

export type PagePattern = 'none' | 'dots' | 'grid' | 'stripes' | 'diamonds' | 'paper';
export type ButtonShape = 'square' | 'rounded' | 'pill' | 'cut';
export type ShadowStyle = 'none' | 'soft' | 'hard' | 'glow';
export type CardFrame = 'none' | 'simple' | 'double' | 'ornate' | 'neon' | 'stamp';
export type AnimationPref = 'full' | 'reduced' | 'none';

export interface Theme {
  id: ID;
  name: string;
  builtIn?: boolean;
  colors: ThemeColors;
  fonts: { heading: string; body: string; headingWeight: number; headingCase: 'none' | 'uppercase' };
  radius: number;
  buttonShape: ButtonShape;
  shadow: ShadowStyle;
  borderWidth: number;
  pageBackground: ImageRef;
  pagePattern: PagePattern;
  boardTexture: ImageRef;
  /** Colour used under the board when no texture/background is set. */
  boardColor: string;
  cardFrame: CardFrame;
  cardBack: ImageRef;
  cardBackColor: string;
  /** Glyph/icon name used for card backs & markers. */
  emblemIcon: string;
  panelOpacity: number; // 0.5–1
  modalBlur: number; // px
  animations: AnimationPref;
}

/* ------------------------------------------------------------------ */
/* FACTIONS, ROLES                                                     */
/* ------------------------------------------------------------------ */

export interface Faction {
  id: ID;
  name: string;
  color: string;
  icon: string;
  emblem: ImageRef;
  description: string;
  /** Word shown on "membership" investigations ("Liberal", "Fascist"…). */
  membershipLabel: string;
}

/** "This role learns the identities of players holding these roles." */
export interface KnowledgeRule {
  id: ID;
  seesRoleIds: ID[];
  minPlayers?: number;
  maxPlayers?: number;
}

export interface Role {
  id: ID;
  name: string;
  factionId: ID;
  portrait: ImageRef;
  icon: string;
  description: string;
  /** Text revealed only to this player at role reveal. */
  secretInfo: string;
  abilities: string;
  winCondition: string;
  loseCondition: string;
  knowledge: KnowledgeRule[];
  canBeLeader: boolean;
  canBeNominee: boolean;
  canBeTargeted: boolean;
  /** Optional linked role card (for card art). */
  cardId?: ID;
}

/** Number of each role for a given player count. */
export interface DistributionRow {
  players: number;
  counts: Record<ID, number>;
}

/* ------------------------------------------------------------------ */
/* CARDS                                                               */
/* ------------------------------------------------------------------ */

export const BUILTIN_CARD_TYPES = ['policy', 'role', 'faction', 'vote', 'reference', 'event'] as const;
export type CardType = string;

export interface CardFace {
  image: ImageRef;
  bgColor: string;
  textColor: string;
  font: string; // '' = theme default
  borderColor: string;
  borderWidth: number;
  frame: CardFrame | 'theme';
  icon: string;
  showTitle: boolean;
  showText: boolean;
  /** Decorative corner ornaments. */
  ornaments: boolean;
}

export type PowerKind = 'none' | 'investigate' | 'peek' | 'specialElection' | 'execute' | 'custom';

export interface CardDef {
  id: ID;
  name: string;
  type: CardType;
  front: CardFace;
  back: CardFace;
  description: string;
  flavor: string;
  effect: string;
  ruleRef: string;
  width: number; // px at 1x
  height: number;
  orientation: 'portrait' | 'landscape';
  rarity: string;
  category: string;
  factionId?: ID;
  archived: boolean;
  /** For policy cards: optional power triggered when this card is enacted. */
  onEnact?: PowerKind;
  onEnactText?: string;
  /** For vote cards. */
  voteValue?: 'yes' | 'no';
}

/* ------------------------------------------------------------------ */
/* TRACKS & BOARD                                                      */
/* ------------------------------------------------------------------ */

export interface TrackSpace {
  id: ID;
  label: string;
  description: string;
  color: string; // '' = track colour
  icon: string;
  image: ImageRef;
}

/** Powers granted at each space, depending on the number of players. */
export interface PowerProfile {
  id: ID;
  minPlayers: number;
  maxPlayers: number;
  /** powers[i] triggers when the (i+1)-th policy is placed on this track. */
  powers: PowerKind[];
  customText: string[];
}

export interface Track {
  id: ID;
  name: string;
  /** Enacting a policy card of this faction advances this track. */
  factionId: ID;
  color: string;
  icon: string;
  spaces: TrackSpace[];
  powerProfiles: PowerProfile[];
}

export interface Rect { x: number; y: number; w: number; h: number } // percentages of board

export type BoardLayout = 'stacked' | 'split' | 'freeform';
export type MarkerShape = 'circle' | 'square' | 'diamond' | 'token' | 'image';
export type SpaceShape = 'card' | 'circle' | 'hex' | 'square';

/** A visual design of the board. Several can be saved per game. */
export interface BoardDesign {
  id: ID;
  name: string;
  layout: BoardLayout;
  background: ImageRef;
  bgColor: string; // '' = theme
  useThemeTexture: boolean;
  aspect: number; // width / height (desktop)
  orientation: 'landscape' | 'portrait';
  spacing: number; // px gap
  padding: number; // px
  trackPlacements: Record<ID, Rect>;
  trackerPlacement: Rect;
  deckPlacement: Rect;
  spaceShape: SpaceShape;
  showSpaceLabels: boolean;
  showTrackTitles: boolean;
  markerShape: MarkerShape;
  markerColor: string;
  markerImage: ImageRef;
  markerIcon: string;
  playerMarker: 'initial' | 'icon' | 'number';
  playerMarkerIcon: string;
  trackOpacity: number;
}

/* ------------------------------------------------------------------ */
/* MECHANICS & RULES                                                   */
/* ------------------------------------------------------------------ */

export interface Mechanics {
  leaderTitle: string;
  nomineeTitle: string;
  governmentTitle: string;
  policyTitle: string;
  electionTrackerTitle: string;
  yesLabel: string;
  noLabel: string;
  yesCardId?: ID;
  noCardId?: ID;
  minPlayers: number;
  maxPlayers: number;
  /** Policies drawn by the leader each legislative session. */
  drawCount: number;
  /** Failed elections in a row before the top policy is enacted. */
  electionTrackerLength: number;
  /** Policy deck composition. */
  deck: { cardId: ID; count: number }[];
  randomNames: string[];
  /** 'majority' = strictly more than half yes; 'atLeastHalf' = ties pass. */
  votePassRule: 'majority' | 'atLeastHalf';
  /** Turn order direction for the leader. */
  rotation: 'clockwise' | 'random';
  /** Whether the current leader votes on their own government. */
  leaderVotes: boolean;
  /** 'percent' = only the share of yes votes is shown; 'names' = everyone's vote is shown. */
  voteReveal: 'percent' | 'names';
  /** When the election tracker goes back to zero (it always resets after chaos). */
  trackerReset: 'chaosOnly' | 'onEnact' | 'onElection';
}

export type Condition =
  | { kind: 'always' }
  | { kind: 'trackAtLeast'; trackId: ID; count: number }
  | { kind: 'playerCount'; min: number; max: number }
  | { kind: 'aliveAtMost'; count: number }
  | { kind: 'roundAtLeast'; count: number };

export type RuleKind =
  | 'trackCompleteWin'
  | 'roleElectedWin'
  | 'roleKilledWin'
  | 'termLimits'
  | 'veto'
  | 'chaos'
  | 'custom';

export interface RuleParams {
  trackId?: ID;
  roleId?: ID;
  factionId?: ID;
  /** termLimits: last leader is only term-limited while alive > this. */
  aliveThreshold?: number;
  /** chaos: whether powers trigger on chaos policies. */
  chaosTriggersPowers?: boolean;
  /** chaos: reset term limits after chaos. */
  chaosResetsTermLimits?: boolean;
  /** veto: veto moves the election tracker. */
  vetoAdvancesTracker?: boolean;
  /** custom rule text / reminder shown to players. */
  text?: string;
}

export interface Rule {
  id: ID;
  kind: RuleKind;
  name: string;
  description: string;
  enabled: boolean;
  /** true = game engine enforces it. false = shown as a reminder; the host applies it. */
  automated: boolean;
  condition: Condition;
  params: RuleParams;
}

export interface RulesSection { id: ID; title: string; body: string }

/* ------------------------------------------------------------------ */
/* ROOT                                                                */
/* ------------------------------------------------------------------ */

export interface GameConfig {
  schemaVersion: 1;
  id: ID;
  /** Name of this preset (separate from the game's display name). */
  presetName: string;
  /** ID of the built-in template this preset was based on — used by "reset to default". */
  baseTemplate: string;
  updatedAt: number;
  identity: Identity;
  themes: Theme[];
  activeThemeId: ID;
  factions: Faction[];
  roles: Role[];
  distribution: DistributionRow[];
  cards: CardDef[];
  cardTypes: string[];
  tracks: Track[];
  boards: BoardDesign[];
  activeBoardId: ID;
  mechanics: Mechanics;
  rules: Rule[];
  rulesText: RulesSection[];
}

/** An uploaded image. Stored with the game document; the file lives in media storage. */
export interface Asset {
  id: ID;
  name: string;
  folder: string;
  mime: string;
  /** Served image URL (/api/media/<key>). */
  url: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
  updatedAt: number;
}

export interface PresetMeta { id: ID; presetName: string; gameName: string; updatedAt: number }
