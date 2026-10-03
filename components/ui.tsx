import type { CSSProperties, ReactNode } from "react";
import { initial, playerSwatch } from "@/lib/colors";

export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.25em] font-display leading-none ${className}`}>
      <span className="chunk-sm inline-block -rotate-6 bg-sun px-[0.3em] pb-[0.05em] pt-[0.2em]">عن</span>
      <span className="inline-block rotate-2">مين؟</span>
    </span>
  );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-spin rounded-full border-[3px] border-current border-t-transparent ${className}`}
    />
  );
}

/** Round colored badge with the player's initial (no portraits for players). */
export function NameBadge({
  playerId,
  name,
  className = "size-12 text-2xl",
}: {
  playerId: string;
  name: string;
  className?: string;
}) {
  const sw = playerSwatch(playerId);
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-full border-[3px] border-ink font-display leading-none ${sw.bg} ${sw.fg} ${className}`}
    >
      <span className="pt-[0.15em]">{initial(name)}</span>
    </span>
  );
}

/** Big centered status card used by guest waiting screens. */
export function GuestStatus({
  emoji,
  title,
  subtitle,
  accent = false,
  children,
}: {
  emoji?: string;
  title: string;
  subtitle?: string;
  /** Make the subtitle the call to action ("look at the TV"). */
  accent?: boolean;
  children?: ReactNode;
}) {
  return (
    <div key={title} className="anim-rise flex flex-1 flex-col items-center justify-center gap-5 px-2 text-center">
      {emoji && (
        <div className="chunk grid size-32 -rotate-3 place-items-center bg-card text-7xl leading-none">
          <span className="anim-wiggle inline-block">{emoji}</span>
        </div>
      )}
      <h1 className="font-display text-4xl leading-tight">{title}</h1>
      {subtitle &&
        (accent ? (
          <p className="chunk-sm anim-nudge rotate-1 bg-sun px-5 pb-2 pt-3 font-display text-3xl">{subtitle}</p>
        ) : (
          <p className="text-xl font-bold text-mute">{subtitle}</p>
        ))}
      {children}
    </div>
  );
}

export function ConnectionBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="anim-fade fixed inset-x-0 top-0 z-50 flex justify-center p-2">
      <span className="chunk-sm flex items-center gap-2 bg-pink px-4 py-1.5 text-sm font-bold text-white">
        <Spinner className="size-3.5" />
        الاتصال ضعيف… نحاول نرجعك
      </span>
    </div>
  );
}

const CONFETTI_COLORS = ["#ffc72c", "#ff4f8b", "#3e82ff", "#16c47b", "#8a5cff", "#ff8a3d"];

/** Pure-CSS confetti, deterministic layout (no hydration mismatch). */
export function Confetti({ count = 40 }: { count?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: count }, (_, i) => {
        const style = {
          left: `${(i * 37) % 100}%`,
          background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          animationDelay: `${((i * 53) % 40) / 10}s`,
          animationDuration: `${4 + ((i * 29) % 30) / 10}s`,
          "--drift": `${((i * 41) % 120) - 60}px`,
          "--spin": `${360 + ((i * 67) % 540)}deg`,
        } as CSSProperties;
        return <span key={i} className="confetti-piece" style={style} />;
      })}
    </div>
  );
}

/** Playful floating shapes for the edges of a screen. Purely decorative. */
export function Decor() {
  const shapes: { cls: string; style: CSSProperties; content?: string }[] = [
    { cls: "size-[9vmin] rounded-full bg-pink", style: { top: "8%", left: "4%", "--r": "0deg" } as CSSProperties },
    { cls: "size-[7vmin] rounded-[1.5vmin] bg-sky", style: { bottom: "12%", left: "7%", "--r": "18deg" } as CSSProperties },
    { cls: "size-[6vmin] rounded-full bg-mint", style: { top: "14%", right: "6%", "--r": "0deg" } as CSSProperties },
    { cls: "size-[8vmin] rounded-[2vmin] bg-grape", style: { bottom: "8%", right: "5%", "--r": "-14deg" } as CSSProperties },
    { cls: "grid size-[8vmin] place-items-center rounded-full bg-sun font-display text-[5vmin]", style: { top: "46%", right: "2%", "--r": "10deg" } as CSSProperties, content: "؟" },
    { cls: "grid size-[7vmin] place-items-center rounded-full bg-orange font-display text-[4.5vmin]", style: { top: "40%", left: "2%", "--r": "-10deg" } as CSSProperties, content: "!" },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {shapes.map((s, i) => (
        <span
          key={i}
          className={`anim-bob absolute border-[3px] border-ink shadow-[0_4px_0_var(--color-ink)] ${s.cls}`}
          style={{ ...s.style, animationDelay: `${i * 0.4}s` }}
        >
          {s.content && <span className="pt-[0.2em]">{s.content}</span>}
        </span>
      ))}
    </div>
  );
}
