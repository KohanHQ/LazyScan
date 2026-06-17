-- Popularity ranking source. One bucket row per (manga, calendar day); each read
-- (a reader opening a ready chapter) increments that day's `views`. Bounded growth
-- (<= #manga * #days) keeps aggregation cheap and needs no pruning worker, unlike
-- an append-only event log. `view_date` is the DB server-TZ date (CURRENT_DATE),
-- so "today"/"this week" windows are server-local. ON DELETE CASCADE drops a
-- manga's buckets with the manga.
CREATE TABLE IF NOT EXISTS manga_views (
  manga_id UUID NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  view_date DATE NOT NULL DEFAULT CURRENT_DATE,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (manga_id, view_date)
);

-- Popular query filters by a trailing date window before grouping; index the date.
CREATE INDEX IF NOT EXISTS idx_manga_views_date ON manga_views(view_date);
