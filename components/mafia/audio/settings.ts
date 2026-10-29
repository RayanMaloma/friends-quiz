import type { VoiceChoice } from "./narrator";

/**
 * The TV's sound settings, kept in localStorage. Two independent channels:
 * the theme (ambience, heartbeat and effects) and the narrator. The global
 * mute silences both without touching their levels.
 */
export const AUDIO_SETTINGS_KEY = "fq:mafia:audio";

export interface AudioSettings {
  /** صوت الثيم, 0–1. */
  themeVolume: number;
  /** صوت الراوي, 0–1. */
  narratorVolume: number;
  muted: boolean;
  voice: VoiceChoice;
}

/** The ambience stays well under the narrator by default. */
export const AUDIO_DEFAULTS: AudioSettings = { themeVolume: 0.2, narratorVolume: 1, muted: false, voice: "auto" };

const level = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** Reads stored settings; anything missing or invalid falls back to the defaults (older saves had one shared `volume`). */
export function parseAudioSettings(raw: string | null): AudioSettings {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object") return AUDIO_DEFAULTS;
    return {
      themeVolume: level(v.themeVolume, AUDIO_DEFAULTS.themeVolume),
      narratorVolume: level(v.narratorVolume, AUDIO_DEFAULTS.narratorVolume),
      muted: v.muted === true,
      voice: typeof v.voice === "string" && v.voice ? v.voice : "auto",
    };
  } catch {
    return AUDIO_DEFAULTS;
  }
}

/** How far the ambience drops while the narrator speaks (a share of its level). */
export const DUCK_LEVEL = 0.25;
