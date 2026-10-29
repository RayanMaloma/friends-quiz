import { rpc } from "@/lib/server/db";
import { fail, handleError, ok, readBody } from "@/lib/server/game";
import { clearAdminCookie, clientIp, hasAdminPasswordCookie, isSameOriginRequest } from "@/lib/server/admin";
import { authProvider } from "@/lib/server/auth/provider";
import { currentUser, endSession, setSessionCookies } from "@/lib/server/auth/session";
import { createLimiter } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Accounts: register / login / logout / me. Email + password only; the role
 * is never accepted from the client (every new account is a 'user', see
 * fq_auth_user_created). No email is ever sent: no confirmation, no OTP, no
 * reset. A forgotten password is reset by the administrator in Supabase.
 */

const failedLogins = createLimiter(10, 10 * 60 * 1000); // per IP and per email
const signups = createLimiter(5, 60 * 60 * 1000); // per IP

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;

function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const email = v.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function cleanPassword(v: unknown): string | null {
  return typeof v === "string" && v.length >= MIN_PASSWORD && v.length <= MAX_PASSWORD ? v : null;
}

export async function POST(req: Request) {
  try {
    if (!isSameOriginRequest(req)) return fail("FORBIDDEN", 403);
    const body = await readBody(req);
    const ip = clientIp(req);

    switch (body.action) {
      case "me": {
        const user = await currentUser({ refresh: true });
        return ok({
          user: user && { email: user.email, role: user.role },
          gm: await hasAdminPasswordCookie(),
        });
      }

      case "register": {
        const email = cleanEmail(body.email);
        if (!email) return fail("BAD_EMAIL");
        const password = cleanPassword(body.password);
        if (!password) return fail("WEAK_PASSWORD");
        if (!signups.allowed(ip)) return fail("TOO_MANY_ATTEMPTS", 429);
        signups.record(ip);
        const res = await (await authProvider()).signUp(email, password);
        if (!res.ok) return fail(res.error, res.error === "EMAIL_TAKEN" ? 409 : res.error === "SERVER_ERROR" ? 500 : 400);
        await setSessionCookies(res.tokens);
        // A new account is always a regular user (registration activity: database trigger).
        return ok({ user: { email: res.user.email, role: "user" } });
      }

      case "login": {
        const email = cleanEmail(body.email);
        const password = typeof body.password === "string" && body.password.length <= MAX_PASSWORD ? body.password : null;
        if (!email || !password) return fail("INVALID_CREDENTIALS", 401);
        if (!failedLogins.allowed(ip) || !failedLogins.allowed(email)) return fail("TOO_MANY_ATTEMPTS", 429);
        const res = await (await authProvider()).signIn(email, password);
        if (!res.ok) {
          if (res.error === "INVALID_CREDENTIALS") {
            failedLogins.record(ip);
            failedLogins.record(email);
            return fail("INVALID_CREDENTIALS", 401);
          }
          return fail(res.error, res.error === "TOO_MANY_ATTEMPTS" ? 429 : 500);
        }
        await setSessionCookies(res.tokens);
        await rpc("fq_log_login", { p_user_id: res.user.id });
        const profile = await rpc<{ ok: boolean; role?: string }>("fq_auth_profile", { p_user_id: res.user.id });
        return ok({ user: { email: res.user.email, role: profile.role === "super_admin" ? "super_admin" : "user" } });
      }

      // Signs this browser out of everything: the account and the GM password.
      case "logout":
        await endSession();
        await clearAdminCookie();
        return ok({});
    }
    return fail("BAD_REQUEST");
  } catch (err) {
    return handleError(err);
  }
}
