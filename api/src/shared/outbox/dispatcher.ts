import { Redis } from "ioredis";
import { envSchema } from "@/env";
import { createConfig } from "@/config";
import { getDbClient } from "@/shared/database/client";
import { recordDispatched } from "@/shared/metrics/outbox";
import { logInfo, logWarn, logError } from "@/shared/utility/logger";

// Publishes unpublished outbox rows to the Redis Stream their consumer
// reads, routed by event-type prefix: chapter events to the image service
// (binding contract: its event contract docs), auth email events to mail.
// Runs inside the API process.
//
// Delivery is at-least-once: a crash between XADD and the published_at
// UPDATE re-publishes the same eventId next tick, and a second API instance
// would double-publish too (no SKIP LOCKED in v1) — the consumers dedup by
// eventId, so both are benign by design.

// First matching prefix wins. The chapter stream key is byte-identical to
// the pre-routing dispatcher so the image service's contract is untouched.
const STREAM_BY_PREFIX: Array<[prefix: string, stream: string]> = [
  ["chapter.", "events:chapter-page"],
  ["auth.email.", "events:email"],
];

// An unrouted event_type (typo or a producer ahead of this map) returns
// null: the row is marked published with last_publish_error = "unrouted" so
// it never re-scans forever, stays auditable, and is never silently XADDed
// onto the wrong stream.
function streamFor(eventType: string): string | null {
  for (const [prefix, stream] of STREAM_BY_PREFIX) {
    if (eventType.startsWith(prefix)) {
      return stream;
    }
  }
  return null;
}

// Wire format: one `event` field holding the envelope JSON; schemaVersion
// lives inside the envelope.
const STREAM_FIELD = "event";
// Approximate cap so the stream cannot grow unbounded; trimmed entries
// remain replayable from the outbox by re-nulling published_at.
const STREAM_MAXLEN = 10_000;
const TICK_INTERVAL_MS = 1_000;
const BATCH_SIZE = 100;

interface OutboxRow {
  id: string;
  event_type: string;
  schema_version: number;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  occurred_at: Date;
}

export interface OutboxDispatcher {
  stop(): Promise<void>;
}

function buildEnvelope(row: OutboxRow): string {
  return JSON.stringify({
    eventId: row.id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    occurredAt: row.occurred_at.toISOString(),
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: row.payload,
  });
}

export function startOutboxDispatcher(): OutboxDispatcher {
  const db = getDbClient();
  const redisUrl = createConfig(envSchema.parse(process.env)).redis.url;

  // Dedicated client, not the fail-fast cache client: the dispatcher must
  // keep reconnecting across Redis restarts. Offline queueing is disabled so
  // a down Redis rejects XADD immediately — the row's publish_attempts and
  // last_publish_error record the failure and the next tick retries.
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  redis.on("error", (error) => {
    logWarn("Outbox dispatcher Redis error", {
      message: error instanceof Error ? error.message : String(error),
    });
  });

  let stopped = false;
  let ticking = false;

  async function publishBatch(): Promise<void> {
    const rows = await db<OutboxRow[]>`
      SELECT id, event_type, schema_version, aggregate_type, aggregate_id,
             payload, occurred_at
      FROM outbox_events
      WHERE published_at IS NULL
      ORDER BY occurred_at
      LIMIT ${BATCH_SIZE}
    `;

    for (const row of rows) {
      if (stopped) {
        return;
      }

      const stream = streamFor(row.event_type);
      if (!stream) {
        logWarn("Outbox event has no stream route; skipping", {
          eventId: row.id,
          eventType: row.event_type,
        });
        await db`
          UPDATE outbox_events
          SET published_at = now(),
              last_publish_error = 'unrouted'
          WHERE id = ${row.id}
            AND published_at IS NULL
        `;
        continue;
      }

      try {
        await redis.xadd(
          stream,
          "MAXLEN",
          "~",
          STREAM_MAXLEN,
          "*",
          STREAM_FIELD,
          buildEnvelope(row),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logWarn("Outbox publish failed; will retry", {
          eventId: row.id,
          message,
        });
        await db`
          UPDATE outbox_events
          SET publish_attempts = publish_attempts + 1,
              last_publish_error = ${message}
          WHERE id = ${row.id}
        `;
        continue;
      }
      recordDispatched(stream);
      await db`
        UPDATE outbox_events
        SET published_at = now()
        WHERE id = ${row.id}
          AND published_at IS NULL
      `;
    }
  }

  async function tick(): Promise<void> {
    if (ticking || stopped) {
      return;
    }
    ticking = true;
    try {
      await publishBatch();
    } catch (error) {
      // Postgres hiccups land here; the rows stay unpublished and the next
      // tick retries, so log and carry on rather than killing the loop.
      logError(
        "Outbox dispatcher tick failed",
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      ticking = false;
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);

  logInfo("Outbox dispatcher started", {
    streams: STREAM_BY_PREFIX.map(([, stream]) => stream),
    intervalMs: TICK_INTERVAL_MS,
    batchSize: BATCH_SIZE,
  });

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      // Let an in-flight tick drain before closing the connection.
      while (ticking) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      redis.disconnect();
      logInfo("Outbox dispatcher stopped");
    },
  };
}
