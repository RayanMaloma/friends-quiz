"use client";

import { useEffect, type ReactNode } from "react";

// Small building blocks for the dashboard. Same chunky look as the game,
// tuned for dense forms on a laptop or a phone.

export const inputCls =
  "chunk-sm w-full bg-card px-3 font-bold outline-none placeholder:font-semibold placeholder:text-mute/60 focus:bg-[#fffbea]";

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
      <label htmlFor={htmlFor} className="font-display text-lg leading-tight">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs font-bold text-mute">{hint}</p>}
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
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-8 w-14 shrink-0 rounded-full border-[3px] border-ink transition-colors ${
          checked ? "bg-mint" : "bg-cream-2"
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full border-[3px] border-ink bg-card transition-[inset-inline-start] ${
            checked ? "start-[1.7rem]" : "start-0.5"
          }`}
        />
      </button>
      <span className="flex flex-col">
        <span className="font-extrabold leading-snug">{label}</span>
        {hint && <span className="text-xs font-bold text-mute">{hint}</span>}
      </span>
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
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`chunk-sm px-3 font-extrabold transition-transform ${size === "sm" ? "h-9 text-sm" : "h-11"} ${
            o.value === value ? "-translate-y-0.5 bg-sun" : "bg-card text-ink/70"
          }`}
        >
          {o.label}
        </button>
      ))}
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
    <div className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className={`chunk flex max-h-[92dvh] w-full flex-col gap-4 overflow-y-auto rounded-b-none bg-cream p-5 sm:rounded-b-[1.75rem] ${
          wide ? "sm:max-w-3xl" : "sm:max-w-lg"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl leading-tight">{title}</h2>
          <button type="button" onClick={onClose} className="btn btn-ghost h-10 px-3 text-base" aria-label="إغلاق">
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
    <span className={`chunk-sm inline-block px-2.5 pb-0.5 pt-1 text-xs font-black leading-none ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="chunk flex flex-col gap-4 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-2xl leading-tight">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
