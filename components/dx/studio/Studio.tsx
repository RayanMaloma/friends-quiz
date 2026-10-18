"use client";

import React, { useRef, useState } from 'react';
import { useStore, type StudioTab } from '@/components/dx/store';
import { Button, Panel, Tabs, TextArea, useConfirm } from '@/components/dx/components/ui';
import { Icon } from '@/components/dx/components/Icon';
import { IdentityTab } from './IdentityTab';
import { ThemeTab } from './ThemeTab';
import { BoardTab } from './BoardTab';
import { CardsTab } from './CardsTab';
import { RolesTab } from './RolesTab';
import { RulesTab } from './RulesTab';
import { AssetsTab } from './AssetsTab';

const TABS: { id: StudioTab; label: string; icon: string }[] = [
  { id: 'identity', label: 'الهوية', icon: 'star' },
  { id: 'theme', label: 'الثيم', icon: 'palette' },
  { id: 'board', label: 'اللوحة', icon: 'board' },
  { id: 'cards', label: 'البطاقات', icon: 'cards' },
  { id: 'roles', label: 'الفرق والأدوار', icon: 'users' },
  { id: 'rules', label: 'القوانين', icon: 'book' },
  { id: 'assets', label: 'الصور', icon: 'image' },
  { id: 'share', label: 'استيراد وتصدير', icon: 'save' },
];

/** The deduction game editor (rendered inside the admin dashboard). */
export function Studio({ tab, onTab }: { tab: StudioTab; onTab: (t: StudioTab) => void }) {
  return (
    <div className="studio">
      <Tabs label="أقسام المحرر" tabs={TABS} value={tab} onChange={onTab} />
      <p className="studio-note small"><Icon name="info" size={14} /> التعديلات تنحفظ تلقائيًا. اللعبة اللي شغّالة الحين تكمل بإعداداتها، والتعديل يطبّق على الغرف الجاية.</p>
      <div className="studio-body" role="tabpanel" aria-label={TABS.find(t => t.id === tab)?.label}>
        {tab === 'identity' && <IdentityTab />}
        {tab === 'theme' && <ThemeTab />}
        {tab === 'board' && <BoardTab />}
        {tab === 'cards' && <CardsTab />}
        {tab === 'roles' && <RolesTab />}
        {tab === 'rules' && <RulesTab />}
        {tab === 'assets' && <AssetsTab />}
        {tab === 'share' && <ShareTab />}
      </div>
    </div>
  );
}

function ShareTab() {
  const { config, exportConfig, importConfig, resetPreset, toast } = useStore();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState('');
  const [result, setResult] = useState<{ errors: string[]; warnings: string[] } | null>(null);

  const download = () => {
    const blob = new Blob([exportConfig()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${config.identity.name.replace(/[\\/:*?"<>|]+/g, '_') || 'game'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const runImport = async (text: string) => {
    if (!(await confirm({ title: 'استبدال تصميم اللعبة؟', message: 'التصميم الحالي بينمسح ويحل محله الملف المستورد. الصور الحالية تبقى في المكتبة.', confirmLabel: 'استيراد', danger: true }))) return;
    const res = importConfig(text);
    setResult(res);
    if (!res.errors.length) { toast('تم الاستيراد.', 'success'); setPaste(''); }
  };

  return (
    <div className="studio-stack">
      <Panel title="تصدير">
        <p className="small muted">ملف JSON فيه كل التصميم وروابط الصور. تقدر تستورده في لعبة ثانية أو تحتفظ فيه كنسخة.</p>
        <Button icon="download" onClick={download}>تنزيل ملف JSON</Button>
      </Panel>
      <Panel title="استيراد">
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async e => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) await runImport(await f.text());
        }} />
        <div className="col gap-s">
          <Button icon="upload" onClick={() => fileRef.current?.click()}>اختيار ملف</Button>
          <TextArea value={paste} onChange={setPaste} rows={5} placeholder="أو الصق محتوى JSON هنا" />
          <Button disabled={!paste.trim()} onClick={() => runImport(paste)}>استيراد النص الملصوق</Button>
          {result && result.errors.length > 0 && <ul className="small bad">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {result && result.warnings.length > 0 && <ul className="small muted">{result.warnings.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </div>
      </Panel>
      <Panel title="إرجاع للأصل">
        <p className="small muted">يرجع كل شي (الأسماء، البطاقات، القوانين، الثيمات) لنسخة القالب الأصلية.</p>
        <Button variant="danger" icon="undo" onClick={async () => {
          if (await confirm({ title: 'إرجاع كل شي للأصل؟', message: 'كل تعديلاتك على التصميم بتنمسح.', confirmLabel: 'إرجاع', danger: true })) resetPreset();
        }}>إرجاع للإعدادات الأصلية</Button>
      </Panel>
    </div>
  );
}
