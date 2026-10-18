"use client";

import React from 'react';
import type { Condition, Rule, RuleKind } from '@/lib/dx/types/config';
import { useStore } from '@/components/dx/store';
import { Badge, Button, Field, IconButton, NumberInput, Panel, Select, TextArea, TextInput, Tip, Toggle, moveItem, useConfirm } from '@/components/dx/components/ui';
import { describeCondition } from '@/lib/dx/engine/helpers';
import { uid } from '@/lib/dx/config/ids';

const KIND_INFO: Record<RuleKind, { label: string; help: string }> = {
  trackCompleteWin: { label: 'فوز: اكتمال مسار', help: 'يفوز فريق لما يكتمل مسار.' },
  roleElectedWin: { label: 'فوز: انتخاب دور', help: 'يفوز فريق لما يُنتخب دور معيّن كمرشّح (مثل المستشار).' },
  roleKilledWin: { label: 'فوز: إعدام دور', help: 'يفوز فريق لما يُعدم دور معيّن.' },
  termLimits: { label: 'حدود المنصب', help: 'آخر مرشّح منتخب (والقائد، فوق عدد معيّن من اللاعبين) ما ينفع يترشح.' },
  veto: { label: 'صلاحية الفيتو', help: 'المرشّح يقدر يقترح رمي البطاقتين؛ والقائد يقدر يوافق.' },
  chaos: { label: 'فوضى بعد التصويتات الفاشلة', help: 'لما يمتلئ متتبع الانتخابات، تُعتمد البطاقة اللي فوق تلقائيًا.' },
  custom: { label: 'قانون طاولة مخصص', help: 'نص حر يظهر للاعبين طول ما شرطه متحقق. دائمًا تطبقه الطاولة.' },
};

function ConditionEditor({ cond, onChange }: { cond: Condition; onChange: (c: Condition) => void }) {
  const { config } = useStore();
  return (
    <div className="row gap-s wrap cond-editor">
      <Field label="يطبّق" inline>
        <Select value={cond.kind} onChange={k => {
          const t = config.tracks[0]?.id ?? '';
          onChange(k === 'always' ? { kind: 'always' } : k === 'trackAtLeast' ? { kind: 'trackAtLeast', trackId: t, count: 3 } : k === 'playerCount' ? { kind: 'playerCount', min: config.mechanics.minPlayers, max: config.mechanics.maxPlayers } : k === 'aliveAtMost' ? { kind: 'aliveAtMost', count: 5 } : { kind: 'roundAtLeast', count: 3 });
        }} options={[
          { value: 'always', label: 'دائمًا' }, { value: 'trackAtLeast', label: 'لما يوصل مسار…' }, { value: 'playerCount', label: 'مع عدد لاعبين…' },
          { value: 'aliveAtMost', label: 'لما يبقى لاعبين قليل…' }, { value: 'roundAtLeast', label: 'من جولة معيّنة…' },
        ]} />
      </Field>
      {cond.kind === 'trackAtLeast' && <>
        <Select value={cond.trackId} onChange={v => onChange({ ...cond, trackId: v })} aria-label="المسار" options={config.tracks.map(t => ({ value: t.id, label: t.name }))} />
        <Field label="على الأقل" inline><NumberInput value={cond.count} min={0} max={20} onChange={v => onChange({ ...cond, count: v })} /></Field>
      </>}
      {cond.kind === 'playerCount' && <>
        <Field label="من" inline><NumberInput value={cond.min} min={1} max={99} onChange={v => onChange({ ...cond, min: v })} /></Field>
        <Field label="إلى" inline><NumberInput value={cond.max} min={1} max={99} onChange={v => onChange({ ...cond, max: v })} /></Field>
      </>}
      {cond.kind === 'aliveAtMost' && <Field label="الأحياء ≤" inline><NumberInput value={cond.count} min={1} max={99} onChange={v => onChange({ ...cond, count: v })} /></Field>}
      {cond.kind === 'roundAtLeast' && <Field label="الجولة ≥" inline><NumberInput value={cond.count} min={1} max={99} onChange={v => onChange({ ...cond, count: v })} /></Field>}
    </div>
  );
}

function RuleEditor({ rule, index }: { rule: Rule; index: number }) {
  const { config, update } = useStore();
  const confirm = useConfirm();
  const set = (fn: (r: Rule) => void) => update(c => { const r = c.rules.find(x => x.id === rule.id); if (r) fn(r); });
  const facOpts = config.factions.map(f => ({ value: f.id, label: f.name }));
  const roleOpts = config.roles.map(r => ({ value: r.id, label: r.name }));
  return (
    <div className={`rule-card ${rule.enabled ? '' : 'off'}`}>
      <div className="rule-card-head">
        <Badge>{KIND_INFO[rule.kind].label}</Badge>
        <Tip text={KIND_INFO[rule.kind].help} />
        <span className="grow" />
        <IconButton icon="up" label="تحريك لفوق" disabled={index === 0} onClick={() => update(c => { c.rules = moveItem(c.rules, index, index - 1); })} />
        <IconButton icon="down" label="تحريك لتحت" disabled={index === config.rules.length - 1} onClick={() => update(c => { c.rules = moveItem(c.rules, index, index + 1); })} />
        <IconButton icon="trash" label="حذف القانون" onClick={async () => { if (await confirm({ title: `حذف «${rule.name}»؟`, message: 'اللعبة بتوقف تطبيقه.', confirmLabel: 'حذف', danger: true })) update(c => { c.rules = c.rules.filter(r => r.id !== rule.id); }); }} />
      </div>
      <div className="grid-2">
        <Field label="الاسم"><TextInput value={rule.name} onChange={v => set(r => { r.name = v; })} /></Field>
        <div className="col gap-s rule-toggles">
          <Toggle checked={rule.enabled} onChange={v => set(r => { r.enabled = v; })} label="مفعّل" />
          {rule.kind !== 'custom' && <Toggle checked={rule.automated} onChange={v => set(r => { r.automated = v; })} label="تطبقه اللعبة تلقائيًا" hint="مطفي = اللعبة تعرض تذكير والمضيف يطبّق القانون من تحكم المضيف." />}
        </div>
      </div>
      <Field label="الوصف اللي يشوفه اللاعبين"><TextArea rows={2} value={rule.kind === 'custom' ? rule.params.text ?? '' : rule.description} onChange={v => set(r => { if (r.kind === 'custom') r.params.text = v; else r.description = v; })} /></Field>

      {(rule.kind === 'trackCompleteWin') && (
        <div className="grid-2">
          <Field label="المسار"><Select value={rule.params.trackId ?? ''} onChange={v => set(r => { r.params.trackId = v; })} options={config.tracks.map(t => ({ value: t.id, label: t.name }))} /></Field>
          <Field label="الفريق الفائز"><Select value={rule.params.factionId ?? ''} onChange={v => set(r => { r.params.factionId = v; })} options={facOpts} /></Field>
        </div>
      )}
      {(rule.kind === 'roleElectedWin' || rule.kind === 'roleKilledWin') && (
        <div className="grid-2">
          <Field label="الدور"><Select value={rule.params.roleId ?? ''} onChange={v => set(r => { r.params.roleId = v; })} options={roleOpts} /></Field>
          <Field label="الفريق الفائز"><Select value={rule.params.factionId ?? ''} onChange={v => set(r => { r.params.factionId = v; })} options={facOpts} /></Field>
        </div>
      )}
      {rule.kind === 'termLimits' && (
        <Field label="آخر قائد ممنوع بعد طالما الأحياء أكثر من هذا العدد"><NumberInput value={rule.params.aliveThreshold ?? 5} min={0} max={99} onChange={v => set(r => { r.params.aliveThreshold = v; })} /></Field>
      )}
      {rule.kind === 'veto' && <Toggle checked={rule.params.vetoAdvancesTracker !== false} onChange={v => set(r => { r.params.vetoAdvancesTracker = v; })} label="الفيتو المقبول يقدّم متتبع الانتخابات" />}
      {rule.kind === 'chaos' && (
        <div className="row gap-m wrap">
          <Toggle checked={!!rule.params.chaosTriggersPowers} onChange={v => set(r => { r.params.chaosTriggersPowers = v; })} label="بطاقات الفوضى تفعّل الصلاحيات" />
          <Toggle checked={rule.params.chaosResetsTermLimits !== false} onChange={v => set(r => { r.params.chaosResetsTermLimits = v; })} label="الفوضى تصفّر حدود المنصب" />
        </div>
      )}
      <ConditionEditor cond={rule.condition} onChange={cd => set(r => { r.condition = cd; })} />
      <p className="small muted">{describeCondition(rule.condition, config)}.</p>
    </div>
  );
}

export function RulesTab() {
  const { config, update, resetPreset } = useStore();
  const confirm = useConfirm();
  const m = config.mechanics;
  const addRule = (kind: RuleKind) => update(c => {
    c.rules.push({
      id: uid('rule'), kind, name: KIND_INFO[kind].label, description: KIND_INFO[kind].help, enabled: true, automated: kind !== 'custom',
      condition: { kind: 'always' },
      params: kind === 'trackCompleteWin' ? { trackId: c.tracks[0]?.id, factionId: c.factions[0]?.id }
        : kind === 'roleElectedWin' || kind === 'roleKilledWin' ? { roleId: c.roles[0]?.id, factionId: c.factions[0]?.id }
        : kind === 'termLimits' ? { aliveThreshold: 5 } : kind === 'chaos' ? { chaosResetsTermLimits: true } : kind === 'veto' ? { vetoAdvancesTracker: true } : { text: 'اكتب قانونك الخاص هنا.' },
    });
  });

  return (
    <div className="studio-stack">
      <Panel title="ترتيب الدور والتصويت">
        <div className="grid-3">
          <Field label="لقب القائد"><TextInput value={m.leaderTitle} onChange={v => update(c => { c.mechanics.leaderTitle = v; })} /></Field>
          <Field label="لقب المرشّح"><TextInput value={m.nomineeTitle} onChange={v => update(c => { c.mechanics.nomineeTitle = v; })} /></Field>
          <Field label="اسم الحكومة"><TextInput value={m.governmentTitle} onChange={v => update(c => { c.mechanics.governmentTitle = v; })} /></Field>
          <Field label="اسم البطاقة (القانون)"><TextInput value={m.policyTitle} onChange={v => update(c => { c.mechanics.policyTitle = v; })} /></Field>
          <Field label="اسم صوت الموافقة"><TextInput value={m.yesLabel} onChange={v => update(c => { c.mechanics.yesLabel = v; })} /></Field>
          <Field label="اسم صوت الرفض"><TextInput value={m.noLabel} onChange={v => update(c => { c.mechanics.noLabel = v; })} /></Field>
          <Field label="التصويت ينجح بـ" hint="ينحسب مع اللاعبين اللي يصوّتون."><Select value={m.votePassRule} onChange={v => update(c => { c.mechanics.votePassRule = v; })} options={[{ value: 'atLeastHalf', label: '٥٠٪ موافقة أو أكثر' }, { value: 'majority', label: 'أكثر من ٥٠٪ موافقة (التعادل يفشل)' }]} /></Field>
          <Field label={`${m.leaderTitle} يصوّت؟`}><Select value={(m.leaderVotes ?? true) ? 'yes' : 'no'} onChange={v => update(c => { c.mechanics.leaderVotes = v === 'yes'; })} options={[{ value: 'no', label: `لا — ${m.leaderTitle} ما يصوّت` }, { value: 'yes', label: 'إيه — كل الأحياء يصوّتون' }]} /></Field>
          <Field label="بعد التصويت، اعرض" hint="تصويت سرّي: تظهر النسبة بس والأصوات الفردية تنمسح."><Select value={m.voteReveal ?? 'percent'} onChange={v => update(c => { c.mechanics.voteReveal = v; })} options={[{ value: 'percent', label: 'نسبة الموافقة بس' }, { value: 'names', label: 'صوت كل واحد باسمه' }]} /></Field>
          <Field label="متتبع الانتخابات يتصفّر" hint="دائمًا يتصفّر بعد الفوضى."><Select value={m.trackerReset ?? 'chaosOnly'} onChange={v => update(c => { c.mechanics.trackerReset = v; })} options={[{ value: 'chaosOnly', label: 'بعد الفوضى بس (يحتفظ بالعدد)' }, { value: 'onEnact', label: 'لما تُعتمد بطاقة' }, { value: 'onElection', label: 'لما ينجح تصويت' }]} /></Field>
          <Field label="تناوب القائد"><Select value={m.rotation} onChange={v => update(c => { c.mechanics.rotation = v; })} options={[{ value: 'clockwise', label: 'بالترتيب حسب الجلسة' }, { value: 'random', label: 'عشوائي كل جولة' }]} /></Field>
          <Field label="البطاقات المسحوبة كل جلسة" hint="القائد يرمي لين يبقى اثنتين، والمرشّح يعتمد وحدة."><NumberInput value={m.drawCount} min={2} max={6} onChange={v => update(c => { c.mechanics.drawCount = v; })} /></Field>
          <Field label="تصويتات فاشلة قبل الفوضى"><NumberInput value={m.electionTrackerLength} min={1} max={10} onChange={v => update(c => { c.mechanics.electionTrackerLength = v; })} /></Field>
        </div>
      </Panel>

      <Panel title="القوانين والصلاحيات وشروط الفوز" actions={
        <Select value="" aria-label="إضافة قانون" onChange={v => v && addRule(v as RuleKind)} options={[{ value: '', label: '+ إضافة قانون…' }, ...(Object.keys(KIND_INFO) as RuleKind[]).map(k => ({ value: k, label: KIND_INFO[k].label }))]} />
      }>
        <p className="small muted">الصلاحيات الخاصة تنضبط لكل خانة في المسارات (تبويب اللوحة) ولكل بطاقة (تبويب البطاقات). القوانين تحت تحدد الفوز وإجراءات الطاولة. كل قانون يكون تلقائي أو تطبقه الطاولة.</p>
        <div className="rule-cards">
          {config.rules.map((r, i) => <RuleEditor key={r.id} rule={r} index={i} />)}
        </div>
      </Panel>

      <Panel title="نص القوانين" actions={<Button size="sm" icon="plus" onClick={() => update(c => { c.rulesText.push({ id: uid('rt'), title: 'قسم جديد', body: '' }); })}>إضافة قسم</Button>}>
        {config.rulesText.map((s, i) => (
          <div key={s.id} className="text-section">
            <div className="row gap-s">
              <TextInput value={s.title} onChange={v => update(c => { c.rulesText[i].title = v; })} aria-label="عنوان القسم" />
              <IconButton icon="up" label="تحريك لفوق" disabled={i === 0} onClick={() => update(c => { c.rulesText = moveItem(c.rulesText, i, i - 1); })} />
              <IconButton icon="down" label="تحريك لتحت" disabled={i === config.rulesText.length - 1} onClick={() => update(c => { c.rulesText = moveItem(c.rulesText, i, i + 1); })} />
              <IconButton icon="trash" label="حذف القسم" onClick={() => update(c => { c.rulesText.splice(i, 1); })} />
            </div>
            <TextArea rows={4} value={s.body} onChange={v => update(c => { c.rulesText[i].body = v; })} aria-label={`نص ${s.title}`} />
          </div>
        ))}
      </Panel>

      <Panel title="إرجاع">
        <p className="small">يرجّع اللعبة كاملة (الهوية، الثيم، اللوحة، البطاقات، الأدوار والقوانين) لقالبها الأصلي. الصور المرفوعة تبقى في المكتبة.</p>
        <Button variant="danger" icon="refresh" onClick={async () => {
          if (await confirm({ title: 'إرجاع للأصل؟', message: `«${config.identity.name}» بترجع للإعدادات الأصلية. صدّرها أول إذا تبي نسخة احتياطية.`, confirmLabel: 'إرجاع كل شي', danger: true })) resetPreset();
        }}>إرجاع للإعدادات الأصلية</Button>
      </Panel>
    </div>
  );
}
