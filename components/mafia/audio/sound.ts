/**
 * Atmosphere and sound effects for the TV, synthesized with the Web Audio
 * API: no audio files to load, license or lose. This is the "theme" channel
 * (صوت الثيم): everything goes through one master gain (its volume / the
 * global mute) and a limiter, so nothing clips. The narrator is a separate
 * channel (narrator.ts). Nothing here plays on phones.
 *
 * The AudioContext is created on the first user gesture (browser autoplay
 * rules); until then every call is a silent no-op.
 */

import { DUCK_LEVEL } from "./settings";

export type Ambience = "off" | "lobby" | "night" | "day" | "crimson" | "gold";

export type Sfx =
  | "introDark"
  | "introHit"
  | "count"
  | "nightfall"
  | "phase"
  | "dawn"
  | "tick"
  | "alarm"
  | "suspense"
  | "sting"
  | "saved"
  | "quiet"
  | "mafiaWin"
  | "cityWin";

type Layer = "wind" | "rain" | "drone";

/** The ambience bus level, before ducking. */
const AMBIENCE_LEVEL = 0.55;

const MIX: Record<Ambience, Record<Layer, number>> = {
  off: { wind: 0, rain: 0, drone: 0 },
  lobby: { wind: 0.22, rain: 0.1, drone: 0.16 },
  night: { wind: 0.32, rain: 0.18, drone: 0.3 },
  day: { wind: 0.14, rain: 0, drone: 0.07 },
  crimson: { wind: 0.2, rain: 0.06, drone: 0.42 },
  gold: { wind: 0.1, rain: 0, drone: 0.05 },
};

export class MafiaSound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambienceBus!: GainNode;
  private fxBus!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private layers: Partial<Record<Layer, GainNode>> = {};
  private sources: AudioScheduledSourceNode[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private ambience: Ambience = "off";
  private volume = 0.2;
  private muted = false;
  private ducked = false;

  get ready(): boolean {
    return this.ctx?.state === "running";
  }

  /** Call from a user gesture (click / key). Safe to call often. */
  async unlock(): Promise<boolean> {
    try {
      if (!this.ctx) this.build();
      if (this.ctx && this.ctx.state !== "running") await this.ctx.resume();
    } catch {
      // No Web Audio: the game runs silent.
    }
    return this.ready;
  }

  private build() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    // A gentle limiter at the end: stacked layers and stings never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(limiter);
    this.applyVolume();

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);

    this.ambienceBus = ctx.createGain();
    this.ambienceBus.gain.value = AMBIENCE_LEVEL * (this.ducked ? DUCK_LEVEL : 1);
    this.ambienceBus.connect(this.master);
    this.fxBus = ctx.createGain();
    this.fxBus.gain.value = 0.9;
    this.fxBus.connect(this.master);
    this.fxBus.connect(this.reverb);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.buildLayers();
    this.setAmbience(this.ambience, true);
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  private buildLayers() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    // Wind: low rumbling noise with a slowly wandering filter.
    const wind = ctx.createGain();
    wind.gain.value = 0;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 380;
    windFilter.Q.value = 0.8;
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.06;
    const windDepth = ctx.createGain();
    windDepth.gain.value = 180;
    windLfo.connect(windDepth).connect(windFilter.frequency);
    const windSrc = this.noiseSource();
    windSrc.connect(windFilter).connect(wind).connect(this.ambienceBus);

    // Rain: soft hiss.
    const rain = ctx.createGain();
    rain.gain.value = 0;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1100;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 5200;
    const rainSrc = this.noiseSource();
    rainSrc.loopStart = 1.3;
    rainSrc.connect(hp).connect(lp).connect(rain).connect(this.ambienceBus);

    // Drone: two detuned low saws, darkly filtered, breathing slowly.
    const drone = ctx.createGain();
    drone.gain.value = 0;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 150;
    const droneOut = ctx.createGain();
    droneOut.gain.value = 0.5;
    const breath = ctx.createOscillator();
    breath.frequency.value = 0.08;
    const breathDepth = ctx.createGain();
    breathDepth.gain.value = 0.18;
    breath.connect(breathDepth).connect(droneOut.gain);
    const oscs = [55, 55.35, 41.2].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? "sine" : "sawtooth";
      o.frequency.value = f;
      o.connect(droneFilter);
      return o;
    });
    droneFilter.connect(droneOut).connect(drone).connect(this.ambienceBus);

    for (const s of [windLfo, windSrc, rainSrc, breath, ...oscs]) s.start(t);
    this.sources.push(windLfo, windSrc, rainSrc, breath, ...oscs);
    this.layers = { wind, rain, drone };
  }

  /** The theme channel's level (0–1) and the global mute. Applies at once, smoothly. */
  setVolume(volume: number, muted: boolean) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.muted = muted;
    this.applyVolume();
  }

  private applyVolume() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.08);
  }

  /**
   * While the narrator speaks, the ambience drops to DUCK_LEVEL of its level
   * (quickly), and comes back slowly once the line ends.
   */
  duck(on: boolean) {
    if (on === this.ducked) return;
    this.ducked = on;
    if (!this.ctx) return;
    this.ambienceBus.gain.setTargetAtTime(AMBIENCE_LEVEL * (on ? DUCK_LEVEL : 1), this.ctx.currentTime, on ? 0.12 : 0.6);
  }

  setAmbience(a: Ambience, immediate = false) {
    this.ambience = a;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const layer of Object.keys(this.layers) as Layer[]) {
      this.layers[layer]!.gain.setTargetAtTime(MIX[a][layer], t, immediate ? 0.05 : 1.6);
    }
  }

  /** A slow, quiet heartbeat under the night phases. */
  heartbeat(on: boolean) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (!on) return;
    this.heartbeatTimer = setInterval(() => {
      if (!this.ready) return;
      const t = this.ctx!.currentTime;
      this.thump(t, 0.5);
      this.thump(t + 0.24, 0.32);
    }, 1250);
  }

  private thump(t: number, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(62, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level * 0.55, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.ambienceBus);
    o.start(t);
    o.stop(t + 0.3);
  }

  /* ---------------------------------------------------------------- */
  /* Effects                                                           */
  /* ---------------------------------------------------------------- */

  private tone(opts: {
    freq: number;
    to?: number;
    type?: OscillatorType;
    at?: number;
    attack?: number;
    hold?: number;
    release: number;
    level: number;
    filter?: number;
    dry?: boolean;
  }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.at ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? "sine";
    o.frequency.setValueAtTime(opts.freq, t);
    const end = t + (opts.attack ?? 0.01) + (opts.hold ?? 0) + opts.release;
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.level, t + (opts.attack ?? 0.01));
    g.gain.setValueAtTime(opts.level, t + (opts.attack ?? 0.01) + (opts.hold ?? 0));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    let node: AudioNode = o;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = opts.filter;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(opts.dry ? this.master : this.fxBus);
    o.start(t);
    o.stop(end + 0.05);
  }

  private noiseHit(opts: { at?: number; from: number; to: number; attack: number; release: number; level: number; type?: BiquadFilterType }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.at ?? 0);
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? "lowpass";
    f.Q.value = opts.type === "bandpass" ? 2 : 0.7;
    f.frequency.setValueAtTime(opts.from, t);
    f.frequency.exponentialRampToValueAtTime(opts.to, t + opts.attack + opts.release);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.level, t + opts.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.attack + opts.release);
    src.connect(f).connect(g).connect(this.fxBus);
    src.start(t);
    src.stop(t + opts.attack + opts.release + 0.05);
  }

  /** A struck bell (FM synthesis). */
  private bell(freq: number, at: number, level: number, decay = 2.6) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const carrier = ctx.createOscillator();
    carrier.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * 3.51;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * 2.2, t);
    modGain.gain.exponentialRampToValueAtTime(1, t + decay);
    mod.connect(modGain).connect(carrier.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    carrier.connect(g).connect(this.fxBus);
    carrier.start(t);
    mod.start(t);
    carrier.stop(t + decay + 0.1);
    mod.stop(t + decay + 0.1);
  }

  play(name: Sfx) {
    if (!this.ready) return;
    switch (name) {
      // Opening sequence: the lights go out (a slow, low swell under the fog)…
      case "introDark":
        this.tone({ freq: 41.2, attack: 2.4, hold: 0.6, release: 2.5, level: 0.32, dry: true });
        this.tone({ freq: 82.4, to: 61.7, type: "sawtooth", attack: 2.6, release: 2.4, level: 0.05, filter: 260 });
        this.noiseHit({ from: 160, to: 900, attack: 2.6, release: 0.6, level: 0.09 });
        break;
      // …the crimson light hits (a deep boom, a dark cluster and a distant bell)…
      case "introHit":
        this.tone({ freq: 70, to: 28, attack: 0.005, release: 1.6, level: 0.55, dry: true });
        this.noiseHit({ from: 1200, to: 80, attack: 0.005, release: 1.3, level: 0.28 });
        [55, 58.27, 82.41, 87.31].forEach((f) =>
          this.tone({ freq: f, type: "sawtooth", attack: 0.4, hold: 1.4, release: 2.4, level: 0.05, filter: 480 }),
        );
        this.bell(110, 0.15, 0.08, 4.5);
        break;
      // …and each beat of ٣ ٢ ١ (a muffled drum).
      case "count":
        this.tone({ freq: 96, to: 52, attack: 0.004, release: 0.55, level: 0.45, dry: true });
        this.noiseHit({ from: 700, to: 120, attack: 0.003, release: 0.25, level: 0.16 });
        break;
      case "nightfall":
        this.tone({ freq: 196, to: 49, attack: 0.6, hold: 0.4, release: 3, level: 0.22 });
        this.tone({ freq: 98, to: 41, type: "sawtooth", attack: 0.8, release: 3.5, level: 0.08, filter: 300 });
        this.noiseHit({ from: 2400, to: 160, attack: 1.2, release: 2.4, level: 0.12 });
        break;
      case "phase":
        this.tone({ freq: 73.4, attack: 0.02, release: 3.4, level: 0.26 });
        this.tone({ freq: 146.8, attack: 0.02, release: 2.2, level: 0.08 });
        this.bell(220, 0.02, 0.05, 3);
        break;
      case "dawn":
        [220, 277.18, 329.63, 440].forEach((f, i) =>
          this.tone({ freq: f * (1 + (i - 1.5) * 0.002), attack: 2.2, hold: 0.8, release: 3.2, level: 0.07, type: i === 3 ? "triangle" : "sine" }),
        );
        this.tone({ freq: 1760, attack: 2.5, release: 2.5, level: 0.012, type: "triangle", at: 0.6 });
        this.noiseHit({ from: 400, to: 4000, attack: 2.5, release: 1.5, level: 0.05, type: "bandpass" });
        break;
      case "tick":
        this.noiseHit({ from: 4200, to: 3800, attack: 0.002, release: 0.04, level: 0.18, type: "highpass" });
        this.tone({ freq: 1900, attack: 0.002, release: 0.05, level: 0.04, dry: true });
        break;
      case "alarm":
        this.bell(523.25, 0, 0.16);
        this.bell(523.25, 0.55, 0.13);
        this.bell(392, 1.1, 0.12, 3.4);
        break;
      case "suspense":
        this.noiseHit({ from: 180, to: 2600, attack: 2.4, release: 0.25, level: 0.1, type: "bandpass" });
        this.tone({ freq: 55, to: 82, type: "sawtooth", attack: 2.3, release: 0.3, level: 0.08, filter: 420 });
        break;
      case "sting":
        this.tone({ freq: 90, to: 30, attack: 0.005, release: 1.1, level: 0.5, dry: true });
        this.noiseHit({ from: 900, to: 90, attack: 0.005, release: 0.9, level: 0.3 });
        [73.42, 77.78, 110, 116.54].forEach((f) =>
          this.tone({ freq: f, type: "sawtooth", attack: 0.03, hold: 0.3, release: 3.6, level: 0.05, filter: 650 }),
        );
        break;
      case "saved":
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone({ freq: f, at: i * 0.14, attack: 0.01, release: 2.2, level: 0.07 }));
        this.tone({ freq: 261.63, attack: 0.8, hold: 0.5, release: 2.5, level: 0.06, type: "triangle" });
        break;
      case "quiet":
        this.bell(164.81, 0, 0.09, 4);
        this.tone({ freq: 82.4, attack: 1, release: 3, level: 0.06 });
        break;
      case "mafiaWin":
        [65.41, 77.78, 98, 130.81].forEach((f) =>
          this.tone({ freq: f, type: "sawtooth", attack: 2.5, hold: 2, release: 4, level: 0.06, filter: 520 }),
        );
        this.bell(130.81, 0.3, 0.14, 4);
        this.bell(130.81, 2.1, 0.12, 4);
        this.bell(123.47, 3.9, 0.12, 5);
        this.tone({ freq: 45, to: 32, attack: 0.01, release: 2, level: 0.4, dry: true });
        break;
      case "cityWin":
        [261.63, 329.63, 392, 523.25].forEach((f, i) =>
          this.tone({ freq: f, at: i * 0.18, type: "triangle", attack: 1.6, hold: 1.8, release: 3.6, level: 0.06 }),
        );
        [1046.5, 1318.5].forEach((f, i) => this.tone({ freq: f, at: 1.2 + i * 0.4, attack: 1.2, release: 3, level: 0.012 }));
        this.bell(523.25, 0.1, 0.06, 4);
        break;
    }
  }

  dispose() {
    this.heartbeat(false);
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.sources = [];
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
