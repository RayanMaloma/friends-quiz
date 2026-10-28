"use client";

import React, { useEffect, useState } from "react";
import { serverOffset } from "@/lib/client/useClock";
import { ROLE_INFO, SECONDS, type Role } from "@/lib/mafia/rules";
import type { Phase } from "@/lib/mafia/types";
import type { MafiaPublicMatch } from "@/lib/mafia/views";
import { Emblem } from "./Emblem";

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

/** Milliseconds left in the phase (frozen while paused). null = no timer. */
export function remainingMs(m: MafiaPublicMatch, now: number): number | null {
  if (m.paused) return m.pausedRemaining;
  if (m.deadline === null) return null;
  return Math.max(0, m.deadline - now);
}

/**
 * Asks the server for a fresh state when the phase is due, so the room moves
 * on without waiting for the safety poll. The server decides; this only knocks.
 */
export function useDeadlineRefresh(m: MafiaPublicMatch | null | undefined, serverNow: string | undefined, receivedAt: number, refresh: () => void) {
  const deadline = m && !m.paused ? m.deadline : null;
  useEffect(() => {
    if (deadline === null) return;
    const offset = serverOffset(serverNow, receivedAt);
    const wait = Math.max(0, deadline - (Date.now() + offset)) + 350;
    const id = setTimeout(refresh, wait);
    return () => clearTimeout(id);
  }, [deadline, serverNow, receivedAt, refresh]);
}

export function formatClock(ms: number | null): string {
  if (ms === null) return "";
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A ring that empties as the phase runs out. */
export function Countdown({ ms, total, size = "md", label }: { ms: number | null; total: number; size?: "sm" | "md" | "lg" | "xl"; label?: string }) {
  if (ms === null) return null;
  const frac = total > 0 ? Math.min(1, ms / total) : 0;
  const urgent = ms <= 10000;
  const C = 2 * Math.PI * 46;
  return (
    <div className={`mf-countdown is-${size} ${urgent ? "is-urgent" : ""}`} role="timer" aria-label={label ?? `باقي ${Math.ceil(ms / 1000)} ثانية`}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="46" className="track" />
        <circle cx="50" cy="50" r="46" className="bar" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
      </svg>
      <span className="mf-countdown-num" dir="ltr">{size === "xl" ? formatClock(ms) : Math.ceil(ms / 1000)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Role cards                                                          */
/* ------------------------------------------------------------------ */

export function RoleCard({ role, teammates, compact }: { role: Role; teammates?: { id: string; name: string; alive: boolean }[]; compact?: boolean }) {
  const info = ROLE_INFO[role];
  return (
    <div className={`mf-card ${compact ? "is-compact" : ""}`} data-role={role}>
      <div className="mf-card-frame">
        <span className="mf-card-corner tl" />
        <span className="mf-card-corner tr" />
        <span className="mf-card-corner bl" />
        <span className="mf-card-corner br" />
        <p className="mf-card-eyebrow">ملف سرّي · {info.team}</p>
        <Emblem role={role} className="mf-card-emblem" />
        <h2 className="mf-card-name">{info.name}</h2>
        {!compact && <p className="mf-card-tagline">{info.tagline}</p>}
        {!compact && <p className="mf-card-goal">{info.goal}</p>}
        {teammates && teammates.length > 0 && (
          <div className="mf-card-team">
            <span>شركاؤك</span>
            <ul>
              {teammates.map((t) => (
                <li key={t.id} className={t.alive ? "" : "is-out"}>{t.name}</li>
              ))}
            </ul>
          </div>
        )}
        {role === "mafia" && teammates && teammates.length === 0 && !compact && <p className="mf-card-goal">أنت القاتل الوحيد… لا تثق بأحد.</p>}
      </div>
    </div>
  );
}

/** The back of every card: identical for all roles, so nothing leaks. */
export function CardBack({ hint }: { hint?: string }) {
  return (
    <div className="mf-card mf-card-back">
      <div className="mf-card-frame">
        <span className="mf-card-corner tl" />
        <span className="mf-card-corner tr" />
        <span className="mf-card-corner bl" />
        <span className="mf-card-corner br" />
        <div className="mf-card-seal">
          <span>سرّي</span>
        </div>
        <p className="mf-wordmark-sm">MAFIA</p>
        {hint && <p className="mf-card-hint">{hint}</p>}
      </div>
    </div>
  );
}

export function RoleChip({ role }: { role: Role }) {
  return (
    <span className="mf-role-chip" data-role={role}>
      <Emblem role={role} />
      {ROLE_INFO[role].name}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export const PHASE_LABEL: Record<Phase, string> = {
  intro: "البداية",
  roleReveal: "توزيع الأدوار",
  nightfall: "الليل",
  mafia: "القتلة",
  detective: "الشايب",
  doctor: "الطبيب",
  dawn: "الفجر",
  discussion: "النقاش",
  voting: "التصويت",
  verdict: "النتيجة",
  gameOver: "النهاية",
};

export const PHASE_TOTAL_MS: Partial<Record<Phase, number>> = {
  roleReveal: SECONDS.roleReveal * 1000,
  mafia: SECONDS.mafia * 1000,
  detective: SECONDS.detective * 1000,
  doctor: SECONDS.doctor * 1000,
  discussion: SECONDS.discussion * 1000,
  voting: SECONDS.voting * 1000,
};

export function countsLine(counts: Record<Role, number>): { role: Role; n: number }[] {
  return (["mafia", "detective", "doctor", "citizen"] as Role[]).map((role) => ({ role, n: counts[role] })).filter((x) => x.n > 0);
}

export function Plain({ children }: { children: React.ReactNode }) {
  return <main className="mf mf-plain">{children}</main>;
}
