-- Trigram indexes for manga search. The search query uses leading-wildcard
-- ILIKE ('%term%'), which a plain B-tree cannot serve, forcing a sequential
-- scan on every GET /manga?search=. GIN + gin_trgm_ops makes it index-backed.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_manga_title_trgm
  ON manga USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_manga_slug_trgm
  ON manga USING GIN (slug gin_trgm_ops);

-- Expression index for uploads filtered/joined by metadata->>'mangaSlug'
-- (deleteUploadsByMangaSlug, findStorageKeysById). Exact-match on the JSONB
-- expression, so a B-tree on the extracted text is enough and cheaper than GIN.
CREATE INDEX IF NOT EXISTS idx_uploads_manga_slug
  ON uploads ((metadata->>'mangaSlug'));
