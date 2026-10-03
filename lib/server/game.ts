import "server-only";
import { rpc, ConfigError } from "@/lib/server/db";
import type { Snapshot } from "@/lib/types";

export type RpcResult = { ok: true; [k: string]: unknown } | { ok: false; error: string };

export async function getSnapshot(sessionId: string): Promise<Snapshot | null> {
  const res = await rpc<({ ok: true } & Snapshot) | { ok: false; error: string }>(
    "fq_get_snapshot",
    { p_session_id: sessionId },
  );
  if (!res.ok) return null;
  return res;
}

export function fail(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

export function ok(body: Record<string, unknown>) {
  return Response.json({ ok: true, ...body });
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

export function handleError(err: unknown) {
  if (err instanceof ConfigError) {
    console.error("[config]", err.message);
    return fail("SERVER_NOT_CONFIGURED", 500);
  }
  console.error("[api]", err);
  return fail("SERVER_ERROR", 500);
}
