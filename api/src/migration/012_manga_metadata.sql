ALTER TABLE manga ADD COLUMN IF NOT EXISTS author TEXT;
ALTER TABLE manga ADD COLUMN IF NOT EXISTS artist TEXT;
ALTER TABLE manga ADD COLUMN IF NOT EXISTS publisher TEXT;
ALTER TABLE manga ADD COLUMN IF NOT EXISTS published_year SMALLINT;

-- Sanity bound for published_year: allow historical works but reject absurd
-- values. Nullable, so rows without a year are unaffected.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'manga_published_year_check'
      AND conrelid = 'manga'::regclass
  ) THEN
    ALTER TABLE manga
      ADD CONSTRAINT manga_published_year_check
      CHECK (published_year IS NULL OR published_year BETWEEN 1000 AND 2300);
  END IF;
END $$;
