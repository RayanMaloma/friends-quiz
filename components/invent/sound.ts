"use client";

/**
 * Small synthesized cues for the host screen (no audio files to load).
 * Browsers only allow sound after a user gesture: `unlock()` is called from
 * a click (start, resume…); until then every cue is silently skipped.
 * Mute and volume are remembered on this device.
 */

export type Cue = "start" | "submit" | "tick" | "close" | "reveal" | "points" | "winner";

const KEY = "fq:invent:audio";

export interface SoundSettings {
  muted: boolean;
  volume: number;
}

export function readSoundSettings(): SoundSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    if (raw && typeof raw === "object") {
      const volume = typeof raw.volume === "number" && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : 0.6;
      return { muted: raw.muted === true, volume };
    }
  } catch {
    // private mode
  }
  return { muted: false, volume: 0.6 };
}

export function writeSoundSettings(s: SoundSettings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

type Note = { f: number; t: number; d: number; type?: OscillatorType; g?: number };

const CUES: Record<Cue, Note[]> = {
  start: [
    { f: 392, t: 0, d: 0.12 },
    { f: 523, t: 0.11, d: 0.12 },
    { f: 659, t: 0.22, d: 0.12 },
    { f: 784, t: 0.33, d: 0.3 },
  ],
  submit: [{ f: 880, t: 0, d: 0.08, type: "triangle", g: 0.5 }, { f: 1320, t: 0.06, d: 0.1, type: "triangle", g: 0.4 }],
  tick: [{ f: 1046, t: 0, d: 0.05, type: "square", g: 0.18 }],
  close: [{ f: 660, t: 0, d: 0.12, type: "triangle" }, { f: 440, t: 0.1, d: 0.22, type: "triangle" }],
  reveal: [
    { f: 523, t: 0, d: 0.09, type: "triangle" },
    { f: 659, t: 0.07, d: 0.09, type: "triangle" },
    { f: 784, t: 0.14, d: 0.09, type: "triangle" },
    { f: 1046, t: 0.21, d: 0.35, type: "triangle" },
  ],
  points: [{ f: 988, t: 0, d: 0.07, type: "square", g: 0.2 }, { f: 1318, t: 0.07, d: 0.16, type: "square", g: 0.2 }],
  winner: [
    { f: 523, t: 0, d: 0.16 },
    { f: 523, t: 0.17, d: 0.1 },
    { f: 523, t: 0.29, d: 0.1 },
    { f: 698, t: 0.42, d: 0.5 },
    { f: 880, t: 0.42, d: 0.5, g: 0.5 },
  ],
};

export class InventSound {
  private ctx: AudioContext | null = null;
  settings: SoundSettings = { muted: false, volume: 0.6 };

  async unlock() {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx ??= new Ctor();
      if (this.ctx.state === "suspended") await this.ctx.resume();
    } catch {
      // no audio
    }
  }

  play(cue: Cue) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || this.settings.muted || this.settings.volume <= 0) return;
    const start = ctx.currentTime + 0.01;
    const master = ctx.createGain();
    master.gain.value = this.settings.volume * 0.25;
    master.connect(ctx.destination);
    for (const n of CUES[cue]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.value = n.f;
      const peak = n.g ?? 1;
      gain.gain.setValueAtTime(0.0001, start + n.t);
      gain.gain.exponentialRampToValueAtTime(peak, start + n.t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.t + n.d);
      osc.connect(gain).connect(master);
      osc.start(start + n.t);
      osc.stop(start + n.t + n.d + 0.05);
    }
  }
}
