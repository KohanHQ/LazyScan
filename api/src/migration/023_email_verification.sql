-- Mail phase H1: email verification + mail service worker bookkeeping (additive
-- only). Nothing reads or writes these until H2 (auth flow, flag-gated) /
-- H4+ (mail service consumer). Contract: its OTP plan docs.

-- Hard-verify column. DEFAULT false applies to NEW rows; the backfill below
-- grandfathers every EXISTING account to true so nobody is locked out when
-- REQUIRE_EMAIL_VERIFICATION flips on. Application code always sets the
-- value explicitly (register: false, superuser bootstrap: true) and never
-- relies on the default.
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
UPDATE users SET verified = true WHERE verified = false;

-- OTP store. One active (unconsumed, unexpired) row per user is the norm;
-- resend rotates that row (new code_hash/salt/expires_at, attempts reset).
-- code_hash = sha256(code || salt) hex — the 5-attempt cap is the real
-- brute-force control, not hash work factor. Plaintext codes exist only in
-- outbox_events.payload (10-min TTL bounds exposure; never logged).
CREATE TABLE IF NOT EXISTS email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Verify/resend lookup path: latest unconsumed row for a user.
CREATE INDEX IF NOT EXISTS idx_email_verifications_user_active
  ON email_verifications (user_id, created_at DESC)
  WHERE consumed_at IS NULL;

-- mail-service-side delivery dedup (mirrors chapter_worker_processed_events). A
-- row here means the email was sent. PK makes duplicate inserts a no-op
-- conflict. Deliberately no FK to outbox_events so outbox rows stay
-- prunable without losing dedup history.
CREATE TABLE IF NOT EXISTS herald_processed_events (
  event_id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Durable record for poison/non-retryable failures (mirrors
-- chapter_worker_failures). raw_event holds the raw stream message (TEXT,
-- not JSONB: unparseable envelopes are the use case). No FKs: user_id is
-- NULL when the envelope never parsed, and rows must survive user cascade
-- deletes.
CREATE TABLE IF NOT EXISTS herald_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID,
  user_id UUID,
  error_message TEXT NOT NULL,
  raw_event TEXT,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retryable BOOLEAN NOT NULL DEFAULT true
);
