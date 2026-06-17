import { Redis } from "ioredis";
import { createApp } from "@/app";
import { envSchema } from "@/env";
import { createConfig } from "@/config";
import { getDbClient } from "@/shared/database/client";
import { createStorageService } from "@/shared/storage";
import { ensureDefaultSuperuser } from "@/modules/auth/auth.service";
import { pruneStagingOriginals } from "@/modules/chapter/chapter.service";
import { startOutboxDispatcher } from "@/shared/outbox/dispatcher";
import { startOutboxMetrics } from "@/shared/metrics/outbox";

const env = envSchema.parse(process.env);
const config = createConfig(env);

async function pingDatabase(): Promise<boolean> {
  try {
    const db = getDbClient();
    await db`SELECT 1`;
    return true;
  } catch (error) {
    console.error("[Database] Connection failed:", error);
    return false;
  }
}

// Boot guard: Redis backs the outbox dispatcher (events:chapter-page stream to
// Kiln) and the popularity cache. Probes once and gives up fast instead of
// reconnecting forever, so a dead Redis is detected at boot rather than
// surfacing later as silently-stalled chapter processing.
async function pingRedis(): Promise<boolean> {
  const client = new Redis(config.redis.url, {
    lazyConnect: true,
    connectTimeout: 3_000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  // Swallow background connect errors; the connect()/ping() below is authoritative.
  client.on("error", () => {});
  try {
    await client.connect();
    return (await client.ping()) === "PONG";
  } catch (error) {
    console.error("[Redis] Connection failed:", error);
    return false;
  } finally {
    client.disconnect();
  }
}

async function pingStorage(): Promise<boolean> {
  if (!config.storage.isConfigured) {
    console.warn("[Storage] not configured, skipping ping");
    return false;
  }

  try {
    const storage = createStorageService(config);
    await storage.exists("_ping_test");
    return true;
  } catch (error) {
    console.error("[Storage] connection failed:", error);
    return false;
  }
}

interface StoragePrune {
  stop(): void;
}

// Periodic storage prune (lite self-host): reclaims staged page originals Kiln
// has already converted so MinIO usage stays under its bucket quota. Lives here
// (not in createApp) so tests never start it; gated by ENABLE_STORAGE_PRUNE. A
// failed run logs and waits for the next tick. The admin endpoint runs the same
// job on demand regardless of this flag.
function startStoragePrune(intervalMs: number): StoragePrune {
  let stopped = false;
  let running = false;

  async function tick(): Promise<void> {
    if (running || stopped) {
      return;
    }
    running = true;
    try {
      await pruneStagingOriginals();
    } catch (error) {
      console.error("[StoragePrune] run failed:", error);
    } finally {
      running = false;
    }
  }

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function startServer() {
  console.log("Starting server...\n");

  const dbOk = await pingDatabase();
  console.log(`[Database] PostgreSQL: ${dbOk ? "✓ connected" : "✗ failed"}`);
  if (!dbOk) {
    console.error(
      "[Database] Required; aborting boot. Ensure PostgreSQL is running and DATABASE_URL is correct."
    );
    process.exit(1);
  }

  // Hard dependency: abort the boot if Redis is unreachable. Without it chapter
  // page events never reach Kiln and the popularity cache is dead, so running on
  // is worse than failing loudly.
  const redisOk = await pingRedis();
  console.log(`[Redis] dispatcher/cache: ${redisOk ? "✓ connected" : "✗ unreachable"}`);
  if (!redisOk) {
    console.error(
      "[Redis] Required for the outbox dispatcher and the popularity cache; aborting boot. Ensure Redis is running and REDIS_URL is correct."
    );
    process.exit(1);
  }

  const storageOk = await pingStorage();
  console.log(`[Storage] ${config.storage.provider}: ${storageOk ? "✓ connected" : "✗ not configured"}`);

  const defaultSuperuser = await ensureDefaultSuperuser(config.auth.defaultSuperuser);
  console.log(`[Auth] Default superuser: ${defaultSuperuser ? "ready" : "not configured"}`);

  console.log("");

  const app = createApp();

  app.listen(
    {
      port: Number(process.env.PORT) || 3000,
      hostname: process.env.HOST || "0.0.0.0",
    },
    ({ hostname, port }) => {
      console.log(`Elysia is running at http://${hostname}:${port}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    },
  );

  // Outbox -> Redis Streams publisher. Lives here (not in createApp) so
  // tests never start it. Boot already hard-requires Redis.
  const dispatcher = startOutboxDispatcher();
  // Outbox gauge poller (O4) — same lifecycle home as the dispatcher.
  const outboxMetrics = startOutboxMetrics();
  // Storage prune poller (lite self-host) — same lifecycle home. Off unless
  // ENABLE_STORAGE_PRUNE; the bundled compose turns it on.
  const storagePrune = config.storagePrune.enabled
    ? startStoragePrune(config.storagePrune.intervalMs)
    : null;
  console.log(
    `[StoragePrune] ${config.storagePrune.enabled ? `enabled (every ${Math.round(config.storagePrune.intervalMs / 1000)}s)` : "disabled"}`,
  );

  const shutdown = (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    outboxMetrics.stop();
    storagePrune?.stop();
    dispatcher
      .stop()
      .catch(() => {})
      .finally(() => process.exit(0));
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((error) => {
  console.error("[Server] Failed to start:", error);
  process.exit(1);
});
