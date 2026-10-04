"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { PEOPLE } from "@/lib/people";
import { Portrait } from "@/components/PersonImage";

/**
 * TV lobby only: every few seconds one of the friends sneaks into the screen
 * from an edge, hangs around for a couple of seconds, and disappears again.
 *
 * Rendered as a layer BEHIND the lobby content (and with overflow hidden), so a
 * peeking face can never cover the room code, QR or player list. Just the
 * transparent cutout — no card, ring, label or name.
 */

type Variant = {
  cls: string;
  durationMs: number;
  /** Random placement + size for this appearance. */
  place: () => Record<string, string>;
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);

const VARIANTS: Variant[] = [
  { cls: "peek-rise", durationMs: 3900, place: () => ({ left: `${rand(36, 50)}%`, "--h": `${rand(44, 52)}vh` }) },
  { cls: "peek-lean-right", durationMs: 3700, place: () => ({ "--h": `${rand(56, 66)}vh` }) },
  { cls: "peek-lean-left", durationMs: 3500, place: () => ({ "--h": `${rand(54, 62)}vh` }) },
  { cls: "peek-hang", durationMs: 4000, place: () => ({ left: `${rand(10, 44)}%`, "--h": `${rand(38, 46)}vh` }) },
  { cls: "peek-oops", durationMs: 2300, place: () => ({ left: `${rand(28, 60)}%`, "--h": `${rand(46, 54)}vh` }) },
  { cls: "peek-side", durationMs: 3500, place: () => ({ top: `${rand(4, 16)}vh`, "--h": `${rand(38, 44)}vh` }) },
] as const;

type Appearance = { key: number; personId: string; variant: Variant; style: CSSProperties };

export function PeekingFriends() {
  const [current, setCurrent] = useState<Appearance | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let lastPerson = "";
    let lastVariant = "";
    let key = 0;

    const pick = <T,>(items: readonly T[], avoid: (t: T) => boolean) => {
      const pool = items.filter((t) => !avoid(t));
      return (pool.length ? pool : items)[Math.floor(Math.random() * (pool.length || items.length))];
    };

    const showNext = () => {
      const person = pick(PEOPLE, (p) => p.id === lastPerson);
      const variant = pick(VARIANTS, (v) => v.cls === lastVariant);
      lastPerson = person.id;
      lastVariant = variant.cls;
      key += 1;
      setCurrent({
        key,
        personId: person.id,
        variant,
        style: { ...variant.place(), "--peek-duration": `${variant.durationMs}ms` } as CSSProperties,
      });
      // Hide after the animation, then wait 3–6s before the next friend.
      timer = setTimeout(() => {
        setCurrent(null);
        timer = setTimeout(showNext, rand(3000, 6000));
      }, variant.durationMs + 50);
    };

    timer = setTimeout(showNext, 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div aria-hidden className="peek-layer pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {current && (
        <div key={current.key} className={`peek ${current.variant.cls}`} style={current.style}>
          <Portrait personId={current.personId} />
        </div>
      )}
    </div>
  );
}
