"use client";

import { useEffect, useRef, useState } from "react";
import { CANVAS, MAX_POINTS, MAX_STROKE_POINTS, type Stroke } from "@/lib/draw/engine";
import { paint, paintStroke, useSquareCanvas } from "./parts";

/** Points closer than this (canvas units) to the previous one are dropped: smaller drawings, same look. */
const MIN_STEP = 3;
const ERASER = 0;

/** Reads this turn's local backup (survives a refresh or a re-render). */
export function readBackup(key: string): Stroke[] | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as Stroke[]) : null;
  } catch {
    return null;
  }
}

function writeBackup(key: string, strokes: Stroke[]) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(strokes));
  } catch {
    // private mode / full: the server draft still has it
  }
}

const countPoints = (strokes: readonly Stroke[]) => strokes.reduce((n, s) => n + s.p.length / 2, 0);

/**
 * The drawer's canvas: finger, pen or mouse. Strokes live in a ref (never in
 * React state, so a re-render or a fresh view can't drop any) and are backed
 * up to sessionStorage after every stroke. `onChange` hands the latest list
 * to the parent (autosave, approve).
 */
export function Board({
  backupKey,
  initial,
  colors,
  sizes,
  onChange,
}: {
  backupKey: string;
  /** Strokes to start from (local backup or the server draft); taken only while the board is still empty. */
  initial: Stroke[] | null;
  colors: readonly string[];
  sizes: readonly number[];
  onChange: (strokes: Stroke[]) => void;
}) {
  const strokes = useRef<Stroke[]>([]);
  const active = useRef<{ id: number; stroke: Stroke } | null>(null);
  const [color, setColor] = useState(1);
  const [size, setSize] = useState(1);
  const [eraser, setEraser] = useState(false);
  const [count, setCount] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const { box, canvas, size: px, repaint } = useSquareCanvas((ctx, s) => paint(ctx, strokes.current, s, colors, sizes));

  const changed = () => {
    setCount(strokes.current.length);
    writeBackup(backupKey, strokes.current);
    onChangeRef.current(strokes.current.slice());
  };

  // Start from the backup / server draft (only onto an empty board).
  useEffect(() => {
    if (!initial || initial.length === 0 || strokes.current.length > 0) return;
    strokes.current = initial.slice();
    repaint();
    changed();
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const toCanvas = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    const clamp = (v: number) => Math.max(0, Math.min(CANVAS, Math.round(v)));
    return [clamp(((e.clientX - r.left) / r.width) * CANVAS), clamp(((e.clientY - r.top) / r.height) * CANVAS)];
  };

  const ctx = () => canvas.current?.getContext("2d") ?? null;

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 || active.current) return;
    if (countPoints(strokes.current) >= MAX_POINTS - 1) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toCanvas(e);
    const stroke: Stroke = { c: eraser ? ERASER : color, w: size, p: [x, y] };
    strokes.current.push(stroke);
    active.current = { id: e.pointerId, stroke };
    const c = ctx();
    if (c && px > 0) paintStroke(c, stroke, px / CANVAS, colors, sizes);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    e.preventDefault();
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    const from = a.stroke.p.length;
    let total = countPoints(strokes.current);
    for (const ev of events.length > 0 ? events : [e.nativeEvent]) {
      const [x, y] = toCanvas(ev);
      const p = a.stroke.p;
      if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < MIN_STEP) continue;
      if (total >= MAX_POINTS || p.length >= MAX_STROKE_POINTS * 2) break;
      p.push(x, y);
      total++;
    }
    const c = ctx();
    if (c && px > 0 && a.stroke.p.length > from) {
      c.lineCap = "round";
      c.lineJoin = "round";
      paintStroke(c, a.stroke, px / CANVAS, colors, sizes, from);
    }
  }

  function up(e: React.PointerEvent<HTMLCanvasElement>) {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    active.current = null;
    changed();
  }

  function undo() {
    if (active.current || strokes.current.length === 0) return;
    strokes.current.pop();
    repaint();
    changed();
  }

  function clear() {
    setConfirmClear(false);
    if (active.current) return;
    strokes.current = [];
    repaint();
    changed();
  }

  return (
    <div className="mw-board">
      <div ref={box} className="mw-board-box">
        <canvas
          ref={canvas}
          className={`mw-paper mw-canvas ${eraser ? "is-eraser" : ""}`}
          aria-label="لوحة الرسم"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      <div className="mw-tools" role="toolbar" aria-label="أدوات الرسم">
        <div className="mw-swatches">
          {colors.map((hex, i) =>
            i === ERASER ? null : (
              <button
                key={hex}
                type="button"
                className={`mw-swatch ${!eraser && color === i ? "is-on" : ""}`}
                style={{ "--sw": hex } as React.CSSProperties}
                aria-label={`لون ${i}`}
                aria-pressed={!eraser && color === i}
                onClick={() => {
                  setColor(i);
                  setEraser(false);
                }}
              />
            ),
          )}
        </div>
        <div className="mw-tool-row">
          <div className="mw-sizes">
            {sizes.map((w, i) => (
              <button
                key={w}
                type="button"
                className={`mw-size ${size === i ? "is-on" : ""}`}
                aria-label={`سُمك ${i + 1}`}
                aria-pressed={size === i}
                onClick={() => setSize(i)}
              >
                <span style={{ width: `${Math.max(4, Math.min(26, w / 2))}px`, height: `${Math.max(4, Math.min(26, w / 2))}px`, background: eraser ? "#9aa59f" : colors[color] }} />
              </button>
            ))}
          </div>
          <button type="button" className={`mw-tool ${eraser ? "is-on" : ""}`} aria-label="ممحاة" aria-pressed={eraser} title="ممحاة" onClick={() => setEraser((v) => !v)}>
            <EraserIcon />
          </button>
          <button type="button" className="mw-tool" aria-label="تراجع" title="تراجع" disabled={count === 0} onClick={undo}>
            <UndoIcon />
          </button>
          <button type="button" className="mw-tool" aria-label="مسح اللوحة" title="مسح اللوحة" disabled={count === 0} onClick={() => setConfirmClear(true)}>
            <TrashIcon />
          </button>
        </div>
      </div>

      {confirmClear && (
        <div className="mw-confirm" role="alertdialog" aria-label="مسح اللوحة؟">
          <TrashIcon />
          <button type="button" className="mw-btn mw-btn-danger" onClick={clear} autoFocus>
            امسح
          </button>
          <button type="button" className="mw-btn" onClick={() => setConfirmClear(false)}>
            تراجع
          </button>
        </div>
      )}
    </div>
  );
}

function EraserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3l5 5-10 10H6l-3-3z" />
      <path d="M11 8l5 5" />
      <path d="M6 21h14" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 010 10h-3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}
