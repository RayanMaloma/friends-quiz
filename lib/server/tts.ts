import "server-only";

/**
 * The narrator's server-side voice: turns a line into speech with a cloud
 * TTS service, so the TV doesn't depend on whatever voices its browser has.
 * Configured by environment variables (see .env.example); with none set,
 * the TV falls back to recorded files, then to a system voice.
 *
 * - elevenlabs: any voice from the ElevenLabs library. Pick a male Saudi
 *   Najdi voice there; this is the only option that can sound truly Najdi.
 * - azure: Azure Speech, ar-SA-HamedNeural by default (a natural Saudi male
 *   voice, but closer to formal Arabic than to Najdi).
 */

type Provider = "elevenlabs" | "azure";

interface Config {
  provider: Provider;
  label: string;
  synth: (text: string) => Promise<ArrayBuffer>;
}

function config(): Config | null {
  const env = process.env;
  const provider = (env.MAFIA_TTS_PROVIDER ?? "").trim().toLowerCase();
  if (provider === "elevenlabs") {
    const key = env.ELEVENLABS_API_KEY;
    const voice = env.ELEVENLABS_VOICE_ID;
    if (!key || !voice) return null;
    const model = env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
    return {
      provider,
      label: env.MAFIA_TTS_LABEL || "ElevenLabs",
      synth: async (text) => {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
          method: "POST",
          headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({ text, model_id: model }),
        });
        if (!res.ok) throw new Error(`elevenlabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return res.arrayBuffer();
      },
    };
  }
  if (provider === "azure") {
    const key = env.AZURE_SPEECH_KEY;
    const region = env.AZURE_SPEECH_REGION;
    if (!key || !region) return null;
    const voice = env.AZURE_SPEECH_VOICE || "ar-SA-HamedNeural";
    return {
      provider,
      label: env.MAFIA_TTS_LABEL || `Azure ${voice}`,
      synth: async (text) => {
        const ssml =
          `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ar-SA">` +
          `<voice name="${escapeXml(voice)}"><prosody rate="-8%" pitch="-6%">${escapeXml(text)}</prosody></voice></speak>`;
        const res = await fetch(`https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
            "User-Agent": "friends-quiz-mafia",
          },
          body: ssml,
        });
        if (!res.ok) throw new Error(`azure ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return res.arrayBuffer();
      },
    };
  }
  return null;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** What the TV shows in its sound settings, or null when no service is set up. */
export function ttsInfo(): { provider: Provider; label: string } | null {
  const c = config();
  return c ? { provider: c.provider, label: c.label } : null;
}

// Lines repeat across phases and rooms: keep the audio of recent ones.
const MAX_CACHED = 300;
const cache = new Map<string, Promise<ArrayBuffer>>();

/** The spoken audio (MP3) of a line, or null when no service is set up. */
export async function synthesize(text: string): Promise<ArrayBuffer | null> {
  const c = config();
  if (!c) return null;
  const id = `${c.provider}:${c.label}:${text}`;
  let audio = cache.get(id);
  if (!audio) {
    audio = c.synth(text);
    cache.set(id, audio);
    // A failure isn't cached: the next request tries again.
    audio.catch(() => cache.delete(id));
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  }
  return audio;
}
