/**
 * The TV's sound settings, kept in localStorage: the narrator's level and a
 * mute that silences it without touching the level.
 */
export const AUDIO_SETTINGS_KEY = "fq:mafia:audio";

export interface AudioSettings {
  /** صوت الراوي, 0–1. */
  narratorVolume: number;
  muted: boolean;
}

export const AUDIO_DEFAULTS: AudioSettings = { narratorVolume: 1, muted: false };

const level = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** Reads stored settings; anything missing or invalid falls back to the defaults (older saves had more fields). */
export function parseAudioSettings(raw: string | null): AudioSettings {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object") return AUDIO_DEFAULTS;
    return {
      narratorVolume: level(v.narratorVolume, AUDIO_DEFAULTS.narratorVolume),
      muted: v.muted === true,
    };
  } catch {
    return AUDIO_DEFAULTS;
  }
}
