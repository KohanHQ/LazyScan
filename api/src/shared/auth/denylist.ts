import { cacheGet, cacheSet } from "@/shared/cache/redis";

// Server-side session revocation: a per-token (jti) denylist in Redis. Logout
// writes the current token's jti with a TTL equal to its remaining lifetime, so
// the entry self-expires exactly when the token would have anyway — growth is
// bounded to "one key per active revoked token".
//
// Reuses the shared cache Redis client (and its swallow-on-error behavior), so
// this is deliberately FAIL-OPEN: if Redis is unreachable mid-run, a revoked
// token is treated as still valid rather than logging every user out. Redis is a
// hard boot dependency, so the exposure window is a mid-run blip. The security
// tradeoff (availability over a brief revocation gap) is recorded in
// known-constraints.md.

const DENYLIST_PREFIX = "session:denylist:";

// Revokes a session by its jti. ttlMs is the token's remaining lifetime; a
// non-positive value (already expired) is a no-op. Best-effort: a Redis failure
// is swallowed by cacheSet, leaving the token valid until natural expiry.
export async function revokeSession(jti: string, ttlMs: number): Promise<void> {
  if (ttlMs <= 0) {
    return;
  }
  await cacheSet(`${DENYLIST_PREFIX}${jti}`, 1, ttlMs);
}

// True if the jti has been revoked. Fail-open: a missing key OR a Redis error
// both read as "not revoked".
export async function isSessionRevoked(jti: string): Promise<boolean> {
  const value = await cacheGet<number>(`${DENYLIST_PREFIX}${jti}`);
  return value !== undefined;
}
