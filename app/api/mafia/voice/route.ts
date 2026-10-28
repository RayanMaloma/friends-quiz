import { fail, getSnapshot, handleError, ok, readBody } from "@/lib/server/game";
import { hashToken, isTokenShaped, isUuid } from "@/lib/server/tokens";
import { synthesize, ttsInfo } from "@/lib/server/tts";
import { cue, NAMED_CUES, SCRIPT, type CueKey } from "@/lib/mafia/narration";

export const dynamic = "force-dynamic";

/**
 * The narrator's voice, for the TV only (host token).
 *
 * - `{ action: "status" }` → which TTS service speaks, if any.
 * - `{ action: "speak", key, name? }` → the line as MP3. Only script lines,
 *   and only the names of this room's players, so it can't be used as a
 *   free text-to-speech service.
 */
export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    if (!isUuid(body.sessionId) || !isTokenShaped(body.hostToken)) return fail("FORBIDDEN", 403);
    const snapshot = await getSnapshot(body.sessionId);
    if (!snapshot || snapshot.session.kind !== "mafia" || snapshot.session.host_token_hash !== hashToken(body.hostToken)) {
      return fail("FORBIDDEN", 403);
    }

    if (body.action === "status") return ok({ tts: ttsInfo() });

    if (body.action !== "speak" || typeof body.key !== "string" || !Object.hasOwn(SCRIPT, body.key)) return fail("BAD_REQUEST");
    const key = body.key as CueKey;
    let name: string | null = null;
    if (body.name !== undefined && body.name !== null) {
      if (!NAMED_CUES.includes(key) || !snapshot.players.some((p) => p.display_name === body.name)) return fail("BAD_REQUEST");
      name = body.name as string;
    }

    const audio = await synthesize(cue(key, name).text);
    if (!audio) return fail("TTS_NOT_CONFIGURED", 501);
    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
    });
  } catch (err) {
    if (!(err instanceof Error) || !/^(elevenlabs|azure) /.test(err.message)) return handleError(err);
    console.error("[tts]", err.message);
    return fail("TTS_FAILED", 502);
  }
}
