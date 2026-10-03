import "server-only";
import { getAdminClient, isSupabaseConfigured } from "@/lib/server/db";
import { gameChannelName, SYNC_EVENT } from "@/lib/realtime-config";

/**
 * Tell every client of a game "something changed — refetch".
 * The message carries no game data, so a public channel leaks nothing.
 * Failures are logged and swallowed: clients also resync on reconnect,
 * focus and a safety poll.
 */
export async function notifyGame(sessionId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const topic = gameChannelName(sessionId);
  const payload = { at: Date.now() };

  const client = getAdminClient();
  const channel = client.channel(topic);
  try {
    await channel.httpSend(SYNC_EVENT, payload, { timeout: 3000 });
    return;
  } catch (err) {
    console.warn("[notifyGame] httpSend failed, trying REST broadcast", err);
  } finally {
    await client.removeChannel(channel).catch(() => {});
  }

  // Fallback: the classic Realtime REST broadcast endpoint.
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
    if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers,
      body: JSON.stringify({ messages: [{ topic, event: SYNC_EVENT, payload }] }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.warn("[notifyGame] REST broadcast failed", res.status, await res.text());
  } catch (err) {
    console.warn("[notifyGame] REST broadcast failed", err);
  }
}
