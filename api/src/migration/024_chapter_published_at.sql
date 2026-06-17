-- Chapter lifecycle (Cluster A): API-owned publish visibility, orthogonal to the
-- Kiln-owned processing `status`. Reader visibility becomes
-- `status = 'ready' AND published_at IS NOT NULL`.
--
-- `status` (importing|processing|ready|failed) is written by the Kiln worker and
-- means "processing lifecycle". `published_at` is written only by the API and
-- means "the owner has made this chapter reader-visible". A draft-held chapter is
-- processed normally (status reaches 'ready') but stays invisible until published.
ALTER TABLE chapters
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Reader-visibility scan path: the catalog/feed/updates queries filter published
-- chapters per manga.
CREATE INDEX IF NOT EXISTS idx_chapters_published
  ON chapters (manga_id)
  WHERE published_at IS NOT NULL;

-- Backfill: every chapter that is already 'ready' was reader-visible before this
-- migration, so it must stay visible. Use updated_at (the worker's last touch,
-- ~= the old publish time) as the publish timestamp so updates/feed ordering is
-- preserved. Without this, all existing chapters would vanish from the catalog.
UPDATE chapters
  SET published_at = updated_at
  WHERE status = 'ready' AND published_at IS NULL;
