/**
 * The TV's narrator. For each line, the first source that has it:
 *
 * 1. A recorded line: public/mafia/voice/manifest.json maps a line key to an
 *    audio file (a Najdi voice actor, or a TTS voice rendered offline).
 *    Recordings have no names, so a line naming a player prefers 2.
 * 2. The server voice (/api/mafia/voice): a cloud TTS service set up with
 *    environment variables, e.g. an ElevenLabs Najdi voice. Speaks names.
 * 3. A system voice from the browser. Never sold as Najdi: the settings say
 *    which voice it is. Automatic choice prefers a Saudi (ar-SA) male voice,
 *    then any Saudi voice, then any Arabic voice.
 * 4. Nothing: the line is shown as a subtitle only, and the settings say why.
 *
 * Every source plays through one shared <audio> element (or the speech
 * engine), and a new line always stops the previous one: lines never
 * overlap. Playback never gates the game: phases follow the server clock.
 */
import { SCRIPT, type Cue } from "@/lib/mafia/narration";

/** Male ar-SA voices known by name: Edge "Hamed" (natural), Windows "Naayf", Apple "Maged". */
const KNOWN_SAUDI_MALE = /\b(hamed|naayf|maged)\b/i;

/** A very short silent WAV, played from the first click so later lines may play. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export type VoiceChoice = "auto" | "off" | string;

export interface NarratorSource {
  kind: "recorded" | "server" | "tts" | "none";
  /** Shown in the sound settings. */
  label: string;
  /** Whether this source is a real Najdi voice (as far as we know). */
  najdi: boolean;
}

export interface VoiceSession {
  sessionId: string;
  hostToken: string;
}

const lang = (v: SpeechSynthesisVoice) => v.lang.replace("_", "-").toLowerCase();

export class Narrator {
  private files: Record<string, string> = {};
  private player: HTMLAudioElement | null = null;
  private session: VoiceSession | null = null;
  private server: { label: string } | null = null;
  /** Server audio as blob URLs, by line text (null = failed). */
  private clips = new Map<string, Promise<string | null>>();
  private voices: SpeechSynthesisVoice[] = [];
  private choice: VoiceChoice = "auto";
  private volume = 0.8;
  private muted = false;
  /** Bumped by every speak/stop: a line still loading when this changes is dropped. */
  private seq = 0;
  private primed = false;
  private listeners = new Set<() => void>();
  private onSpeaking: (on: boolean) => void;
  /** Why the last line was silent, for the settings panel. */
  lastError: string | null = null;

  constructor(onSpeaking: (on: boolean) => void) {
    this.onSpeaking = onSpeaking;
  }

  /** Loads the recorded-lines manifest, the server voice and the system voices. */
  async init(session: VoiceSession | null) {
    this.session = session;
    if (typeof window === "undefined") return;
    if (!this.player) {
      this.player = new Audio();
      this.player.preload = "auto";
    }
    if ("speechSynthesis" in window) {
      const load = () => {
        this.voices = window.speechSynthesis.getVoices();
        this.emit();
      };
      load();
      window.speechSynthesis.addEventListener?.("voiceschanged", load);
    }
    await Promise.all([this.loadManifest(), this.loadServer()]);
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
        // Only keep files that exist, so a missing one falls back to the next source.
        const head = await fetch(url, { method: "HEAD" }).catch(() => null);
        if (head?.ok) this.files[key] = url;
      }
    } catch {
      // No manifest: no recorded lines.
    }
  }

  private async loadServer() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/mafia/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", ...this.session }),
      });
      const json = res.ok ? await res.json() : null;
      this.server = json?.tts ? { label: String(json.tts.label) } : null;
    } catch {
      this.server = null;
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

  get hasServerVoice() {
    return this.server !== null;
  }

  /** Arabic system voices, for picking one by hand. */
  arabicVoices(): { uri: string; name: string; lang: string }[] {
    return this.voices.filter((v) => lang(v).startsWith("ar")).map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang }));
  }

  setChoice(choice: VoiceChoice) {
    this.choice = choice;
    this.emit();
  }

  setVolume(volume: number, muted: boolean) {
    this.volume = volume;
    this.muted = muted;
    if (this.player) this.player.volume = muted ? 0 : volume;
  }

  private ttsVoice(): SpeechSynthesisVoice | null {
    if (this.choice === "off") return null;
    if (this.choice !== "auto") return this.voices.find((v) => v.voiceURI === this.choice) ?? null;
    return (
      this.voices.find((v) => lang(v) === "ar-sa" && KNOWN_SAUDI_MALE.test(v.name)) ??
      this.voices.find((v) => lang(v) === "ar-sa") ??
      this.voices.find((v) => lang(v).startsWith("ar")) ??
      null
    );
  }

  /** What speaks a line that has no recording and no server voice. */
  ttsSource(): NarratorSource {
    const v = this.ttsVoice();
    if (v) return { kind: "tts", label: `صوت النظام: ${v.name} (${v.lang}) — مو لهجة نجدية`, najdi: false };
    return {
      kind: "none",
      label: this.choice === "off" ? "مطفّى — نص على الشاشة فقط" : "ما فيه صوت عربي بهالمتصفح ولا خدمة صوت — نص على الشاشة فقط",
      najdi: false,
    };
  }

  /** Overall source, for the settings badge. */
  source(): NarratorSource {
    if (this.recordedCount > 0) return { kind: "recorded", label: `تسجيلات صوتية (${this.recordedCount} مقطع)`, najdi: true };
    if (this.server) return { kind: "server", label: `خدمة الصوت: ${this.server.label}`, najdi: true };
    return this.ttsSource();
  }

  /**
   * Call from the click that starts the game: browsers only let a page play
   * sound after a user gesture, and Safari wants each player primed by one.
   */
  unlock() {
    if (typeof window === "undefined" || this.primed) return;
    this.primed = true;
    if (this.player && this.player.paused) {
      this.player.src = SILENCE;
      this.player.play().catch(() => {});
    }
    if ("speechSynthesis" in window && this.ttsVoice()) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  }

  /** Loads lines ahead (server voice), so they start on time. */
  prefetch(lines: Cue[]) {
    for (const line of lines) if (this.useServerFor(line)) void this.clip(line);
  }

  private useServerFor(line: Cue): boolean {
    return !!this.server && !!this.session && (!this.files[line.key] || !!line.name);
  }

  private clip(line: Cue): Promise<string | null> {
    let p = this.clips.get(line.text);
    if (!p) {
      p = fetch("/api/mafia/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "speak", key: line.key, name: line.name ?? null, ...this.session }),
      })
        .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
        .catch(() => null);
      this.clips.set(line.text, p);
      // A failed line may be retried later.
      void p.then((url) => {
        if (!url) this.clips.delete(line.text);
      });
    }
    return p;
  }

  stop() {
    this.seq++;
    if (this.player && !this.player.paused) this.player.pause();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    this.onSpeaking(false);
  }

  /** Speaks a line. Resolves when it ends (or right away if there is no voice). */
  async speak(line: Cue): Promise<void> {
    this.stop();
    const seq = this.seq;
    if (this.muted) return;

    if (this.useServerFor(line)) {
      const url = await this.clip(line);
      if (seq !== this.seq) return; // a newer line started meanwhile
      if (url) return this.play(url, seq);
    }
    // Without the server voice, a named line uses its name-free recording
    // (same voice all game; the name is on screen).
    const recorded = this.files[line.key];
    if (recorded) return this.play(recorded, seq);
    if (this.ttsVoice()) return this.say(line.text, seq);
    this.lastError = this.ttsSource().label;
  }

  private play(url: string, seq: number): Promise<void> {
    const el = this.player;
    if (!el) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        el.onended = el.onerror = null;
        if (seq === this.seq) this.onSpeaking(false);
        resolve();
      };
      el.onended = done;
      el.onerror = done;
      el.src = url;
      el.volume = this.volume;
      this.onSpeaking(true);
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

  private say(text: string, seq: number): Promise<void> {
    const voice = this.ttsVoice()!;
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      // A little slower and lower than default: calmer, more dramatic.
      u.rate = 0.9;
      u.pitch = 0.85;
      u.volume = this.volume;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        if (seq === this.seq) this.onSpeaking(false);
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

/** Every name-free line, to load ahead at the start of a match. */
export const STATIC_LINES = (Object.keys(SCRIPT) as (keyof typeof SCRIPT)[]).map((key) => ({ key, text: SCRIPT[key] }));
