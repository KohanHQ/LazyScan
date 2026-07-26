-- Forge/image service phase F1: outbox + worker bookkeeping tables (additive only).
-- Nothing reads or writes these until F2 (outbox writes) / F3 (dispatcher) /
-- F4+ (image service consumer). Contract: its event contract docs.

-- Transactional outbox. One row per domain event; id becomes the envelope
-- eventId. The dispatcher (F3) reads unpublished rows, XADDs to Redis
-- Streams, then sets published_at.
CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  publish_attempts INTEGER NOT NULL DEFAULT 0,
  last_publish_error TEXT
);

-- Dispatcher scan path: oldest unpublished first.
CREATE INDEX IF NOT EXISTS idx_outbox_events_unpublished
  ON outbox_events (occurred_at)
  WHERE published_at IS NULL;

-- Consumer-side delivery dedup: a row here means the event was fully
-- handled. PK makes duplicate inserts a no-op conflict. Deliberately no FK
-- to outbox_events so outbox rows stay prunable without losing dedup
-- history.
CREATE TABLE IF NOT EXISTS chapter_worker_processed_events (
  event_id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Durable record for poison/non-retryable failures. raw_event holds the
-- raw stream message (TEXT, not JSONB: unparseable envelopes are the use
-- case). No FKs: page_id is NULL when the envelope never parsed, and rows
-- must survive page/import cascade deletes.
CREATE TABLE IF NOT EXISTS chapter_worker_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID,
  page_id UUID,
  error_message TEXT NOT NULL,
  raw_event TEXT,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retryable BOOLEAN NOT NULL DEFAULT true
);
