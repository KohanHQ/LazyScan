import { Redis } from "ioredis";
import { envSchema } from "@/env";
import { createConfig } from "@/config";
import { logWarn } from "@/shared/utility/logger";

// Redis-backed cache for hot, recomputable reads (e.g. popularity ranking),
// reusing the Redis already in the stack for the chapter-page event stream
// (outbox dispatcher -> Kiln) rather than adding infra.
//
// This layer is strictly optional and degrades gracefully: a missing/broken
// Redis is swallowed and treated as a cache miss, and callers recompute from
// Postgres. Values are JSON-serialised with a per-entry TTL. Not for anything that
// needs strong consistency — it is a best-effort read accelerator.

let client: Redis | null = null;
let initialized = false;

// Lazily builds a single shared client. Tuned to fail fast instead of buffering
// commands forever when Redis is down: it gives up reconnecting after a couple of
// tries so optional cache commands reject quickly and fall through to the DB.
function getClient(): Redis | null {
  if (initialized) {
    return client;
  }
  initialized = true;
  try {
    const url = createConfig(envSchema.parse(process.env)).redis.url;
    client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      retryStrategy: (times) => (times > 2 ? null : 200),
    });
    // An unhandled 'error' event would crash the process; downgrade it to a warn.
    // Per-command failures are also caught below, so this is just for noise from
    // background (re)connect attempts.
    client.on("error", (error) => {
      logWarn("Redis cache unavailable; serving uncached", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    logWarn("Redis cache init failed; serving uncached", {
      message: error instanceof Error ? error.message : String(error),
    });
    client = null;
  }
  return client;
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const redis = getClient();
  if (!redis) {
    return undefined;
  }
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlMs: number
): Promise<void> {
  const redis = getClient();
  if (!redis) {
    return;
  }
  try {
    await redis.set(key, JSON.stringify(value), "PX", ttlMs);
  } catch {
    // Best-effort: a failed write just means the next read recomputes and re-caches.
  }
}

// Deletes a single key, or every key under a "prefix:" via SCAN. Invalidation only
// runs on catalog mutations (rare), so the scan cost is acceptable and avoids the
// blocking KEYS command.
export async function cacheInvalidate(prefix: string): Promise<void> {
  const redis = getClient();
  if (!redis) {
    return;
  }
  try {
    if (!prefix.endsWith(":")) {
      await redis.del(prefix);
      return;
    }
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        100
      );
      cursor = next;
      if (keys.length) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch {
    // Best-effort: stale entries expire on their own via TTL.
  }
}
