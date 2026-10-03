"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { playerKey, playerStore, type PlayerCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import type { GuestView } from "@/lib/types";
import { PEOPLE, personName } from "@/lib/people";
import { phoneFactClass } from "@/lib/format";
import { Avatar, Portrait } from "@/components/PersonImage";
import { ConnectionBanner, GuestStatus, Spinner } from "@/components/ui";

export default function PlayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const creds = useStored<PlayerCreds>(playerKey(sessionId));

  useEffect(() => {
    if (creds === null) router.replace("/join");
  }, [creds, router]);

  if (!creds) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-10 text-sun" />
      </main>
    );
  }
  return <Controller creds={creds} />;
}

function Controller({ creds }: { creds: PlayerCreds }) {
  useWakeLock();
  const router = useRouter();
  const { sessionId, playerToken } = creds;

  const fetchView = useCallback(
    () => api<{ view: GuestView }>("/api/guest", { action: "state", sessionId, playerToken }),
    [sessionId, playerToken],
  );
  const { view, fatalError, connected, mutate, refresh } = useGameSync<GuestView>(sessionId, fetchView);

  if (fatalError) {
    return (
      <Shell>
        <GuestStatus emoji="🙈" title={errorMessage(fatalError)}>
          <Link
            href="/join"
            onClick={() => playerStore.clear(sessionId)}
            className="btn btn-primary mt-4 h-14 w-full max-w-xs text-xl"
          >
            ادخل من جديد
          </Link>
        </GuestStatus>
      </Shell>
    );
  }

  if (!view) {
    return (
      <Shell>
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-10 text-sun" />
        </div>
      </Shell>
    );
  }

  const me = view.me.personId;

  return (
    <Shell>
      <ConnectionBanner show={!connected} />
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Avatar personId={me} className="size-10" ring="bg-sun" />
          <span className="text-lg font-black">{personName(me)}</span>
        </span>
        <span className="rounded-full bg-panel-2 px-3 py-1 text-sm font-bold text-mute">
          {view.status === "LOBBY" || view.status === "FINISHED"
            ? <>رمز <span dir="ltr" className="text-paper">{view.code}</span></>
            : `السؤال ${view.currentIndex + 1} من ${view.totalQuestions}`}
        </span>
      </header>

      {view.status === "LOBBY" && (
        <GuestStatus
          visual={
            <div className="relative h-56 w-48 overflow-hidden border-b-4 border-sun">
              <div className="anim-disc absolute inset-x-2 -bottom-8 aspect-square rounded-full bg-sun" />
              <div className="anim-portrait absolute inset-0">
                <Portrait personId={me} size="card" eager />
              </div>
            </div>
          }
          title="تم تسجيل دخولك ✓"
          subtitle="بانتظار بداية اللعبة"
        >
          <LeaveButton
            onLeave={async () => {
              const res = await mutate(() => api("/api/guest", { action: "leave", sessionId, playerToken }));
              if (res.ok) {
                playerStore.clear(sessionId);
                router.replace(`/join?code=${view.code}`);
              }
            }}
          />
        </GuestStatus>
      )}

      {view.status === "QUESTION" && view.question && (
        view.question.isOwner ? (
          <GuestStatus emoji="😂" title="هذي المعلومة عنك 😂" subtitle="خل الباقين يحاولون يعرفونك">
            <p className="mt-6 text-2xl font-black text-sun">تابع الشاشة 👀</p>
          </GuestStatus>
        ) : view.question.submitted ? (
          <GuestStatus emoji="✅" title="تم تسجيل إجابتك ✓" subtitle="تابع الشاشة 👀" accent />
        ) : (
          <AnswerForm
            key={view.question.index}
            view={view}
            onSubmit={async (personId) => {
              const res = await mutate(() =>
                api<{ view: GuestView }>("/api/guest", {
                  action: "answer",
                  sessionId,
                  playerToken,
                  roundIndex: view.question!.index,
                  personId,
                }),
              );
              if (!res.ok) {
                // Round closed / state moved on: resync to the authoritative state.
                refresh();
                return errorMessage(res.error);
              }
              return null;
            }}
          />
        )
      )}

      {view.status === "REVEAL" && <GuestStatus emoji="📺" title="شوف الشاشة 👀" subtitle="الإجابة على الشاشة" accent />}

      {view.status === "LEADERBOARD" && (
        <GuestStatus emoji="📺" title="الترتيب على الشاشة 🏆" subtitle="استعد للمعلومة الجاية" />
      )}

      {view.status === "FINISHED" && (
        <GuestStatus emoji="🎉" title="خلصت اللعبة 🎉" subtitle="النتائج على الشاشة" accent />
      )}
    </Shell>
  );
}

function AnswerForm({
  view,
  onSubmit,
}: {
  view: GuestView;
  onSubmit: (personId: string) => Promise<string | null>;
}) {
  const q = view.question!;
  const [selected, setSelected] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = PEOPLE.filter((p) => p.id !== view.me.personId);

  async function submit() {
    if (!selected || sending) return;
    setSending(true);
    setError(null);
    const err = await onSubmit(selected);
    // On success the view switches to "submitted" and this form unmounts.
    if (err) {
      setError(err);
      setSending(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-5 pb-32">
      <div className="anim-rise rounded-3xl border border-line bg-panel p-5">
        <p className={phoneFactClass(q.factText)}>
          <span className="text-sun">«</span>
          {q.factText}
          <span className="text-sun">»</span>
        </p>
      </div>
      <p className="text-center text-lg font-bold text-mute">عن مين؟</p>
      <div className="flex flex-col gap-2.5">
        {options.map((p, i) => {
          const isSel = selected === p.id;
          return (
            <button
              key={p.id}
              disabled={sending}
              onClick={() => setSelected(p.id)}
              className={`anim-rise flex h-16 items-center gap-3 rounded-2xl border-2 px-3 text-start text-xl font-black transition-all ${
                isSel ? "border-sun bg-sun text-sun-ink" : "border-line bg-panel active:scale-[0.98]"
              }`}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <Avatar personId={p.id} className="size-11" ring={isSel ? "bg-sun-deep" : "bg-panel-2"} />
              <span className="flex-1">{p.name}</span>
              <span
                className={`grid size-7 place-items-center rounded-full border-2 text-base ${
                  isSel ? "border-sun-ink bg-sun-ink text-sun" : "border-line"
                }`}
              >
                {isSel ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>

      <div className="sticky-bottom-safe fixed inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pt-6">
        <div className="mx-auto flex max-w-lg flex-col gap-2">
          {error && <p className="text-center font-bold text-rose">{error}</p>}
          <button onClick={submit} disabled={!selected || sending} className="btn btn-primary h-16 w-full text-2xl">
            {sending && <Spinner />}
            {sending ? "جاري الإرسال…" : "تأكيد الإجابة"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LeaveButton({ onLeave }: { onLeave: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("تبي تغيّر اسمك؟")) return;
        setBusy(true);
        await onLeave();
        setBusy(false);
      }}
      className="mt-8 text-sm font-bold text-mute underline underline-offset-4"
    >
      مو أنت؟ غيّر الاسم
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="safe-pad mx-auto flex min-h-dvh max-w-lg flex-col gap-5">{children}</main>;
}
