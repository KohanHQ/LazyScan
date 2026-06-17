-- Chapter volume (MangaDex-style grouping). Nullable NUMERIC mirroring
-- chapter_number: most catalogs use whole volumes but decimals exist (e.g.
-- omnibus 1.5), and NULL means "no volume" — the detail page only renders
-- volume group headers when at least one chapter has a value.
--
-- Deliberately no index and no ordering change: the reader's chapter ordering
-- (sort_order, chapter_number NULLS LAST, created_at, id) stays authoritative
-- (the reading-history hasNextChapter EXISTS mirrors that tuple), and volume
-- grouping is a display-only concern on the client.
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS volume NUMERIC(10, 2);
