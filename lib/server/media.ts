import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAdminClient, isSupabaseConfigured, localDataDir } from "@/lib/server/db";

/**
 * Uploaded images (question photos, portraits, covers).
 *
 * - Production: a PRIVATE Supabase Storage bucket ("media"), created on first
 *   upload. Browsers never talk to Storage; they load /api/media/<key>, which
 *   the server streams (and the CDN caches — keys are immutable).
 * - Local dev: files in .local-db/media.
 *
 * Keys are random UUIDs, so a URL says nothing about who/what is in the photo.
 */

const BUCKET = "media";
// Vercel functions accept request bodies up to ~4.5 MB; photos are resized in the browser first.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;
type MediaType = keyof typeof TYPES;

const EXT_TO_TYPE: Record<string, MediaType> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

/** Detect the real type from the file's first bytes (never trust the client). SVG is not allowed. */
export function sniffImageType(b: Uint8Array): MediaType | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

const KEY_RE = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;

export function isMediaKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function mediaUrl(key: string): string {
  return `/api/media/${key}`;
}

function localDir() {
  return path.join(localDataDir(), "media");
}

let bucketReady: Promise<void> | null = null;

function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const storage = getAdminClient().storage;
    const { error } = await storage.getBucket(BUCKET);
    if (!error) return;
    const created = await storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_UPLOAD_BYTES });
    if (created.error && !/already exists/i.test(created.error.message)) {
      throw new Error(`could not create storage bucket: ${created.error.message}`);
    }
  })().catch((err) => {
    bucketReady = null;
    throw err;
  });
  return bucketReady;
}

export async function saveMedia(bytes: Uint8Array): Promise<{ key: string; url: string } | { error: string }> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { error: "FILE_TOO_LARGE" };
  const type = sniffImageType(bytes);
  if (!type) return { error: "UNSUPPORTED_FILE" };
  const key = `${randomUUID()}.${TYPES[type]}`;

  if (isSupabaseConfigured) {
    await ensureBucket();
    const { error } = await getAdminClient()
      .storage.from(BUCKET)
      .upload(key, bytes, { contentType: type, cacheControl: "31536000", upsert: false });
    if (error) throw new Error(`upload failed: ${error.message}`);
  } else {
    await mkdir(localDir(), { recursive: true });
    await writeFile(path.join(localDir(), key), bytes);
  }
  return { key, url: mediaUrl(key) };
}

export async function readMedia(key: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!isMediaKey(key)) return null;
  const type = EXT_TO_TYPE[key.split(".").pop()!];
  if (isSupabaseConfigured) {
    const { data, error } = await getAdminClient().storage.from(BUCKET).download(key);
    if (error || !data) return null;
    return { bytes: new Uint8Array(await data.arrayBuffer()), type };
  }
  try {
    return { bytes: new Uint8Array(await readFile(path.join(localDir(), key))), type };
  } catch {
    return null;
  }
}
