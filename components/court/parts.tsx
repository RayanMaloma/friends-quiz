"use client";

import { useEffect, useState } from "react";
import type { Phase, Role, Standing } from "@/lib/court/engine";
import type { CourtPublicGame, CourtTimer } from "@/lib/court/views";

export { timeLeft, useDeadlineRefresh, useServerNow } from "@/components/invent/parts";

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/** The court's scales. */
export function Scales({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`ct-scales ${className}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M50 14v66M30 86h40M22 28h56" />
        <path d="M22 28 10 56h24zM78 28 66 56h24z" />
      </g>
      <g fill="currentColor">
        <circle cx="50" cy="12" r="6" />
        <path d="M8 56h28a14 9 0 0 1-28 0zM64 56h28a14 9 0 0 1-28 0z" />
      </g>
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`ct-brand ${compact ? "is-compact" : ""}`}>
      <Scales size={compact ? 26 : 38} />
      <span>المحكمة</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Roles and phases                                                    */
/* ------------------------------------------------------------------ */

export const ROLE: Record<Role, { label: string; icon: string }> = {
  accused: { label: "المتهم", icon: "🎭" },
  prosecutor: { label: "المدعي العام", icon: "🔎" },
  lawyer: { label: "المحامي", icon: "🛡️" },
  juror: { label: "محلّف", icon: "🗳️" },
};

export function RoleTag({ role, name, size = "md" }: { role: Role; name?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`ct-role is-${role} is-${size}`}>
      <span className="ct-role-icon" aria-hidden>
        {ROLE[role].icon}
      </span>
      <span className="ct-role-label">{ROLE[role].label}</span>
      {name !== undefined && <span className="ct-role-name">{name}</span>}
    </span>
  );
}

/** The steps of a case, as shown on the stepper. */
const STEPS: { key: string; label: string; icon: string; phases: Phase[] }[] = [
  { key: "a", label: "القضية", icon: "📜", phases: ["announce"] },
  { key: "o", label: "الافتتاح", icon: "🎙️", phases: ["opening_p", "opening_l"] },
  { key: "e", label: "الأدلة", icon: "🗂️", phases: ["evidence", "objection"] },
  { key: "x", label: "الاستجواب", icon: "❓", phases: ["cross_p", "cross_l"] },
  { key: "c", label: "الختام", icon: "🏁", phases: ["closing_p", "closing_l"] },
  { key: "v", label: "التصويت", icon: "🗳️", phases: ["vote"] },
  { key: "d", label: "الحكم", icon: "⚖️", phases: ["verdict", "standings"] },
];

export const phaseLabel = (p: Phase) => (p === "standings" ? "الترتيب" : p === "final" ? "النهاية" : (STEPS.find((s) => s.phases.includes(p))?.label ?? ""));

export function PhaseSteps({ phase }: { phase: Phase }) {
  const at = STEPS.findIndex((s) => s.phases.includes(phase));
  return (
    <ol className="ct-steps" aria-label={phaseLabel(phase)}>
      {STEPS.map((s, i) => (
        <li key={s.key} className={i < at ? "is-done" : i === at ? "is-now" : ""} aria-current={i === at ? "step" : undefined}>
          <span aria-hidden>{s.icon}</span>
          {i === at && <b>{s.label}</b>}
        </li>
      ))}
    </ol>
  );
}

/** Who has the floor now (null: nobody in particular). */
export function speakerOf(g: CourtPublicGame): { role: Role; target?: Role } | null {
  switch (g.phase) {
    case "opening_p":
    case "closing_p":
    case "evidence":
    case "objection":
      return { role: "prosecutor" };
    case "opening_l":
    case "closing_l":
      return { role: "lawyer" };
    case "cross_p":
      return { role: "prosecutor", target: "accused" };
    case "cross_l":
      return { role: "lawyer", target: "accused" };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

export function TimerBar({ ms, timer, paused = false }: { ms: number | null; timer: CourtTimer | null; paused?: boolean }) {
  if (ms === null || !timer) return null;
  const secs = Math.ceil(ms / 1000);
  const frac = timer.durationMs > 0 ? Math.min(1, ms / timer.durationMs) : 0;
  return (
    <span className={`ct-timer ${ms <= 5000 && !paused ? "is-urgent" : ""} ${paused ? "is-paused" : ""}`} role="timer" aria-label={`باقي ${secs} ثانية`}>
      <span className="ct-timer-num" dir="ltr">
        {paused ? <PauseIcon /> : secs}
      </span>
      <span className="ct-timer-rail" aria-hidden>
        <span style={{ transform: `scaleX(${frac})` }} />
      </span>
    </span>
  );
}

/** Two bars (the ⏸ glyph is missing from many TV fonts). */
export function PauseIcon({ big = false }: { big?: boolean }) {
  return <span className={`ct-pause-icon ${big ? "is-big" : ""}`} aria-label="متوقف" role="img" />;
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export const VERDICT = { guilty: "مذنب", innocent: "غير مذنب" } as const;

export function Stamp({ guilty, className = "" }: { guilty: boolean; className?: string }) {
  return <span className={`ct-stamp ${guilty ? "is-guilty" : "is-innocent"} ${className}`}>{guilty ? VERDICT.guilty : VERDICT.innocent}</span>;
}

export const KIND = {
  true: { label: "صحيح", cls: "is-true" },
  misleading: { label: "مضلّل", cls: "is-misleading" },
  inconclusive: { label: "غير حاسم", cls: "is-inconclusive" },
} as const;

export function Standings({ rows, meId, limit, showGain = true }: { rows: Standing[]; meId?: string; limit?: number; showGain?: boolean }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <ol className="ct-standings">
      {shown.map((r, i) => (
        <li key={r.playerId} className={`ct-rise ${r.playerId === meId ? "is-me" : ""} ${r.rank === 1 && r.score > 0 ? "is-top" : ""}`} style={{ animationDelay: `${i * 45}ms` }}>
          <span className="rank" dir="ltr">
            {r.rank}
          </span>
          <span className="name">{r.name}</span>
          {showGain && r.gained > 0 && (
            <span className="gain" dir="ltr">
              +{r.gained}
            </span>
          )}
          <span className="score" dir="ltr">
            {r.score}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Privacy                                                             */
/* ------------------------------------------------------------------ */

/** Shows `children` only while pressed (hides again on release, or when the app goes to the background). */
export function HoldToReveal({ children, label = "اضغط مطوّلًا" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const hide = () => setOpen(false);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);
  return (
    <button
      type="button"
      className={`ct-hold ${open ? "is-open" : ""}`}
      aria-pressed={open}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setOpen(true);
      }}
      onPointerUp={() => setOpen(false)}
      onPointerCancel={() => setOpen(false)}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setOpen(true)}
      onKeyUp={() => setOpen(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {open ? (
        <span className="ct-hold-body">{children}</span>
      ) : (
        <span className="ct-hold-cover">
          <span aria-hidden>👁️</span>
          {label}
        </span>
      )}
    </button>
  );
}
