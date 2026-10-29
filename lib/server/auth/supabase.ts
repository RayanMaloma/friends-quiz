import "server-only";
import { createClient, type AuthError as SbAuthError, type Session } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/server/db";
import type { AuthError, AuthProvider, AuthResult } from "./provider";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** A fresh, stateless client per call: nothing is persisted server-side between users. */
function publicClient() {
  return createClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function mapError(err: SbAuthError): AuthError {
  const code = err.code ?? "";
  if (code === "invalid_credentials" || code === "email_not_confirmed") return "INVALID_CREDENTIALS";
  if (code === "user_already_exists" || code === "email_exists") return "EMAIL_TAKEN";
  if (code === "weak_password") return "WEAK_PASSWORD";
  if (code.startsWith("over_") || err.status === 429) return "TOO_MANY_ATTEMPTS";
  if (code === "signup_disabled" || code === "email_provider_disabled") return "SIGNUP_UNAVAILABLE";
  // The database refused the row: the reserved super-admin email (fq_auth_user_guard).
  if (/database error saving new user/i.test(err.message)) return "EMAIL_RESERVED";
  if (/invalid login credentials/i.test(err.message)) return "INVALID_CREDENTIALS";
  console.error("[auth]", err.status, code, err.message);
  return "SERVER_ERROR";
}

function result(session: Session | null, err: SbAuthError | null): AuthResult {
  if (err) return { ok: false, error: mapError(err) };
  if (!session?.user?.email) return { ok: false, error: "SERVER_ERROR" };
  return {
    ok: true,
    user: { id: session.user.id, email: session.user.email },
    tokens: {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
    },
  };
}

export const supabaseAuth: AuthProvider = {
  async signUp(email, password) {
    const { data, error } = await publicClient().auth.signUp({ email, password });
    if (error) return result(null, error);
    if (!data.session) {
      // "Confirm email" is still on in Supabase (Authentication → Sign In / Providers → Email).
      // Either a new unconfirmed user or an existing email (Supabase hides which).
      console.error("[auth] signUp returned no session: disable email confirmation in the Supabase dashboard");
      return { ok: false, error: "SIGNUP_UNAVAILABLE" };
    }
    return result(data.session, null);
  },

  async signIn(email, password) {
    const { data, error } = await publicClient().auth.signInWithPassword({ email, password });
    return result(data.session, error);
  },

  async refresh(refreshToken) {
    const { data, error } = await publicClient().auth.refreshSession({ refresh_token: refreshToken });
    return result(data.session, error);
  },

  async getUser(accessToken) {
    const { data, error } = await getAdminClient().auth.getUser(accessToken);
    if (error || !data.user?.email) return null;
    return { id: data.user.id, email: data.user.email };
  },

  async signOut(accessToken) {
    await getAdminClient().auth.admin.signOut(accessToken, "local");
  },
};
