-- Manga categorization tags. A plain TEXT[] (normalized lowercase by the API)
-- instead of a tags/junction pair: every manga read path keeps its single-table
-- query, and the GIN index serves the `tags @> ARRAY[...]` containment filter.
-- Revisit a normalized model only if tag rename/merge tooling becomes a need.
ALTER TABLE manga ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_manga_tags
  ON manga USING GIN (tags);
