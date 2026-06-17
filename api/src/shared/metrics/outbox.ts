import { Counter, Gauge } from "prom-client";
import { getDbClient } from "@/shared/database/client";
import { logWarn } from "@/shared/utility/logger";
import { registry } from "@/shared/metrics/metrics";

// Outbox pipeline-health metrics (observability plan O4). The two gauges
// come from one SQL poll on a 10s interval — not per scrape — so a scrape
// burst never multiplies Postgres load. The dispatched counter is
// incremented by the dispatcher at successful XADD (a counter must be
// monotonic, so it cannot be computed from an interval query; plan
// deviation recorded in the session log). At-least-once publishing means
// a crash between XADD and the published_at UPDATE re-publishes and
// re-counts — slight overcount, benign by design.

const POLL_INTERVAL_MS = 10_000;

const undispatched = new Gauge({
  name: "outbox_undispatched",
  help: "Outbox rows not yet published to their stream.",
  registers: [registry],
});

const oldestAge = new Gauge({
  name: "outbox_oldest_age_seconds",
  help: "Age of the oldest unpublished outbox row (#1 pipeline-health signal).",
  registers: [registry],
});

const dispatched = new Counter({
  name: "outbox_dispatched_total",
  help: "Outbox rows published to a Redis Stream.",
  labelNames: ["stream"] as const,
  registers: [registry],
});

// recordDispatched is the dispatcher's seam: one row published to a stream.
export function recordDispatched(stream: string): void {
  dispatched.inc({ stream });
}

export interface OutboxMetrics {
  stop(): void;
}

// startOutboxMetrics polls the outbox gauges. Lives in index.ts next to
// the dispatcher (not in createApp) so tests never start it. A failed poll
// logs and skips the tick — gauges go stale, nothing else is affected.
export function startOutboxMetrics(): OutboxMetrics {
  const db = getDbClient();
  let stopped = false;
  let polling = false;

  async function poll(): Promise<void> {
    if (polling || stopped) {
      return;
    }
    polling = true;
    try {
      const [row] = await db<
        { undispatched: number; oldest_age_seconds: number | null }[]
      >`
        SELECT count(*)::int AS undispatched,
               EXTRACT(EPOCH FROM (now() - min(occurred_at)))::float
                 AS oldest_age_seconds
        FROM outbox_events
        WHERE published_at IS NULL
      `;
      undispatched.set(row?.undispatched ?? 0);
      oldestAge.set(row?.oldest_age_seconds ?? 0);
    } catch (error) {
      logWarn("Outbox metrics poll failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      polling = false;
    }
  }

  void poll();
  const timer = setInterval(() => {
    void poll();
  }, POLL_INTERVAL_MS);

  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}
