import { randomBytes, timingSafeEqual } from "node:crypto";

/** A prefixed random token, safe to put in a URL path or an Authorization header. */
export function newToken(prefix = "tok") {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

/** A short opaque id for rooms, claims, and files. */
export function newId(bytes = 8) {
  return randomBytes(bytes).toString("hex");
}

/** Constant-time comparison that never throws on length mismatch. */
export function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
