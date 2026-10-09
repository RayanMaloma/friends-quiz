import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// NEXT_PUBLIC_FQ_LOCAL_DB=1: the server uses the local database, so there are no Realtime pings.
export const isRealtimeConfigured = Boolean(url && anonKey) && process.env.NEXT_PUBLIC_FQ_LOCAL_DB !== "1";

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
