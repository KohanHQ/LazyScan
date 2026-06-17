-- Metadata search/sort/filter for GET /manga. Search now also matches author,
-- artist, and publisher via leading-wildcard ILIKE, so each needs a trigram GIN
-- index (same rationale as the title/slug indexes in 013). published_year gains a
-- plain B-tree for the equality filter and the new sort option.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_manga_author_trgm
  ON manga USING GIN (author gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_manga_artist_trgm
  ON manga USING GIN (artist gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_manga_publisher_trgm
  ON manga USING GIN (publisher gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_manga_published_year
  ON manga (published_year);
