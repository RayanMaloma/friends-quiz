import type { ReactNode } from "react";

export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-black tracking-tight ${className}`}>
      <span className="inline-grid place-items-center rounded-xl bg-sun px-2.5 py-0.5 text-sun-ink -rotate-3">
        عن
      </span>
      <span>مين؟</span>
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

/** Big centered status card used by guest waiting screens. */
export function GuestStatus({
  emoji,
  visual,
  title,
  subtitle,
  accent = false,
  children,
}: {
  emoji?: string;
  visual?: ReactNode;
  title: string;
  subtitle?: string;
  /** Make the subtitle the call to action ("look at the TV"). */
  accent?: boolean;
  children?: ReactNode;
}) {
  return (
    <div key={title} className="anim-rise flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      {visual ?? <div className="anim-float text-7xl leading-none">{emoji}</div>}
      <h1 className="text-3xl font-black leading-snug">{title}</h1>
      {subtitle && (
        <p className={accent ? "text-2xl font-black text-sun" : "text-xl font-bold text-mute"}>{subtitle}</p>
      )}
      {children}
    </div>
  );
}

export function ConnectionBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="anim-fade fixed inset-x-0 top-0 z-50 flex justify-center p-2">
      <span className="flex items-center gap-2 rounded-full bg-rose px-4 py-1.5 text-sm font-bold text-white shadow-lg">
        <Spinner className="size-3.5" />
        الاتصال ضعيف… نحاول نرجعك
      </span>
    </div>
  );
}

const CONFETTI_COLORS = ["#ffd23f", "#ff5d73", "#3ddc97", "#f7f3e8", "#7aa2ff"];

/** Pure-CSS confetti, deterministic layout (no hydration mismatch). */
export function Confetti({ count = 36 }: { count?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: count }, (_, i) => {
        const left = (i * 37) % 100;
        const delay = ((i * 53) % 40) / 10;
        const duration = 4 + ((i * 29) % 30) / 10;
        const drift = ((i * 41) % 120) - 60;
        return (
          <span
            key={i}
            className="confetti-piece"
            style={
              {
                left: `${left}%`,
                background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                animationDelay: `${delay}s`,
                animationDuration: `${duration}s`,
                "--drift": `${drift}px`,
                "--spin": `${360 + ((i * 67) % 540)}deg`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
