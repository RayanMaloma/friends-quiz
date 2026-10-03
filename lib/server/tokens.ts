import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Tokens are generated server-side (crypto.randomUUID isn't available on
// plain-http LAN pages in iOS Safari). Only the sha256 hash is stored in the DB.
export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isTokenShaped(v: unknown): v is string {
  return typeof v === "string" && v.length >= 16 && v.length <= 128;
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
}
