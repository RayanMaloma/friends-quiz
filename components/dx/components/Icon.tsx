"use client";

/**
 * Built-in vector icon set (no image files). Icons are referenced by
 * name from config data, so any card/role/space can pick one.
 */
import React from 'react';

const P: Record<string, string> = {
  // game glyphs
  star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>',
  shield: '<path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10.5-4.6-1.9-8-5.5-8-10.5v-6z"/>',
  crown: '<path d="M3 18.5h18M4 18.5L3 7.5l5 4 4-7 4 7 5-4-1 11"/>',
  skull: '<path d="M12 3a8 8 0 0 0-8 8c0 2.8 1.4 4.6 3 5.6V20h10v-3.4c1.6-1 3-2.8 3-5.6a8 8 0 0 0-8-8z"/><circle cx="9" cy="11.5" r="1.8"/><circle cx="15" cy="11.5" r="1.8"/><path d="M10 20v-2M14 20v-2"/>',
  eye: '<path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  dove: '<path d="M3 14c3.5.5 6-1.5 7.5-5.5C11.5 11 14 12.5 17 12l4-3-1.5 4.5C18 18 14 20 10 20c-3.5 0-6-2.5-7-6z"/><path d="M15.5 9.5l1-4 2 1.5"/>',
  scroll: '<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8"/><path d="M6 3a2 2 0 0 0-2 2v2h4"/><path d="M8 21a2 2 0 0 1-2-2V5"/><path d="M10.5 8h5M10.5 12h5M10.5 16h3"/>',
  gavel: '<path d="M14.5 3.5l6 6M11 7l6 6M12.75 5.25l-4 4M18.75 11.25l-4 4M10.5 11.5L3 19l2 2 7.5-7.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20.5 20.5l-5.3-5.3"/>',
  dagger: '<path d="M12 2l2 4v9h-4V6z"/><path d="M7 15h10M12 15v6.5"/>',
  flame: '<path d="M12 22c4 0 7-2.8 7-6.8 0-4-3-6.2-4-10.2-2 2-3 4-3 6-1-1-2-2-2-4-2.2 2-5 5-5 8.2C5 19.2 8 22 12 22z"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  heart: '<path d="M12 20s-8-4.7-8-10.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5C20 15.3 12 20 12 20z"/>',
  key: '<circle cx="7.5" cy="15.5" r="4"/><path d="M10.5 12.5l9-9M16.5 6.5l3 3M14 9l2 2"/>',
  castle: '<path d="M3 21V8h3V5h2.5v3h2V5h3v3h2V5H18v3h3v13zM10 21v-5a2 2 0 0 1 4 0v5"/>',
  rocket: '<path d="M12 2c4 3 5.2 8 4 13H8C6.8 10 8 5 12 2z"/><path d="M8 15l-3 4.5h4M16 15l3 4.5h-4M10.5 21h3"/><circle cx="12" cy="9" r="1.6"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
  planet: '<circle cx="12" cy="12" r="6"/><path d="M4.5 15.5c-2.5 3 1.5 4 8.5 1s10.3-7.3 8.6-9.4c-.6-.8-2-.9-3.8-.4"/>',
  ballot: '<rect x="4" y="10" width="16" height="11" rx="1"/><path d="M8 10V3.5h8V10M10 7h4"/>',
  mask: '<path d="M3 6c3-1 6-1 9 1 3-2 6-2 9-1 0 7-3 12-9 12S3 13 3 6z"/><path d="M7 11.5h3M14 11.5h3"/>',
  diamond: '<path d="M12 2.5l9 9.5-9 9.5L3 12z"/>',
  hexagon: '<path d="M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  hourglass: '<path d="M6 2.5h12M6 21.5h12M7 2.5c0 5 5 7 5 9.5s-5 4.5-5 9.5M17 2.5c0 5-5 7-5 9.5s5 4.5 5 9.5"/>',
  feather: '<path d="M20 4c-6 0-12 4-13.5 12.5L4 20"/><path d="M20 4c0 7-4 12-11 12.5M10 12h6"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M6 11h12M4 14c0 4 4 7 8 7s8-3 8-7"/>',
  wolf: '<path d="M4 3l3 5 5-2 5 2 3-5v9c0 5-4 9-8 9s-8-4-8-9z"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M10.5 16.5L12 18l1.5-1.5"/>',
  tower: '<path d="M7 21V9h10v12M5 9V4h3v2h2.5V4h3v2H16V4h3v5zM10 21v-4h4v4"/>',
  sword: '<path d="M14.5 3H21v6.5L10 20.5 3.5 14z"/><path d="M6 11l7 7M3 21l3.5-3.5"/>',
  // ui
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 13h11l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 16v4h16v-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  home: '<path d="M3 11l9-7.5 9 7.5M5.5 9.5V20h13V9.5"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  folder: '<path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.2 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.9 8.4 2 12 2 12s3.8 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 10v10M15 10v10"/>',
  cards: '<rect x="3" y="6.5" width="11.5" height="15" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v12.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2 .8 3.5 2.8 3.5 5.7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2 0-1.5-1-1.5-1-3 0-1 .8-2 2-2h2a4 4 0 0 0 4-4c0-4-4-7-9-7z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/>',
  save: '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M7 21v-7h10v7"/>',
  flip: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 17.5v.5"/>',
  log: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  crop: '<path d="M6 2v16h16M2 6h16v16"/>',
  align: '<path d="M4 4v16M8 7h12M8 12h8M8 17h11"/>',
};

export const GAME_ICONS = ['', 'star', 'shield', 'crown', 'skull', 'eye', 'dove', 'scroll', 'gavel', 'search', 'dagger', 'sword', 'flame', 'moon', 'sun', 'bolt', 'target', 'heart', 'key', 'castle', 'tower', 'rocket', 'chip', 'planet', 'ballot', 'mask', 'wolf', 'anchor', 'feather', 'hourglass', 'diamond', 'hexagon', 'circle', 'check', 'x', 'user', 'lock', 'book'];

export function Icon({ name, size = 20, stroke = 1.8, className, title, style }: {
  name?: string; size?: number | string; stroke?: number; className?: string; title?: string; style?: React.CSSProperties;
}) {
  const body = (name && P[name]) || '';
  if (!body) return null;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      style={style}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : '') + body }}
    />
  );
}

export const hasIcon = (n?: string) => !!(n && P[n]);
