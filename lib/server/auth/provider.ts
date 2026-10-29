import "server-only";
import { isSupabaseConfigured } from "@/lib/server/db";

/**
 * Accounts are Supabase Auth users. The server talks to Supabase Auth (the
 * browser never holds a Supabase session): it signs up / signs in with the
 * user's email + password, keeps the resulting access + refresh tokens in
 * httpOnly cookies, and verifies the access token on every request.
 *
 * Local development without Supabase (embedded database) uses a stand-in with
 * the same contract (lib/server/auth/local.ts), like lib/server/db.ts does for
 * the database. It never runs when Supabase is configured or on Vercel.
 */

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch seconds. */
  expiresAt: number;
}

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthError =
  | "INVALID_CREDENTIALS"
  | "EMAIL_TAKEN"
  | "EMAIL_RESERVED"
  | "WEAK_PASSWORD"
  | "TOO_MANY_ATTEMPTS"
  /** Supabase still requires email confirmation (dashboard setting, see README). */
  | "SIGNUP_UNAVAILABLE"
  | "SERVER_ERROR";

export type AuthResult = { ok: true; user: AuthUser; tokens: AuthTokens } | { ok: false; error: AuthError };

export interface AuthProvider {
  signUp(email: string, password: string): Promise<AuthResult>;
  signIn(email: string, password: string): Promise<AuthResult>;
  refresh(refreshToken: string): Promise<AuthResult>;
  /** The account behind a valid, unexpired access token. */
  getUser(accessToken: string): Promise<AuthUser | null>;
  /** Revokes the session (its refresh token stops working). */
  signOut(accessToken: string): Promise<void>;
}

export async function authProvider(): Promise<AuthProvider> {
  if (isSupabaseConfigured) return (await import("./supabase")).supabaseAuth;
  return (await import("./local")).localAuth;
}
