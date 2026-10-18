/**
 * Reusable UI primitives. All styling goes through theme CSS variables
 * (see styles.css), so these never need to change when a theme does.
 */
"use client";

import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';

export function Button({ variant = 'secondary', icon, children, size = 'md', className = '', ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; icon?: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button type="button" className={`dbtn dbtn-${variant} dbtn-${size} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'lg' ? 22 : size === 'sm' ? 15 : 18} />}
      {children != null && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon, label, variant = 'ghost', className = '', ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; variant?: BtnVariant }) {
  return (
    <button type="button" className={`dbtn dbtn-${variant} dbtn-icon ${className}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={17} />
    </button>
  );
}

export function Tip({ text, children }: { text: string; children?: React.ReactNode }) {
  const id = useId();
  return (
    <span className="tip" tabIndex={0} aria-describedby={id}>
      {children ?? <Icon name="info" size={15} />}
      <span role="tooltip" id={id} className="tip-bubble">{text}</span>
    </span>
  );
}

export function Field({ label, hint, children, inline }: { label: string; hint?: string; children: React.ReactNode; inline?: boolean }) {
  return (
    <label className={`field ${inline ? 'field-inline' : ''}`}>
      <span className="field-label">{label}{hint && <Tip text={hint} />}</span>
      {children}
    </label>
  );
}

export function TextInput({ value, onChange, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void }) {
  return <input className="input" value={value} onChange={e => onChange(e.target.value)} {...rest} />;
}

export function TextArea({ value, onChange, rows = 3, ...rest }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void }) {
  return <textarea className="input" rows={rows} value={value} onChange={e => onChange(e.target.value)} {...rest} />;
}

export function NumberInput({ value, onChange, min, max, step = 1, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  // While typing, keep the raw text (e.g. an empty field); otherwise show the value.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="input input-num" type="number" inputMode="decimal" value={draft ?? String(value)} min={min} max={max} step={step}
      onChange={e => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && !Number.isNaN(n)) onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)));
      }}
      onBlur={() => setDraft(null)}
      {...rest}
    />
  );
}

export function Select<T extends string>({ value, onChange, options, ...rest }: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select className="input" value={value} onChange={e => onChange(e.target.value as T)} {...rest}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden><span className="toggle-thumb" /></span>
      <span>{label}</span>
      {hint && <Tip text={hint} />}
    </label>
  );
}

export function ColorField({ label, value, onChange, allowEmpty, emptyLabel = 'الافتراضي' }: { label: string; value: string; onChange: (v: string) => void; allowEmpty?: boolean; emptyLabel?: string }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="color-field">
        <input type="color" aria-label={`${label} — اختيار اللون`} value={valid ? value : '#888888'} onChange={e => onChange(e.target.value)} />
        <input className="input" aria-label={`${label} — كود اللون`} value={value} placeholder={allowEmpty ? emptyLabel : '#000000'} onChange={e => onChange(e.target.value.trim())} maxLength={7} />
        {allowEmpty && value && <IconButton icon="x" label={`إرجاع ${label}`} onClick={() => onChange('')} />}
      </div>
    </div>
  );
}

export function Range({ label, value, onChange, min, max, step = 1, suffix = '' }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label} <span className="muted num">{value}{suffix}</span></label>
      <input id={id} type="range" className="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; icon?: string }[]; value: T; onChange: (t: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id} ref={el => { refs.current[i] = el; }} role="tab" type="button" aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1} className={`tab ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}
          onKeyDown={e => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              // RTL: the next tab is on the left.
              const n = (i + (e.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length;
              onChange(tabs[n].id); refs.current[n]?.focus();
            }
          }}
        >
          {t.icon && <Icon name={t.icon} size={16} />}<span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide, labelledBy }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const f = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-x)');
      (f ?? ref.current)?.focus();
    }, 10);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const els = [...ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.hasAttribute('disabled'));
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { window.clearTimeout(t); document.removeEventListener('keydown', key, true); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? id} ref={ref} tabIndex={-1}>
        <header className="modal-head">
          <h2 id={id}>{title}</h2>
          <IconButton icon="x" label="إغلاق" className="modal-x" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------- confirm dialogs (promise based) ---------- */

interface ConfirmOpts { title: string; message: React.ReactNode; confirmLabel?: string; danger?: boolean; cancelLabel?: string }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>(resolve => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal
        open={!!state} onClose={() => close(false)} title={state?.title ?? ''}
        footer={<>
          <Button variant="ghost" onClick={() => close(false)}>{state?.cancelLabel ?? 'إلغاء'}</Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{state?.confirmLabel ?? 'تأكيد'}</Button>
        </>}
      >
        <div className="confirm-msg">{state?.message}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export function EmptyState({ icon = 'info', title, children }: { icon?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={30} />
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className = '' }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`dpanel ${className}`}>
      {(title || actions) && <header className="dpanel-head">{title && <h3>{title}</h3>}{actions && <div className="row gap-s">{actions}</div>}</header>}
      {children}
    </section>
  );
}

export function Badge({ children, color, title }: { children: React.ReactNode; color?: string; title?: string }) {
  return <span className="badge" title={title} style={color ? ({ '--badge': color } as React.CSSProperties) : undefined}>{children}</span>;
}

/** Simple ordered-list editor controls. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const a = arr.slice();
  if (to < 0 || to >= a.length) return a;
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}
