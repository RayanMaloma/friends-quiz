export type ApiResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; status: number; [extra: string]: unknown };

const TIMEOUT_MS = 10000;

export async function api<T = Record<string, unknown>>(
  endpoint: "/api/host" | "/api/guest" | "/api/admin" | "/api/dx" | "/api/mafia" | "/api/invent",
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
    if (!json.ok) {
      return { ...json, ok: false, error: String(json.error ?? "SERVER_ERROR"), status: res.status };
    }
    return json as { ok: true } & T;
  } catch {
    return { ok: false, error: "NETWORK", status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Errors that mean "this device can't continue in this game" (vs. transient). */
export const FATAL_ERRORS = new Set(["FORBIDDEN", "NOT_A_PLAYER", "GAME_NOT_FOUND", "DX_SESSION", "MAFIA_SESSION", "INVENT_SESSION"]);

const MESSAGES: Record<string, string> = {
  GAME_NOT_FOUND: "رمز اللعبة غير صحيح",
  IDENTITY_TAKEN: "هذا الشخص داخل بالفعل من جهاز ثاني",
  NAME_TAKEN: "هذا الاسم مستخدم، اختار اسم ثاني",
  BAD_NAME: "اكتب اسمك (لين ٢٤ حرف)",
  NOT_A_PLAYER: "انتهت جلستك في اللعبة، ادخل من جديد",
  FORBIDDEN: "هذا الجهاز ما يتحكم بهذي اللعبة",
  ROUND_CLOSED: "انقفل السؤال قبل ما توصل إجابتك",
  OWNER_CANNOT_ANSWER: "هذا السؤال عنك 😂",
  INVALID_CHOICE: "اختيار غير صالح",
  INVALID_ANSWER: "الإجابة غير صالحة",
  TIME_UP: "خلص الوقت ⏰",
  NO_QUESTIONS: "اللعبة ما فيها أسئلة جاهزة",
  GAME_MISSING: "اللعبة غير موجودة",
  ADMIN_REQUIRED: "سجّل دخول لوحة التحكم أول",
  ADMIN_NOT_CONFIGURED: "لوحة التحكم مقفلة: أضف ADMIN_PASSWORD في إعدادات السيرفر",
  WRONG_PASSWORD: "كلمة المرور غلط",
  TOO_MANY_ATTEMPTS: "محاولات كثيرة، جرّب بعد شوي",
  VERSION_CONFLICT: "اللعبة تعدّلت من مكان ثاني — حدّث الصفحة",
  PUBLISH_BLOCKED: "صلّح المشاكل قبل النشر",
  NOT_FOUND: "غير موجود",
  FILE_TOO_LARGE: "الملف كبير (الحد ٤ ميغا)",
  UNSUPPORTED_FILE: "نوع الملف غير مدعوم (JPG أو PNG أو WEBP أو GIF)",
  SCHEMA_OUTDATED: "قاعدة البيانات تحتاج تحديث (شغّل ملف الـ migration الجديد)",
  BAD_REQUEST: "طلب غير صالح",
  GAME_ALREADY_STARTED: "اللعبة بدأت خلاص",
  NETWORK: "في مشكلة بالاتصال، جرّب مرة ثانية",
  SERVER_NOT_CONFIGURED: "السيرفر مو مجهز (إعدادات Supabase ناقصة)",
  CODE_EXHAUSTED: "ما قدرنا نسوي رمز جديد، جرّب مرة ثانية",
  DX_GAME_BROKEN: "اللعبة فيها مشاكل — صلّحها من لوحة التحكم",
  NOT_STARTED: "اللعبة ما بدأت",
  NOT_YOUR_TURN: "مو دورك الحين",
  BUSY: "ضغط كثير، جرّب مرة ثانية",
  GAME_OVER: "اللعبة خلصت",
  DX_INVALID: "تصميم اللعبة فيه أخطاء",
  MF_PAUSED: "اللعبة موقّفة مؤقتًا",
  MF_CLOSED: "انتهى الوقت",
  MF_DEAD: "أنت طالع من اللعبة",
  MF_NOT_YOURS: "مو دورك الحين",
  MF_TARGET: "ما تقدر تختار هذا الشخص",
  MF_LOCKED: "حققت مع شخص الليلة خلاص",
  MF_INTRO: "اللعبة بتبدأ بعد لحظات…",
  IV_CLOSED: "انقفلت هالمرحلة، تابع الشاشة",
  IV_EMPTY: "اكتب إجابتك (لين ٢٠٠ حرف)",
  IV_ANSWERED: "أرسلت إجابتك خلاص",
  IV_VOTED: "صوّتت خلاص",
  IV_OWN_ANSWER: "ما تقدر تصوّت لإجابتك 😏",
  IV_BAD_CHOICE: "اختيار غير صالح",
  IV_NOT_SEATED: "دخلت بعد ما بدأت الجولة، انتظر المباراة الجاية",
};

/** Like errorMessage, but prefers the server's own explanation (game rule errors). */
export function resultMessage(res: { error: string; message?: unknown }): string {
  return typeof res.message === "string" && res.message ? res.message : errorMessage(res.error);
}

export function errorMessage(code: string | null | undefined): string {
  if (!code) return "";
  return MESSAGES[code] ?? "صار خطأ غير متوقع، جرّب مرة ثانية";
}
