"use client";

import type { GameDoc, Person } from "@/lib/types";
import { LIMITS, newId } from "@/lib/game/doc";
import { ImageField } from "@/components/admin/ImageField";
import { inputCls } from "@/components/admin/ui";

/**
 * The people a game is about: possible answers for "who" questions and polls.
 * A person can be linked to a player on join, so they sit out questions about
 * themselves.
 */
export function PeopleEditor({
  doc,
  onChange,
  onAddPhotos,
  onPasteFacts,
}: {
  doc: GameDoc;
  onChange: (people: Person[], questions?: GameDoc["questions"]) => void;
  onAddPhotos: (personId: string) => void;
  onPasteFacts: (personId: string) => void;
}) {
  const people = doc.people;
  const countFor = (id: string) =>
    doc.questions.filter((q) => q.aboutPersonId === id || (q.type === "who" && q.correct.includes(id))).length;

  const update = (i: number, patch: Partial<Person>) =>
    onChange(people.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const remove = (p: Person) => {
    const n = countFor(p.id);
    if (!window.confirm(n > 0 ? `حذف ${p.name}؟ عنده ${n} سؤال بتحتاج تختار لها إجابة ثانية.` : `حذف ${p.name}؟`)) return;
    // Drop references so nothing points at a missing person.
    const questions = doc.questions.map((q) => ({
      ...q,
      correct: q.correct.filter((c) => c !== p.id),
      aboutPersonId: q.aboutPersonId === p.id ? null : q.aboutPersonId,
    }));
    onChange(people.filter((x) => x.id !== p.id), questions);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="chunk-sm bg-[#eef4ff] px-4 py-3 text-sm font-bold leading-relaxed">
        الأشخاص هم الإجابات في أسئلة «مين؟» والتصويت. الصورة تطلع على التلفزيون لحظة كشف الإجابة — أفضل شي صورة مقصوصة
        بخلفية شفافة (PNG) والشخص واقف لين أسفل الصورة. لو الشخص داخل يلعب، يختار اسمه عند الدخول وما يجاوب على الأسئلة
        اللي عنه.
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {people.map((p, i) => (
          <li key={p.id} className="chunk flex flex-col gap-3 bg-card p-3">
            <ImageField
              value={p.image}
              onChange={(image) => update(i, { image })}
              kind="portrait"
              label="صورة الشخص"
              className="h-52"
            />
            <input
              value={p.name}
              maxLength={LIMITS.personName}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="الاسم"
              className={`${inputCls} h-12 font-display text-xl`}
            />
            <p className="text-xs font-bold text-mute">{countFor(p.id)} سؤال عنه</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => onAddPhotos(p.id)} className="btn btn-ghost h-10 px-3 text-sm">
                📸 صور من {p.name || "…"}
              </button>
              <button onClick={() => onPasteFacts(p.id)} className="btn btn-ghost h-10 px-3 text-sm">
                📝 معلومات
              </button>
              <button onClick={() => remove(p)} className="btn h-10 bg-pink px-3 text-sm text-white">
                حذف
              </button>
            </div>
          </li>
        ))}
        {people.length < LIMITS.people && (
          <li>
            <button
              onClick={() => onChange([...people, { id: newId("p"), name: `شخص ${people.length + 1}`, image: null }])}
              className="chunk flex size-full min-h-48 flex-col items-center justify-center gap-2 border-dashed bg-cream font-display text-2xl text-mute hover:text-ink"
            >
              <span className="text-4xl">＋</span>
              إضافة شخص
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
