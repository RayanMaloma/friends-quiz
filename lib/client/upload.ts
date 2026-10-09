"use client";

import { errorMessage } from "@/lib/client/api";

/**
 * Uploads an image for the game. Photos straight from a phone can be 5–10 MB,
 * so we shrink them in the browser first (keeps uploads fast and under the
 * server limit). GIFs are uploaded as-is to keep animation.
 */

// Vercel functions accept request bodies up to ~4.5 MB.
const MAX_BYTES = 4 * 1024 * 1024;

export type UploadKind = "photo" | "portrait" | "option";

const MAX_DIM: Record<UploadKind, number> = { photo: 1920, portrait: 1400, option: 800 };

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Keep the URL alive until decode finished; the element holds the pixels now.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function prepareImage(file: File, kind: UploadKind): Promise<Blob> {
  if (file.type === "image/gif") return file;
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decode(file);
  } catch {
    if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
      throw new Error("HEIC");
    }
    // Unknown to the browser: let the server decide (it checks the real type).
    return file;
  }
  const w = "naturalWidth" in source ? source.naturalWidth : source.width;
  const h = "naturalHeight" in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, MAX_DIM[kind] / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) source.close();

  // WebP keeps transparency (portrait cutouts) and is small. Older Safari
  // can't encode it and returns PNG instead: use JPEG for photos then.
  const webp = await canvasToBlob(canvas, "image/webp", 0.86);
  if (webp && webp.type === "image/webp") return webp;
  if (kind === "portrait") {
    const png = await canvasToBlob(canvas, "image/png", 1);
    if (png && png.size <= MAX_BYTES) return png;
  }
  const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.86);
  return jpeg ?? file;
}

export async function uploadImage(file: File, kind: UploadKind): Promise<{ url: string } | { error: string }> {
  let blob: Blob;
  try {
    blob = await prepareImage(file, kind);
  } catch (err) {
    if (err instanceof Error && err.message === "HEIC") {
      return { error: "صور HEIC ما تنفتح في هذا المتصفح — ارفعها من سفاري أو حوّلها JPG" };
    }
    return { error: "ما قدرنا نقرأ الصورة" };
  }
  if (blob.size > MAX_BYTES) return { error: "الصورة كبيرة (الحد ٤ ميغا)" };
  const form = new FormData();
  form.append("file", blob, file.name);
  try {
    const res = await fetch("/api/admin/media", { method: "POST", body: form });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      return { error: errorMessage(json?.error ?? "SERVER_ERROR") };
    }
    return { url: json.url as string };
  } catch {
    return { error: "في مشكلة بالاتصال، جرّب مرة ثانية" };
  }
}
