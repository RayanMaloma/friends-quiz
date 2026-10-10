"use client";

import { useState } from "react";
import type { ChoiceOption, Person, Question, QuestionType } from "@/lib/types";
import { LIMITS, newId, QUESTION_TYPE_INFO, QUESTION_TYPES, questionIssues, TRUE_FALSE_OPTIONS } from "@/lib/game/doc";
import { optionStyle } from "@/lib/colors";
import { Img } from "@/components/Media";
import { ImageField } from "@/components/admin/ImageField";
import { Field, inputCls, Segmented, Toggle } from "@/components/admin/ui";

/** Switch a question's type, keeping everything that still makes sense. */
export function changeType(q: Question, type: QuestionType, people: Person[]): Question {
  const next: Question = { ...q, type };
  const personIds = new Set(people.map((p) => p.id));
  next.correct = [];
  next.accepted = type === "text" ? q.accepted : [];
  next.numberAnswer = type === "number" ? q.numberAnswer : null;
  next.pollScoring = type === "poll" ? q.pollScoring : "none";
  if (type === "who") {
    next.correct = q.correct.filter((c) => personIds.has(c)).slice(0, 1);
    next.options = [];
  } else if (type === "choice") {
    next.options = q.options.length >= 2 ? q.options : [1, 2, 3, 4].map(() => ({ id: newId("o"), label: "", image: null }));
    next.correct = q.correct.filter((c) => next.options.some((o) => o.id === c));
  } else if (type === "poll") {
    next.optionSource = q.options.length >= 2 ? "custom" : "people";
  } else {
    next.options = [];
  }
  if (type !== "who" && q.type === "who") next.aboutPersonId = null;
  return next;
}

function answerSummary(q: Question, people: Person[]): string {
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "؟";
  switch (q.type) {
    case "who":
      return q.correct.length ? q.correct.map(name).join("، ") : "—";
    case "choice":
      return q.options.filter((o) => q.correct.includes(o.id)).map((o) => o.label || "صورة").join("، ") || "—";
    case "truefalse":
      return q.correct[0] === "true" ? "صح" : q.correct[0] === "false" ? "خطأ" : "—";
    case "poll":
      return q.pollScoring === "majority" ? "الأغلبية تكسب" : "بدون نقاط";
    case "text":
      return q.accepted.join("، ") || "—";
    case "number":
      return q.numberAnswer === null ? "—" : String(q.numberAnswer);
  }
}

export function QuestionCard({
  q,
  index,
  total,
  people,
  expanded,
  onToggle,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: {
  q: Question;
  index: number;
  total: number;
  people: Person[];
  expanded: boolean;
  onToggle: () => void;
  /** Pass a function to update from the latest state (async uploads must not undo newer edits). */
  onChange: (next: QuestionUpdate) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const issues = q.enabled ? questionIssues(q, people) : [];
  const info = QUESTION_TYPE_INFO[q.type];
  return (
    <li
      className={`panel-sm flex flex-col overflow-hidden bg-card ${q.enabled ? "" : "opacity-60"} ${
        issues.length ? "border-pink" : ""
      } ${expanded ? "shadow-[0_3px_0_var(--color-ink)]" : ""}`}
    >
      <div className={`flex items-center gap-2 p-2 sm:gap-3 sm:px-3 ${expanded ? "bg-[#fff6d8]" : ""}`}>
        <span className="w-6 shrink-0 text-center text-sm font-black text-mute">{index + 1}</span>
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-start">
          {q.image ? (
            <span className="relative size-11 shrink-0 overflow-hidden rounded-lg border-2 border-ink bg-ink">
              <Img src={q.image} alt="" sizes="44px" className="object-cover" />
            </span>
          ) : (
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-cream text-xl">
              {info.emoji}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-extrabold">
              {q.prompt || (q.image ? "📷 صورة" : <span className="text-mute">سؤال فاضي</span>)}
            </span>
            <span className="block truncate text-xs font-semibold text-mute">
              {info.label} · الإجابة: {answerSummary(q, people)}
            </span>
          </span>
          {issues.length > 0 && (
            <span
              className="shrink-0 rounded-full bg-pink px-2 py-0.5 text-xs font-black text-white"
              title={issues.join("\n")}
            >
              يحتاج تصليح
            </span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <IconBtn label="لفوق" disabled={index === 0} onClick={() => onMove(-1)}>
            ↑
          </IconBtn>
          <IconBtn label="لتحت" disabled={index === total - 1} onClick={() => onMove(1)}>
            ↓
          </IconBtn>
          <IconBtn label={expanded ? "إغلاق" : "تعديل"} onClick={onToggle}>
            {expanded ? "▴" : "✎"}
          </IconBtn>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-5 border-t-2 border-ink/15 p-3 sm:p-5">
          {issues.length > 0 && (
            <ul className="flex flex-col gap-0.5 rounded-xl bg-[#ffe1ec] px-3 py-2 text-sm font-bold">
              {issues.map((i) => (
                <li key={i}>• {i}</li>
              ))}
            </ul>
          )}
          <QuestionForm q={q} people={people} onChange={onChange} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-ink/10 pt-4">
            <div className="min-w-56">
              <Toggle
                checked={q.enabled}
                onChange={(enabled) => onChange((cur) => ({ ...cur, enabled }))}
                label="مفعّل"
                hint="الأسئلة الموقفة ما تنلعب"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={onToggle} className="abtn abtn-primary abtn-sm">
                تم ✓
              </button>
              <button onClick={onDuplicate} className="abtn abtn-sm">
                نسخ
              </button>
              <button
                onClick={() => {
                  if (window.confirm("حذف السؤال؟")) onDelete();
                }}
                className="abtn abtn-danger abtn-sm"
              >
                حذف
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="abtn abtn-quiet abtn-sm abtn-icon text-base"
    >
      {children}
    </button>
  );
}

export type QuestionUpdate = Question | ((cur: Question) => Question);

function QuestionForm({
  q,
  people,
  onChange,
}: {
  q: Question;
  people: Person[];
  onChange: (next: QuestionUpdate) => void;
}) {
  const set = (patch: Partial<Question>) => onChange((cur) => ({ ...cur, ...patch }));
  const [advanced, setAdvanced] = useState(q.timeLimit !== null || q.points !== null || !!q.note);

  return (
    <div className="flex flex-col gap-5">
      <Field label="نوع السؤال">
        <div className="flex flex-wrap gap-1.5">
          {QUESTION_TYPES.map((t) => {
            const info = QUESTION_TYPE_INFO[t];
            return (
              <button
                key={t}
                type="button"
                aria-pressed={t === q.type}
                onClick={() => t !== q.type && onChange((cur) => changeType(cur, t, people))}
                className={`abtn abtn-sm ${t === q.type ? "abtn-primary" : "text-ink/70"}`}
                title={info.hint}
              >
                {info.emoji} {info.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs font-semibold text-mute">{QUESTION_TYPE_INFO[q.type].hint}</p>
      </Field>

      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <Field label="نص السؤال" hint={q.image ? "اختياري مع الصورة" : undefined}>
          <textarea
            value={q.prompt}
            maxLength={LIMITS.prompt}
            rows={4}
            onChange={(e) => set({ prompt: e.target.value })}
            placeholder={q.type === "who" ? "مثال: اول مره دخنت ب ٣ ابتدائي" : "اكتب السؤال…"}
            className={`${inputCls} min-h-28 resize-y py-2 leading-relaxed`}
          />
        </Field>
        <Field label="صورة السؤال">
          <ImageField value={q.image} onChange={(image) => set({ image })} kind="photo" className="h-36" />
        </Field>
      </div>

      {q.type === "who" && (
        <Field label="الإجابة الصحيحة: مين؟">
          {people.length < 2 ? (
            <p className="text-sm font-bold text-pink">أضف الأشخاص أول من تبويب «الأشخاص».</p>
          ) : (
            <PersonPicker
              people={people}
              value={q.correct[0] ?? null}
              onChange={(id) =>
                set({
                  correct: id ? [id] : [],
                  // Follow the answer unless the author turned exclusion off.
                  aboutPersonId: q.aboutPersonId === null && q.correct.length > 0 ? null : id,
                })
              }
            />
          )}
          {q.correct.length > 0 && (
            <Toggle
              checked={q.aboutPersonId === q.correct[0]}
              onChange={(v) => set({ aboutPersonId: v ? q.correct[0] : null })}
              label="صاحب الإجابة ما يجاوب على هذا السؤال"
              hint="لو هو داخل اللعبة، جواله يقول له «هذا السؤال عنك»"
            />
          )}
        </Field>
      )}

      {q.type === "choice" && (
        <OptionsEditor
          options={q.options}
          correct={q.correct}
          withCorrect
          onChange={(options, correct) => set({ options, correct })}
          onOptionImage={(id, image) =>
            onChange((cur) => ({ ...cur, options: cur.options.map((o) => (o.id === id ? { ...o, image } : o)) }))
          }
        />
      )}

      {q.type === "truefalse" && (
        <Field label="الإجابة الصحيحة">
          <Segmented
            value={q.correct[0] ?? ""}
            onChange={(v) => set({ correct: [v] })}
            options={TRUE_FALSE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
          />
        </Field>
      )}

      {q.type === "poll" && (
        <>
          <Field label="التصويت على">
            <Segmented
              value={q.optionSource}
              onChange={(optionSource) =>
                set({
                  optionSource,
                  options:
                    optionSource === "custom" && q.options.length < 2
                      ? [1, 2].map(() => ({ id: newId("o"), label: "", image: null }))
                      : q.options,
                })
              }
              options={[
                { value: "people", label: "الأشخاص" },
                { value: "custom", label: "خيارات أكتبها" },
              ]}
            />
          </Field>
          {q.optionSource === "custom" && (
            <OptionsEditor
              options={q.options}
              correct={[]}
              onChange={(options) => set({ options })}
              onOptionImage={(id, image) =>
                onChange((cur) => ({ ...cur, options: cur.options.map((o) => (o.id === id ? { ...o, image } : o)) }))
              }
            />
          )}
          <Field label="النقاط">
            <Segmented
              value={q.pollScoring}
              onChange={(pollScoring) => set({ pollScoring })}
              options={[
                { value: "majority", label: "اللي يصوّت مع الأغلبية ياخذ نقاط" },
                { value: "none", label: "بدون نقاط (للضحك بس)" },
              ]}
            />
          </Field>
        </>
      )}

      {q.type === "text" && (
        <Field label="الإجابات المقبولة" hint="المطابقة مرنة: المسافات، الهمزات، التشكيل، «ال» والحروف الكبيرة ما تفرق.">
          <TagsInput values={q.accepted} onChange={(accepted) => set({ accepted })} placeholder="اكتب إجابة واضغط Enter" />
        </Field>
      )}

      {q.type === "number" && (
        <Field label="الرقم الصحيح" hint="أقرب تخمين (أو أكثر من واحد لو تعادلوا) ياخذ النقاط.">
          <input
            dir="ltr"
            type="number"
            inputMode="decimal"
            value={q.numberAnswer ?? ""}
            onChange={(e) => set({ numberAnswer: e.target.value === "" ? null : Number(e.target.value) })}
            className={`${inputCls} h-12 max-w-56 text-xl tabular-nums`}
          />
        </Field>
      )}

      <div>
        <button type="button" onClick={() => setAdvanced((a) => !a)} className="abtn abtn-quiet abtn-sm -ms-2 text-mute">
          {advanced ? "إخفاء الخيارات المتقدمة" : "خيارات متقدمة (وقت، نقاط، ملاحظة…)"}
        </button>
        {advanced && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="الوقت (ثواني)" hint="فاضي = حسب إعدادات اللعبة · 0 = بدون مؤقت">
              <input
                dir="ltr"
                type="number"
                min={0}
                max={LIMITS.timeLimit}
                value={q.timeLimit ?? ""}
                placeholder="افتراضي"
                onChange={(e) => set({ timeLimit: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                className={`${inputCls} h-11`}
              />
            </Field>
            <Field label="النقاط" hint="فاضي = حسب إعدادات اللعبة">
              <input
                dir="ltr"
                type="number"
                min={0}
                max={LIMITS.points}
                value={q.points ?? ""}
                placeholder="افتراضي"
                onChange={(e) => set({ points: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                className={`${inputCls} h-11`}
              />
            </Field>
            {q.type !== "who" && people.length > 0 && (
              <Field label="السؤال عن شخص؟" hint="هذا الشخص ما يجاوب عليه (لو داخل اللعبة)">
                <select
                  value={q.aboutPersonId ?? ""}
                  onChange={(e) => set({ aboutPersonId: e.target.value || null })}
                  className={`${inputCls} h-11`}
                >
                  <option value="">لا أحد</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="sm:col-span-2">
              <Field label="ملاحظة تطلع مع الإجابة" hint="قصة، شرح، أو تعليق يطلع على التلفزيون بعد الكشف">
                <textarea
                  value={q.note}
                  maxLength={LIMITS.note}
                  rows={2}
                  onChange={(e) => set({ note: e.target.value })}
                  className={`${inputCls} resize-y py-2`}
                />
              </Field>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PersonPicker({
  people,
  value,
  onChange,
}: {
  people: Person[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {people.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(value === p.id ? null : p.id)}
          aria-pressed={value === p.id}
          className={`abtn h-11 ps-1 ${value === p.id ? "abtn-primary" : ""}`}
        >
          <span className="relative size-8 overflow-hidden rounded-full border-2 border-ink bg-card">
            {p.image ? (
              <Img src={p.image} alt="" sizes="32px" className="object-cover object-top" />
            ) : (
              <span className="grid size-full place-items-center text-sm">{[...p.name][0]}</span>
            )}
          </span>
          {value === p.id && "✓ "}
          {p.name}
        </button>
      ))}
    </div>
  );
}

function OptionsEditor({
  options,
  correct,
  withCorrect = false,
  onChange,
  onOptionImage,
}: {
  options: ChoiceOption[];
  correct: string[];
  withCorrect?: boolean;
  onChange: (options: ChoiceOption[], correct: string[]) => void;
  onOptionImage: (optionId: string, image: string | null) => void;
}) {
  const update = (i: number, patch: Partial<ChoiceOption>) =>
    onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)), correct);
  return (
    <Field label={withCorrect ? "الخيارات (علّم الصحيح ✓)" : "الخيارات"}>
      <ul className="flex flex-col gap-2">
        {options.map((o, i) => {
          const st = optionStyle(i);
          const isCorrect = correct.includes(o.id);
          return (
            <li key={o.id} className="flex items-center gap-2">
              <span className={`grid size-11 shrink-0 place-items-center rounded-lg border-2 border-ink text-lg ${st.bg} ${st.fg}`}>
                {st.shape}
              </span>
              <input
                value={o.label}
                maxLength={LIMITS.option}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder={`الخيار ${i + 1}`}
                className={`${inputCls} h-11 min-w-0 flex-1`}
              />
              <OptionImage value={o.image} onChange={(image) => onOptionImage(o.id, image)} />
              {withCorrect && (
                <button
                  type="button"
                  onClick={() =>
                    onChange(options, isCorrect ? correct.filter((c) => c !== o.id) : [...correct, o.id])
                  }
                  className={`grid size-11 shrink-0 place-items-center rounded-lg border-2 border-ink text-lg font-black ${
                    isCorrect ? "bg-mint" : "bg-cream text-ink/30"
                  }`}
                  title="إجابة صحيحة"
                >
                  ✓
                </button>
              )}
              <button
                type="button"
                disabled={options.length <= 2}
                onClick={() => onChange(options.filter((_, j) => j !== i), correct.filter((c) => c !== o.id))}
                className="grid size-11 shrink-0 place-items-center rounded-lg border-2 border-ink bg-card font-black disabled:opacity-30"
                title="حذف الخيار"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      {options.length < LIMITS.options && (
        <button
          type="button"
          onClick={() => onChange([...options, { id: newId("o"), label: "", image: null }], correct)}
          className="abtn abtn-sm self-start"
        >
          + خيار
        </button>
      )}
    </Field>
  );
}

function OptionImage({ value, onChange }: { value: string | null; onChange: (url: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border-2 border-ink bg-cream"
        title="صورة للخيار"
      >
        {value ? <Img src={value} alt="" sizes="44px" className="object-cover" /> : "🖼️"}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-6" onClick={() => setOpen(false)}>
          <div className="panel w-full max-w-xs bg-cream p-4" onClick={(e) => e.stopPropagation()}>
            <ImageField
              value={value}
              onChange={(url) => {
                onChange(url);
                setOpen(false);
              }}
              kind="option"
              fit="cover"
              className="h-56"
            />
          </div>
        </div>
      )}
    </>
  );
}

function TagsInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (t && !values.includes(t) && values.length < LIMITS.accepted) onChange([...values, t]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <span key={v} className="flex h-8 items-center gap-2 rounded-full border-2 border-ink bg-mint px-3 text-sm font-extrabold">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label="حذف">
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          maxLength={LIMITS.option}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className={`${inputCls} h-11 flex-1`}
        />
        <button type="button" onClick={add} className="abtn">
          إضافة
        </button>
      </div>
    </div>
  );
}
