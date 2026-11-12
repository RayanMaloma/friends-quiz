"use client";

import { useState } from "react";
import type { PanelId } from "@/lib/outage/roles";
import {
  DOOR_NAMES,
  SYS_NAMES,
  VALVE_NAMES,
  type DoorId,
  type Procedure,
  type SectionId,
  type SysId,
  type ValveId,
} from "@/lib/outage/sim";
import type {
  BreakersPanel,
  CommsPanel,
  CoolingPanel,
  DoorsPanel,
  GridPanel,
  MaintPanel,
  MonitorPanel,
  PanelData,
  ValvesPanel,
} from "@/lib/outage/views";
import type { Send } from "./OutagePhone";

const SYS: SysId[] = ["cooling", "life", "comms", "security"];
const SECTIONS: SectionId[] = ["A", "B", "C"];

export function Panel({ id, data, send }: { id: PanelId; data: PanelData; send: Send }) {
  switch (id) {
    case "breakers":
      return data.breakers ? <Breakers d={data.breakers} send={send} /> : null;
    case "grid":
      return data.grid ? <Grid d={data.grid} send={send} /> : null;
    case "cooling":
      return data.cooling ? <Cooling d={data.cooling} send={send} /> : null;
    case "doors":
      return data.doors ? <Doors d={data.doors} send={send} /> : null;
    case "valves":
      return data.valves ? <Valves d={data.valves} send={send} /> : null;
    case "comms":
      return data.comms ? <Comms d={data.comms} send={send} /> : null;
    case "monitor":
      return data.monitor ? <Monitor d={data.monitor} send={send} /> : null;
    case "maint":
      return data.maint ? <Maint d={data.maint} send={send} /> : null;
  }
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

function Switch({ label, on, onChange, hint, tone }: { label: string; on: boolean; onChange: (on: boolean) => void; hint?: string; tone?: "ok" | "warn" | "danger" }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`oc-switch ${on ? "is-on" : ""} ${tone ? `is-${tone}` : ""}`} onClick={() => onChange(!on)}>
      <span className="oc-switch-label">{label}</span>
      {hint && <small className="oc-switch-hint">{hint}</small>}
      <span className="oc-switch-track" aria-hidden>
        <span />
      </span>
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "danger" }) {
  return (
    <div className={`oc-stat ${tone ? `is-${tone}` : ""}`}>
      <span>{label}</span>
      <b dir="ltr">{value}</b>
    </div>
  );
}

const trendText = (v: number, unit: string) => `${v > 0 ? "▲" : v < 0 ? "▼" : "•"} ${Math.abs(v).toFixed(1)}${unit}`;

/** A numeric slider that sends once on release. */
function Slider({ label, value, min, max, step, onCommit, unit = "" }: { label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void; unit?: string }) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <label className="oc-slider">
      <span className="oc-slider-head">
        {label}
        <b dir="ltr">
          {shown}
          {unit}
        </b>
      </span>
      <input
        type="range"
        dir="ltr"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  );
}

function CodeInput({ label, onSubmit, disabled }: { label: string; onSubmit: (code: string) => Promise<boolean>; disabled?: boolean }) {
  const [code, setCode] = useState("");
  return (
    <form
      className="oc-code-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!code) return;
        if (await onSubmit(code)) setCode("");
      }}
    >
      <input
        className="oc-input"
        inputMode="numeric"
        dir="ltr"
        aria-label={label}
        placeholder={label}
        maxLength={8}
        value={code}
        disabled={disabled}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
      />
      <button type="submit" className="oc-btn oc-btn-primary" disabled={disabled || !code}>
        ⏎
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Electrical                                                          */
/* ------------------------------------------------------------------ */

const GEN_TEXT = { on: "يعمل", off: "متوقف", fault: "معطل" } as const;

function Breakers({ d, send }: { d: BreakersPanel; send: Send }) {
  return (
    <div className="oc-panel">
      <Stat label="الإنتاج" value={`${d.supply}`} tone={d.supply <= 0 ? "danger" : undefined} />
      <div className="oc-grid2">
        <Switch label="المولد الرئيسي" hint={d.main === "on" ? `${d.mainCap}` : GEN_TEXT[d.main]} on={d.main === "on"} tone={d.main === "fault" ? "danger" : undefined} onChange={(on) => void send({ type: "main", on })} />
        <Switch label="المولد الاحتياطي" hint={d.backup === "on" ? "40" : GEN_TEXT[d.backup]} on={d.backup === "on"} tone={d.backup === "fault" ? "danger" : undefined} onChange={(on) => void send({ type: "backup", on })} />
      </div>
      <p className="oc-section-label">القواطع</p>
      <div className="oc-grid2">
        {SYS.map((k) => (
          <Switch
            key={k}
            label={SYS_NAMES[k]}
            hint={d.breakers[k] ? (d.powered[k] ? "⚡" : "ضعيف") : undefined}
            tone={d.breakers[k] && !d.powered[k] ? "warn" : undefined}
            on={d.breakers[k]}
            onChange={(on) => void send({ type: "breaker", sys: k, on })}
          />
        ))}
      </div>
    </div>
  );
}

function Grid({ d, send }: { d: GridPanel; send: Send }) {
  return (
    <div className="oc-panel">
      <div className="oc-grid2">
        <Stat label="الإنتاج" value={`${d.supply}`} />
        <Stat label="المتاح" value={`${d.free}`} tone={d.free < 0 ? "danger" : d.free === 0 ? "warn" : "ok"} />
      </div>
      {SYS.map((k) => {
        const short = d.breakers[k] && d.delivered[k] < d.need[k];
        return (
          <div key={k} className={`oc-alloc ${short ? "is-short" : ""}`}>
            <div className="oc-alloc-head">
              <span>{SYS_NAMES[k]}</span>
              <small dir="ltr">
                {d.delivered[k]}/{d.need[k]}
              </small>
            </div>
            <div className="oc-stepper">
              <button type="button" className="oc-btn" aria-label={`إنقاص ${SYS_NAMES[k]}`} disabled={d.alloc[k] <= 0} onClick={() => void send({ type: "alloc", sys: k, value: d.alloc[k] - d.step })}>
                −
              </button>
              <b dir="ltr">{d.alloc[k]}</b>
              <button type="button" className="oc-btn" aria-label={`زيادة ${SYS_NAMES[k]}`} disabled={d.alloc[k] >= d.max[k]} onClick={() => void send({ type: "alloc", sys: k, value: d.alloc[k] + d.step })}>
                +
              </button>
            </div>
            <span className="oc-bar" aria-hidden>
              <span style={{ transform: `scaleX(${d.max[k] ? d.alloc[k] / d.max[k] : 0})` }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cooling                                                             */
/* ------------------------------------------------------------------ */

function Cooling({ d, send }: { d: CoolingPanel; send: Send }) {
  const tone = d.temp >= 130 ? "danger" : d.temp >= 85 ? "warn" : "ok";
  return (
    <div className="oc-panel">
      <div className="oc-grid2">
        <Stat label="المفاعل" value={`${Math.round(d.temp)}°`} tone={tone} />
        <Stat label="الاتجاه" value={trendText(d.trend, "°")} tone={d.trend > 0 ? "warn" : "ok"} />
        <Stat label="السائل" value={`${d.coolant}%`} tone={d.coolant < 20 ? "danger" : undefined} />
        <Stat label="التدفق" value={`${Math.round(d.flow * 100)}%`} />
      </div>
      <Switch
        label="المضخة"
        hint={d.pump === "fault" ? "معطلة" : !d.powered ? "لا طاقة" : d.isolated ? "الخط معزول" : undefined}
        tone={d.pump === "fault" ? "danger" : !d.powered || d.isolated ? "warn" : undefined}
        on={d.pump === "on"}
        onChange={(on) => void send({ type: "pump", on })}
      />
      <Slider label="القوة" value={d.power} min={0} max={100} step={10} unit="%" onCommit={(value) => void send({ type: "pumpPower", value })} />
      <div className="oc-grid2">
        <Switch label="صمام المفاعل" on={d.loops.reactor} onChange={(open) => void send({ type: "loop", loop: "reactor", open })} />
        <Switch label="صمام المولد" on={d.loops.gen} onChange={(open) => void send({ type: "loop", loop: "gen", open })} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Security                                                            */
/* ------------------------------------------------------------------ */

const DOOR_LIST: DoorId[] = ["gate", "store", "A", "B", "C"];

function Doors({ d, send }: { d: DoorsPanel; send: Send }) {
  const [codeFor, setCodeFor] = useState<DoorId | null>(null);
  const toggle = async (door: DoorId, open: boolean) => {
    if (d.doors[door].locked) {
      setCodeFor(door);
      return;
    }
    await send({ type: "door", door, open });
  };
  return (
    <div className="oc-panel">
      {!d.up && <p className="oc-flag is-danger">⚠ {d.down}</p>}
      {d.lockdown && (
        <div className="oc-box is-danger">
          <p className="oc-flag is-danger">🔒 إغلاق طارئ</p>
          <CodeInput label="رمز الرفع" disabled={d.keypadWait > 0} onSubmit={(code) => send({ type: "override", code })} />
        </div>
      )}
      {d.keypadWait > 0 && <p className="oc-flag is-warn">الإدخال مقفل {d.keypadWait}ث</p>}
      <div className="oc-list">
        {DOOR_LIST.map((id) => {
          const door = d.doors[id];
          return (
            <div key={id} className="oc-door">
              <Switch
                label={`${door.locked ? "🔒 " : ""}${DOOR_NAMES[id]}`}
                hint={door.lost ? "مفصول" : undefined}
                on={door.open}
                tone={door.lost ? "danger" : undefined}
                onChange={(open) => void toggle(id, open)}
              />
              {codeFor === id && door.locked && (
                <CodeInput
                  label="رمز التحقق"
                  disabled={d.keypadWait > 0}
                  onSubmit={async (code) => {
                    const ok = await send({ type: "door", door: id, open: !door.open, code });
                    if (ok) setCodeFor(null);
                    return ok;
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const VALVE_LIST: ValveId[] = ["coolant", "fuel", "A", "B", "C"];

function Valves({ d, send }: { d: ValvesPanel; send: Send }) {
  const [purge, setPurge] = useState<SectionId | null>(null);
  return (
    <div className="oc-panel">
      {d.lockdown && <p className="oc-flag is-danger">🔒 إغلاق طارئ</p>}
      <div className="oc-grid2">
        {VALVE_LIST.map((id) => (
          <Switch
            key={id}
            label={VALVE_NAMES[id]}
            hint={d.valves[id].lost ? "مفصول" : undefined}
            tone={d.valves[id].lost ? "danger" : undefined}
            on={d.valves[id].open}
            onChange={(open) => void send({ type: "valve", valve: id, open })}
          />
        ))}
      </div>
      <p className="oc-section-label">تفريغ طارئ</p>
      <div className="oc-row">
        {SECTIONS.map((s) =>
          purge === s ? (
            <button
              key={s}
              type="button"
              className="oc-btn oc-btn-danger"
              onClick={async () => {
                await send({ type: "purge", section: s });
                setPurge(null);
              }}
            >
              تأكيد {s}
            </button>
          ) : (
            <button key={s} type="button" className="oc-btn" disabled={d.valves[s].lost} onClick={() => setPurge(s)}>
              {s}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Comms                                                               */
/* ------------------------------------------------------------------ */

function Comms({ d, send }: { d: CommsPanel; send: Send }) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  return (
    <div className="oc-panel">
      <p className={`oc-flag ${d.linked ? "is-ok" : "is-danger"}`}>{d.linked ? "📡 متصل" : d.up ? "📡 لا إشارة" : "📡 بلا طاقة"}</p>
      <div className="oc-stepper is-wide">
        {/* RTL row: "+" on the right, matching the slider, which grows to the right. */}
        <button type="button" className="oc-btn" aria-label="تردد أعلى" onClick={() => void send({ type: "tune", freq: Math.min(99, d.freq + 1) })}>
          +
        </button>
        <Slider label="التردد" value={d.freq} min={0} max={99} step={1} onCommit={(freq) => void send({ type: "tune", freq })} />
        <button type="button" className="oc-btn" aria-label="تردد أقل" onClick={() => void send({ type: "tune", freq: Math.max(0, d.freq - 1) })}>
          −
        </button>
      </div>
      {d.handshake && (
        <div className="oc-box is-warn">
          <p className="oc-flag is-warn">القيادة تطلب رمز التأكيد</p>
          <CodeInput label="رمز التأكيد" disabled={!d.linked} onSubmit={(code) => send({ type: "handshake", code })} />
        </div>
      )}
      {d.confirmed && <p className="oc-flag is-ok">✓ تم التأكيد</p>}
      <ul className="oc-messages">
        {d.messages.length === 0 && <li className="oc-muted">لا رسائل</li>}
        {d.messages.map((m) => (
          <li key={m.id} className="oc-msg">
            <div className="oc-msg-head">
              <b>{m.label}</b>
              <span className="oc-sig" dir="ltr">
                {m.sig}
              </span>
            </div>
            {m.text ? (
              <p>{m.text}</p>
            ) : (
              <>
                <p className="oc-digits" dir="ltr">
                  {m.cipher ? `🔐 ${m.digits}` : m.digits}
                </p>
                {m.decoded && (
                  <p className="oc-digits is-decoded" dir="ltr">
                    {m.decoded.digits} <small>k{m.decoded.key}</small>
                  </p>
                )}
                {m.cipher && (
                  <form
                    className="oc-code-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const key = Number(keys[m.id]);
                      if (Number.isInteger(key)) void send({ type: "decrypt", message: m.id, key });
                    }}
                  >
                    <input
                      className="oc-input is-key"
                      inputMode="numeric"
                      dir="ltr"
                      maxLength={1}
                      placeholder="المفتاح"
                      aria-label="المفتاح"
                      value={keys[m.id] ?? ""}
                      onChange={(e) => setKeys({ ...keys, [m.id]: e.target.value.replace(/\D/g, "").slice(0, 1) })}
                    />
                    <button type="submit" className="oc-btn">
                      فك
                    </button>
                  </form>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Monitor                                                             */
/* ------------------------------------------------------------------ */

function Monitor({ d, send }: { d: MonitorPanel; send: Send }) {
  return (
    <div className="oc-panel">
      {d.warnings.length > 0 && (
        <ul className="oc-warnings">
          {d.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <div className="oc-grid3">
        <Stat label="المفاعل" value={`${Math.round(d.reactor.temp)}° ${trendText(d.reactor.trend, "")}`} tone={d.reactor.trend > 0 ? "warn" : undefined} />
        <Stat label="الأكسجين" value={`${Math.round(d.o2.pct)}% ${trendText(d.o2.trend, "")}`} tone={d.o2.trend < 0 ? "warn" : undefined} />
        <Stat label="م. احتياطي" value={`${d.backupHeat}°`} tone={d.backupHeat >= 85 ? "danger" : d.backupHeat >= 65 ? "warn" : undefined} />
        <Stat label="السائل" value={`${d.coolant}%`} tone={d.coolant < 20 ? "danger" : undefined} />
        <Stat label="التدفق" value={`${Math.round(d.flow * 100)}%`} />
        <Stat label="ذروة الإشارة" value={`${d.peak}`} />
      </div>
      <div className="oc-grid3">
        {SECTIONS.map((s) => (
          <div key={s} className={`oc-sensor ${d.pressure[s] < 90 ? "is-warn" : ""}`}>
            <span>ضغط {s}</span>
            <b dir="ltr">{d.pressure[s]}</b>
            <button type="button" className="oc-btn is-small" disabled={d.calibrating !== null} onClick={() => void send({ type: "calibrate", section: s })}>
              {d.calibrating === s ? "…" : "معايرة"}
            </button>
          </div>
        ))}
      </div>
      <div className="oc-grid3">
        <Stat label="توقيع القيادة" value={d.sig} />
        {d.key !== null && <Stat label="المفتاح" value={`${d.key}`} />}
        {d.handshake && <Stat label="رمز التأكيد" value={d.handshake} tone="warn" />}
        {d.codeHalf && <Stat label="نصف الرمز" value={`··${d.codeHalf}`} tone="warn" />}
      </div>
      {d.diagnoses.length > 0 && (
        <ul className="oc-diag">
          {d.diagnoses.map((x) => (
            <li key={x.device}>
              <b dir="ltr">{x.code}</b> {x.name} ← {x.fix}
            </li>
          ))}
        </ul>
      )}
      <ol className="oc-log">
        {d.log.map((e, i) => (
          <li key={`${e.t}-${i}`}>
            <span dir="ltr">{e.t}</span> {e.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */

const PART_NAMES = { coupling: "قارنة", bearing: "محمل", filter: "فلتر", relay: "مرحّل", seal: "ختم" } as const;

function Maint({ d, send }: { d: MaintPanel; send: Send }) {
  const [proc, setProc] = useState<Record<string, Procedure>>({});
  return (
    <div className="oc-panel">
      {d.job && (
        <div className="oc-box is-ok">
          <p className="oc-flag is-ok">🔧 {d.job.name}</p>
          <span className="oc-bar is-job" aria-label={`باقي ${d.job.left}ث`}>
            <span style={{ transform: `scaleX(${1 - d.job.left / d.job.total})` }} />
          </span>
        </div>
      )}
      {d.faults.length === 0 && !d.job && <p className="oc-muted">✓ لا أعطال</p>}
      {d.faults.map((f) => (
        <div key={f.device} className="oc-repair">
          <div className="oc-msg-head">
            <b>{f.name}</b>
            <span className="oc-sig" dir="ltr">
              {f.code}
            </span>
          </div>
          {f.fix && <p className="oc-muted">{f.fix}</p>}
          <div className="oc-code-form">
            <select
              className="oc-input"
              aria-label="الإجراء"
              value={proc[f.device] ?? ""}
              onChange={(e) => setProc({ ...proc, [f.device]: e.target.value as Procedure })}
            >
              <option value="" disabled>
                الإجراء
              </option>
              {d.procedures.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="oc-btn oc-btn-primary"
              disabled={!proc[f.device] || d.job !== null}
              onClick={() => void send({ type: "repair", device: f.device, procedure: proc[f.device] })}
            >
              نفّذ
            </button>
          </div>
        </div>
      ))}
      {d.scrubber === "stopped" && (
        <button type="button" className={`oc-btn oc-btn-lg ${d.scrubberWindow !== null ? "oc-btn-primary" : ""}`} onClick={() => void send({ type: "scrubber" })}>
          تشغيل المنقّي {d.scrubberWindow !== null && <span dir="ltr">{d.scrubberWindow}ث</span>}
        </button>
      )}
      {d.coolant < 60 && (
        <button type="button" className="oc-btn" onClick={() => void send({ type: "refill" })}>
          تعبئة سائل التبريد <span dir="ltr">{d.coolant}%</span>
        </button>
      )}
      <p className="oc-section-label">{d.store ? "القطع" : "🔒 المستودع مغلق"}</p>
      <div className="oc-parts">
        {(Object.keys(PART_NAMES) as (keyof typeof PART_NAMES)[]).map((p) => (
          <span key={p} className={d.parts[p] === 0 ? "is-out" : ""}>
            {PART_NAMES[p]} <b dir="ltr">{d.parts[p]}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
