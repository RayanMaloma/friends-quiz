/**
 * Image rendering & picking. All images in the app go through
 * <AssetImage>, which resolves an asset ID from the library and falls
 * back to generated artwork when the image is missing.
 */
"use client";

import React, { useMemo, useRef, useState } from 'react';
import type { ImageRef } from '@/lib/dx/types/config';
import { useStore } from '@/components/dx/store';
import { Icon, GAME_ICONS } from './Icon';
import { Button, Field, IconButton, Modal, Range, Select, TextInput } from './ui';
import { ACCEPT_ATTR, formatBytes } from '@/lib/dx/assets/assetUtils';

export function AssetImage({ image, alt, fallbackIcon, fallbackText, className = '', style, color }: {
  image?: ImageRef; alt: string; fallbackIcon?: string; fallbackText?: string; className?: string; style?: React.CSSProperties; color?: string;
}) {
  const { assets } = useStore();
  const asset = image?.assetId ? assets[image.assetId] : undefined;
  const [broken, setBroken] = useState(false);
  if (asset && !broken) {
    const zoom = image?.zoom ?? 1;
    return (
      <span className={`asset-img ${className}`} style={style}>
        <img
          src={asset.url} alt={alt} draggable={false} onError={() => setBroken(true)}
          style={{
            objectFit: image?.fit ?? 'cover',
            objectPosition: `${image?.posX ?? 50}% ${image?.posY ?? 50}%`,
            transform: zoom !== 1 ? `scale(${zoom})` : undefined,
            transformOrigin: `${image?.posX ?? 50}% ${image?.posY ?? 50}%`,
          }}
        />
      </span>
    );
  }
  const missing = !!image?.assetId;
  return (
    <span className={`asset-img asset-fallback ${className}`} style={{ ...style, ...(color ? { '--fb': color } as React.CSSProperties : {}) }} role="img" aria-label={missing ? `${alt} (الصورة مفقودة)` : alt}>
      {fallbackIcon ? <Icon name={fallbackIcon} size="42%" /> : <span className="fb-text">{(fallbackText ?? alt).trim().charAt(0).toUpperCase()}</span>}
      {missing && <span className="fb-missing" title="صورة هذا العنصر انحذفت أو ما انرفعت">مفقودة</span>}
    </span>
  );
}

/** Choose / upload / position an image for any ImageRef field. */
export function ImagePicker({ label, value, onChange, hint, aspect = 1, allowPosition = true }: {
  label: string; value: ImageRef; onChange: (v: ImageRef) => void; hint?: string; aspect?: number; allowPosition?: boolean;
}) {
  const { assets } = useStore();
  const [open, setOpen] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const asset = value.assetId ? assets[value.assetId] : undefined;
  return (
    <div className="field image-picker">
      <span className="field-label">{label}{hint && <span className="muted small"> — {hint}</span>}</span>
      <div className="image-picker-row">
        <button type="button" className="image-thumb" onClick={() => setOpen(true)} aria-label={`اختيار صورة لـ ${label}`} style={{ aspectRatio: String(aspect) }}>
          {value.assetId ? <AssetImage image={value} alt={label} fallbackIcon="image" /> : <span className="thumb-empty"><Icon name="image" size={22} /><span>اختيار</span></span>}
        </button>
        <div className="col gap-xs">
          <span className="small">{asset ? asset.name : value.assetId ? 'الصورة مفقودة' : 'بدون صورة'}</span>
          <div className="row gap-xs wrap">
            <Button size="sm" icon="image" onClick={() => setOpen(true)}>{value.assetId ? 'تغيير' : 'اختيار'}</Button>
            {value.assetId && allowPosition && <Button size="sm" icon="crop" onClick={() => setAdjust(a => !a)} aria-expanded={adjust}>قص وتموضع</Button>}
            {value.assetId && <IconButton icon="x" label={`إزالة صورة ${label}`} onClick={() => onChange({})} />}
          </div>
        </div>
      </div>
      {adjust && value.assetId && (
        <div className="adjust-box">
          <Field label="الملاءمة"><Select value={value.fit ?? 'cover'} onChange={v => onChange({ ...value, fit: v })} options={[{ value: 'cover', label: 'تعبئة (قص)' }, { value: 'contain', label: 'احتواء (بدون قص)' }]} /></Field>
          <Range label="تكبير" value={value.zoom ?? 1} min={1} max={3} step={0.05} onChange={z => onChange({ ...value, zoom: z })} suffix="×" />
          <Range label="أفقي" value={value.posX ?? 50} min={0} max={100} onChange={x => onChange({ ...value, posX: x })} suffix="%" />
          <Range label="عمودي" value={value.posY ?? 50} min={0} max={100} onChange={y => onChange({ ...value, posY: y })} suffix="%" />
          <Button size="sm" variant="ghost" onClick={() => onChange({ assetId: value.assetId })}>إرجاع التموضع</Button>
        </div>
      )}
      <AssetPickerModal open={open} onClose={() => setOpen(false)} onPick={id => { onChange({ ...value, assetId: id }); setOpen(false); }} />
    </div>
  );
}

export function AssetPickerModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const { assets, addAssets } = useStore();
  const [folder, setFolder] = useState('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const list = useMemo(() => Object.values(assets).sort((a, b) => b.updatedAt - a.updatedAt), [assets]);
  const folders = useMemo(() => [...new Set(list.map(a => a.folder))].sort(), [list]);
  const shown = list.filter(a => (folder === 'all' || a.folder === folder) && a.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal open={open} onClose={onClose} title="اختيار صورة" wide
      footer={<>
        <input ref={fileRef} type="file" accept={ACCEPT_ATTR} hidden multiple onChange={async e => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          setBusy(true);
          const added = await addAssets(files, folder === 'all' ? 'مرفوعات' : folder);
          setBusy(false);
          if (added.length === 1) onPick(added[0].id);
        }} />
        <Button variant="primary" icon="upload" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'جاري الرفع…' : 'رفع صورة جديدة'}</Button>
      </>}
    >
      <div className="row gap-s wrap picker-filters">
        <TextInput value={q} onChange={setQ} placeholder="بحث في الصور" aria-label="بحث في الصور" />
        <Select value={folder} onChange={setFolder} aria-label="المجلد" options={[{ value: 'all', label: 'كل المجلدات' }, ...folders.map(f => ({ value: f, label: f }))]} />
      </div>
      {shown.length === 0 ? (
        <div className="empty"><Icon name="image" size={30} /><strong>{list.length ? 'ما فيه صور مطابقة' : 'مكتبة الصور فاضية'}</strong><span className="muted">ارفع صور PNG أو JPG أو WebP. تنحفظ مع اللعبة وتقدر تستخدمها في أي مكان.</span></div>
      ) : (
        <div className="asset-grid">
          {shown.map(a => (
            <button type="button" key={a.id} className="asset-tile" onClick={() => onPick(a.id)}>
              <span className="asset-tile-img"><img src={a.url} alt="" /></span>
              <span className="asset-tile-name">{a.name}</span>
              <span className="muted small">{a.width}×{a.height} · {formatBytes(a.bytes)}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function IconPicker({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field">
      <span className="field-label">{label}{hint && <span className="muted small"> — {hint}</span>}</span>
      <button type="button" className="icon-pick-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {value ? <Icon name={value} size={20} /> : <span className="muted small">بدون</span>}
        <span className="small">{value || 'بدون أيقونة'}</span>
        <Icon name="down" size={14} />
      </button>
      {open && (
        <div className="icon-grid" role="listbox" aria-label={`خيارات ${label}`}>
          {GAME_ICONS.map(n => (
            <button type="button" key={n || 'none'} role="option" aria-selected={n === value} className={`icon-cell ${n === value ? 'active' : ''}`} title={n || 'none'} onClick={() => { onChange(n); setOpen(false); }}>
              {n ? <Icon name={n} size={18} /> : <Icon name="x" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FieldText({ label, value, onChange, hint, placeholder }: { label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string }) {
  return <Field label={label} hint={hint}><TextInput value={value} onChange={onChange} placeholder={placeholder} /></Field>;
}
