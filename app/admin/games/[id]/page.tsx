"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { hostStore } from "@/lib/client/storage";
import type { GameDoc, GameRecord, GameRecordStatus, Question, QuestionType } from "@/lib/types";
import { blankQuestion, newId, QUESTION_TYPE_INFO, QUESTION_TYPES, validateGameDoc, type Issue } from "@/lib/game/doc";
import { ACCENT_HEX } from "@/lib/colors";
import { peopleLabel, questionsLabel } from "@/lib/format";
import { Spinner } from "@/components/ui";
import { StatusPill } from "@/components/admin/ui";
import { QuestionCard } from "@/components/admin/QuestionEditor";
import { PeopleEditor } from "@/components/admin/PeopleEditor";
import { GeneralEditor, SettingsEditor } from "@/components/admin/SettingsEditor";
import { FactsBulkDialog, PhotoBulkDialog } from "@/components/admin/BulkDialogs";

type Tab = "questions" | "people" | "settings" | "general";
type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export default function GameEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<GameDoc | null>(null);
  const [status, setStatus] = useState<GameRecordStatus>("draft");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("questions");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; issues?: Issue[] } | null>(null);

  // Autosave bookkeeping (refs: never stale inside timers/promises).
  const docRef = useRef<GameDoc | null>(null);
  const versionRef = useRef<number | null>(null);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ game: GameRecord }>("/api/admin", { action: "getGame", id });
    if (!res.ok) {
      setLoadError(errorMessage(res.error));
      return;
    }
    docRef.current = res.game.doc;
    versionRef.current = res.game.version;
    revision.current = 0;
    savedRevision.current = 0;
    setDoc(res.game.doc);
    setStatus(res.game.status);
    setSaveState("saved");
    setSaveError(null);
  }, [id]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // One save at a time; keep saving until the server has the latest edits.
    while (inFlight.current) await inFlight.current;
    while (docRef.current && revision.current !== savedRevision.current) {
      const rev = revision.current;
      setSaveState("saving");
      const run = (async () => {
        const res = await api<{ game: GameRecord }>("/api/admin", {
          action: "saveGame",
          id,
          doc: docRef.current,
          version: versionRef.current,
        });
        if (!res.ok) {
          setSaveState(res.error === "VERSION_CONFLICT" ? "conflict" : "error");
          setSaveError(errorMessage(res.error));
          return false;
        }
        versionRef.current = res.game.version;
        setStatus(res.game.status);
        savedRevision.current = rev;
        setSaveError(null);
        setSaveState(revision.current === rev ? "saved" : "dirty");
        return true;
      })();
      inFlight.current = run;
      const ok = await run;
      inFlight.current = null;
      if (!ok) return false;
    }
    return true;
  }, [id]);

  const update = useCallback(
    (fn: (d: GameDoc) => GameDoc) => {
      setDoc((cur) => {
        if (!cur) return cur;
        const next = fn(cur);
        docRef.current = next;
        return next;
      });
      revision.current += 1;
      setSaveState((s) => (s === "conflict" ? s : "dirty"));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveNow(), 900);
    },
    [saveNow],
  );

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (revision.current !== savedRevision.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const issues = useMemo(() => (doc ? validateGameDoc(doc) : []), [doc]);

  async function setGameStatus(next: GameRecordStatus) {
    setBusy("status");
    setNotice(null);
    if (!(await saveNow())) {
      setBusy(null);
      return;
    }
    const res = await api<{ version: number; status: GameRecordStatus }>("/api/admin", {
      action: "setStatus",
      id,
      status: next,
    });
    setBusy(null);
    if (!res.ok) {
      setNotice({ text: errorMessage(res.error), issues: (res.issues as Issue[] | undefined) ?? undefined });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    versionRef.current = res.version;
    setStatus(res.status);
    setNotice({ text: next === "published" ? "انشرت ✓ — تطلع الحين في قائمة «تشغيل»" : "رجعت مسودة" });
  }

  async function play() {
    setBusy("play");
    setNotice(null);
    if (!(await saveNow())) {
      setBusy(null);
      return;
    }
    const res = await api<{ sessionId: string; code: string; hostToken: string }>("/api/host", {
      action: "create",
      gameId: id,
    });
    setBusy(null);
    if (!res.ok) {
      setNotice({ text: errorMessage(res.error) });
      return;
    }
    hostStore.save({ sessionId: res.sessionId, code: res.code, hostToken: res.hostToken });
    router.push(`/host/${res.sessionId}`);
  }

  function exportJson() {
    if (!doc) return;
    const blob = new Blob([JSON.stringify({ format: "shilla-game", version: 1, doc }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.title.replace(/[\\/:*?"<>|]+/g, "_") || "game"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="font-display text-3xl">{loadError}</p>
        <Link href="/admin" className="btn btn-primary h-12 px-6 text-lg">
          رجوع للألعاب
        </Link>
      </div>
    );
  }
  if (!doc) return <Spinner className="mx-auto mt-16 size-8 text-ink" />;

  const enabledCount = doc.questions.filter((q) => q.enabled).length;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin" className="btn btn-ghost h-11 px-3 text-lg" aria-label="رجوع">
          →
        </Link>
        <span
          className="chunk-sm grid size-12 shrink-0 -rotate-6 place-items-center text-2xl"
          style={{ background: ACCENT_HEX[doc.accent] }}
        >
          {doc.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-3xl leading-tight">{doc.title || "بدون اسم"}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-mute">
            <StatusPill status={status} />
            <SaveIndicator state={saveState} />
            <span>
              المفعّل: {questionsLabel(enabledCount)} · {peopleLabel(doc.people.length)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportJson} className="btn btn-ghost h-11 px-3 text-base" title="تحميل نسخة JSON من اللعبة">
            📦 تصدير
          </button>
          {status === "published" ? (
            <button onClick={() => setGameStatus("draft")} disabled={!!busy} className="btn btn-ghost h-11 px-4 text-base">
              إلغاء النشر
            </button>
          ) : (
            <button
              onClick={() => setGameStatus("published")}
              disabled={!!busy || status === "archived"}
              className="btn h-11 bg-mint px-4 text-lg"
            >
              {busy === "status" && <Spinner className="size-4" />}
              نشر
            </button>
          )}
          <button onClick={play} disabled={!!busy || enabledCount === 0} className="btn btn-primary h-11 px-4 text-lg">
            {busy === "play" ? <Spinner className="size-4" /> : "📺"} تشغيل
          </button>
        </div>
      </div>

      {saveState === "conflict" && (
        <div className="chunk-sm flex flex-wrap items-center justify-between gap-3 bg-pink px-4 py-3 font-bold text-white">
          <span>اللعبة تعدّلت من جهاز أو تبويب ثاني. تعديلاتك هنا ما انحفظت.</span>
          <span className="flex gap-2">
            <button onClick={() => void load()} className="btn btn-ghost h-10 px-3 text-sm">
              تحميل النسخة الأحدث
            </button>
            <button
              onClick={() => {
                versionRef.current = null;
                setSaveState("dirty");
                void saveNow();
              }}
              className="btn btn-ghost h-10 px-3 text-sm"
            >
              احفظ نسختي فوقها
            </button>
          </span>
        </div>
      )}
      {saveState === "error" && saveError && (
        <div className="chunk-sm flex items-center justify-between gap-3 bg-pink px-4 py-2 font-bold text-white">
          <span>ما انحفظ: {saveError}</span>
          <button onClick={() => void saveNow()} className="btn btn-ghost h-9 px-3 text-sm">
            جرّب مرة ثانية
          </button>
        </div>
      )}
      {notice && (
        <div className="chunk-sm flex flex-col gap-1 bg-[#fff1c4] px-4 py-3 font-bold">
          <div className="flex items-center justify-between gap-3">
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} aria-label="إغلاق">
              ✕
            </button>
          </div>
          {notice.issues && notice.issues.length > 0 && (
            <ul className="text-sm text-ink/80">
              {notice.issues.slice(0, 8).map((i, k) => (
                <li key={k}>
                  ⚠{" "}
                  {i.questionId
                    ? `سؤال ${doc.questions.findIndex((q) => q.id === i.questionId) + 1}: `
                    : ""}
                  {i.message}
                </li>
              ))}
              {notice.issues.length > 8 && <li>و {notice.issues.length - 8} غيرها…</li>}
            </ul>
          )}
        </div>
      )}

      {/* Tabs */}
      <nav className="flex gap-2 overflow-x-auto no-scrollbar">
        {(
          [
            ["questions", `الأسئلة (${doc.questions.length})`],
            ["people", `الأشخاص (${doc.people.length})`],
            ["settings", "القوانين"],
            ["general", "الاسم والشكل"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`chunk-sm shrink-0 px-4 pb-1 pt-2 font-display text-lg leading-tight ${tab === t ? "bg-sun" : "bg-card"}`}
          >
            {label}
            {t === "questions" && issues.some((i) => i.questionId) && <span className="ms-1 text-pink">●</span>}
          </button>
        ))}
      </nav>

      {tab === "questions" && <QuestionsTab doc={doc} update={update} />}
      {tab === "people" && (
        <PeopleTab doc={doc} update={update} />
      )}
      {tab === "settings" && (
        <SettingsEditor
          settings={doc.settings}
          hasPeople={doc.people.length > 0}
          enabledCount={enabledCount}
          onChange={(patch) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } }))}
        />
      )}
      {tab === "general" && <GeneralEditor doc={doc} onChange={(patch) => update((d) => ({ ...d, ...patch }))} />}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, string> = {
    saved: "✓ محفوظ",
    dirty: "• تعديلات…",
    saving: "جاري الحفظ…",
    error: "⚠ ما انحفظ",
    conflict: "⚠ تعارض",
  };
  return <span className={state === "error" || state === "conflict" ? "text-pink" : ""}>{map[state]}</span>;
}

type Dialog = { kind: "photos" | "facts"; personId: string | null } | null;

function PeopleTab({ doc, update }: { doc: GameDoc; update: (fn: (d: GameDoc) => GameDoc) => void }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  return (
    <>
      <PeopleEditor
        doc={doc}
        onChange={(people, questions) => update((d) => ({ ...d, people, questions: questions ?? d.questions }))}
        onAddPhotos={(personId) => setDialog({ kind: "photos", personId })}
        onPasteFacts={(personId) => setDialog({ kind: "facts", personId })}
      />
      <BulkDialog dialog={dialog} doc={doc} update={update} onClose={() => setDialog(null)} />
    </>
  );
}

function BulkDialog({
  dialog,
  doc,
  update,
  onClose,
}: {
  dialog: Dialog;
  doc: GameDoc;
  update: (fn: (d: GameDoc) => GameDoc) => void;
  onClose: () => void;
}) {
  if (!dialog) return null;
  const add = (qs: Question[]) => update((d) => ({ ...d, questions: [...d.questions, ...qs] }));
  return dialog.kind === "photos" ? (
    <PhotoBulkDialog
      people={doc.people}
      initialPersonId={dialog.personId}
      defaultPrompt="مين صوّر هذي الصورة؟"
      onAdd={add}
      onClose={onClose}
    />
  ) : (
    <FactsBulkDialog people={doc.people} initialPersonId={dialog.personId} onAdd={add} onClose={onClose} />
  );
}

function QuestionsTab({ doc, update }: { doc: GameDoc; update: (fn: (d: GameDoc) => GameDoc) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [personFilter, setPersonFilter] = useState<string>("");
  const [showAdd, setShowAdd] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  const setQuestions = (fn: (qs: Question[]) => Question[]) => update((d) => ({ ...d, questions: fn(d.questions) }));

  const addQuestion = (type: QuestionType) => {
    const q = blankQuestion(type);
    setQuestions((qs) => [...qs, q]);
    setExpanded(q.id);
    setShowAdd(false);
    setTimeout(() => document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  const q = query.trim().toLowerCase();
  const visible = doc.questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => {
      if (personFilter && question.aboutPersonId !== personFilter && !question.correct.includes(personFilter)) return false;
      if (q && !question.prompt.toLowerCase().includes(q) && !question.note.toLowerCase().includes(q)) return false;
      return true;
    });

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <button onClick={() => setShowAdd((s) => !s)} className="btn btn-primary h-12 px-5 text-xl">
            + سؤال
          </button>
          {showAdd && (
            <div className="chunk-sm absolute start-0 top-14 z-20 grid w-72 gap-1 bg-card p-2">
              {QUESTION_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => addQuestion(t)}
                  className="flex items-start gap-2 rounded-lg px-2 py-2 text-start hover:bg-cream"
                >
                  <span className="text-xl">{QUESTION_TYPE_INFO[t].emoji}</span>
                  <span>
                    <span className="block font-extrabold">{QUESTION_TYPE_INFO[t].label}</span>
                    <span className="block text-xs font-bold text-mute">{QUESTION_TYPE_INFO[t].hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => setDialog({ kind: "photos", personId: null })} className="btn btn-ghost h-12 px-4 text-lg">
          📸 رفع صور
        </button>
        <button onClick={() => setDialog({ kind: "facts", personId: null })} className="btn btn-ghost h-12 px-4 text-lg">
          📝 لصق معلومات
        </button>
        <div className="ms-auto flex flex-wrap gap-2">
          {doc.people.length > 0 && (
            <select
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
              className="chunk-sm h-11 bg-card px-2 font-bold"
              aria-label="فلترة حسب الشخص"
            >
              <option value="">كل الأشخاص</option>
              {doc.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث…"
            className="chunk-sm h-11 w-40 bg-card px-3 font-bold outline-none"
          />
        </div>
      </div>

      {doc.questions.length === 0 ? (
        <div className="chunk flex flex-col items-center gap-3 bg-card p-10 text-center">
          <span className="text-5xl">❓</span>
          <p className="font-display text-2xl">ما فيه أسئلة للحين</p>
          <p className="max-w-md font-bold text-mute">
            أضف سؤال بأي نوع، أو ارفع صور الشلة دفعة وحدة (كل صورة تصير سؤال «مين صوّرها؟»)، أو الصق معلومات سطر بسطر.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center font-bold text-mute">ما فيه أسئلة تطابق البحث</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map(({ question, index }) => (
            <div key={question.id} id={`q-${question.id}`}>
              <QuestionCard
                q={question}
                index={index}
                total={doc.questions.length}
                people={doc.people}
                expanded={expanded === question.id}
                onToggle={() => setExpanded((e) => (e === question.id ? null : question.id))}
                onChange={(next) => setQuestions((qs) => qs.map((x) => (x.id === next.id ? next : x)))}
                onMove={(delta) =>
                  setQuestions((qs) => {
                    const i = qs.findIndex((x) => x.id === question.id);
                    const j = i + delta;
                    if (i < 0 || j < 0 || j >= qs.length) return qs;
                    const copy = [...qs];
                    [copy[i], copy[j]] = [copy[j], copy[i]];
                    return copy;
                  })
                }
                onDuplicate={() =>
                  setQuestions((qs) => {
                    const i = qs.findIndex((x) => x.id === question.id);
                    const copy = [...qs];
                    const ids = new Map(question.options.map((o) => [o.id, newId("o")]));
                    copy.splice(i + 1, 0, {
                      ...question,
                      id: newId("q"),
                      options: question.options.map((o) => ({ ...o, id: ids.get(o.id)! })),
                      correct: question.correct.map((c) => ids.get(c) ?? c),
                    });
                    return copy;
                  })
                }
                onDelete={() => setQuestions((qs) => qs.filter((x) => x.id !== question.id))}
              />
            </div>
          ))}
        </ul>
      )}
      <BulkDialog dialog={dialog} doc={doc} update={update} onClose={() => setDialog(null)} />
    </div>
  );
}
