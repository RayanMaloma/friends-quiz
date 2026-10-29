"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { serverOffset } from "@/lib/client/useClock";
import type { Phase, Standing } from "@/lib/invent/engine";
import type { InventCard, InventTimer } from "@/lib/invent/views";

/* ------------------------------------------------------------------ */
/* Clock                                                               */
/* ------------------------------------------------------------------ */

/** Server time (ms), ticking every `ms`. Uses the offset from the last view. */
export function useServerNow(serverNow: string | undefined, receivedAt: number, ms = 250): number {
  const offset = serverOffset(serverNow, receivedAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now + offset;
}

/** Milliseconds left (frozen while paused). The server's numbers, never a local timer. */
export function timeLeft(timer: InventTimer | null, now: number): number | null {
  if (!timer) return null;
  if (timer.deadline === null) return timer.remainingMs;
  return Math.max(0, timer.deadline - now);
}

/**
 * Asks the server for a fresh state when the phase is due, so the room moves
 * on without waiting for the safety poll. The server decides; this only knocks.
 */
export function useDeadlineRefresh(timer: InventTimer | null | undefined, serverNow: string | undefined, receivedAt: number, refresh: () => void) {
  const deadline = timer?.deadline ?? null;
  useEffect(() => {
    if (deadline === null) return;
    const offset = serverOffset(serverNow, receivedAt);
    const wait = Math.max(0, deadline - (Date.now() + offset)) + 300;
    const id = setTimeout(refresh, wait);
    return () => clearTimeout(id);
  }, [deadline, serverNow, receivedAt, refresh]);
}

export function Countdown({ ms, total, paused, size = "4.5rem" }: { ms: number | null; total: number; paused?: boolean; size?: string }) {
  if (ms === null) return null;
  const frac = total > 0 ? Math.min(1, ms / total) : 0;
  const secs = Math.ceil(ms / 1000);
  const urgent = !paused && ms <= 5000;
  const C = 2 * Math.PI * 44;
  return (
    <div
      className={`iv-countdown ${urgent ? "is-urgent" : ""} ${paused ? "is-paused" : ""}`}
      style={{ "--size": size } as React.CSSProperties}
      role="timer"
      aria-label={paused ? "الوقت موقّف" : `باقي ${secs} ثانية`}
    >
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="44" className="track" />
        <circle cx="50" cy="50" r="44" className="bar" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
      </svg>
      <span className="iv-countdown-num" dir="ltr">{paused ? "❚❚" : secs}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

export const PHASE_LABEL: Record<Phase, string> = {
  answering: "وقت الإجابة",
  voting: "وقت التصويت",
  reveal: "مين كتب وش؟",
  leaderboard: "الترتيب",
  final: "النتيجة النهائية",
};

export function votesLabel(n: number): string {
  if (n === 0) return "ولا صوت";
  if (n === 1) return "صوت واحد";
  if (n === 2) return "صوتين";
  if (n <= 10) return `${n} أصوات`;
  return `${n} صوت`;
}

export const pointsLabel = (n: number) => `+${n} نقطة`;


/* ------------------------------------------------------------------ */
/* Answer cards (voting and reveal: same component, same order)        */
/* ------------------------------------------------------------------ */

/**
 * The diagonal author tag. Starts at the big size from the stylesheet and,
 * if its rotated box would not fit in the card's tag zone (long names like
 * «عبدالرحمن الناهض»), shrinks the type until it does — so a name is never
 * clipped. Refits when the card is resized.
 */
function AuthorTag({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const tag = ref.current;
    const zone = tag?.parentElement;
    if (!tag || !zone) return;
    const fit = () => {
      tag.style.fontSize = "";
      const base = parseFloat(getComputedStyle(tag).fontSize);
      // Offset sizes ignore transforms (rotation, entrance animation): the rotated box is computed here.
      const w = tag.offsetWidth;
      const h = tag.offsetHeight;
      const rad = (30 * Math.PI) / 180;
      const boxW = w * Math.cos(rad) + h * Math.sin(rad);
      const boxH = w * Math.sin(rad) + h * Math.cos(rad);
      // Margins leave room for the notched ends and the shadow.
      const room = Math.min((zone.clientWidth * 0.86) / boxW, (zone.clientHeight * 0.92) / boxH, 1);
      if (room < 1) tag.style.fontSize = `${Math.max(10, base * room)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(zone);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [name]);
  return (
    <span ref={ref} className="iv-tag">
      {name}
    </span>
  );
}

export function AnswerCards({
  cards,
  selectable,
  selectedId,
  votedId,
  onSelect,
}: {
  cards: InventCard[];
  /** Phones while voting: cards are buttons (own answer disabled). */
  selectable?: boolean;
  selectedId?: string | null;
  /** The card this phone voted for (highlighted after the vote). */
  votedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const top = Math.max(0, ...cards.map((c) => c.votes ?? 0));
  return (
    <ul className="iv-cards">
      {cards.map((c, i) => {
        const revealed = c.author !== null;
        const className = [
          "iv-card",
          revealed ? "is-revealed" : "",
          c.mine ? "is-mine" : "",
          selectedId === c.id ? "is-selected" : "",
          votedId === c.id ? "is-voted-by-me" : "",
          revealed && top > 0 && c.votes === top ? "is-top" : "",
        ].join(" ");
        const body = (
          <>
            <p className="iv-card-text" dir="auto">{c.text}</p>
            <p className="iv-card-meta" aria-hidden={!revealed}>
              <span>{votesLabel(c.votes ?? 0)}</span>
              <span>—</span>
              <span className={`pts ${c.points ? "" : "is-zero"}`}>{pointsLabel(c.points ?? 0)}</span>
            </p>
            <span className="iv-card-zone" aria-hidden={!revealed}>
              {revealed ? (
                <AuthorTag name={c.author!.name} />
              ) : c.mine ? (
                <span className="iv-card-mine-label">إجابتك</span>
              ) : (
                <span className="iv-card-mark">؟</span>
              )}
            </span>
          </>
        );
        return (
          // Cards rise in when voting opens; at the reveal they stay put (only the tags arrive).
          <li key={c.id} className={revealed ? undefined : "iv-rise"} style={revealed ? undefined : { animationDelay: `${Math.min(i, 12) * 35}ms` }}>
            {selectable && !revealed ? (
              <button
                type="button"
                className={className}
                disabled={c.mine}
                aria-pressed={selectedId === c.id}
                aria-label={c.mine ? `إجابتك: ${c.text}` : c.text}
                onClick={() => onSelect?.(c.id)}
              >
                {body}
              </button>
            ) : (
              <div className={className}>
                {body}
                {revealed && (
                  <span className="sr-only">
                    كتبها {c.author!.name}، {votesLabel(c.votes ?? 0)}، {pointsLabel(c.points ?? 0)}
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Standings                                                           */
/* ------------------------------------------------------------------ */

export function Standings({ rows, meId, showGain = true }: { rows: Standing[]; meId?: string; showGain?: boolean }) {
  return (
    <ol className="iv-standings">
      {rows.map((r, i) => (
        <li
          key={r.playerId}
          className={`iv-standing ${r.rank === 1 && r.score > 0 ? "is-first" : ""} ${r.playerId === meId ? "is-me" : ""}`}
          style={{ animationDelay: `${Math.min(i, 15) * 45}ms` }}
        >
          <span className="rank">{r.rank}</span>
          <span className="name">{r.name}</span>
          {showGain ? <span className={`gain ${r.gained ? "" : "is-zero"}`} dir="ltr">{r.gained ? `+${r.gained}` : "+0"}</span> : <span />}
          <span className="score">{r.score}</span>
        </li>
      ))}
    </ol>
  );
}

/** First three places (ties share a step). */
export function Podium({ rows }: { rows: Standing[] }) {
  const step = (rank: number) => rows.filter((r) => r.rank === rank);
  const places = [1, 2, 3]
    .map((rank) => ({ rank, who: step(rank) }))
    .filter((p) => p.who.length > 0)
    .slice(0, 3);
  // Display order: 2nd, 1st, 3rd (first in the middle).
  const order = [places.find((p) => p.rank === 2), places.find((p) => p.rank === 1), places.find((p) => p.rank === 3)];
  return (
    <div className="iv-podium">
      {order.map((p, i) =>
        p ? (
          <div key={p.rank} className={`iv-step p${p.rank}`}>
            <span className="who">{p.who.map((w) => w.name).join(" و ")}</span>
            <span className="pts">{p.who[0].score} نقطة</span>
            <div className="block" style={{ animationDelay: `${(3 - p.rank) * 180}ms` }}>
              {p.rank === 1 ? "🏆" : p.rank}
            </div>
          </div>
        ) : (
          <div key={`empty-${i}`} />
        ),
      )}
    </div>
  );
}
