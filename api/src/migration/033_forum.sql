-- Forum: seeded categories -> threads -> flat posts, plus a report queue.
-- Additive only. Profanity is masked in the app before storing; the length
-- CHECKs are the DB-side backstop for the service-side validation.

-- Seed data, not user data: there is no category CRUD API — a new category is a
-- migration. The INSERT is ON CONFLICT DO NOTHING so a re-run cannot duplicate
-- or clobber a locally edited name/description.
CREATE TABLE IF NOT EXISTS forum_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO forum_categories (slug, name, description, sort_order)
VALUES
  ('general', 'General', 'Anything and everything.', 10),
  ('manga-talk', 'Manga Talk', 'Series discussion, recommendations, and reviews.', 20),
  ('site-feedback', 'Site Feedback', 'Bugs, requests, and feedback about the site.', 30)
ON CONFLICT (slug) DO NOTHING;

-- last_post_at is the only stored denormalization (thread creation counts as
-- activity, and a reply bumps it in the same transaction as the insert). Reply
-- counts stay derived via COUNT — no counter to drift.
CREATE TABLE IF NOT EXISTS forum_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  pinned BOOLEAN NOT NULL DEFAULT false,
  locked BOOLEAN NOT NULL DEFAULT false,
  last_post_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Category listing order: pinned first, then most recent activity.
CREATE INDEX IF NOT EXISTS idx_forum_threads_category_activity
  ON forum_threads(category_id, pinned DESC, last_post_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS forum_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Thread reading order: oldest-first flat list.
CREATE INDEX IF NOT EXISTS idx_forum_posts_thread_created
  ON forum_posts(thread_id, created_at ASC, id ASC);

-- Reports cascade with their target: deleting the offending content clears the
-- queue entry. Accepted ceiling — no report audit history in v1; `dismiss`
-- keeps the row as status='dismissed'.
CREATE TABLE IF NOT EXISTS forum_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES forum_threads(id) ON DELETE CASCADE,
  post_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'nsfw', 'other')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT forum_reports_one_target CHECK ((thread_id IS NULL) <> (post_id IS NULL))
);

-- One OPEN report per reporter per target; a dismissed one does not block a
-- re-report. These indexes are the race-safe duplicate check (the API turns the
-- unique violation into a 409), not just a listing aid.
CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_reports_open_thread
  ON forum_reports(reporter_id, thread_id)
  WHERE status = 'open' AND thread_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_reports_open_post
  ON forum_reports(reporter_id, post_id)
  WHERE status = 'open' AND post_id IS NOT NULL;

-- Admin queue read path: filtered by status, newest first.
CREATE INDEX IF NOT EXISTS idx_forum_reports_status_created
  ON forum_reports(status, created_at DESC, id DESC);
