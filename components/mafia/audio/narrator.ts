/**
 * The TV's narrator. Three sources, in this order:
 *
 * 1. Recorded lines: public/mafia/voice/manifest.json maps a line key to an
 *    audio file (a Saudi voice actor or a TTS service rendered offline).
 * 2. The browser's own speech synthesis, but only with a voice that says it
 *    is Saudi Arabic (ar-SA). Automatic choice is limited to known male
 *    Saudi voices; any other Arabic voice must be picked by hand in the
 *    sound settings. We never fall back to an unrelated voice silently.
 * 3. Nothing: the line is shown as a subtitle only.
 *
 * Playback never gates the game: phases follow the server clock, and a
 * missing or failing file just means a silent line.
 */
import type { Cue } from "@/lib/mafia/narration";

/** Male ar-SA voices known by name: Edge "Hamed" (natural), Windows "Naayf", Apple "Maged". */
const KNOWN_SAUDI_MALE = /\b(hamed|naayf|maged)\b/i;

export type VoiceChoice = "auto" | "off" | string;

export interface NarratorSource {
  kind: "recorded" | "tts" | "none";
  /** Shown in the sound settings. */
  label: string;
}

const isSaudi = (v: SpeechSynthesisVoice) => v.lang.replace("_", "-").toLowerCase() === "ar-sa";

export class Narrator {
  private files: Record<string, string> = {};
  private elements = new Map<string, HTMLAudioElement>();
  private current: HTMLAudioElement | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private choice: VoiceChoice = "auto";
  private volume = 0.8;
  private muted = false;
  private listeners = new Set<() => void>();
  private onSpeaking: (on: boolean) => void;

  constructor(onSpeaking: (on: boolean) => void) {
    this.onSpeaking = onSpeaking;
  }

  /** Loads the recorded-lines manifest and the system voices. */
  async init() {
    try {
      const res = await fetch("/mafia/voice/manifest.json", { cache: "no-cache" });
      const json = res.ok ? await res.json() : null;
      const lines = json && typeof json === "object" && json.lines && typeof json.lines === "object" ? json.lines : {};
      for (const [key, file] of Object.entries(lines)) {
        if (typeof file !== "string" || !/^[\w./-]+$/.test(file)) continue;
        this.files[key] = `/mafia/voice/${file.replace(/^\/+/, "")}`;
        const el = new Audio();
        el.preload = "auto";
        el.src = this.files[key];
        // A broken file is dropped, so its line falls back to TTS / subtitle.
        el.addEventListener("error", () => {
          delete this.files[key];
          this.elements.delete(key);
          this.emit();
        });
        this.elements.set(key, el);
      }
    } catch {
      // No manifest: no recorded lines.
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const load = () => {
        this.voices = window.speechSynthesis.getVoices();
        this.emit();
      };
      load();
      window.speechSynthesis.addEventListener?.("voiceschanged", load);
    }
    this.emit();
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

  /** Arabic system voices, for picking one by hand. */
  arabicVoices(): { uri: string; name: string; lang: string }[] {
    return this.voices
      .filter((v) => v.lang.toLowerCase().startsWith("ar"))
      .map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang }));
  }

  setChoice(choice: VoiceChoice) {
    this.choice = choice;
    this.emit();
  }

  setVolume(volume: number, muted: boolean) {
    this.volume = volume;
    this.muted = muted;
    if (this.current) this.current.volume = muted ? 0 : volume;
  }

  private ttsVoice(): SpeechSynthesisVoice | null {
    if (this.choice === "off") return null;
    if (this.choice !== "auto") return this.voices.find((v) => v.voiceURI === this.choice) ?? null;
    return this.voices.find((v) => isSaudi(v) && KNOWN_SAUDI_MALE.test(v.name)) ?? null;
  }

  /** What will speak a line without a recording. */
  ttsSource(): NarratorSource {
    const v = this.ttsVoice();
    if (v) return { kind: "tts", label: `${v.name} (${v.lang})` };
    return { kind: "none", label: this.choice === "off" ? "مطفّى — نص على الشاشة فقط" : "ما لقينا صوت سعودي — نص على الشاشة فقط" };
  }

  /** Overall source, for the settings badge. */
  source(): NarratorSource {
    if (this.recordedCount > 0) return { kind: "recorded", label: `تسجيلات صوتية (${this.recordedCount} مقطع)` };
    return this.ttsSource();
  }

  stop() {
    if (this.current) {
      this.current.pause();
      this.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    this.onSpeaking(false);
  }

  /** Speaks a line. Resolves when it ends (or right away if there is no voice). */
  speak(line: Cue): Promise<void> {
    this.stop();
    if (this.muted) return Promise.resolve();
    const el = this.elements.get(line.key);
    if (el) {
      return new Promise((resolve) => {
        const done = () => {
          if (this.current === el) this.current = null;
          this.onSpeaking(false);
          resolve();
        };
        el.currentTime = 0;
        el.volume = this.volume;
        el.onended = done;
        el.onerror = done;
        this.current = el;
        this.onSpeaking(true);
        el.play().catch(done);
      });
    }
    const voice = this.ttsVoice();
    if (!voice || typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(line.text);
      u.voice = voice;
      u.lang = voice.lang;
      // A little slower and lower than default: calmer, more dramatic.
      u.rate = 0.9;
      u.pitch = 0.85;
      u.volume = this.volume;
      const done = () => {
        this.onSpeaking(false);
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      this.onSpeaking(true);
      window.speechSynthesis.speak(u);
      // Some engines never fire onend: don't keep the ambience ducked forever.
      setTimeout(done, 15000);
    });
  }
}
