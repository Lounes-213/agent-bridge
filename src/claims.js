import { newId } from "./tokens.js";

/** An error that carries the HTTP status the server should answer with. */
export class BridgeError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = "BridgeError";
    this.status = status;
    this.extra = extra;
  }
}

export const DEFAULT_TTL_MS = 90_000;
export const MIN_TTL_MS = 5_000;
export const MAX_TTL_MS = 3_600_000;

/**
 * Normalise a project path so two agents on different operating systems agree
 * on the same key. Rejects anything that could escape the project root.
 */
export function normalizePath(input) {
  const raw = String(input ?? "").trim();
  if (raw === "") throw new BridgeError(400, "path is required");
  if (raw.length > 400)
    throw new BridgeError(400, "path is longer than 400 characters");

  const slashed = raw.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(slashed) || slashed.startsWith("/")) {
    throw new BridgeError(400, "path must be relative to the project root");
  }

  const parts = [];
  for (const part of slashed.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw new BridgeError(400, "path must not contain '..'");
    parts.push(part);
  }
  if (parts.length === 0) throw new BridgeError(400, "path is required");
  return parts.join("/");
}

export function clampTtl(ttlSeconds, fallbackMs = DEFAULT_TTL_MS) {
  if (ttlSeconds === undefined || ttlSeconds === null || ttlSeconds === "")
    return fallbackMs;
  const seconds = Number(ttlSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new BridgeError(400, "ttlSeconds must be a positive number");
  }
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.round(seconds * 1000)));
}

/** Drop claims whose lease has ended. Mutates the array and returns it. */
export function pruneClaims(claims, now = Date.now()) {
  for (let index = claims.length - 1; index >= 0; index -= 1) {
    if (claims[index].expiresAt <= now) claims.splice(index, 1);
  }
  return claims;
}

/**
 * Claim a path for an agent. A live claim by another agent is a conflict; the
 * same agent may renew. Returns the claim plus whether it was renewed.
 */
export function claimPath(claims, { path, owner, ttlMs, now = Date.now() }) {
  const normalized = normalizePath(path);
  pruneClaims(claims, now);

  const existing = claims.find((entry) => entry.path === normalized);
  if (existing && existing.owner !== owner) {
    throw new BridgeError(409, "path is already claimed", {
      claim: {
        id: existing.id,
        path: existing.path,
        owner: existing.owner,
        expiresAt: existing.expiresAt,
      },
    });
  }
  if (existing) {
    existing.expiresAt = now + ttlMs;
    return { claim: existing, renewed: true };
  }

  const claim = {
    id: newId(6),
    path: normalized,
    owner,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  claims.push(claim);
  return { claim, renewed: false };
}

export function extendClaim(claims, { id, owner, ttlMs, now = Date.now() }) {
  pruneClaims(claims, now);
  const claim = claims.find((entry) => entry.id === id);
  if (!claim) throw new BridgeError(404, "claim not found or already expired");
  if (claim.owner !== owner)
    throw new BridgeError(403, "claim belongs to another agent");
  claim.expiresAt = now + ttlMs;
  return claim;
}

export function releaseClaim(
  claims,
  { id, owner, isHost = false, now = Date.now() },
) {
  pruneClaims(claims, now);
  const index = claims.findIndex((entry) => entry.id === id);
  if (index === -1)
    throw new BridgeError(404, "claim not found or already expired");
  const claim = claims[index];
  if (!isHost && claim.owner !== owner)
    throw new BridgeError(403, "claim belongs to another agent");
  claims.splice(index, 1);
  return claim;
}
