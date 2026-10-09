"use client";

import { useRef, useState } from "react";
import type { Person, Question } from "@/lib/types";
import { blankQuestion, LIMITS } from "@/lib/game/doc";
import { uploadImage } from "@/lib/client/upload";
import { Field, inputCls, Modal } from "@/components/admin/ui";
import { PersonPicker } from "@/components/admin/QuestionEditor";
import { Spinner } from "@/components/ui";

type Item = { file: File; preview: string; status: "waiting" | "uploading" | "done" | "error"; error?: string };

/**
 * "Who took this photo?" in bulk: pick a person, drop their photos, get one
 * question per photo (answer = that person, who sits it out).
 */
export function PhotoBulkDialog({
  people,
  initialPersonId,
  defaultPrompt,
  onAdd,
  onClose,
}: {
  people: Person[];
  initialPersonId: string | null;
  defaultPrompt: string;
  onAdd: (questions: Question[]) => void;
  onClose: () => void;
}) {
  const [personId, setPersonId] = useState<string | null>(initialPersonId);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | File[]) => {
    const imgs = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    setItems((cur) => [
      ...cur,
      ...imgs.map((file) => ({ file, preview: URL.createObjectURL(file), status: "waiting" as const })),
    ]);
  };

  async function run() {
    if (!personId || running) return;
    setRunning(true);
    const created: Question[] = [];
    const next = [...items];
    for (let i = 0; i < next.length; i++) {
      if (next[i].status === "done") continue;
      next[i] = { ...next[i], status: "uploading" };
      setItems([...next]);
      const res = await uploadImage(next[i].file, "photo");
      if ("error" in res) {
        next[i] = { ...next[i], status: "error", error: res.error };
      } else {
        next[i] = { ...next[i], status: "done" };
        created.push(
          blankQuestion("who", {
            prompt: prompt.trim().slice(0, LIMITS.prompt),
            image: res.url,
            correct: [personId],
            aboutPersonId: personId,
          }),
        );
      }
      setItems([...next]);
    }
    setRunning(false);
    if (created.length) onAdd(created);
    if (next.every((it) => it.status === "done")) onClose();
  }

  const failed = items.filter((i) => i.status === "error").length;

  return (
    <Modal title="📸 إضافة صور (مين صوّرها؟)" onClose={running ? () => {} : onClose} wide>
      <Field label="الصور لمين؟">
        {people.length === 0 ? (
          <p className="font-bold text-pink">أضف الأشخاص أول من تبويب «الأشخاص».</p>
        ) : (
          <PersonPicker people={people} value={personId} onChange={setPersonId} />
        )}
      </Field>
      <Field label="نص السؤال لكل صورة" hint="ممكن تخليه فاضي">
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} className={`${inputCls} h-11`} />
      </Field>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        className="chunk-sm flex flex-col gap-3 border-dashed bg-card p-3"
      >
        {items.length === 0 ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex h-40 flex-col items-center justify-center gap-1 font-extrabold text-mute"
          >
            <span className="text-4xl">🖼️</span>
            اختار الصور أو اسحبها هنا (تقدر تختار أكثر من وحدة)
          </button>
        ) : (
          <>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {items.map((it, i) => (
                <li key={it.preview} className="relative aspect-square overflow-hidden rounded-lg border-2 border-ink bg-ink">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                  <img src={it.preview} alt="" className="size-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-ink/70 py-0.5 text-center text-xs font-bold text-white">
                    {it.status === "waiting" && "جاهزة"}
                    {it.status === "uploading" && "يرفع…"}
                    {it.status === "done" && "✓"}
                    {it.status === "error" && "فشل"}
                  </span>
                  {it.status === "uploading" && (
                    <span className="absolute inset-0 grid place-items-center bg-cream/60">
                      <Spinner className="size-6 text-ink" />
                    </span>
                  )}
                  {!running && it.status !== "done" && (
                    <button
                      type="button"
                      onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}
                      className="absolute end-1 top-1 grid size-6 place-items-center rounded-full border-2 border-ink bg-card text-xs font-black"
                      aria-label="إزالة"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!running && (
              <button type="button" onClick={() => input.current?.click()} className="btn btn-ghost h-10 self-start px-3 text-base">
                + صور ثانية
              </button>
            )}
          </>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {failed > 0 && (
        <p className="text-sm font-bold text-pink">
          {failed} صورة ما انرفعت: {items.find((i) => i.status === "error")?.error}
        </p>
      )}
      <button
        onClick={run}
        disabled={!personId || running || items.every((i) => i.status === "done")}
        className="btn btn-primary h-14 text-xl"
      >
        {running && <Spinner />}
        {running
          ? "جاري الرفع…"
          : `أضف ${items.filter((i) => i.status !== "done").length} سؤال`}
      </button>
    </Modal>
  );
}

/** Paste facts, one per line → one "who" question each. */
export function FactsBulkDialog({
  people,
  initialPersonId,
  onAdd,
  onClose,
}: {
  people: Person[];
  initialPersonId: string | null;
  onAdd: (questions: Question[]) => void;
  onClose: () => void;
}) {
  const [personId, setPersonId] = useState<string | null>(initialPersonId);
  const [text, setText] = useState("");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <Modal title="📝 لصق معلومات" onClose={onClose} wide>
      <Field label="المعلومات عن مين؟">
        {people.length === 0 ? (
          <p className="font-bold text-pink">أضف الأشخاص أول من تبويب «الأشخاص».</p>
        ) : (
          <PersonPicker people={people} value={personId} onChange={setPersonId} />
        )}
      </Field>
      <Field label="كل سطر = سؤال" hint={`${lines.length} سؤال`}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={"اكره الافوكادو\nما قد جربت ماتشا\n…"}
          className={`${inputCls} resize-y py-2 leading-relaxed`}
        />
      </Field>
      <button
        disabled={!personId || lines.length === 0}
        onClick={() => {
          onAdd(
            lines.map((line) =>
              blankQuestion("who", {
                prompt: line.slice(0, LIMITS.prompt),
                correct: [personId!],
                aboutPersonId: personId,
              }),
            ),
          );
          onClose();
        }}
        className="btn btn-primary h-14 text-xl"
      >
        أضف {lines.length} سؤال
      </button>
    </Modal>
  );
}
