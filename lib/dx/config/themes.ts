import type { Theme } from '../types/config';

/** Fonts loaded from Google Fonts (see DX_FONTS_URL). Arabic faces first. */
export const FONT_OPTIONS = [
  { label: 'Cairo (عربي واضح)', value: "'Cairo', system-ui, sans-serif" },
  { label: 'Tajawal (عربي حديث)', value: "'Tajawal', system-ui, sans-serif" },
  { label: 'Lalezar (عناوين عريضة)', value: "'Lalezar', 'Cairo', sans-serif" },
  { label: 'Changa (تقني)', value: "'Changa', system-ui, sans-serif" },
  { label: 'Reem Kufi (كوفي)', value: "'Reem Kufi', 'Cairo', sans-serif" },
  { label: 'Noto Kufi Arabic (كوفي حديث)', value: "'Noto Kufi Arabic', system-ui, sans-serif" },
  { label: 'El Messiri (أنيق)', value: "'El Messiri', 'Cairo', sans-serif" },
  { label: 'Amiri (نسخ كلاسيكي)', value: "'Amiri', Georgia, serif" },
  { label: 'Aref Ruqaa (رقعة)', value: "'Aref Ruqaa', 'Amiri', serif" },
  { label: 'Marhey (مرح)', value: "'Marhey', 'Cairo', sans-serif" },
  { label: 'Playfair Display (لاتيني كلاسيكي)', value: "'Playfair Display', Georgia, serif" },
  { label: 'Oswald (لاتيني ملصقات)', value: "'Oswald', 'Arial Narrow', sans-serif" },
  { label: 'Special Elite (لاتيني آلة كاتبة)', value: "'Special Elite', 'Courier New', monospace" },
  { label: 'Cinzel (لاتيني منقوش)', value: "'Cinzel', Georgia, serif" },
  { label: 'IM Fell English (لاتيني طباعة قديمة)', value: "'IM Fell English', Georgia, serif" },
  { label: 'Uncial Antiqua (لاتيني قروسطي)', value: "'Uncial Antiqua', Georgia, serif" },
  { label: 'Orbitron (لاتيني خيال علمي)', value: "'Orbitron', 'Segoe UI', sans-serif" },
  { label: 'Rajdhani (لاتيني تقني)', value: "'Rajdhani', 'Segoe UI', sans-serif" },
  { label: 'Exo 2 (لاتيني فضائي)', value: "'Exo 2', 'Segoe UI', sans-serif" },
  { label: 'Space Grotesk (لاتيني حديث)', value: "'Space Grotesk', 'Segoe UI', sans-serif" },
  { label: 'Inter (لاتيني نظيف)', value: "'Inter', 'Segoe UI', system-ui, sans-serif" },
  { label: 'Lora (لاتيني كتب)', value: "'Lora', Georgia, serif" },
  { label: 'خط النظام', value: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { label: 'خط النظام (serif)', value: "Georgia, 'Times New Roman', serif" },
];

const base = {
  pageBackground: {},
  boardTexture: {},
  cardBack: {},
  panelOpacity: 0.96,
  modalBlur: 6,
  animations: 'full' as const,
  builtIn: true,
};

export const SAMPLE_THEMES: Theme[] = [
  {
    ...base,
    id: 'theme_classic',
    name: 'سياسي كلاسيكي',
    colors: {
      primary: '#b5361f', secondary: '#2f5e7a', accent: '#e8b14a',
      bg: '#efe2c4', surface: '#fbf4e2', surfaceAlt: '#e9d9b4',
      text: '#2a1d14', textMuted: '#6b5844', border: '#3a2a1c',
      danger: '#a32a1a', success: '#2f6b3a', onPrimary: '#fff8ea',
    },
    fonts: { heading: "'Oswald', 'Lalezar', 'Arial Narrow', sans-serif", body: "'Lora', 'Cairo', Georgia, serif", headingWeight: 600, headingCase: 'uppercase' },
    radius: 6, buttonShape: 'rounded', shadow: 'hard', borderWidth: 2,
    pagePattern: 'paper', boardColor: '#d9c493', cardFrame: 'double', cardBackColor: '#3a2a1c', emblemIcon: 'scroll',
  },
  {
    ...base,
    id: 'theme_darkfantasy',
    name: 'فانتازيا مظلمة',
    colors: {
      primary: '#8f2d3a', secondary: '#4b5d3a', accent: '#c9a45c',
      bg: '#14100f', surface: '#211a18', surfaceAlt: '#2e2421',
      text: '#ece0cf', textMuted: '#a8988a', border: '#5a463c',
      danger: '#c2413d', success: '#6d9a58', onPrimary: '#fdeee0',
    },
    fonts: { heading: "'Cinzel', 'Aref Ruqaa', Georgia, serif", body: "'IM Fell English', 'Amiri', Georgia, serif", headingWeight: 700, headingCase: 'none' },
    radius: 4, buttonShape: 'cut', shadow: 'soft', borderWidth: 1,
    pagePattern: 'diamonds', boardColor: '#2a201c', cardFrame: 'ornate', cardBackColor: '#3b1f22', emblemIcon: 'skull',
  },
  {
    ...base,
    id: 'theme_cyberpunk',
    name: 'سايبربنك',
    colors: {
      primary: '#ff2e88', secondary: '#00e5ff', accent: '#f6ff00',
      bg: '#07060f', surface: '#120f22', surfaceAlt: '#1b1733',
      text: '#e9e6ff', textMuted: '#9a93c7', border: '#3b2f6b',
      danger: '#ff4d4d', success: '#2dffb0', onPrimary: '#0b0614',
    },
    fonts: { heading: "'Orbitron', 'Changa', 'Segoe UI', sans-serif", body: "'Rajdhani', 'Changa', 'Segoe UI', sans-serif", headingWeight: 700, headingCase: 'uppercase' },
    radius: 2, buttonShape: 'cut', shadow: 'glow', borderWidth: 1,
    pagePattern: 'grid', boardColor: '#0e0b1d', cardFrame: 'neon', cardBackColor: '#1a0f2e', emblemIcon: 'chip',
  },
  {
    ...base,
    id: 'theme_medieval',
    name: 'مملكة القرون الوسطى',
    colors: {
      primary: '#2c4a7a', secondary: '#7a2c2c', accent: '#d4a72c',
      bg: '#e6dcc3', surface: '#f5eedb', surfaceAlt: '#ddcfab',
      text: '#2b2418', textMuted: '#6d5f45', border: '#5b4a2c',
      danger: '#8e2a20', success: '#3f6a2e', onPrimary: '#fbf5e4',
    },
    fonts: { heading: "'Uncial Antiqua', 'Aref Ruqaa', Georgia, serif", body: "'IM Fell English', 'Amiri', Georgia, serif", headingWeight: 400, headingCase: 'none' },
    radius: 10, buttonShape: 'rounded', shadow: 'soft', borderWidth: 2,
    pagePattern: 'paper', boardColor: '#c9b689', cardFrame: 'ornate', cardBackColor: '#2c4a7a', emblemIcon: 'castle',
  },
  {
    ...base,
    id: 'theme_space',
    name: 'خيال علمي فضائي',
    colors: {
      primary: '#3d7bff', secondary: '#ff8a3d', accent: '#7ef0d0',
      bg: '#060a17', surface: '#0e1528', surfaceAlt: '#16203a',
      text: '#e2e9ff', textMuted: '#8b98bf', border: '#2a3a63',
      danger: '#ff5a5a', success: '#43d18f', onPrimary: '#ffffff',
    },
    fonts: { heading: "'Exo 2', 'Reem Kufi', 'Segoe UI', sans-serif", body: "'Space Grotesk', 'Noto Kufi Arabic', 'Segoe UI', sans-serif", headingWeight: 700, headingCase: 'none' },
    radius: 14, buttonShape: 'pill', shadow: 'glow', borderWidth: 1,
    pagePattern: 'dots', boardColor: '#0b1224', cardFrame: 'simple', cardBackColor: '#13234a', emblemIcon: 'planet',
  },
  {
    ...base,
    id: 'theme_minimal',
    name: 'حديث بسيط',
    colors: {
      primary: '#111111', secondary: '#6b7280', accent: '#e4572e',
      bg: '#f6f6f4', surface: '#ffffff', surfaceAlt: '#ececea',
      text: '#111111', textMuted: '#5f6368', border: '#d4d4d0',
      danger: '#d63a2f', success: '#2f8f5b', onPrimary: '#ffffff',
    },
    fonts: { heading: "'Space Grotesk', 'Noto Kufi Arabic', 'Segoe UI', sans-serif", body: "'Inter', 'Tajawal', 'Segoe UI', system-ui, sans-serif", headingWeight: 600, headingCase: 'none' },
    radius: 10, buttonShape: 'rounded', shadow: 'none', borderWidth: 1,
    pagePattern: 'none', boardColor: '#ffffff', cardFrame: 'simple', cardBackColor: '#111111', emblemIcon: 'hexagon',
    animations: 'reduced',
  },
];

/** One stylesheet with every font a theme can pick (Latin + Arabic). */
export const DX_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Aref+Ruqaa:wght@400;700&family=Cairo:wght@400;600;700;800&family=Changa:wght@400;600;700&family=Cinzel:wght@400;600;700&family=El+Messiri:wght@400;600;700&family=Exo+2:wght@400;600;700&family=IM+Fell+English&family=Inter:wght@400;600;700&family=Lalezar&family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Marhey:wght@400;600;700&family=Noto+Kufi+Arabic:wght@400;600;700&family=Orbitron:wght@500;700&family=Oswald:wght@400;500;600;700&family=Playfair+Display:wght@500;700&family=Rajdhani:wght@500;600;700&family=Reem+Kufi:wght@400;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Special+Elite&family=Tajawal:wght@400;500;700;800&family=Uncial+Antiqua&display=swap';
