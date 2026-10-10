"use client";

import { useEffect, type ReactNode } from "react";

// Building blocks for the dashboard: the game's palette with calmer, denser
// surfaces (see .panel / .abtn / .ainput in globals.css).

export const inputCls = "ainput";

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-black">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs font-semibold text-mute">{hint}</p>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl px-1 py-1.5 hover:bg-cream/60">
      <span className="flex flex-col">
        <span className="font-extrabold leading-snug">{label}</span>
        {hint && <span className="text-xs font-semibold text-mute">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full border-2 border-ink transition-colors ${
          checked ? "bg-mint" : "bg-cream-2"
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full border-2 border-ink bg-card transition-[inset-inline-start] ${
            checked ? "start-[1.45rem]" : "start-0.5"
          }`}
        />
      </button>
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`abtn ${size === "sm" ? "abtn-sm" : ""} ${o.value === value ? "abtn-primary" : "text-ink/70"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Wrapping tab row (never scrolls, so nothing gets clipped). */
export function Tabs<T extends string>({
  value,
  items,
  onChange,
}: {
  value: T;
  items: { value: T; label: string; badge?: string | number; alert?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 rounded-2xl border-2 border-ink bg-cream-2/70 p-1">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={`flex h-10 min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-1.5 text-[0.8rem] font-black transition-colors sm:flex-none sm:gap-1.5 sm:px-4 sm:text-sm ${
              active ? "border-2 border-ink bg-card shadow-[0_2px_0_var(--color-ink)]" : "text-ink/60 hover:bg-card/60 hover:text-ink"
            }`}
          >
            {it.label}
            {it.badge !== undefined && (
              <span className={`rounded-full px-1.5 text-xs ${active ? "bg-sun" : "bg-card/80"}`}>{it.badge}</span>
            )}
            {it.alert && <span className="size-2 rounded-full bg-pink" aria-label="فيه مشاكل" />}
          </button>
        );
      })}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={title}
        className={`panel flex max-h-[92dvh] w-full flex-col gap-4 overflow-y-auto rounded-b-none bg-cream p-5 sm:rounded-b-2xl ${
          wide ? "sm:max-w-3xl" : "sm:max-w-lg"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl leading-tight">{title}</h2>
          <button type="button" onClick={onClose} className="abtn abtn-quiet abtn-sm abtn-icon text-lg" aria-label="إغلاق">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: "draft" | "published" | "archived" }) {
  const map = {
    draft: { label: "مسودة", cls: "bg-cream-2" },
    published: { label: "منشورة", cls: "bg-mint" },
    archived: { label: "مؤرشفة", cls: "bg-[#dfe3ee]" },
  } as const;
  const s = map[status];
  return (
    <span className={`inline-flex h-6 items-center rounded-full border-2 border-ink px-2.5 text-xs font-black ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function Section({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="panel flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-xl leading-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm font-semibold text-mute">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Small notice bar (info / warning / error) with an optional action. */
export function Notice({
  tone = "info",
  children,
  action,
}: {
  tone?: "info" | "warn" | "error" | "success";
  children: ReactNode;
  action?: ReactNode;
}) {
  const cls = {
    info: "bg-[#eef4ff]",
    warn: "bg-[#fff1c4]",
    error: "bg-[#ffe1ec]",
    success: "bg-[#dcf8ea]",
  }[tone];
  return (
    <div className={`panel-sm flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm font-bold ${cls}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
