export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string; status: number };

const TIMEOUT_MS = 10000;

export async function api<T = Record<string, unknown>>(
  endpoint: "/api/host" | "/api/guest",
  body: Record<string, unknown>,
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    if (!json || typeof json !== "object") {
      return { ok: false, error: "NETWORK", status: res.status };
    }
    if (!json.ok) return { ok: false, error: String(json.error ?? "SERVER_ERROR"), status: res.status };
    return json as { ok: true } & T;
  } catch {
    return { ok: false, error: "NETWORK", status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Errors that mean "this device can't continue in this game" (vs. transient). */
export const FATAL_ERRORS = new Set(["FORBIDDEN", "NOT_A_PLAYER", "GAME_NOT_FOUND"]);

const MESSAGES: Record<string, string> = {
  GAME_NOT_FOUND: "رمز اللعبة غير صحيح",
  IDENTITY_TAKEN: "هذا الشخص داخل بالفعل من جهاز ثاني",
  NAME_TAKEN: "هذا الاسم مستخدم، اختار اسم ثاني",
  BAD_NAME: "اكتب اسمك (لين ٢٤ حرف)",
  NOT_A_PLAYER: "انتهت جلستك في اللعبة، ادخل من جديد",
  FORBIDDEN: "هذا الجهاز ما يتحكم بهذي اللعبة",
  ROUND_CLOSED: "انقفل السؤال قبل ما توصل إجابتك",
  OWNER_CANNOT_ANSWER: "هذي المعلومة عنك 😂",
  GAME_ALREADY_STARTED: "اللعبة بدأت خلاص",
  NETWORK: "في مشكلة بالاتصال، جرّب مرة ثانية",
  SERVER_NOT_CONFIGURED: "السيرفر مو مجهز (إعدادات Supabase ناقصة)",
  CODE_EXHAUSTED: "ما قدرنا نسوي رمز جديد، جرّب مرة ثانية",
};

export function errorMessage(code: string | null | undefined): string {
  if (!code) return "";
  return MESSAGES[code] ?? "صار خطأ غير متوقع، جرّب مرة ثانية";
}
