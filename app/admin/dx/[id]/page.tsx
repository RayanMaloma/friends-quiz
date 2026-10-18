"use client";

import "../../../dx.css";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { hostStore } from "@/lib/client/storage";
import type { GameRecordStatus } from "@/lib/types";
import type { DxDoc } from "@/lib/dx/doc";
import { DX_FONTS_URL } from "@/lib/dx/config/themes";
import { Spinner } from "@/components/ui";
import { Notice, StatusPill } from "@/components/admin/ui";
import { DxRoot, StudioProvider, type StudioDoc, type StudioTab } from "@/components/dx/store";
import { ConfirmProvider } from "@/components/dx/components/ui";
import { Studio } from "@/components/dx/studio/Studio";

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
type Issue = { message: string };
interface DxRecord { id: string; status: GameRecordStatus; version: number; doc: DxDoc }

/** Editor for a deduction game: the full customization studio, autosaved to the database. */
export default function DxEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<DxDoc | null>(null);
  const [status, setStatus] = useState<GameRecordStatus>("draft");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<StudioTab>("identity");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; issues?: Issue[] } | null>(null);

  const docRef = useRef<DxDoc | null>(null);
  const versionRef = useRef<number | null>(null);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ game: DxRecord; issues: Issue[] }>("/api/admin", { action: "dxGet", id });
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
    setIssues(res.issues);
    setSaveState("saved");
    setSaveError(null);
  }, [id]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    while (inFlight.current) await inFlight.current;
    while (docRef.current && revision.current !== savedRevision.current) {
      const rev = revision.current;
      setSaveState("saving");
      const run = (async () => {
        const res = await api<{ game: DxRecord; issues: Issue[] }>("/api/admin", {
          action: "dxSave",
          id,
          doc: docRef.current,
          version: versionRef.current,
        });
        if (!res.ok) {
          setSaveState(res.error === "VERSION_CONFLICT" ? "conflict" : "error");
          const errors = Array.isArray(res.errors) ? (res.errors as string[]) : [];
          setSaveError(errors.length ? errors.join(" · ") : errorMessage(res.error));
          return false;
        }
        versionRef.current = res.game.version;
        setStatus(res.game.status);
        setIssues(res.issues);
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

  const onChange = useCallback(
    (fn: (d: StudioDoc) => StudioDoc) => {
      setDoc((cur) => {
        if (!cur) return cur;
        const next = fn({ config: cur.config, assets: cur.assets });
        const merged: DxDoc = { ...cur, config: next.config, assets: next.assets, title: next.config.identity.name };
        docRef.current = merged;
        return merged;
      });
      revision.current += 1;
      setSaveState((s) => (s === "conflict" ? s : "dirty"));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveNow(), 900);
    },
    [saveNow],
  );

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (revision.current !== savedRevision.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  async function setGameStatus(next: GameRecordStatus) {
    setBusy("status");
    setNotice(null);
    if (!(await saveNow())) {
      setBusy(null);
      return;
    }
    const res = await api<{ version: number; status: GameRecordStatus }>("/api/admin", { action: "setStatus", id, status: next });
    setBusy(null);
    if (!res.ok) {
      setNotice({ text: errorMessage(res.error), issues: (res.issues as Issue[] | undefined) ?? undefined });
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
    const res = await api<{ sessionId: string; code: string; hostToken: string }>("/api/dx", { action: "create", gameId: id });
    setBusy(null);
    if (!res.ok) {
      setNotice({ text: errorMessage(res.error), issues });
      return;
    }
    hostStore.save({ sessionId: res.sessionId, code: res.code, hostToken: res.hostToken });
    router.push(`/dx/host/${res.sessionId}`);
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="font-display text-3xl">{loadError}</p>
        <Link href="/admin" className="abtn abtn-primary">رجوع للألعاب</Link>
      </div>
    );
  }
  if (!doc) return <Spinner className="mx-auto mt-16 size-8 text-ink" />;

  const saveLabel: Record<SaveState, string> = {
    saved: "✓ كل التعديلات محفوظة",
    dirty: "تعديلات جديدة…",
    saving: "جاري الحفظ…",
    error: "⚠ ما انحفظ",
    conflict: "⚠ تعارض",
  };

  return (
    <div className="flex flex-col gap-4">
      <link rel="stylesheet" href={DX_FONTS_URL} />
      <div className="sticky top-14 z-20 -mx-4 border-b-2 border-ink/10 bg-cream/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin" className="abtn abtn-quiet abtn-icon" aria-label="رجوع للألعاب" title="رجوع للألعاب">→</Link>
          <span className="grid size-11 shrink-0 place-items-center rounded-xl border-2 border-ink bg-grape text-2xl">{doc.emoji}</span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-2xl leading-tight">{doc.config.identity.name || "بدون اسم"}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs font-bold text-mute">
              <StatusPill status={status} />
              <span className={saveState === "error" || saveState === "conflict" ? "text-pink" : ""}>{saveLabel[saveState]}</span>
              <span>· لعبة أدوار سرّية</span>
            </div>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
            {status === "published" ? (
              <button onClick={() => setGameStatus("draft")} disabled={!!busy} className="abtn abtn-sm">إلغاء النشر</button>
            ) : (
              <button onClick={() => setGameStatus("published")} disabled={!!busy || status === "archived"} className="abtn abtn-go">
                {busy === "status" && <Spinner className="size-4" />}
                نشر
              </button>
            )}
            <button onClick={play} disabled={!!busy} className="abtn abtn-primary">
              {busy === "play" ? <Spinner className="size-4" /> : "📺"} تشغيل
            </button>
          </div>
        </div>
      </div>

      {saveState === "conflict" && (
        <Notice tone="error" action={<button onClick={() => void load()} className="abtn abtn-sm">تحميل النسخة الأحدث</button>}>
          اللعبة تعدّلت من جهاز أو تبويب ثاني، وتعديلاتك هنا ما انحفظت.
        </Notice>
      )}
      {saveState === "error" && saveError && (
        <Notice tone="error" action={<button onClick={() => void saveNow()} className="abtn abtn-sm">جرّب مرة ثانية</button>}>
          ما انحفظ: {saveError}
        </Notice>
      )}
      {notice && (
        <Notice tone={notice.issues?.length ? "warn" : "success"} action={<button onClick={() => setNotice(null)} className="abtn abtn-quiet abtn-sm abtn-icon" aria-label="إغلاق">✕</button>}>
          <p>{notice.text}</p>
          {notice.issues && notice.issues.length > 0 && (
            <ul className="mt-1 font-semibold text-ink/80">{notice.issues.slice(0, 8).map((i, k) => <li key={k}>• {i.message}</li>)}</ul>
          )}
        </Notice>
      )}
      {issues.length > 0 && !notice && (
        <Notice tone="warn">
          <p>قبل ما تنشر، صلّح هذي:</p>
          <ul className="mt-1 font-semibold text-ink/80">{issues.slice(0, 5).map((i, k) => <li key={k}>• {i.message}</li>)}</ul>
        </Notice>
      )}

      <StudioProvider doc={{ config: doc.config, assets: doc.assets }} onChange={onChange} onTab={setTab}>
        <DxRoot fill={false} className="dx-studio">
          <ConfirmProvider>
            <Studio tab={tab} onTab={setTab} />
          </ConfirmProvider>
        </DxRoot>
      </StudioProvider>
    </div>
  );
}
