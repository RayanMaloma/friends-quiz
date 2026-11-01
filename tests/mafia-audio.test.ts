import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Narrator } from "@/components/mafia/audio/narrator";
import { AUDIO_DEFAULTS, parseAudioSettings } from "@/components/mafia/audio/settings";
import { cue, SCRIPT } from "@/lib/mafia/narration";

// The TV's narrator plays the recorded lines only, on a fake <audio> element.

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

describe("recorded lines", () => {
  const dir = path.join(process.cwd(), "public", "mafia", "voice");
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as { lines: Record<string, string> };

  it("every file in the manifest exists, for a line of the script", () => {
    expect(Object.keys(manifest.lines).sort()).toEqual(["dawn", "detective", "doctor", "mafia"]);
    for (const [key, file] of Object.entries(manifest.lines)) {
      expect(key in SCRIPT).toBe(true);
      expect(existsSync(path.join(dir, file))).toBe(true);
    }
  });
});

describe("narrator", () => {
  it("defaults to 100% and follows its slider, also mid-line", async () => {
    const { n, el } = narratorWith({ mafia: "/v/mafia.ogg" });
    n.setVolume(AUDIO_DEFAULTS.narratorVolume, false);
    void n.speak(cue("mafia"));
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

  it("never plays two lines at once", async () => {
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

  it("a line without a recording is silent and doesn't cut off the one playing", async () => {
    const { n, el } = narratorWith({ dawn: "/v/dawn.ogg" });
    n.setVolume(1, false);
    void n.speak(cue("dawn"));
    await Promise.resolve();
    await n.speak(cue("dawn_killed", "سارة"));
    expect(el.playing).toEqual(["/v/dawn.ogg"]);
    expect(el.paused).toBe(false);
  });

  it("is silent while muted", async () => {
    const { n, el } = narratorWith({ mafia: "/v/mafia.ogg" });
    n.setVolume(1, true);
    await n.speak(cue("mafia"));
    expect(el.playing).toEqual([]);
  });
});

describe("saved settings", () => {
  it("defaults: narrator 100%, not muted", () => {
    expect(parseAudioSettings(null)).toEqual({ narratorVolume: 1, muted: false });
    expect(parseAudioSettings("not json")).toEqual(AUDIO_DEFAULTS);
  });

  it("keeps the level and the mute; older saves' extra fields are dropped; bad values are clamped", () => {
    const old = JSON.stringify({ themeVolume: 0.55, narratorVolume: 0.8, muted: true, voice: "x" });
    expect(parseAudioSettings(old)).toEqual({ narratorVolume: 0.8, muted: true });
    expect(parseAudioSettings(JSON.stringify({ narratorVolume: -1 }))).toEqual({ narratorVolume: 0, muted: false });
  });
});
