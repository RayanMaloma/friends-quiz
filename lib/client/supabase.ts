import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isRealtimeConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/** Browser client — used ONLY for Realtime broadcast pings (tables are locked by RLS). */
export function getBrowserSupabase(): SupabaseClient | null {
  if (!isRealtimeConfigured) return null;
  client ??= createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
}
