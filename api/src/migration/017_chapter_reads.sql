-- Explicit per-chapter read state. One row per (user, chapter) means a chapter is
-- read; absence means unread. This is orthogonal to `reading_progress`, which pins
-- a single "continue reading" position per (user, manga). Reads let a richer model
-- track read/unread per chapter (including out-of-order reads) instead of deriving
-- it positionally from the pinned progress chapter.
--
-- `manga_id` is denormalized (with an index) so listing a user's read chapters for
-- one manga is a cheap index scan without joining `chapters`, matching the
-- denormalization style in `reading_progress`/`manga_views`. ON DELETE CASCADE on
-- all FKs drops a user's/manga's/chapter's read rows with the parent.
--
-- No historical backfill: existing positional "read" state (chapters before the
-- pinned progress) is not migrated, so chapters render unread until re-read or
-- explicitly marked.
CREATE TABLE IF NOT EXISTS chapter_reads (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  manga_id UUID NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_chapter_reads_user_manga ON chapter_reads(user_id, manga_id);
