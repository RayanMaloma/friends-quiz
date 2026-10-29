"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { hostStore } from "@/lib/client/storage";
import {
  DEFAULT_ANSWER_SECONDS,
  DEFAULT_ROUNDS,
  DEFAULT_VOTE_SECONDS,
  MAX_QUESTION_LENGTH,
  MAX_QUESTIONS,
  MAX_TIMER_SECONDS,
} from "@/lib/invent/engine";

/** A public «اخترع إجابتك» room: the host writes the questions, picks the match settings, then gets the QR. */
export function NewRoomForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [rounds, setRounds] = useState<number | null>(null);
  const [answerSeconds, setAnswerSeconds] = useState(DEFAULT_ANSWER_SECONDS);
  const [voteSeconds, setVoteSeconds] = useState(DEFAULT_VOTE_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questions = [...new Set(text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean))];
  const count = questions.length;
  const tooLong = questions.some((q) => [...q].length > MAX_QUESTION_LENGTH);
  // Follows the number of questions until the host picks a length; never more than the questions.
  const matchLength = Math.min(rounds ?? Math.min(DEFAULT_ROUNDS, count), count);
  const valid = count >= 1 && count <= MAX_QUESTIONS && !tooLong && matchLength >= 1;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const res = await api<{ sessionId: string; code: string; hostToken: string }>("/api/invent", {
      action: "create",
      questions,
      rounds: matchLength,
      answerSeconds,
      voteSeconds,
    });
    if (!res.ok) {
      if (res.error === "AUTH_REQUIRED") router.replace("/games");
      setError(errorMessage(res.error));
      setBusy(false);
      return;
    }
    hostStore.save({ sessionId: res.sessionId, code: res.code, hostToken: res.hostToken });
    router.push(`/invent/host/${res.sessionId}`);
  }

  return (
    <main className="iv safe-pad">
      <form onSubmit={create} className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-6">
        <header className="flex items-center justify-between gap-3">
          <h1 className="iv-display text-4xl" style={{ color: "var(--iv-gold)" }}>
            اخترع إجابتك
          </h1>
          <Link href="/games" className="iv-btn iv-btn-sm">
            رجوع
          </Link>
        </header>

        <label className="flex flex-col gap-2">
          <span className="flex items-baseline justify-between font-extrabold">
            الأسئلة
            <span className={`text-sm ${count > MAX_QUESTIONS ? "iv-error" : "iv-mute"}`}>
              {count} / {MAX_QUESTIONS}
            </span>
          </span>
          <textarea
            className="iv-textarea"
            style={{ minHeight: "16rem", resize: "vertical" }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"سؤال في كل سطر\nوش أغرب شي صار لك في السفر؟"}
            autoFocus
            aria-invalid={tooLong}
          />
          {tooLong && <span className="iv-error text-sm">كل سؤال لين {MAX_QUESTION_LENGTH} حرف</span>}
        </label>

        <section className="iv-panel flex flex-col gap-3 p-4">
          <NumberRow label="الجولات" value={matchLength} min={count ? 1 : 0} max={Math.max(count, 1)} onChange={setRounds} />
          <NumberRow label="وقت الإجابة (ث)" value={answerSeconds} min={1} max={MAX_TIMER_SECONDS} onChange={setAnswerSeconds} />
          <NumberRow label="وقت التصويت (ث)" value={voteSeconds} min={1} max={MAX_TIMER_SECONDS} onChange={setVoteSeconds} />
        </section>

        {error && <p className="iv-error text-center font-bold">{error}</p>}
        <button type="submit" disabled={!valid || busy} className="iv-btn iv-btn-gold iv-btn-lg iv-btn-block">
          {busy ? "…" : "افتح الغرفة"}
        </button>
      </form>
    </main>
  );
}

function NumberRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="iv-field">
      <span>{label}</span>
      <input
        className="iv-input iv-num"
        type="number"
        inputMode="numeric"
        dir="ltr"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = Math.round(Number(e.target.value));
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
      />
    </label>
  );
}
