"use client";

import type { GameDoc, GameSettings } from "@/lib/types";
import { ACCENTS, LIMITS } from "@/lib/game/doc";
import { ACCENT_HEX, ACCENT_LABEL } from "@/lib/colors";
import { ImageField } from "@/components/admin/ImageField";
import { Field, inputCls, Section, Segmented, Toggle } from "@/components/admin/ui";

const EMOJIS = ["🎉", "🤫", "📸", "🧠", "🗳️", "🎯", "🔥", "😂", "🏆", "🎬", "🎵", "⚽", "🍔", "✈️", "💡", "👀"];

export function GeneralEditor({ doc, onChange }: { doc: GameDoc; onChange: (patch: Partial<GameDoc>) => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="الاسم والشكل">
        <Field label="اسم اللعبة" htmlFor="g-title">
          <input
            id="g-title"
            value={doc.title}
            maxLength={LIMITS.title}
            onChange={(e) => onChange({ title: e.target.value })}
            className={`${inputCls} h-12 font-display text-2xl`}
          />
        </Field>
        <Field label="وصف قصير" hint="يطلع على التلفزيون في صالة الانتظار" htmlFor="g-tagline">
          <input
            id="g-tagline"
            value={doc.tagline}
            maxLength={LIMITS.tagline}
            onChange={(e) => onChange({ tagline: e.target.value })}
            className={`${inputCls} h-11`}
          />
        </Field>
        <Field label="الإيموجي">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={doc.emoji}
              maxLength={LIMITS.emoji}
              onChange={(e) => onChange({ emoji: e.target.value })}
              className={`${inputCls} h-11 w-20 text-center text-2xl`}
              aria-label="إيموجي"
            />
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onChange({ emoji: e })}
                className={`grid size-10 place-items-center rounded-lg border-2 text-xl ${
                  doc.emoji === e ? "border-ink bg-sun" : "border-transparent"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </Field>
        <Field label="اللون" hint="لون الأزرار والتمييز على التلفزيون والجوالات">
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => onChange({ accent: a })}
                className={`chunk-sm flex h-11 items-center gap-2 px-3 font-extrabold ${doc.accent === a ? "-translate-y-0.5" : "opacity-70"}`}
                style={{ background: ACCENT_HEX[a] }}
              >
                {doc.accent === a && "✓"} {ACCENT_LABEL[a]}
              </button>
            ))}
          </div>
        </Field>
      </Section>
      <Section title="صورة الغلاف">
        <p className="-mt-2 text-sm font-bold text-mute">اختياري — تطلع في قائمة الألعاب.</p>
        <ImageField value={doc.cover} onChange={(cover) => onChange({ cover })} kind="photo" fit="cover" className="h-56" />
      </Section>
    </div>
  );
}

export function SettingsEditor({
  settings,
  hasPeople,
  enabledCount,
  onChange,
}: {
  settings: GameSettings;
  hasPeople: boolean;
  enabledCount: number;
  onChange: (patch: Partial<GameSettings>) => void;
}) {
  const s = settings;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="⏱️ الوقت والنقاط">
        <Field label="وقت كل سؤال (ثواني)" hint="ممكن تغيّره لكل سؤال من «خيارات متقدمة»">
          <NumberChoice
            value={s.timeLimit}
            max={LIMITS.timeLimit}
            onChange={(timeLimit) => onChange({ timeLimit })}
            options={[
              { value: 0, label: "بدون مؤقت" },
              { value: 10, label: "١٠ث" },
              { value: 15, label: "١٥ث" },
              { value: 20, label: "٢٠ث" },
              { value: 30, label: "٣٠ث" },
              { value: 45, label: "٤٥ث" },
              { value: 60, label: "دقيقة" },
              { value: 90, label: "١:٣٠" },
            ]}
          />
        </Field>
        <Toggle
          checked={s.autoReveal}
          onChange={(autoReveal) => onChange({ autoReveal })}
          label="كشف الإجابة تلقائياً"
          hint="لما يخلص الوقت أو يجاوب الكل. بدونها المضيف يضغط «إظهار الإجابة»."
        />
        <Field label="نقاط الإجابة الصحيحة">
          <NumberChoice
            value={s.points}
            max={LIMITS.points}
            onChange={(points) => onChange({ points })}
            options={[
              { value: 1, label: "١" },
              { value: 10, label: "١٠" },
              { value: 100, label: "١٠٠" },
              { value: 1000, label: "١٠٠٠" },
            ]}
          />
        </Field>
        <Toggle
          checked={s.speedBonus}
          onChange={(speedBonus) => onChange({ speedBonus })}
          label="الأسرع ياخذ نقاط أكثر"
          hint="يحتاج مؤقت: من ١٠٠٪ للي يجاوب فوراً لين ٥٠٪ عند آخر ثانية."
        />
      </Section>

      <Section title="🔀 الأسئلة">
        <Field label="الترتيب">
          <Segmented
            value={s.order}
            onChange={(order) => onChange({ order })}
            options={[
              { value: "shuffle", label: "عشوائي (متوازن)" },
              { value: "fixed", label: "نفس ترتيبي" },
            ]}
          />
        </Field>
        <Field label="عدد الأسئلة في كل جلسة" hint={`فاضي = كل الأسئلة المفعّلة (${enabledCount})`}>
          <input
            dir="ltr"
            type="number"
            min={1}
            max={LIMITS.questions}
            value={s.questionLimit ?? ""}
            placeholder="الكل"
            onChange={(e) => onChange({ questionLimit: e.target.value === "" ? null : Math.max(1, Number(e.target.value)) })}
            className={`${inputCls} h-11 max-w-40`}
          />
        </Field>
        <Field label="لوحة الترتيب تطلع">
          <Segmented
            value={s.leaderboardEvery}
            onChange={(leaderboardEvery) => onChange({ leaderboardEvery })}
            options={[
              { value: 1, label: "بعد كل سؤال" },
              { value: 3, label: "كل ٣" },
              { value: 5, label: "كل ٥" },
              { value: 0, label: "بالنهاية بس" },
            ]}
            size="sm"
          />
        </Field>
      </Section>

      <Section title="📱 الجوالات">
        <Toggle
          checked={s.showQuestionOnPhones}
          onChange={(showQuestionOnPhones) => onChange({ showQuestionOnPhones })}
          label="عرض السؤال على الجوال"
          hint="بدونها السؤال على التلفزيون بس، والجوال فيه الخيارات."
        />
        <Toggle
          checked={s.phoneFeedback}
          onChange={(phoneFeedback) => onChange({ phoneFeedback })}
          label="الجوال يقول صح/غلط والنقاط"
          hint="بدونها الجوال ما يكشف شي — كل النتائج على التلفزيون."
        />
        <Toggle
          checked={s.lateJoin}
          onChange={(lateJoin) => onChange({ lateJoin })}
          label="السماح بالدخول بعد البداية"
        />
      </Section>

      <Section title="📺 التلفزيون">
        <Toggle
          checked={s.showVotes}
          onChange={(showVotes) => onChange({ showVotes })}
          label="عرض تصويت الكل عند الكشف"
          hint="مين اختار وش (أعداد بدون أسماء)."
        />
        {hasPeople && (
          <>
            <Toggle
              checked={s.askPersonOnJoin}
              onChange={(askPersonOnJoin) => onChange({ askPersonOnJoin })}
              label="اسأل اللاعب: أنت واحد من الأشخاص؟"
              hint="عشان ما يجاوب على الأسئلة اللي عنه."
            />
            <Toggle
              checked={s.lobbyPeek}
              onChange={(lobbyPeek) => onChange({ lobbyPeek })}
              label="الأشخاص يطلّون في صالة الانتظار"
              hint="صورهم تطلع من أطراف الشاشة وتختفي (للأشخاص اللي لهم صور)."
            />
          </>
        )}
      </Section>
    </div>
  );
}

/** Preset buttons plus a free number box for anything else. */
function NumberChoice({
  value,
  options,
  max,
  onChange,
}: {
  value: number;
  options: { value: number; label: string }[];
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented value={value} onChange={onChange} options={options} size="sm" />
      <input
        dir="ltr"
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(0, Math.round(n))));
        }}
        className={`${inputCls} h-9 w-24 text-center`}
        aria-label="رقم آخر"
      />
    </div>
  );
}
