-- First real use of the reserved generic `/upload` route: owner avatar upload.
-- Extends the uploads.type allow-list with 'avatar'. The CHECK has to be
-- dropped and re-added (Postgres cannot alter a CHECK in place); the new list
-- is a superset, so existing rows always satisfy it and this stays additive.
ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_type_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_type_check
  CHECK (type IN ('manga_cover', 'chapter_page', 'avatar'));
