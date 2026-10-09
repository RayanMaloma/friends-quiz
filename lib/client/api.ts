export type ApiResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; status: number; [extra: string]: unknown };

const TIMEOUT_MS = 10000;

export async function api<T = Record<string, unknown>>(
  endpoint: "/api/host" | "/api/guest" | "/api/admin",
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
export const FATAL_ERRORS = new Set(["FORBIDDEN", "NOT_A_PLAYER", "GAME_NOT_FOUND"]);

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
};

export function errorMessage(code: string | null | undefined): string {
  if (!code) return "";
  return MESSAGES[code] ?? "صار خطأ غير متوقع، جرّب مرة ثانية";
}
