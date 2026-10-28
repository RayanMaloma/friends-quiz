"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { MafiaSound } from "./sound";
import { Narrator, type NarratorSource, type VoiceChoice } from "./narrator";

const KEY = "fq:mafia:audio";

interface Settings {
  volume: number;
  muted: boolean;
  voice: VoiceChoice;
}

const DEFAULTS: Settings = { volume: 0.8, muted: false, voice: "auto" };

function readSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object") return DEFAULTS;
    return {
      volume: typeof v.volume === "number" ? Math.min(1, Math.max(0, v.volume)) : DEFAULTS.volume,
      muted: v.muted === true,
      voice: typeof v.voice === "string" && v.voice ? v.voice : "auto",
    };
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
export function MafiaAudioProvider({ children }: { children: React.ReactNode }) {
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
    () => narrator.recordedCount + narrator.arabicVoices().length * 1000 + (narrator.ttsSource().kind === "tts" ? 1e6 : 0),
    () => 0,
  );

  useEffect(() => {
    const s = readSettings();
    void Promise.resolve().then(() => setSettings(s));
    void narrator.init();
    return () => {
      narrator.stop();
      sound.dispose();
    };
  }, [narrator, sound]);

  useEffect(() => {
    sound.setVolume(settings.volume, settings.muted);
    narrator.setVolume(settings.volume, settings.muted);
    narrator.setChoice(settings.voice);
    if (settings.muted) narrator.stop();
  }, [settings, sound, narrator]);

  // The first click or key press anywhere unlocks audio (autoplay rules).
  const unlock = useCallback(async () => {
    const ok = await sound.unlock();
    setUnlocked(ok);
  }, [sound]);
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
