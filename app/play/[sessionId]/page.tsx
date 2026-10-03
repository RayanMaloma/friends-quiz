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
import { PEOPLE } from "@/lib/people";
import { personSwatch } from "@/lib/colors";
import { phoneFactClass } from "@/lib/format";
import { ConnectionBanner, GuestStatus, NameBadge, Spinner } from "@/components/ui";

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
        <Spinner className="size-10 text-ink" />
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
            className="btn btn-primary mt-4 h-16 w-full max-w-xs text-2xl"
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
          <Spinner className="size-10 text-ink" />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <ConnectionBanner show={!connected} />
      <header className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <NameBadge playerId={view.me.playerId} name={view.me.name} className="size-11 text-2xl" />
          <span className="truncate font-display text-2xl leading-none pt-1">{view.me.name}</span>
        </span>
        <span className="chunk-sm shrink-0 bg-card px-3 pb-1 pt-2 font-display text-lg leading-none">
          {view.status === "LOBBY" || view.status === "FINISHED" ? (
            <>
              رمز <span dir="ltr">{view.code}</span>
            </>
          ) : (
            `السؤال ${view.currentIndex + 1} من ${view.totalQuestions}`
          )}
        </span>
      </header>

      {view.status === "LOBBY" && (
        <GuestStatus emoji="🎉" title="تم تسجيل دخولك ✓" subtitle="بانتظار بداية اللعبة">
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

      {view.status === "QUESTION" &&
        view.question &&
        (view.question.isOwner ? (
          <GuestStatus emoji="😂" title="هذي المعلومة عنك!" subtitle="تابع الشاشة 👀" accent>
            <p className="text-lg font-bold text-mute">خل الباقين يحاولون يعرفونك</p>
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
        ))}

      {view.status === "REVEAL" && (
        <GuestStatus emoji="📺" title="شوف الشاشة!" subtitle="الإجابة على الشاشة 👀" accent />
      )}

      {view.status === "LEADERBOARD" && (
        <GuestStatus emoji="🏆" title="الترتيب على الشاشة" subtitle="استعد للمعلومة الجاية" />
      )}

      {view.status === "FINISHED" && (
        <GuestStatus emoji="🎉" title="خلصت اللعبة!" subtitle="النتائج على الشاشة 👀" accent />
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
  // Everyone in people.json is a possible answer, except yourself if you're a fact owner.
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
    <div className="flex flex-1 flex-col gap-5 pb-36">
      <div className="chunk anim-pop relative mt-3 bg-card p-5 pt-6">
        <span className="chunk-sm absolute -top-4 start-4 rotate-6 bg-pink px-3 pb-0.5 pt-1.5 font-display text-lg leading-none text-white">
          عن مين؟
        </span>
        <p className={phoneFactClass(q.factText)}>{q.factText}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {options.map((p, i) => {
          const isSel = selected === p.id;
          const sw = personSwatch(p.id);
          return (
            <button
              key={p.id}
              disabled={sending}
              onClick={() => setSelected(p.id)}
              className={`chunk-sm anim-rise relative flex h-20 items-center justify-center px-2 pt-1.5 text-center font-display text-2xl leading-tight transition-transform ${
                isSel ? `${sw.bg} ${sw.fg} -translate-y-1 scale-[1.03]` : "bg-card"
              } ${selected && !isSel ? "opacity-60" : ""}`}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              {isSel && (
                <span className="absolute -top-3 -start-2 grid size-8 place-items-center rounded-full border-[3px] border-ink bg-card font-sans text-base font-black text-ink">
                  ✓
                </span>
              )}
              {p.name}
            </button>
          );
        })}
      </div>

      <div className="sticky-bottom-safe fixed inset-x-0 bottom-0 bg-gradient-to-t from-cream via-cream/95 to-transparent px-4 pt-8">
        <div className="mx-auto flex max-w-lg flex-col gap-2">
          {error && <p className="text-center font-bold text-pink">{error}</p>}
          <button onClick={submit} disabled={!selected || sending} className="btn btn-primary h-20 w-full text-3xl">
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
        if (!window.confirm("تبي تطلع وتدخل باسم ثاني؟")) return;
        setBusy(true);
        await onLeave();
        setBusy(false);
      }}
      className="mt-6 text-base font-bold text-mute underline underline-offset-4"
    >
      غلطت بالاسم؟ غيّره
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="safe-pad mx-auto flex min-h-dvh max-w-lg flex-col gap-5">{children}</main>;
}
