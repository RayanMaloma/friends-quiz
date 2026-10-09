import { readMedia } from "@/lib/server/media";

export const dynamic = "force-dynamic";

/** Serves an uploaded image. Keys are random and immutable, so it caches forever. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  try {
    const media = await readMedia(key);
    if (!media) return new Response("Not found", { status: 404 });
    return new Response(media.bytes as BodyInit, {
      headers: {
        "Content-Type": media.type,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    console.error("[media]", err);
    return new Response("Error", { status: 500 });
  }
}
