-- Per-user reading status: a single tracking state per (user, manga), chosen
-- from a fixed set ('reading','completed','plan_to_read','on_hold','dropped').
-- Distinct from user_library (favorites/queue): status is single-select, so the
-- (user_id, manga_id) primary key allows at most one status per manga and
-- switching status is an ON CONFLICT DO UPDATE.
CREATE TABLE IF NOT EXISTS reading_status (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manga_id UUID NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('reading', 'completed', 'plan_to_read', 'on_hold', 'dropped')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, manga_id)
);

CREATE INDEX IF NOT EXISTS idx_reading_status_user_status ON reading_status(user_id, status);
