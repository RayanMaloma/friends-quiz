"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { MafiaSound } from "./sound";
import { Narrator, STATIC_LINES, type NarratorSource, type VoiceSession } from "./narrator";
import { AUDIO_DEFAULTS as DEFAULTS, AUDIO_SETTINGS_KEY as KEY, parseAudioSettings, type AudioSettings as Settings } from "./settings";

function readSettings(): Settings {
  try {
    return parseAudioSettings(window.localStorage.getItem(KEY));
  } catch {
    return DEFAULTS;
  }
}

interface AudioApi {
  sound: MafiaSound;
  narrator: Narrator;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  /** The browser let us play sound (a click happened). */
  unlocked: boolean;
  unlock: () => Promise<void>;
  speaking: boolean;
  source: NarratorSource;
  voices: { uri: string; name: string; lang: string }[];
}

const Ctx = createContext<AudioApi | null>(null);

/** TV only: one sound engine + narrator for the whole room screen. */
export function MafiaAudioProvider({ session, children }: { session: VoiceSession; children: React.ReactNode }) {
  const [speaking, setSpeaking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [audio] = useState(() => {
    const sound = new MafiaSound();
    const narrator = new Narrator((on) => {
      sound.duck(on);
      setSpeaking(on);
    });
    return { sound, narrator };
  });
  const { sound, narrator } = audio;

  // Re-render when the narrator learns about voices / recordings.
  const version = useSyncExternalStore(
    useCallback((fn: () => void) => narrator.subscribe(fn), [narrator]),
    () => `${narrator.recordedCount}|${narrator.hasServerVoice}|${narrator.arabicVoices().length}|${narrator.ttsSource().label}|${narrator.lastError}`,
    () => "",
  );

  useEffect(() => {
    const s = readSettings();
    void Promise.resolve().then(() => setSettings(s));
    // Then load every name-free line ahead, so the first ones start on time.
    void narrator.init(session).then(() => narrator.prefetch(STATIC_LINES));
    return () => {
      narrator.stop();
      sound.dispose();
    };
    // The session never changes for a mounted TV.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrator, sound]);

  useEffect(() => {
    // Two channels, each with its own level; the mute silences both and keeps the levels.
    sound.setVolume(settings.themeVolume, settings.muted);
    narrator.setVolume(settings.narratorVolume, settings.muted);
    narrator.setChoice(settings.voice);
    if (settings.muted) narrator.stop();
  }, [settings, sound, narrator]);

  // The first click or key press anywhere unlocks audio (autoplay rules).
  const unlock = useCallback(async () => {
    // Synchronously, while the click is still "the user's gesture".
    narrator.unlock();
    const ok = await sound.unlock();
    setUnlocked(ok);
  }, [sound, narrator]);
  useEffect(() => {
    const on = () => void unlock();
    window.addEventListener("pointerdown", on);
    window.addEventListener("keydown", on);
    return () => {
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
    };
  }, [unlock]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // private mode
      }
      return next;
    });
  }, []);

  const value = useMemo<AudioApi>(
    () => ({
      sound,
      narrator,
      settings,
      update,
      unlocked,
      unlock,
      speaking,
      source: narrator.source(),
      voices: narrator.arabicVoices(),
    }),
    // `version` changes when voices or recordings load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sound, narrator, settings, update, unlocked, unlock, speaking, version],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMafiaAudio(): AudioApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMafiaAudio outside MafiaAudioProvider");
  return v;
}
