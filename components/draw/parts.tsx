"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { Standing, Stroke } from "@/lib/draw/engine";
import type { DrawTimer } from "@/lib/draw/views";

export { timeLeft, useDeadlineRefresh, useServerNow } from "@/components/invent/parts";

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/** The ministry's (fictional) seal: a double ring, a brush and a pencil crossed, three stars. */
export function Seal({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`mw-seal ${className}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 3" />
      <g transform="rotate(-40 50 50)" fill="currentColor">
        <rect x="47" y="24" width="6" height="34" rx="2" />
        <path d="M45 58h10l-2 6h-6z" />
        <path d="M46.5 64c0 6 3.5 12 3.5 12s3.5-6 3.5-12z" />
      </g>
      <g transform="rotate(40 50 50)" fill="currentColor">
        <rect x="47" y="26" width="6" height="36" rx="1" />
        <path d="M47 62h6l-3 10z" />
      </g>
      <g fill="currentColor">
        <path d="M50 12l1.6 3.3 3.6.5-2.6 2.5.6 3.6L50 20.2l-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" />
        <path d="M30 18l1.2 2.4 2.6.4-1.9 1.8.5 2.6L30 24l-2.4 1.2.5-2.6-1.9-1.8 2.6-.4z" />
        <path d="M70 18l1.2 2.4 2.6.4-1.9 1.8.5 2.6L70 24l-2.4 1.2.5-2.6-1.9-1.8 2.6-.4z" />
      </g>
    </svg>
  );
}

/** The ministry's name, as on an official letterhead. */
export function Letterhead({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`mw-letterhead ${compact ? "is-compact" : ""}`}>
      <Seal size={compact ? 30 : 44} />
      <span className="mw-letterhead-name">وزارة المقيمين للفنون والرسم</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

/** Seconds left, as a progress rail with the number (red in the last five seconds). */
export function TimerBar({ ms, timer }: { ms: number | null; timer: DrawTimer | null }) {
  if (ms === null || !timer) return null;
  const secs = Math.ceil(ms / 1000);
  const frac = timer.durationMs > 0 ? Math.min(1, ms / timer.durationMs) : 0;
  return (
    <span className={`mw-timer ${ms <= 5000 ? "is-urgent" : ""}`} role="timer" aria-label={`باقي ${secs} ثانية`}>
      <span className="mw-timer-num" dir="ltr">
        {secs}
      </span>
      <span className="mw-timer-rail" aria-hidden>
        <span style={{ transform: `scaleX(${frac})` }} />
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Drawings                                                            */
/* ------------------------------------------------------------------ */

export const BACKGROUND = "#ffffff";

/** Paints `strokes` (canvas units) onto `ctx`, scaled to `size` CSS px. */
export function paint(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[], size: number, colors: readonly string[], sizes: readonly number[]) {
  const k = size / 1000;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) paintStroke(ctx, s, k, colors, sizes);
}

export function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, k: number, colors: readonly string[], sizes: readonly number[], from = 0) {
  const color = colors[s.c] ?? "#000";
  const width = (sizes[s.w] ?? 10) * k;
  const p = s.p;
  if (p.length === 2) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p[0] * k, p[1] * k, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  const start = Math.max(0, from - 2);
  ctx.moveTo(p[start] * k, p[start + 1] * k);
  for (let i = start + 2; i < p.length; i += 2) ctx.lineTo(p[i] * k, p[i + 1] * k);
  ctx.stroke();
}

/** A square canvas that fills its box (the largest square that fits) and keeps it painted on resize. */
export function useSquareCanvas(redraw: (ctx: CanvasRenderingContext2D, size: number) => void) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  const redrawRef = useRef(redraw);
  useEffect(() => {
    redrawRef.current = redraw;
  });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setSize(Math.floor(Math.min(el.clientWidth, el.clientHeight)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || size <= 0) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    c.style.width = `${size}px`;
    c.style.height = `${size}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawRef.current(ctx, size);
  }, [size]);

  /** Repaint now (after the strokes changed). */
  const repaint = () => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (ctx && size > 0) redrawRef.current(ctx, size);
  };
  return { box, canvas, size, repaint };
}

/** A finished drawing, read only. */
export function Sketch({ strokes, colors, sizes, className = "" }: { strokes: readonly Stroke[] | null; colors: readonly string[]; sizes: readonly number[]; className?: string }) {
  const { box, canvas, size, repaint } = useSquareCanvas((ctx, s) => paint(ctx, strokes ?? [], s, colors, sizes));
  useEffect(repaint, [strokes, size]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className={`mw-sketch ${className}`}>
      <canvas ref={canvas} className="mw-paper" role="img" aria-label="اللوحة" />
      {!strokes && <span className="mw-loader" aria-label="جاري التحميل" />}
    </div>
  );
}

/**
 * The strokes of the approved drawing, fetched once per revision (they are
 * not part of the view, which is fetched far more often).
 */
export function useApprovedDrawing(rev: number | null, turnKey: string, fetchDrawing: () => Promise<{ ok: boolean; rev?: number | null; strokes?: Stroke[] }>) {
  const [state, setState] = useState<{ key: string; strokes: Stroke[] } | null>(null);
  const fetchRef = useRef(fetchDrawing);
  useEffect(() => {
    fetchRef.current = fetchDrawing;
  });
  const key = rev === null ? null : `${turnKey}:${rev}`;
  useEffect(() => {
    if (key === null) return;
    let alive = true;
    let tries = 0;
    const load = async () => {
      const res = await fetchRef.current();
      if (!alive) return;
      if (res.ok && res.strokes) setState({ key, strokes: res.strokes });
      else if (tries++ < 5) setTimeout(load, 800);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [key]);
  return state && state.key === key ? state.strokes : null;
}

/** Calls the room's endpoint for the drawing strokes. */
export function drawingRequest(creds: { sessionId: string } & ({ hostToken: string } | { playerToken: string })) {
  const auth = "hostToken" in creds ? { as: "host", hostToken: creds.hostToken } : { as: "guest", playerToken: creds.playerToken };
  return () => api<{ rev: number | null; strokes: Stroke[] }>("/api/draw", { action: "drawing", sessionId: creds.sessionId, ...auth });
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export function Standings({ rows, meId, showGain = true, limit }: { rows: Standing[]; meId?: string; showGain?: boolean; limit?: number }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <ol className="mw-standings">
      {shown.map((r, i) => (
        <li
          key={r.playerId}
          className={`${r.rank === 1 && r.score > 0 ? "is-first" : ""} ${r.playerId === meId ? "is-me" : ""}`}
          style={{ animationDelay: `${Math.min(i, 15) * 40}ms` }}
        >
          <span className="rank">{r.rank}</span>
          <span className="name">{r.name}</span>
          {showGain && <span className={`gain ${r.gained ? "" : "is-zero"}`} dir="ltr">{r.gained ? `+${r.gained}` : ""}</span>}
          <span className="score" dir="ltr">{r.score}</span>
        </li>
      ))}
    </ol>
  );
}

/** Keeps `--mw-vh` at the visible height (the phone keyboard shrinks it), so nothing hides behind the keyboard. */
export function useVisibleHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    const set = () => document.documentElement.style.setProperty("--mw-vh", `${Math.round(vv?.height ?? window.innerHeight)}px`);
    set();
    vv?.addEventListener("resize", set);
    window.addEventListener("resize", set);
    return () => {
      vv?.removeEventListener("resize", set);
      window.removeEventListener("resize", set);
      document.documentElement.style.removeProperty("--mw-vh");
    };
  }, []);
}
