import { fail, handleError, ok } from "@/lib/server/game";
import { isAdmin, isSameOriginRequest } from "@/lib/server/admin";
import { MAX_UPLOAD_BYTES, saveMedia } from "@/lib/server/media";

export const dynamic = "force-dynamic";

/** Upload one image (multipart field "file"). Admin only. */
export async function POST(req: Request) {
  try {
    if (!isSameOriginRequest(req)) return fail("FORBIDDEN", 403);
    if (!(await isAdmin())) return fail("ADMIN_REQUIRED", 401);
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_UPLOAD_BYTES + 64 * 1024) return fail("FILE_TOO_LARGE", 413);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("BAD_REQUEST");
    }
    const file = form.get("file");
    if (!(file instanceof Blob)) return fail("BAD_REQUEST");
    if (file.size > MAX_UPLOAD_BYTES) return fail("FILE_TOO_LARGE", 413);

    const res = await saveMedia(new Uint8Array(await file.arrayBuffer()));
    if ("error" in res) return fail(res.error, 400);
    return ok({ url: res.url });
  } catch (err) {
    return handleError(err);
  }
}
