-- Password reset OTP + login lockout (additive only).

-- email_verifications now serves two OTP flows. DEFAULT 'verify' grandfathers
-- every existing row (they are all registration codes); application code always
-- sets the value explicitly and never relies on the default.
ALTER TABLE email_verifications
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'verify';

-- Lookup path is now per-purpose: latest unconsumed row for (user, purpose).
-- Replaces the purpose-blind index from 023 — a reset code must not shadow a
-- pending verification code (or vice versa).
DROP INDEX IF EXISTS idx_email_verifications_user_active;
CREATE INDEX IF NOT EXISTS idx_email_verifications_user_purpose_active
  ON email_verifications (user_id, purpose, created_at DESC)
  WHERE consumed_at IS NULL;

-- Login lockout counters. locked_until NULL = not locked; both are cleared on a
-- successful login and on a completed password reset.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
