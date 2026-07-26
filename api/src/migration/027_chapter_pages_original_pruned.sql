-- Storage prune bookkeeping (lite self-host): mark when a page's staged original
-- has been reclaimed. The image service downloads the staged original
-- (imports/{importId}/originals/...) and writes the final WebP (storage_key) but
-- never deletes the original, so a processed page keeps BOTH objects (~2x page
-- storage). The prune job deletes the original of ready pages and stamps
-- original_pruned_at so each is reclaimed exactly once and never rescanned.
-- Additive + idempotent.
ALTER TABLE chapter_pages
  ADD COLUMN IF NOT EXISTS original_pruned_at TIMESTAMPTZ;

-- Drives the prune scan: only ready, not-yet-pruned pages. Partial keeps the
-- index tiny (rows leave it the moment they are pruned).
CREATE INDEX IF NOT EXISTS idx_chapter_pages_prunable
  ON chapter_pages (created_at)
  WHERE original_pruned_at IS NULL AND status = 'ready';
