import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MafiaSound } from "@/components/mafia/audio/sound";
import { Narrator } from "@/components/mafia/audio/narrator";
import { AUDIO_DEFAULTS, DUCK_LEVEL, parseAudioSettings } from "@/components/mafia/audio/settings";
import { cue } from "@/lib/mafia/narration";

// The TV's two sound channels (theme / narrator), on a fake Web Audio graph
// and a fake <audio> element.

/* ------------------------------------------------------------------ */
/* A minimal fake AudioContext: records where each gain is heading.    */
/* ------------------------------------------------------------------ */

interface Param {
  value: number;
  target: number;
  timeConstant: number | null;
}

function param(): Param & Record<string, unknown> {
  const p = {
    value: 1,
    target: 1,
    timeConstant: null as number | null,
    setTargetAtTime(v: number, _t: number, tc: number) {
      p.target = v;
      p.timeConstant = tc;
    },
    setValueAtTime(v: number) {
      p.value = v;
      p.target = v;
    },
    exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {},
  };
  return p;
}

const PARAMS = new Set(["gain", "frequency", "Q", "detune", "threshold", "knee", "ratio", "attack", "release"]);

function node(): Record<string, unknown> {
  const n: Record<string, unknown> = { connections: [] as unknown[] };
  return new Proxy(n, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === "connect") return (to: unknown) => ((t.connections as unknown[]).push(to), to);
      if (PARAMS.has(k)) return (t[k] = param());
      return (t[k] = () => {});
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
}

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  sampleRate = 8000;
  destination = node();
  created: Record<string, unknown>[] = [];
  resume = async () => {};
  close = async () => {};
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (c: number) => data[c] };
  }
}
for (const m of ["createGain", "createConvolver", "createBiquadFilter", "createOscillator", "createBufferSource", "createDynamicsCompressor"]) {
  (FakeAudioContext.prototype as unknown as Record<string, unknown>)[m] = function (this: FakeAudioContext) {
    const n = node();
    n.kind = m;
    this.created.push(n);
    return n;
  };
}

const g = globalThis as unknown as { window?: unknown };
beforeEach(() => {
  g.window = { AudioContext: FakeAudioContext };
});
afterEach(() => {
  delete g.window;
});

type Internals = { master: { gain: Param }; ambienceBus: { gain: Param }; fxBus: { gain: Param }; ctx: FakeAudioContext };
async function liveSound() {
  const sound = new MafiaSound();
  await sound.unlock();
  return { sound, io: sound as unknown as Internals };
}

describe("theme channel (صوت الثيم)", () => {
  it("defaults to 20% and follows its slider at once", async () => {
    const { sound, io } = await liveSound();
    sound.setVolume(AUDIO_DEFAULTS.themeVolume, false);
    expect(io.master.gain.target).toBeCloseTo(0.2);
    sound.setVolume(0.65, false);
    expect(io.master.gain.target).toBeCloseTo(0.65);
    sound.setVolume(0, false);
    expect(io.master.gain.target).toBe(0);
    // Out-of-range values are clamped.
    sound.setVolume(4, false);
    expect(io.master.gain.target).toBe(1);
  });

  it("the mute silences it without losing the level", async () => {
    const { sound, io } = await liveSound();
    sound.setVolume(0.4, true);
    expect(io.master.gain.target).toBe(0);
    sound.setVolume(0.4, false);
    expect(io.master.gain.target).toBeCloseTo(0.4);
  });

  it("ends in a limiter, so stacked layers never clip", async () => {
    const { io } = await liveSound();
    const limiter = io.ctx.created.find((n) => n.kind === "createDynamicsCompressor")!;
    expect(limiter.connections).toContain(io.ctx.destination);
    expect((io.master as unknown as { connections: unknown[] }).connections).toContain(limiter);
  });

  it("ducks the ambience to about 25% while the narrator speaks, and brings it back slowly", async () => {
    const { sound, io } = await liveSound();
    sound.setVolume(0.5, false);
    const full = io.ambienceBus.gain.value;
    sound.duck(true);
    expect(io.ambienceBus.gain.target).toBeCloseTo(full * DUCK_LEVEL);
    expect(DUCK_LEVEL).toBe(0.25);
    const down = io.ambienceBus.gain.timeConstant!;
    // Effects and the theme level itself are untouched.
    expect(io.master.gain.target).toBeCloseTo(0.5);
    sound.duck(false);
    expect(io.ambienceBus.gain.target).toBeCloseTo(full);
    expect(io.ambienceBus.gain.timeConstant!).toBeGreaterThan(down); // smooth restore
  });

  it("a duck that starts before the audio is unlocked still applies", async () => {
    const sound = new MafiaSound();
    sound.duck(true);
    await sound.unlock();
    const io = sound as unknown as Internals;
    expect(io.ambienceBus.gain.value).toBeCloseTo(0.55 * DUCK_LEVEL);
  });
});

/* ------------------------------------------------------------------ */
/* Narrator                                                            */
/* ------------------------------------------------------------------ */

class FakeAudioElement {
  volume = 1;
  paused = true;
  src = "";
  playing: string[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play() {
    this.paused = false;
    this.playing.push(this.src);
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  end() {
    this.paused = true;
    this.onended?.();
  }
}

function narratorWith(files: Record<string, string>) {
  const speaking: boolean[] = [];
  const n = new Narrator((on) => speaking.push(on));
  const el = new FakeAudioElement();
  Object.assign(n as unknown as Record<string, unknown>, { player: el, files });
  return { n, el, speaking };
}

describe("narrator channel (صوت الراوي)", () => {
  it("defaults to 100% and follows its own slider, also mid-line", async () => {
    const { n, el } = narratorWith({ intro: "/v/intro.ogg" });
    n.setVolume(AUDIO_DEFAULTS.narratorVolume, false);
    void n.speak(cue("intro"));
    await Promise.resolve();
    expect(el.volume).toBe(1);
    n.setVolume(0.35, false);
    expect(el.volume).toBeCloseTo(0.35);
  });

  it("the mute silences it without losing the level", () => {
    const { n, el } = narratorWith({});
    n.setVolume(0.7, true);
    expect(el.volume).toBe(0);
    n.setVolume(0.7, false);
    expect(el.volume).toBeCloseTo(0.7);
  });

  it("never plays two lines at once, and tells the theme when to duck and restore", async () => {
    const { n, el, speaking } = narratorWith({ mafia: "/v/mafia.ogg", detective: "/v/detective.ogg" });
    n.setVolume(1, false);
    const first = n.speak(cue("mafia"));
    await Promise.resolve();
    expect(el.playing).toEqual(["/v/mafia.ogg"]);
    expect(speaking.at(-1)).toBe(true);
    // A new line stops the old one before it starts.
    void n.speak(cue("detective"));
    await Promise.resolve();
    expect(el.playing).toEqual(["/v/mafia.ogg", "/v/detective.ogg"]);
    expect(el.src).toBe("/v/detective.ogg");
    await first; // the cut-off line is settled, not left hanging
    expect(speaking.at(-1)).toBe(true); // …while the new one plays
    el.end();
    await Promise.resolve();
    expect(speaking.at(-1)).toBe(false);
  });

  it("is silent while muted", async () => {
    const { n, el } = narratorWith({ intro: "/v/intro.ogg" });
    n.setVolume(1, true);
    await n.speak(cue("intro"));
    expect(el.playing).toEqual([]);
  });
});

describe("saved settings", () => {
  it("defaults: theme 20%, narrator 100%, not muted", () => {
    expect(parseAudioSettings(null)).toEqual({ themeVolume: 0.2, narratorVolume: 1, muted: false, voice: "auto" });
    expect(parseAudioSettings("not json")).toEqual(AUDIO_DEFAULTS);
  });

  it("keeps both levels and the mute independently", () => {
    const saved = JSON.stringify({ themeVolume: 0.55, narratorVolume: 0.8, muted: true, voice: "x" });
    expect(parseAudioSettings(saved)).toEqual({ themeVolume: 0.55, narratorVolume: 0.8, muted: true, voice: "x" });
  });

  it("an older save (one shared volume) gets the new, quieter theme default; bad values are clamped", () => {
    expect(parseAudioSettings(JSON.stringify({ volume: 0.8, muted: false }))).toMatchObject({ themeVolume: 0.2, narratorVolume: 1 });
    expect(parseAudioSettings(JSON.stringify({ themeVolume: 7, narratorVolume: -1 }))).toMatchObject({ themeVolume: 1, narratorVolume: 0 });
  });
});
