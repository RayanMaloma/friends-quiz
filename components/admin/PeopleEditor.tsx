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
  update,
  onAddPhotos,
  onPasteFacts,
}: {
  doc: GameDoc;
  /** Functional updates: several portrait uploads can finish in any order. */
  update: (fn: (d: GameDoc) => GameDoc) => void;
  onAddPhotos: (personId: string) => void;
  onPasteFacts: (personId: string) => void;
}) {
  const people = doc.people;
  const countFor = (id: string) =>
    doc.questions.filter((q) => q.aboutPersonId === id || (q.type === "who" && q.correct.includes(id))).length;

  const patchPerson = (id: string, patch: Partial<Person>) =>
    update((d) => ({ ...d, people: d.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));

  const remove = (p: Person) => {
    const n = countFor(p.id);
    if (!window.confirm(n > 0 ? `حذف ${p.name}؟ عنده ${n} سؤال بتحتاج تختار لها إجابة ثانية.` : `حذف ${p.name}؟`)) return;
    // Drop references so nothing points at a missing person.
    update((d) => ({
      ...d,
      people: d.people.filter((x) => x.id !== p.id),
      questions: d.questions.map((q) => ({
        ...q,
        correct: q.correct.filter((c) => c !== p.id),
        aboutPersonId: q.aboutPersonId === p.id ? null : q.aboutPersonId,
      })),
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-semibold text-mute">
        الأشخاص هم الإجابات في أسئلة «مين؟» والتصويت. الصورة تطلع كبيرة على التلفزيون وقت كشف الإجابة — أفضل شي PNG
        بخلفية شفافة. اللي داخل يلعب يختار اسمه عند الدخول وما يجاوب على الأسئلة اللي عنه.
      </p>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {people.map((p) => (
          <li key={p.id} className="panel flex flex-col gap-3 bg-card p-3">
            <ImageField
              value={p.image}
              onChange={(image) => patchPerson(p.id, { image })}
              kind="portrait"
              label="صورة الشخص"
              className="h-52"
            />
            <input
              value={p.name}
              maxLength={LIMITS.personName}
              onChange={(e) => patchPerson(p.id, { name: e.target.value })}
              placeholder="الاسم"
              className={`${inputCls} h-12 font-display text-xl`}
            />
            <p className="text-xs font-bold text-mute">{countFor(p.id)} سؤال عنه</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => onAddPhotos(p.id)} className="abtn abtn-sm">
                📸 صور من {p.name || "…"}
              </button>
              <button onClick={() => onPasteFacts(p.id)} className="abtn abtn-sm">
                📝 معلومات
              </button>
              <button onClick={() => remove(p)} className="abtn abtn-danger abtn-sm">
                حذف
              </button>
            </div>
          </li>
        ))}
        {people.length < LIMITS.people && (
          <li>
            <button
              onClick={() =>
                update((d) => ({
                  ...d,
                  people: [...d.people, { id: newId("p"), name: `شخص ${d.people.length + 1}`, image: null }],
                }))
              }
              className="panel flex size-full min-h-48 flex-col items-center justify-center gap-2 border-dashed bg-cream font-display text-2xl text-mute hover:text-ink"
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
