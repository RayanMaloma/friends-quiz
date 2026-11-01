"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Narrator } from "./narrator";
import { AUDIO_DEFAULTS as DEFAULTS, AUDIO_SETTINGS_KEY as KEY, parseAudioSettings, type AudioSettings as Settings } from "./settings";

function readSettings(): Settings {
  try {
    return parseAudioSettings(window.localStorage.getItem(KEY));
  } catch {
    return DEFAULTS;
  }
}

interface AudioApi {
  narrator: Narrator;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  /** The browser let us play sound (a click happened). */
  unlocked: boolean;
  unlock: () => void;
  speaking: boolean;
}

const Ctx = createContext<AudioApi | null>(null);

/** TV only: one narrator for the whole room screen. */
export function MafiaAudioProvider({ children }: { children: React.ReactNode }) {
  const [speaking, setSpeaking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [narrator] = useState(() => new Narrator(setSpeaking));

  // Re-render when the narrator loads its recordings or fails to play one.
  const version = useSyncExternalStore(
    useCallback((fn: () => void) => narrator.subscribe(fn), [narrator]),
    () => `${narrator.recordedCount}|${narrator.lastError}`,
    () => "",
  );

  useEffect(() => {
    const s = readSettings();
    void Promise.resolve().then(() => setSettings(s));
    void narrator.init();
    return () => narrator.stop();
  }, [narrator]);

  useEffect(() => {
    narrator.setVolume(settings.narratorVolume, settings.muted);
    if (settings.muted) narrator.stop();
  }, [settings, narrator]);

  // The first click or key press anywhere unlocks audio (autoplay rules).
  const unlock = useCallback(() => {
    // Synchronously, while the click is still "the user's gesture".
    narrator.unlock();
    setUnlocked(true);
  }, [narrator]);
  useEffect(() => {
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
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
    () => ({ narrator, settings, update, unlocked, unlock, speaking }),
    // `version` changes when recordings load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [narrator, settings, update, unlocked, unlock, speaking, version],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMafiaAudio(): AudioApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMafiaAudio outside MafiaAudioProvider");
  return v;
}
