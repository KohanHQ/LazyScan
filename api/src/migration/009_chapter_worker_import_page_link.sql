ALTER TABLE chapter_pages
  ADD COLUMN IF NOT EXISTS import_id UUID;

UPDATE chapter_pages cp
SET import_id = ci.id
FROM chapter_imports ci
WHERE cp.import_id IS NULL
  AND ci.chapter_id = cp.chapter_id;

ALTER TABLE chapter_pages
  ALTER COLUMN import_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chapter_pages_import_id_fkey'
  ) THEN
    ALTER TABLE chapter_pages
      ADD CONSTRAINT chapter_pages_import_id_fkey
      FOREIGN KEY (import_id)
      REFERENCES chapter_imports(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chapter_pages_import_id
  ON chapter_pages(import_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chapter_imports_processed_files_lte_total_files'
  ) THEN
    ALTER TABLE chapter_imports
      ADD CONSTRAINT chapter_imports_processed_files_lte_total_files
      CHECK (processed_files <= total_files);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chapter_imports_failed_files_lte_total_files'
  ) THEN
    ALTER TABLE chapter_imports
      ADD CONSTRAINT chapter_imports_failed_files_lte_total_files
      CHECK (failed_files <= total_files);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chapter_imports_processed_failed_files_lte_total_files'
  ) THEN
    ALTER TABLE chapter_imports
      ADD CONSTRAINT chapter_imports_processed_failed_files_lte_total_files
      CHECK (processed_files + failed_files <= total_files);
  END IF;
END $$;
