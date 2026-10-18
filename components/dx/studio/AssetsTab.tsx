"use client";

import React, { useMemo, useRef, useState } from 'react';
import { useStore, type StudioTab } from '@/components/dx/store';
import { Badge, Button, EmptyState, Field, IconButton, Panel, Select, TextInput, useConfirm } from '@/components/dx/components/ui';
import { Icon } from '@/components/dx/components/Icon';
import { ACCEPT_ATTR, assetUsages, formatBytes, referencedAssetIds } from '@/lib/dx/assets/assetUtils';

const RATIOS = [
  { label: 'مربع', r: 1 }, { label: 'بطاقة', r: 0.7 }, { label: 'عريض', r: 16 / 9 }, { label: 'بانر', r: 3 },
];

export function AssetsTab() {
  const { assets, addAssets, replaceAsset, patchAsset, deleteAsset, config, isAssetUsedAnywhere, toast, go } = useStore();
  const confirm = useConfirm();
  const [folder, setFolder] = useState('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const upRef = useRef<HTMLInputElement>(null);
  const repRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => Object.values(assets).sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name)), [assets]);
  const folders = useMemo(() => [...new Set(list.map(a => a.folder))].sort(), [list]);
  const usedHere = useMemo(() => referencedAssetIds(config), [config]);
  const shown = list.filter(a => (folder === 'all' || a.folder === folder) && a.name.toLowerCase().includes(q.toLowerCase()));
  const asset = sel ? assets[sel] : undefined;
  const usages = asset ? assetUsages(config, asset.id) : [];
  const totalBytes = list.reduce((s, a) => s + a.bytes, 0);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    const added = await addAssets(files, folder === 'all' ? (newFolder.trim() || 'مرفوعات') : folder);
    setBusy(false);
    if (added[0]) setSel(added[0].id);
  };

  const removeUnused = async () => {
    const unused = list.filter(a => !usedHere.has(a.id));
    if (!unused.length) return toast('كل الصور مستخدمة.', 'info');
    if (!(await confirm({ title: `حذف ${unused.length} صورة غير مستخدمة؟`, message: <>هذي مو مستخدمة في اللعبة:<br /><span className="small">{unused.map(a => a.name).join(', ')}</span></>, confirmLabel: 'حذف غير المستخدم', danger: true }))) return;
    for (const a of unused) deleteAsset(a.id);
    if (sel && unused.some(a => a.id === sel)) setSel(null);
  };

  return (
    <div className="studio-split assets-split">
      <div className="studio-form">
        <Panel title="مكتبة الصور" actions={<>
          <Button size="sm" variant="ghost" icon="trash" onClick={removeUnused}>إزالة غير المستخدم</Button>
          <Button size="sm" variant="primary" icon="upload" disabled={busy} onClick={() => upRef.current?.click()}>{busy ? 'جاري الرفع…' : 'رفع'}</Button>
        </>}>
          <input ref={upRef} type="file" hidden multiple accept={ACCEPT_ATTR} onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; upload(f); }} />
          <div
            className={`dropzone ${drag ? 'drag' : ''}`}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); upload([...e.dataTransfer.files]); }}
          >
            <Icon name="upload" size={22} />
            <span>اسحب صور PNG أو JPG أو WebP هنا، أو <button type="button" className="link" onClick={() => upRef.current?.click()}>تصفح</button>.</span>
            <span className="small muted">الصور الكبيرة تتصغّر قبل الرفع · {list.length} صورة · {formatBytes(totalBytes)}</span>
          </div>
          <div className="row gap-s wrap">
            <TextInput value={q} onChange={setQ} placeholder="بحث" aria-label="بحث في الصور" />
            <Select value={folder} onChange={setFolder} aria-label="المجلد" options={[{ value: 'all', label: `كل المجلدات (${list.length})` }, ...folders.map(f => ({ value: f, label: `${f} (${list.filter(a => a.folder === f).length})` }))]} />
            {folder === 'all' && <TextInput value={newFolder} onChange={setNewFolder} placeholder="ارفع في مجلد…" aria-label="مجلد الصور الجديدة" />}
          </div>
          {shown.length === 0 ? (
            <EmptyState icon="image" title={list.length ? 'ما فيه صور مطابقة' : 'ما فيه صور للحين'}>
              ارفع صور للشعار والبطاقات والأدوار وخلفيات اللوحة والخانات. كل خانة صورة في المحرر تختار من هذي المكتبة.
            </EmptyState>
          ) : (
            <div className="asset-grid">
              {shown.map(a => (
                <button type="button" key={a.id} className={`asset-tile ${a.id === sel ? 'active' : ''}`} onClick={() => setSel(a.id)} aria-pressed={a.id === sel}>
                  <span className="asset-tile-img"><img src={a.url} alt="" /></span>
                  <span className="asset-tile-name">{a.name}</span>
                  <span className="small muted">{a.folder}{usedHere.has(a.id) ? ' · in use' : ''}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="studio-preview">
        {!asset ? (
          <EmptyState icon="image" title="اختار صورة">اختار صورة عشان تغير اسمها، تنقلها لمجلد، تستبدلها في كل مكان، أو تشوف وين مستخدمة.</EmptyState>
        ) : (
          <Panel title={asset.name} actions={<IconButton icon="x" label="إغلاق" onClick={() => setSel(null)} />}>
            <div className="asset-preview-main"><img src={asset.url} alt={asset.name} /></div>
            <p className="small muted">{asset.width}×{asset.height}px · {asset.mime.replace('image/', '').toUpperCase()} · {formatBytes(asset.bytes)}</p>
            <h4>معاينة بأحجام مختلفة</h4>
            <div className="ratio-row">
              {RATIOS.map(r => (
                <figure key={r.label} className="ratio-box">
                  <div style={{ aspectRatio: String(r.r) }}><img src={asset.url} alt="" /></div>
                  <figcaption className="small muted">{r.label}</figcaption>
                </figure>
              ))}
              {[24, 48, 96].map(s => (
                <figure key={s} className="ratio-box size-box"><img src={asset.url} alt="" style={{ width: s, height: s }} /><figcaption className="small muted">{s}px</figcaption></figure>
              ))}
            </div>
            <div className="grid-2">
              <Field label="الاسم"><TextInput value={asset.name} onChange={v => patchAsset(asset.id, { name: v })} /></Field>
              <Field label="المجلد"><TextInput value={asset.folder} onChange={v => patchAsset(asset.id, { folder: v || 'عام' })} list="asset-folders" /></Field>
              <datalist id="asset-folders">{folders.map(f => <option key={f} value={f} />)}</datalist>
            </div>
            <input ref={repRef} type="file" hidden accept={ACCEPT_ATTR} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) replaceAsset(asset.id, f); }} />
            <div className="row gap-s wrap">
              <Button icon="refresh" onClick={() => repRef.current?.click()}>استبدال الصورة في كل مكان</Button>
              <Button variant="danger" icon="trash" onClick={async () => {
                const anywhere = isAssetUsedAnywhere(asset.id);
                const msg = anywhere
                  ? <>هذي الصورة مستخدمة في {usages.length} مكان. الأماكن هذي بتعرض رسمة بديلة.</>
                  : 'مو مستخدمة في أي مكان.';
                if (await confirm({ title: `حذف «${asset.name}»؟`, message: msg, confirmLabel: 'حذف الصورة', danger: true })) { deleteAsset(asset.id); setSel(null); }
              }}>حذف</Button>
            </div>
            <h4>مستخدمة في ({usages.length})</h4>
            {usages.length === 0 ? <p className="small muted">مو مستخدمة في «{config.identity.name}».</p> : (
              <ul className="usage-list">
                {usages.map((u, i) => <li key={i}><button type="button" className="link" onClick={() => go(u.path as StudioTab)}>{u.label}</button></li>)}
              </ul>
            )}
            {usedHere.has(asset.id) ? <Badge>مستخدمة</Badge> : <Badge>غير مستخدمة</Badge>}
          </Panel>
        )}
      </div>
    </div>
  );
}
