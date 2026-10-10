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
import { Modal, Notice, StatusPill, Tabs } from "@/components/admin/ui";
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
        <Link href="/admin" className="abtn abtn-primary">
          رجوع للألعاب
        </Link>
      </div>
    );
  }
  if (!doc) return <Spinner className="mx-auto mt-16 size-8 text-ink" />;

  const enabledCount = doc.questions.filter((q) => q.enabled).length;
  const questionIssues = issues.filter((i) => i.questionId).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Sticky header: identity + save state + the two main actions */}
      <div className="sticky top-14 z-20 -mx-4 border-b-2 border-ink/10 bg-cream/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin" className="abtn abtn-quiet abtn-icon" aria-label="رجوع للألعاب" title="رجوع للألعاب">
            →
          </Link>
          <span
            className="grid size-11 shrink-0 place-items-center rounded-xl border-2 border-ink text-2xl"
            style={{ background: ACCENT_HEX[doc.accent] }}
          >
            {doc.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-2xl leading-tight">{doc.title || "بدون اسم"}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs font-bold text-mute">
              <StatusPill status={status} />
              <SaveIndicator state={saveState} />
            </div>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto [&>*:not(.hidden)]:flex-1 sm:[&>*]:flex-none">
            <button
              onClick={exportJson}
              className="abtn abtn-quiet abtn-sm hidden sm:inline-flex"
              title="تحميل نسخة JSON من اللعبة"
            >
              تصدير
            </button>
            {status === "published" ? (
              <button onClick={() => setGameStatus("draft")} disabled={!!busy} className="abtn abtn-sm">
                إلغاء النشر
              </button>
            ) : (
              <button
                onClick={() => setGameStatus("published")}
                disabled={!!busy || status === "archived"}
                className="abtn abtn-go"
              >
                {busy === "status" && <Spinner className="size-4" />}
                نشر
              </button>
            )}
            <button onClick={play} disabled={!!busy || enabledCount === 0} className="abtn abtn-primary">
              {busy === "play" ? <Spinner className="size-4" /> : "📺"} تشغيل
            </button>
          </div>
        </div>
      </div>

      {saveState === "conflict" && (
        <Notice
          tone="error"
          action={
            <span className="flex gap-2">
              <button onClick={() => void load()} className="abtn abtn-sm">
                تحميل النسخة الأحدث
              </button>
              <button
                onClick={() => {
                  versionRef.current = null;
                  setSaveState("dirty");
                  void saveNow();
                }}
                className="abtn abtn-sm"
              >
                احفظ نسختي فوقها
              </button>
            </span>
          }
        >
          اللعبة تعدّلت من جهاز أو تبويب ثاني، وتعديلاتك هنا ما انحفظت.
        </Notice>
      )}
      {saveState === "error" && saveError && (
        <Notice
          tone="error"
          action={
            <button onClick={() => void saveNow()} className="abtn abtn-sm">
              جرّب مرة ثانية
            </button>
          }
        >
          ما انحفظ: {saveError}
        </Notice>
      )}
      {notice && (
        <Notice
          tone={notice.issues?.length ? "warn" : "success"}
          action={
            <button onClick={() => setNotice(null)} className="abtn abtn-quiet abtn-sm abtn-icon" aria-label="إغلاق">
              ✕
            </button>
          }
        >
          <p>{notice.text}</p>
          {notice.issues && notice.issues.length > 0 && (
            <ul className="mt-1 font-semibold text-ink/80">
              {notice.issues.slice(0, 8).map((i, k) => (
                <li key={k}>
                  •{" "}
                  {i.questionId ? `سؤال ${doc.questions.findIndex((q) => q.id === i.questionId) + 1}: ` : ""}
                  {i.message}
                </li>
              ))}
              {notice.issues.length > 8 && <li>و {notice.issues.length - 8} غيرها…</li>}
            </ul>
          )}
        </Notice>
      )}

      {status !== "published" && (
        <SetupGuide doc={doc} issues={issues} onGo={setTab} onPublish={() => setGameStatus("published")} />
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "questions", label: "الأسئلة", badge: doc.questions.length, alert: questionIssues > 0 },
          { value: "people", label: "الأشخاص", badge: doc.people.length },
          { value: "settings", label: "القوانين" },
          { value: "general", label: "الشكل" },
        ]}
      />

      {tab === "questions" && <QuestionsTab doc={doc} update={update} onGoPeople={() => setTab("people")} />}
      {tab === "people" && <PeopleTab doc={doc} update={update} />}
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
    saved: "✓ كل التعديلات محفوظة",
    dirty: "تعديلات جديدة…",
    saving: "جاري الحفظ…",
    error: "⚠ ما انحفظ",
    conflict: "⚠ تعارض",
  };
  return <span className={state === "error" || state === "conflict" ? "text-pink" : ""}>{map[state]}</span>;
}

/** Does this game need people? (who questions, polls about people, or a people-based template.) */
function needsPeople(doc: GameDoc): boolean {
  const usesPeople = doc.questions.some((q) => q.type === "who" || (q.type === "poll" && q.optionSource === "people"));
  return usesPeople || doc.people.length > 0 || (doc.questions.length === 0 && doc.settings.askPersonOnJoin);
}

/** The steps to a playable game, shown until it is published. */
function SetupGuide({
  doc,
  issues,
  onGo,
  onPublish,
}: {
  doc: GameDoc;
  issues: Issue[];
  onGo: (t: Tab) => void;
  onPublish: () => void;
}) {
  const peopleDone = doc.people.length >= 2;
  const enabled = doc.questions.filter((q) => q.enabled).length;
  const questionsDone = enabled > 0 && issues.length === 0;
  const steps = [
    ...(needsPeople(doc)
      ? [
          {
            title: "أضف الأشخاص",
            hint: peopleDone ? peopleLabel(doc.people.length) : "شخصين على الأقل — هم الإجابات",
            done: peopleDone,
            action: () => onGo("people"),
            cta: "الأشخاص",
          },
        ]
      : []),
    {
      title: "أضف الأسئلة",
      hint: questionsDone
        ? questionsLabel(enabled)
        : enabled > 0 && issues.length
          ? `${issues.length} ${issues.length === 1 ? "شي يحتاج تصليح" : "أشياء تحتاج تصليح"}`
          : "سؤال واحد على الأقل",
      done: questionsDone,
      action: () => onGo("questions"),
      cta: "الأسئلة",
    },
    {
      title: "انشر والعب",
      hint: "تطلع في قائمة التشغيل على التلفزيون",
      done: false,
      action: onPublish,
      cta: "نشر",
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="panel grid gap-1 p-2 sm:grid-flow-col sm:auto-cols-fr sm:gap-2">
      {steps.map((s, i) => {
        const active = i === current;
        return (
          <li key={s.title} className={`flex items-center gap-3 rounded-xl p-2 ${active ? "bg-[#fff6d8]" : ""}`}>
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-full border-2 border-ink text-sm font-black ${
                s.done ? "bg-mint" : active ? "bg-sun" : "bg-card text-ink/40"
              }`}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-black leading-tight ${s.done ? "text-ink/50" : ""}`}>{s.title}</span>
              <span className="block truncate text-xs font-semibold text-mute">{s.hint}</span>
            </span>
            {active && (
              <button onClick={s.action} className={`abtn abtn-sm ${s.cta === "نشر" ? "abtn-go" : "abtn-primary"}`}>
                {s.cta}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

type Dialog = { kind: "photos" | "facts"; personId: string | null } | null;

function PeopleTab({ doc, update }: { doc: GameDoc; update: (fn: (d: GameDoc) => GameDoc) => void }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  return (
    <>
      <PeopleEditor
        doc={doc}
        update={update}
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

/** Pick the type of a new question: one card per type, with what it's for. */
function TypePicker({ onPick, onClose }: { onPick: (t: QuestionType) => void; onClose: () => void }) {
  return (
    <Modal title="وش نوع السؤال؟" onClose={onClose} wide>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {QUESTION_TYPES.map((t) => {
          const info = QUESTION_TYPE_INFO[t];
          return (
            <li key={t}>
              <button
                onClick={() => onPick(t)}
                className="panel-sm flex h-full w-full items-start gap-3 bg-card p-3 text-start transition-colors hover:bg-[#fff6d8]"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-cream text-2xl">{info.emoji}</span>
                <span>
                  <span className="block font-black">{info.label}</span>
                  <span className="block text-sm font-semibold text-mute">{info.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function QuestionsTab({
  doc,
  update,
  onGoPeople,
}: {
  doc: GameDoc;
  update: (fn: (d: GameDoc) => GameDoc) => void;
  onGoPeople: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [personFilter, setPersonFilter] = useState<string>("");
  const [picking, setPicking] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const people = needsPeople(doc);
  const missingPeople = people && doc.people.length < 2;

  const setQuestions = (fn: (qs: Question[]) => Question[]) => update((d) => ({ ...d, questions: fn(d.questions) }));

  const addQuestion = (type: QuestionType) => {
    const q = blankQuestion(type);
    setQuestions((qs) => [...qs, q]);
    setExpanded(q.id);
    setPicking(false);
    setTimeout(() => document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  const term = query.trim().toLowerCase();
  const visible = doc.questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => {
      if (personFilter && question.aboutPersonId !== personFilter && !question.correct.includes(personFilter)) return false;
      if (term && !question.prompt.toLowerCase().includes(term) && !question.note.toLowerCase().includes(term)) return false;
      return true;
    });

  return (
    <div className="flex flex-col gap-3">
      {doc.questions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setPicking(true)} className="abtn abtn-primary">
            + سؤال جديد
          </button>
          {people && (
            <>
              <button onClick={() => setDialog({ kind: "photos", personId: null })} className="abtn">
                📸 رفع صور
              </button>
              <button onClick={() => setDialog({ kind: "facts", personId: null })} className="abtn">
                📝 لصق معلومات
              </button>
            </>
          )}
          {doc.questions.length > 3 && (
            <div className="flex w-full flex-wrap gap-2 sm:ms-auto sm:w-auto">
              {doc.people.length > 0 && (
                <select
                  value={personFilter}
                  onChange={(e) => setPersonFilter(e.target.value)}
                  className="ainput h-10 w-auto flex-1 sm:flex-none"
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
                placeholder="🔍 بحث في الأسئلة"
                className="ainput h-10 flex-1 sm:w-48 sm:flex-none"
              />
            </div>
          )}
        </div>
      )}

      {doc.questions.length === 0 ? (
        <div className="panel flex flex-col items-center gap-4 p-8 text-center sm:p-10">
          <span className="text-5xl">❓</span>
          <div>
            <p className="font-display text-2xl">ما فيه أسئلة للحين</p>
            <p className="mx-auto mt-1 max-w-md text-sm font-semibold text-mute">
              {missingPeople
                ? "أول خطوة: أضف الأشخاص (هم الإجابات). بعدها ارفع صور كل واحد دفعة وحدة."
                : people
                  ? "أسرع طريقة: ارفع صور كل شخص دفعة وحدة — كل صورة تصير سؤال «مين صوّرها؟». أو الصق معلومات سطر بسطر."
                : "اختار نوع السؤال واكتب أول سؤال."}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {missingPeople ? (
              <button onClick={onGoPeople} className="abtn abtn-primary abtn-lg">
                👥 أضف الأشخاص
              </button>
            ) : (
              people && (
                <>
                  <button onClick={() => setDialog({ kind: "photos", personId: null })} className="abtn abtn-primary abtn-lg">
                    📸 رفع صور
                  </button>
                  <button onClick={() => setDialog({ kind: "facts", personId: null })} className="abtn abtn-lg">
                    📝 لصق معلومات
                  </button>
                </>
              )
            )}
            <button onClick={() => setPicking(true)} className={`abtn abtn-lg ${people ? "" : "abtn-primary"}`}>
              + سؤال جديد
            </button>
          </div>
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
                onChange={(next) =>
                  setQuestions((qs) =>
                    qs.map((x) => (x.id === question.id ? (typeof next === "function" ? next(x) : next) : x)),
                  )
                }
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
      {picking && <TypePicker onPick={addQuestion} onClose={() => setPicking(false)} />}
      <BulkDialog dialog={dialog} doc={doc} update={update} onClose={() => setDialog(null)} />
    </div>
  );
}
