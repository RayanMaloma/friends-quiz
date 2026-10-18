/**
 * ASSET HANDLING
 * Uploads images to the platform's media storage (resized in the
 * browser first) and computes which parts of a config use an asset.
 */
import type { Asset, GameConfig, ImageRef } from '../types/config';
import { uid } from '../config/ids';
import { uploadImage } from '@/lib/client/upload';

export const ACCEPT_ATTR = '.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('ما قدرنا نقرأ الصورة.'));
    img.src = src;
  });
}

/** Resizes in the browser, uploads to media storage, returns the library entry. */
export async function fileToAsset(file: File, folder: string): Promise<Asset> {
  const up = await uploadImage(file, 'photo');
  if ('error' in up) throw new Error(`«${file.name}»: ${up.error}`);
  const img = await loadImage(up.url).catch(() => null);
  const now = Date.now();
  return {
    id: uid('asset'), name: file.name.replace(/.[^.]+$/, '').slice(0, 80), folder: folder || 'عام',
    url: up.url, mime: file.type || 'image/jpeg', width: img?.naturalWidth ?? 0, height: img?.naturalHeight ?? 0,
    bytes: file.size, createdAt: now, updatedAt: now,
  };
}

export function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export interface AssetUsage { path: string; label: string }

/** Walk the config and list every place an asset ID is used. */
export function assetUsages(c: GameConfig, assetId: string): AssetUsage[] {
  const out: AssetUsage[] = [];
  const chk = (ref: ImageRef | undefined, label: string, path: string) => { if (ref?.assetId === assetId) out.push({ label, path }); };
  chk(c.identity.logo, 'شعار اللعبة', 'identity');
  chk(c.identity.favicon, 'أيقونة المتصفح', 'identity');
  chk(c.identity.homeBackground, 'خلفية الشاشة الرئيسية', 'identity');
  c.themes.forEach(t => {
    chk(t.pageBackground, `ثيم «${t.name}» — خلفية الصفحة`, 'theme');
    chk(t.boardTexture, `ثيم «${t.name}» — خامة اللوحة`, 'theme');
    chk(t.cardBack, `ثيم «${t.name}» — ظهر البطاقة`, 'theme');
  });
  c.factions.forEach(f => chk(f.emblem, `فريق «${f.name}» — شعار`, 'roles'));
  c.roles.forEach(r => chk(r.portrait, `دور «${r.name}» — صورة`, 'roles'));
  c.cards.forEach(cd => {
    chk(cd.front.image, `بطاقة «${cd.name}» — الوجه`, 'cards');
    chk(cd.back.image, `بطاقة «${cd.name}» — الظهر`, 'cards');
  });
  c.tracks.forEach(t => t.spaces.forEach((sp, i) => chk(sp.image, `مسار «${t.name}» — خانة ${i + 1}`, 'board')));
  c.boards.forEach(b => {
    chk(b.background, `لوحة «${b.name}» — الخلفية`, 'board');
    chk(b.markerImage, `لوحة «${b.name}» — العلامة`, 'board');
  });
  return out;
}

/** Every asset id referenced by a config. */
export function referencedAssetIds(c: GameConfig): Set<string> {
  const ids = new Set<string>();
  JSON.stringify(c, (k, v) => { if (k === 'assetId' && typeof v === 'string') ids.add(v); return v; });
  return ids;
}
