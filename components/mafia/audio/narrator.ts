/**
 * The TV's narrator: plays the recorded lines listed in
 * public/mafia/voice/manifest.json (line key → audio file). A line without a
 * recording is shown as a subtitle only, and never interrupts a recording.
 *
 * Every recording plays through one shared <audio> element, and a new one
 * stops the previous one: lines never overlap. Playback never gates the
 * game: phases follow the server clock. Volume and mute: settings.ts.
 */
import type { Cue } from "@/lib/mafia/narration";

/** A very short silent WAV, played from the first click so later lines may play. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export class Narrator {
  private files: Record<string, string> = {};
  private player: HTMLAudioElement | null = null;
  private volume = 1;
  private muted = false;
  /** Bumped by every speak/stop: a line still waiting when this changes is dropped. */
  private seq = 0;
  private primed = false;
  /** A line is playing now, and who waits for it to end. */
  private busy = false;
  private idle: (() => void)[] = [];
  /** Settles the line that is playing, when a newer line (or stop) cuts it off. */
  private cut: (() => void) | null = null;
  /** Bumped by every speak request: a line still waiting its turn is dropped when a newer one arrives. */
  private requests = 0;
  private listeners = new Set<() => void>();
  private onSpeaking: (on: boolean) => void;
  /** Why the last line was silent, for the settings panel. */
  lastError: string | null = null;

  constructor(onSpeaking: (on: boolean) => void) {
    this.onSpeaking = onSpeaking;
  }

  private setSpeaking(on: boolean) {
    this.busy = on;
    if (!on) for (const fn of this.idle.splice(0)) fn();
    this.onSpeaking(on);
  }

  /** Loads the recorded-lines manifest. */
  async init() {
    if (typeof window === "undefined") return;
    if (!this.player) {
      this.player = new Audio();
      this.player.preload = "auto";
    }
    await this.loadManifest();
    this.emit();
  }

  private async loadManifest() {
    try {
      const res = await fetch("/mafia/voice/manifest.json", { cache: "no-cache" });
      const json = res.ok ? await res.json() : null;
      const lines = json && typeof json === "object" && json.lines && typeof json.lines === "object" ? json.lines : {};
      for (const [key, file] of Object.entries(lines)) {
        if (typeof file !== "string" || !/^[\w./-]+$/.test(file)) continue;
        const url = `/mafia/voice/${file.replace(/^\/+/, "")}`;
        // Only keep files that exist.
        const head = await fetch(url, { method: "HEAD" }).catch(() => null);
        if (head?.ok) this.files[key] = url;
      }
    } catch {
      // No manifest: no recorded lines.
    }
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  get recordedCount() {
    return Object.keys(this.files).length;
  }

  /** Whether this line has a recording. */
  has(key: string): boolean {
    return key in this.files;
  }

  /** The narrator's level (0–1) and the mute. A line that is playing follows at once. */
  setVolume(volume: number, muted: boolean) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.muted = muted;
    if (this.player) this.player.volume = this.level;
  }

  private get level() {
    return this.muted ? 0 : this.volume;
  }

  /** Shown in the sound settings. */
  get label(): string {
    return this.recordedCount > 0 ? `تسجيلات صوتية (${this.recordedCount} مقطع)` : "نص على الشاشة فقط";
  }

  /**
   * Call from the click that starts the game: browsers only let a page play
   * sound after a user gesture, and Safari wants the player primed by one.
   */
  unlock() {
    if (typeof window === "undefined" || this.primed) return;
    this.primed = true;
    if (this.player && this.player.paused) {
      this.player.src = SILENCE;
      this.player.play().catch(() => {});
    }
  }

  stop() {
    this.seq++;
    this.cut?.();
    this.cut = null;
    if (this.player && !this.player.paused) this.player.pause();
    this.setSpeaking(false);
  }

  /**
   * Plays a line's recording. Resolves when it ends (or right away if it has
   * none). With `waitMs`, a recording that is still playing may finish first
   * (for at most that long) instead of being cut off; lines never overlap.
   */
  async speak(line: Cue, { waitMs = 0 }: { waitMs?: number } = {}): Promise<void> {
    const recorded = this.files[line.key];
    if (!recorded) return;
    const request = ++this.requests;
    if (waitMs > 0 && this.busy) {
      await new Promise<void>((resolve) => {
        this.idle.push(resolve);
        setTimeout(resolve, waitMs);
      });
      if (request !== this.requests) return; // a newer line took its turn
    }
    this.stop();
    if (this.muted) return;
    return this.play(recorded, this.seq);
  }

  private play(url: string, seq: number): Promise<void> {
    const el = this.player;
    if (!el) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        if (this.cut === done) this.cut = null;
        if (el.onended === done) el.onended = el.onerror = null;
        if (seq === this.seq) this.setSpeaking(false);
        resolve();
      };
      this.cut = done;
      el.onended = done;
      el.onerror = done;
      el.src = url;
      el.volume = this.level;
      this.setSpeaking(true);
      el.play().then(
        () => {
          this.lastError = null;
        },
        (err: unknown) => {
          // Usually autoplay: nobody clicked on this page yet.
          this.lastError = err instanceof Error && err.name === "NotAllowedError" ? "المتصفح منع الصوت — اضغط على الشاشة" : "تعذّر تشغيل المقطع";
          this.emit();
          done();
        },
      );
    });
  }
}
