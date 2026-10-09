"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { playerKey, playerStore, type PlayerCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { useGameSync } from "@/lib/client/useGameSync";
import { useWakeLock } from "@/lib/client/useWakeLock";
import { serverOffset, useCountdown } from "@/lib/client/useClock";
import type { Accent, AnswerValue, GuestView } from "@/lib/types";
import { accentStyle, optionStyle, SWATCHES } from "@/lib/colors";
import { phoneFactClass } from "@/lib/format";
import { parseNumberInput } from "@/lib/game/text";
import { ConnectionBanner, GuestStatus, NameBadge, Spinner } from "@/components/ui";
import { Img } from "@/components/Media";

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
  const { view, receivedAt, fatalError, connected, mutate, refresh } = useGameSync<GuestView>(sessionId, fetchView);

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
    <Shell accent={view.accent}>
      <ConnectionBanner show={!connected} />
      <header className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <NameBadge playerId={view.me.playerId} name={view.me.name} className="size-11 text-2xl" />
          <span className="truncate pt-1 font-display text-2xl leading-none">{view.me.name}</span>
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
        <GuestStatus emoji={view.emoji || "🎉"} title="تم تسجيل دخولك ✓" subtitle="بانتظار بداية اللعبة">
          <p className="chunk-sm -rotate-1 bg-card px-4 pb-1 pt-2 font-display text-2xl">{view.title}</p>
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
        <QuestionScreen
          key={view.question.index}
          view={view}
          offset={serverOffset(view.serverNow, receivedAt)}
          onSubmit={async (value) => {
            const res = await mutate(() =>
              api<{ view: GuestView }>("/api/guest", {
                action: "answer",
                sessionId,
                playerToken,
                roundIndex: view.question!.index,
                value,
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
      )}

      {(view.status === "REVEAL" || view.status === "LEADERBOARD") &&
        (view.feedback ? (
          <FeedbackCard feedback={view.feedback} showRank={view.status === "LEADERBOARD"} />
        ) : view.status === "REVEAL" ? (
          <GuestStatus emoji="📺" title="شوف الشاشة!" subtitle="الإجابة على الشاشة 👀" accent />
        ) : (
          <GuestStatus emoji="🏆" title="الترتيب على الشاشة" subtitle="استعد للسؤال الجاي" />
        ))}

      {view.status === "FINISHED" &&
        (view.feedback ? (
          <GuestStatus
            emoji={view.feedback.rank === 1 ? "👑" : "🎉"}
            title={view.feedback.rank === 1 ? "أنت البطل!" : "خلصت اللعبة!"}
            subtitle={`مركزك ${view.feedback.rank} من ${view.feedback.playerCount} — ${view.feedback.score} نقطة`}
            accent
          />
        ) : (
          <GuestStatus emoji="🎉" title="خلصت اللعبة!" subtitle="النتائج على الشاشة 👀" accent />
        ))}
    </Shell>
  );
}

function FeedbackCard({
  feedback: f,
  showRank,
}: {
  feedback: NonNullable<GuestView["feedback"]>;
  showRank: boolean;
}) {
  let emoji = "🗳️";
  let title = "تم التصويت";
  let tone = "bg-card";
  if (f.excluded) {
    emoji = "🤫";
    title = "كان السؤال عنك";
  } else if (!f.answered) {
    emoji = "⏰";
    title = "ما جاوبت";
  } else if (f.correct === true) {
    emoji = "✅";
    title = "صح!";
    tone = "bg-mint";
  } else if (f.correct === false) {
    emoji = "❌";
    title = "غلط";
    tone = "bg-pink";
  }
  return (
    <div className="anim-rise flex flex-1 flex-col items-center justify-center gap-5 px-2 text-center">
      <div className={`chunk grid size-32 -rotate-3 place-items-center text-7xl leading-none ${tone}`}>
        <span className="anim-pop inline-block">{emoji}</span>
      </div>
      <h1 className="font-display text-5xl leading-tight">{title}</h1>
      {f.gained > 0 && (
        <p dir="ltr" className="chunk-sm anim-pop rotate-1 bg-sun px-5 pb-2 pt-3 font-display text-4xl">
          +{f.gained}
        </p>
      )}
      <p className="text-xl font-bold text-mute">
        {showRank ? `مركزك ${f.rank} من ${f.playerCount}` : "الإجابة على الشاشة 👀"} · {f.score} نقطة
      </p>
    </div>
  );
}

function QuestionScreen({
  view,
  offset,
  onSubmit,
}: {
  view: GuestView;
  offset: number;
  onSubmit: (value: AnswerValue) => Promise<string | null>;
}) {
  const q = view.question!;
  const remaining = useCountdown(q.timer, offset);
  const timeUp = remaining !== null && remaining <= 0;

  if (q.isExcluded) {
    return (
      <GuestStatus emoji="😂" title="هذا السؤال عنك!" subtitle="تابع الشاشة 👀" accent>
        <p className="text-lg font-bold text-mute">خل الباقين يحاولون يعرفونك</p>
      </GuestStatus>
    );
  }
  if (q.submitted) return <GuestStatus emoji="✅" title="تم تسجيل إجابتك ✓" subtitle="تابع الشاشة 👀" accent />;
  if (timeUp) return <GuestStatus emoji="⏰" title="خلص الوقت!" subtitle="تابع الشاشة 👀" accent />;

  return (
    <div className="flex flex-1 flex-col gap-4 pb-36">
      {q.timer && remaining !== null && <TimeBar remaining={remaining} limit={q.timer.limit} />}
      {(q.prompt || q.image) && (
        <div className="chunk anim-pop relative mt-1 overflow-hidden bg-card">
          {q.image && (
            <div className="relative aspect-[4/3] w-full bg-ink">
              <Img src={q.image} alt="" sizes="100vw" priority className="object-contain" />
            </div>
          )}
          {q.prompt && <p className={`p-5 ${phoneFactClass(q.prompt)}`}>{q.prompt}</p>}
        </div>
      )}
      {q.type === "text" ? (
        <TextAnswer onSubmit={(text) => onSubmit({ text })} />
      ) : q.type === "number" ? (
        <NumberAnswer onSubmit={(number) => onSubmit({ number })} />
      ) : (
        <OptionAnswer q={q} onSubmit={(option) => onSubmit({ option })} />
      )}
    </div>
  );
}

function TimeBar({ remaining, limit }: { remaining: number; limit: number }) {
  const pct = Math.max(0, Math.min(100, (remaining / limit) * 100));
  const urgent = remaining <= 5;
  return (
    <div className="flex items-center gap-3">
      <div className="chunk-sm h-5 flex-1 overflow-hidden bg-card p-0.5">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ease-linear ${urgent ? "bg-pink" : "bg-mint"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-10 pt-1 text-center font-display text-2xl leading-none tabular-nums ${urgent ? "text-pink" : ""}`}>
        {Math.ceil(remaining)}
      </span>
    </div>
  );
}

function SubmitBar({
  disabled,
  sending,
  error,
  onClick,
}: {
  disabled: boolean;
  sending: boolean;
  error: string | null;
  onClick: () => void;
}) {
  return (
    <div className="sticky-bottom-safe fixed inset-x-0 bottom-0 bg-gradient-to-t from-cream via-cream/95 to-transparent px-4 pt-8">
      <div className="mx-auto flex max-w-lg flex-col gap-2">
        {error && <p className="text-center font-bold text-pink">{error}</p>}
        <button onClick={onClick} disabled={disabled || sending} className="btn btn-primary h-20 w-full text-3xl">
          {sending && <Spinner />}
          {sending ? "جاري الإرسال…" : "تأكيد الإجابة"}
        </button>
      </div>
    </div>
  );
}

function useSubmit<T>(onSubmit: (v: T) => Promise<string | null>) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (v: T) => {
    if (sending) return;
    setSending(true);
    setError(null);
    const err = await onSubmit(v);
    // On success the view switches to "submitted" and this form unmounts.
    if (err) {
      setError(err);
      setSending(false);
    }
  };
  return { sending, error, submit };
}

function OptionAnswer({
  q,
  onSubmit,
}: {
  q: NonNullable<GuestView["question"]>;
  onSubmit: (option: string) => Promise<string | null>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const { sending, error, submit } = useSubmit(onSubmit);
  const hasImages = !q.peopleOptions && q.options.some((o) => o.image);
  const tf = q.type === "truefalse";

  return (
    <>
      <div className={`grid gap-3 ${tf ? "grid-cols-1" : "grid-cols-2"}`}>
        {q.options.map((o, i) => {
          const isSel = selected === o.id;
          const custom = !q.peopleOptions;
          const st = custom ? optionStyle(i) : SWATCHES[i % SWATCHES.length];
          const shape = custom ? optionStyle(i).shape : null;
          // Custom options keep their Kahoot color (matches the TV); people are white until picked.
          const colored = isSel || (custom && !selected);
          return (
            <button
              key={o.id}
              disabled={sending}
              onClick={() => setSelected(o.id)}
              className={`chunk-sm anim-rise relative flex flex-col items-center justify-center gap-1 px-2 pt-1.5 text-center font-display leading-tight transition-transform ${
                tf ? "h-24 text-4xl" : hasImages ? "min-h-36 py-2 text-xl" : "min-h-20 py-2 text-2xl"
              } ${colored ? `${st.bg} ${st.fg}` : "bg-card"} ${isSel ? "-translate-y-1 scale-[1.03]" : ""} ${
                selected && !isSel ? "opacity-50" : ""
              }`}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              {isSel && (
                <span className="absolute -top-3 -start-2 grid size-8 place-items-center rounded-full border-[3px] border-ink bg-card font-sans text-base font-black text-ink">
                  ✓
                </span>
              )}
              {hasImages && o.image && (
                <span className="relative aspect-square w-20 overflow-hidden rounded-xl border-[3px] border-ink bg-card">
                  <Img src={o.image} alt="" sizes="30vw" className="object-cover" />
                </span>
              )}
              <span>
                {shape && <span className="me-1.5 text-[0.7em]">{shape}</span>}
                {o.label}
              </span>
            </button>
          );
        })}
      </div>
      <SubmitBar disabled={!selected} sending={sending} error={error} onClick={() => selected && void submit(selected)} />
    </>
  );
}

function TextAnswer({ onSubmit }: { onSubmit: (text: string) => Promise<string | null> }) {
  const [text, setText] = useState("");
  const { sending, error, submit } = useSubmit(onSubmit);
  const trimmed = text.trim();
  return (
    <>
      <input
        value={text}
        maxLength={80}
        enterKeyHint="send"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && trimmed) void submit(trimmed);
        }}
        placeholder="اكتب إجابتك هنا"
        className="chunk h-20 w-full bg-card px-5 font-display text-3xl outline-none placeholder:text-mute/50 focus:bg-[#fffbea]"
      />
      <SubmitBar disabled={!trimmed} sending={sending} error={error} onClick={() => trimmed && void submit(trimmed)} />
    </>
  );
}

function NumberAnswer({ onSubmit }: { onSubmit: (n: number) => Promise<string | null> }) {
  const [raw, setRaw] = useState("");
  const { sending, error, submit } = useSubmit(onSubmit);
  const value = parseNumberInput(raw);
  return (
    <>
      <input
        dir="ltr"
        value={raw}
        inputMode="decimal"
        enterKeyHint="send"
        onChange={(e) => setRaw(e.target.value.slice(0, 18))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value !== null) void submit(value);
        }}
        placeholder="0"
        className="chunk h-24 w-full bg-card px-5 pt-2 text-center font-display text-6xl tabular-nums outline-none placeholder:text-ink/15 focus:bg-[#fffbea]"
      />
      {raw && value === null && <p className="text-center font-bold text-pink">اكتب رقم صحيح</p>}
      <SubmitBar
        disabled={value === null}
        sending={sending}
        error={error}
        onClick={() => value !== null && void submit(value)}
      />
    </>
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

function Shell({ children, accent }: { children: React.ReactNode; accent?: Accent }) {
  return (
    <main className="safe-pad mx-auto flex min-h-dvh max-w-lg flex-col gap-5" style={accentStyle(accent)}>
      {children}
    </main>
  );
}
