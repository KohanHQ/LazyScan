-- Deterministic fixture for the visual harness. Idempotent: truncates every
-- content table it owns, then re-inserts fixed ids/timestamps, so N applications
-- leave byte-identical rendered pages.
--
-- Apply (local stack up):
--   docker compose exec -T shared-postgres \
--     psql -U lazyscan -d lazyscan -v ON_ERROR_STOP=1 < web/visual/seed.sql
--
-- `users` is deliberately NOT truncated: the API bootstraps its default
-- superuser only at boot, so wiping it would need an api restart.

BEGIN;

TRUNCATE
  forum_reports,
  forum_posts,
  forum_threads,
  manga_comments,
  chapter_reads,
  reading_status,
  reading_progress,
  user_library,
  manga_views,
  chapter_pages,
  chapter_imports,
  chapters,
  manga,
  uploads,
  logs
  CASCADE;

-- Fixture accounts. password_hash is bcrypt("visual-harness-pw", cost 10) —
-- credentials are harness-only and never reach a deployed database.
INSERT INTO users (id, display_id, email, password_hash, role, verified, created_at, updated_at)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'visualharness',
    'visual@harness.test',
    '$2b$10$b7jBHbYM47l7KgXxp0ThZOXgEqsm1f/xdmMbtqCqdaRk/cLjvjL6S',
    'superuser',
    true,
    '2026-01-02 09:00:00+00',
    '2026-01-02 09:00:00+00'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'visualsecond',
    'second@harness.test',
    '$2b$10$b7jBHbYM47l7KgXxp0ThZOXgEqsm1f/xdmMbtqCqdaRk/cLjvjL6S',
    'user',
    true,
    '2026-01-03 09:00:00+00',
    '2026-01-03 09:00:00+00'
  )
ON CONFLICT (id) DO UPDATE SET
  display_id = EXCLUDED.display_id,
  email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  verified = EXCLUDED.verified,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  failed_login_attempts = 0,
  locked_until = NULL;

INSERT INTO profiles (user_id, username, display_name, avatar_url, bio, profile_visibility, shelf_visibility, created_at, updated_at)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'harness',
    'Harness Reader',
    NULL,
    'Fixture account for the visual regression harness. Reads slowly, files bugs quickly.',
    'public',
    'public',
    '2026-01-02 09:00:00+00',
    '2026-01-02 09:00:00+00'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'inkling',
    'Inkling',
    NULL,
    NULL,
    'public',
    'private',
    '2026-01-03 09:00:00+00',
    '2026-01-03 09:00:00+00'
  )
ON CONFLICT (user_id) DO UPDATE SET
  username = EXCLUDED.username,
  display_name = EXCLUDED.display_name,
  avatar_url = EXCLUDED.avatar_url,
  bio = EXCLUDED.bio,
  profile_visibility = EXCLUDED.profile_visibility,
  shelf_visibility = EXCLUDED.shelf_visibility,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at;

-- Covers are inline SVG data URIs: no MinIO round trip, so a container with no
-- route to the published storage port still renders identical pixels.
INSERT INTO manga (id, title, slug, cover_url, description, status, total_chapters, author, artist, publisher, published_year, tags, created_by_user_id, created_at, updated_at)
VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    'Aurora Drift',
    'aurora-drift',
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iOTAwIiB2aWV3Qm94PSIwIDAgNjAwIDkwMCI+PHJlY3Qgd2lkdGg9IjYwMCIgaGVpZ2h0PSI5MDAiIGZpbGw9IiMxZjJhMzMiLz48cmVjdCB4PSI2MCIgeT0iMTIwIiB3aWR0aD0iNDgwIiBoZWlnaHQ9IjQ4MCIgZmlsbD0iIzJmOWU4ZiIvPjxjaXJjbGUgY3g9IjMwMCIgY3k9IjcyMCIgcj0iOTAiIGZpbGw9IiNlOGExM2MiLz48L3N2Zz4=',
    'A courier hauls contraband weather across a frozen archipelago, one storm ahead of the tide wardens.',
    'ongoing',
    2,
    'Mira Sakaguchi',
    'Rune Halvorsen',
    'Northlight Press',
    2021,
    ARRAY['adventure', 'drama'],
    '10000000-0000-4000-8000-000000000001',
    '2026-02-01 10:00:00+00',
    '2026-02-10 10:00:00+00'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'Bitter Circuit',
    'bitter-circuit',
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iOTAwIiB2aWV3Qm94PSIwIDAgNjAwIDkwMCI+PHJlY3Qgd2lkdGg9IjYwMCIgaGVpZ2h0PSI5MDAiIGZpbGw9IiMyYTFmMzMiLz48cmVjdCB4PSI2MCIgeT0iMTIwIiB3aWR0aD0iNDgwIiBoZWlnaHQ9IjQ4MCIgZmlsbD0iIzYzNjZmMSIvPjxjaXJjbGUgY3g9IjMwMCIgY3k9IjcyMCIgcj0iOTAiIGZpbGw9IiM0YmI4ZmEiLz48L3N2Zz4=',
    'Two rival mechanics share a workshop, a debt, and exactly one working arc welder.',
    'completed',
    2,
    'Dae-hyun Park',
    'Dae-hyun Park',
    'Kettle & Co.',
    2019,
    ARRAY['comedy', 'slice-of-life'],
    '10000000-0000-4000-8000-000000000001',
    '2026-01-20 10:00:00+00',
    '2026-02-05 10:00:00+00'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'Cinder Vale',
    'cinder-vale',
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iOTAwIiB2aWV3Qm94PSIwIDAgNjAwIDkwMCI+PHJlY3Qgd2lkdGg9IjYwMCIgaGVpZ2h0PSI5MDAiIGZpbGw9IiMzMzJhMWYiLz48cmVjdCB4PSI2MCIgeT0iMTIwIiB3aWR0aD0iNDgwIiBoZWlnaHQ9IjQ4MCIgZmlsbD0iI2Q0NjE4YyIvPjxjaXJjbGUgY3g9IjMwMCIgY3k9IjcyMCIgcj0iOTAiIGZpbGw9IiM4ZmJjNTIiLz48L3N2Zz4=',
    'The last cartographer of a burning valley maps what is left before the ash takes the roads.',
    'hiatus',
    0,
    'Yuki Amano',
    NULL,
    NULL,
    2023,
    ARRAY['fantasy'],
    '10000000-0000-4000-8000-000000000001',
    '2026-01-10 10:00:00+00',
    '2026-01-10 10:00:00+00'
  );

INSERT INTO chapters (id, manga_id, title, chapter_number, volume, sort_order, status, published_at, created_at, updated_at)
VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Tide Wardens', 1, 1, 1, 'ready', '2026-02-08 10:00:00+00', '2026-02-01 11:00:00+00', '2026-02-08 10:00:00+00'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Salt and Static', 2, 1, 2, 'ready', '2026-02-10 10:00:00+00', '2026-02-09 11:00:00+00', '2026-02-10 10:00:00+00'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'Cold Start', 1, NULL, 1, 'ready', '2026-02-05 10:00:00+00', '2026-01-20 11:00:00+00', '2026-02-05 10:00:00+00'),
  -- Unpublished + failed: drives the settings import-health panel and keeps the
  -- manage page's non-ready badge rendered.
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', 'Bench Test', 2, NULL, 2, 'failed', NULL, '2026-02-06 11:00:00+00', '2026-02-06 12:00:00+00');

INSERT INTO chapter_imports (id, chapter_id, user_id, status, total_files, processed_files, failed_files, error_message, created_at, updated_at)
VALUES
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'completed', 3, 3, 0, NULL, '2026-02-01 11:00:00+00', '2026-02-01 11:10:00+00'),
  ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'completed', 2, 2, 0, NULL, '2026-02-09 11:00:00+00', '2026-02-09 11:10:00+00'),
  ('50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'completed', 2, 2, 0, NULL, '2026-01-20 11:00:00+00', '2026-01-20 11:10:00+00'),
  ('50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'failed', 1, 0, 1, 'Page conversion failed', '2026-02-06 11:00:00+00', '2026-02-06 12:00:00+00');

-- Page images are inline SVG data URIs for the same reason covers are.
INSERT INTO chapter_pages (id, import_id, chapter_id, page_number, original_filename, original_key, storage_key, image_url, width, height, size_bytes, status, error_message, created_at, updated_at)
VALUES
  ('40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1, '001.png', 'orig/aurora/1/001.png', 'pages/aurora/1/001.webp', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIHZpZXdCb3g9IjAgMCAxMDgwIDE5MjAiPjxyZWN0IHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIGZpbGw9IiNlOGU0ZGMiLz48cmVjdCB4PSI4MCIgeT0iMTIwIiB3aWR0aD0iOTIwIiBoZWlnaHQ9IjcwMCIgZmlsbD0iIzNhM2Y0NSIvPjxyZWN0IHg9IjgwIiB5PSI5MDAiIHdpZHRoPSI5MjAiIGhlaWdodD0iNDAwIiBmaWxsPSIjOGE5MDk4Ii8+PHJlY3QgeD0iODAiIHk9IjEzODAiIHdpZHRoPSI1NjAiIGhlaWdodD0iNDAwIiBmaWxsPSIjYzJjOGNlIi8+PC9zdmc+', 1080, 1920, 184320, 'ready', NULL, '2026-02-01 11:05:00+00', '2026-02-08 10:00:00+00'),
  ('40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 2, '002.png', 'orig/aurora/1/002.png', 'pages/aurora/1/002.webp', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIHZpZXdCb3g9IjAgMCAxMDgwIDE5MjAiPjxyZWN0IHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIGZpbGw9IiNlOGU0ZGMiLz48cmVjdCB4PSI4MCIgeT0iMTIwIiB3aWR0aD0iNDQwIiBoZWlnaHQ9IjgyMCIgZmlsbD0iIzNhM2Y0NSIvPjxyZWN0IHg9IjU2MCIgeT0iMTIwIiB3aWR0aD0iNDQwIiBoZWlnaHQ9IjgyMCIgZmlsbD0iIzhhOTA5OCIvPjxyZWN0IHg9IjgwIiB5PSIxMDAwIiB3aWR0aD0iOTIwIiBoZWlnaHQ9Ijc4MCIgZmlsbD0iI2MyYzhjZSIvPjwvc3ZnPg==', 1080, 1920, 176128, 'ready', NULL, '2026-02-01 11:05:00+00', '2026-02-08 10:00:00+00'),
  ('40000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 3, '003.png', 'orig/aurora/1/003.png', 'pages/aurora/1/003.webp', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIHZpZXdCb3g9IjAgMCAxMDgwIDE5MjAiPjxyZWN0IHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIGZpbGw9IiNlOGU0ZGMiLz48Y2lyY2xlIGN4PSI1NDAiIGN5PSI2MjAiIHI9IjM4MCIgZmlsbD0iIzNhM2Y0NSIvPjxyZWN0IHg9IjgwIiB5PSIxMTIwIiB3aWR0aD0iOTIwIiBoZWlnaHQ9IjY2MCIgZmlsbD0iIzhhOTA5OCIvPjwvc3ZnPg==', 1080, 1920, 152064, 'ready', NULL, '2026-02-01 11:05:00+00', '2026-02-08 10:00:00+00'),
  ('40000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 1, '001.png', 'orig/aurora/2/001.png', 'pages/aurora/2/001.webp', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIHZpZXdCb3g9IjAgMCAxMDgwIDE5MjAiPjxyZWN0IHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIGZpbGw9IiNlOGU0ZGMiLz48cmVjdCB4PSI4MCIgeT0iMTIwIiB3aWR0aD0iOTIwIiBoZWlnaHQ9IjcwMCIgZmlsbD0iIzNhM2Y0NSIvPjxyZWN0IHg9IjgwIiB5PSI5MDAiIHdpZHRoPSI5MjAiIGhlaWdodD0iNDAwIiBmaWxsPSIjOGE5MDk4Ii8+PHJlY3QgeD0iODAiIHk9IjEzODAiIHdpZHRoPSI1NjAiIGhlaWdodD0iNDAwIiBmaWxsPSIjYzJjOGNlIi8+PC9zdmc+', 1080, 1920, 181248, 'ready', NULL, '2026-02-09 11:05:00+00', '2026-02-10 10:00:00+00'),
  ('40000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 2, '002.png', 'orig/aurora/2/002.png', 'pages/aurora/2/002.webp', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIHZpZXdCb3g9IjAgMCAxMDgwIDE5MjAiPjxyZWN0IHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIGZpbGw9IiNlOGU0ZGMiLz48cmVjdCB4PSI4MCIgeT0iMTIwIiB3aWR0aD0iNDQwIiBoZWlnaHQ9IjgyMCIgZmlsbD0iIzNhM2Y0NSIvPjxyZWN0IHg9IjU2MCIgeT0iMTIwIiB3aWR0aD0iNDQwIiBoZWlnaHQ9IjgyMCIgZmlsbD0iIzhhOTA5OCIvPjxyZWN0IHg9IjgwIiB5PSIxMDAwIiB3aWR0aD0iOTIwIiBoZWlnaHQ9Ijc4MCIgZmlsbD0iI2MyYzhjZSIvPjwvc3ZnPg==', 1080, 1920, 169984, 'ready', NULL, '2026-02-09 11:05:00+00', '2026-02-10 10:00:00+00'),
  ('40000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 1, '001.png', 'orig/bitter/1/001.png', 'pages/bitter/1/001.webp', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIHZpZXdCb3g9IjAgMCAxMDgwIDE5MjAiPjxyZWN0IHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIGZpbGw9IiNlOGU0ZGMiLz48Y2lyY2xlIGN4PSI1NDAiIGN5PSI2MjAiIHI9IjM4MCIgZmlsbD0iIzNhM2Y0NSIvPjxyZWN0IHg9IjgwIiB5PSIxMTIwIiB3aWR0aD0iOTIwIiBoZWlnaHQ9IjY2MCIgZmlsbD0iIzhhOTA5OCIvPjwvc3ZnPg==', 1080, 1920, 148992, 'ready', NULL, '2026-01-20 11:05:00+00', '2026-02-05 10:00:00+00'),
  ('40000000-0000-4000-8000-000000000007', '50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 2, '002.png', 'orig/bitter/1/002.png', 'pages/bitter/1/002.webp', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIHZpZXdCb3g9IjAgMCAxMDgwIDE5MjAiPjxyZWN0IHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjE5MjAiIGZpbGw9IiNlOGU0ZGMiLz48cmVjdCB4PSI4MCIgeT0iMTIwIiB3aWR0aD0iOTIwIiBoZWlnaHQ9IjcwMCIgZmlsbD0iIzNhM2Y0NSIvPjxyZWN0IHg9IjgwIiB5PSI5MDAiIHdpZHRoPSI5MjAiIGhlaWdodD0iNDAwIiBmaWxsPSIjOGE5MDk4Ii8+PHJlY3QgeD0iODAiIHk9IjEzODAiIHdpZHRoPSI1NjAiIGhlaWdodD0iNDAwIiBmaWxsPSIjYzJjOGNlIi8+PC9zdmc+', 1080, 1920, 163840, 'ready', NULL, '2026-01-20 11:05:00+00', '2026-02-05 10:00:00+00'),
  ('40000000-0000-4000-8000-000000000008', '50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000004', 1, 'bench.png', 'orig/bitter/2/bench.png', 'pages/bitter/2/bench.webp', NULL, NULL, NULL, NULL, 'failed', 'Unsupported colour profile', '2026-02-06 11:05:00+00', '2026-02-06 12:00:00+00');

-- CURRENT_DATE, not a literal: the popularity window is a trailing N days, so a
-- fixed date would age out and silently flip the home hero to its "New titles"
-- fallback. Counts are spaced far apart because a reader GET adds +1 per shot —
-- ordering has to survive that until the next fixture application.
INSERT INTO manga_views (manga_id, view_date, views)
VALUES
  ('20000000-0000-4000-8000-000000000001', CURRENT_DATE, 5000),
  ('20000000-0000-4000-8000-000000000002', CURRENT_DATE, 3000),
  ('20000000-0000-4000-8000-000000000003', CURRENT_DATE, 1000);

INSERT INTO user_library (id, user_id, manga_id, list, position, added_at)
VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'favorite', NULL, '2026-02-02 10:00:00+00'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'favorite', NULL, '2026-02-03 10:00:00+00'),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'queue', 1, '2026-02-04 10:00:00+00');

INSERT INTO reading_status (user_id, manga_id, status, updated_at)
VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'reading', '2026-02-08 12:00:00+00'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'completed', '2026-02-05 12:00:00+00'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'plan_to_read', '2026-01-11 12:00:00+00');

-- Pinned mid-chapter with a later ready chapter, so history renders a partial
-- percent and the home "Continue reading" rail keeps the entry.
INSERT INTO reading_progress (id, user_id, manga_id, chapter_id, page_id, page_number, created_at, updated_at)
VALUES
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 2, '2026-02-08 12:00:00+00', '2026-02-08 12:00:00+00');

INSERT INTO chapter_reads (user_id, chapter_id, manga_id, read_at)
VALUES
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', '2026-02-05 12:00:00+00');

INSERT INTO manga_comments (id, manga_id, user_id, body, created_at, updated_at)
VALUES
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'The archipelago spreads are doing a lot of quiet work here.', '2026-02-09 08:00:00+00', '2026-02-09 08:00:00+00'),
  ('80000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Agreed. Chapter two earns the pacing of chapter one.', '2026-02-09 09:30:00+00', '2026-02-09 09:30:00+00');

-- forum_categories are migration-seeded (033) and never truncated here.
INSERT INTO forum_threads (id, category_id, user_id, title, body, pinned, locked, last_post_at, created_at, updated_at)
VALUES
  (
    '90000000-0000-4000-8000-000000000001',
    (SELECT id FROM forum_categories WHERE slug = 'general'),
    '10000000-0000-4000-8000-000000000001',
    'Read the pinned post before opening a thread',
    'Keep threads on topic, use the report button instead of replying to spam, and tag spoilers.',
    true,
    false,
    '2026-02-11 09:00:00+00',
    '2026-02-01 09:00:00+00',
    '2026-02-01 09:00:00+00'
  ),
  (
    '90000000-0000-4000-8000-000000000002',
    (SELECT id FROM forum_categories WHERE slug = 'general'),
    '10000000-0000-4000-8000-000000000002',
    'What are you reading this week?',
    'Halfway through Aurora Drift and the weather-smuggling premise is holding up better than expected.',
    false,
    false,
    '2026-02-10 15:00:00+00',
    '2026-02-07 11:00:00+00',
    '2026-02-07 11:00:00+00'
  ),
  (
    '90000000-0000-4000-8000-000000000003',
    (SELECT id FROM forum_categories WHERE slug = 'manga-talk'),
    '10000000-0000-4000-8000-000000000002',
    'Bitter Circuit ending, spoilers welcome',
    'Locked thread so the ending discussion stays in one place.',
    false,
    true,
    '2026-02-06 18:00:00+00',
    '2026-02-06 18:00:00+00',
    '2026-02-06 18:00:00+00'
  );

INSERT INTO forum_posts (id, thread_id, user_id, body, created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'Bookmarked, thanks for writing it down.', '2026-02-02 10:00:00+00', '2026-02-02 10:00:00+00'),
  ('a0000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'One addition: chapter numbers in the title help people search.', '2026-02-11 09:00:00+00', '2026-02-11 09:00:00+00'),
  ('a0000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Same, the tide warden chase in chapter two is the highlight so far.', '2026-02-10 15:00:00+00', '2026-02-10 15:00:00+00');

INSERT INTO forum_reports (id, reporter_id, thread_id, post_id, reason, note, status, created_at, resolved_at, resolved_by)
VALUES
  ('b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', NULL, 'a0000000-0000-4000-8000-000000000002', 'spam', 'Reads like a copy-paste reply.', 'open', '2026-02-11 10:00:00+00', NULL, NULL),
  ('b0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000003', NULL, 'other', NULL, 'open', '2026-02-11 11:00:00+00', NULL, NULL);

-- Dated ahead of the run deliberately: the API writes a live INFO row on every
-- harness login, and the audit trail lists created_at DESC with a page size of
-- 10. Future timestamps keep page one pinned to exactly these rows.
INSERT INTO logs (id, level, message, service, context, error_name, error_message, error_stack, created_at)
VALUES
  ('c0000000-0000-4000-8000-000000000001', 'error', 'Page conversion failed', 'lazyscan-api', '{"chapterId":"30000000-0000-4000-8000-000000000004","pageNumber":1}', 'ConvertError', 'Unsupported colour profile', 'ConvertError: Unsupported colour profile\n    at convert (image.ts:42:11)', '2030-01-01 12:00:00+00'),
  ('c0000000-0000-4000-8000-000000000002', 'warn', 'Outbox publish failed; will retry', 'lazyscan-api', '{"eventId":"c0000000-0000-4000-8000-000000000002","attempt":2}', NULL, NULL, NULL, '2030-01-01 11:55:00+00'),
  ('c0000000-0000-4000-8000-000000000003', 'warn', 'Login failed: invalid password', 'lazyscan-api', '{"userId":"10000000-0000-4000-8000-000000000002","attempts":1}', NULL, NULL, NULL, '2030-01-01 11:50:00+00'),
  ('c0000000-0000-4000-8000-000000000004', 'info', 'Chapter import completed', 'lazyscan-api', '{"importId":"50000000-0000-4000-8000-000000000001"}', NULL, NULL, NULL, '2030-01-01 11:45:00+00'),
  ('c0000000-0000-4000-8000-000000000005', 'info', 'User logged in', 'lazyscan-api', '{"userId":"10000000-0000-4000-8000-000000000001"}', NULL, NULL, NULL, '2030-01-01 11:40:00+00'),
  ('c0000000-0000-4000-8000-000000000006', 'info', 'Email verified', 'lazyscan-api', '{"userId":"10000000-0000-4000-8000-000000000002"}', NULL, NULL, NULL, '2030-01-01 11:35:00+00'),
  ('c0000000-0000-4000-8000-000000000007', 'info', 'Outbox dispatcher started', 'lazyscan-api', '{"intervalMs":1000,"batchSize":100}', NULL, NULL, NULL, '2030-01-01 11:30:00+00'),
  ('c0000000-0000-4000-8000-000000000008', 'debug', 'Cache miss', 'lazyscan-api', '{"key":"popular:week"}', NULL, NULL, NULL, '2030-01-01 11:25:00+00'),
  ('c0000000-0000-4000-8000-000000000009', 'debug', 'Storage prune skipped', 'lazyscan-api', NULL, NULL, NULL, NULL, '2030-01-01 11:20:00+00'),
  ('c0000000-0000-4000-8000-00000000000a', 'info', 'User registered, verification pending', 'lazyscan-api', '{"userId":"10000000-0000-4000-8000-000000000002"}', NULL, NULL, NULL, '2030-01-01 11:15:00+00'),
  ('c0000000-0000-4000-8000-00000000000b', 'info', 'Default superuser bootstrapped', 'lazyscan-api', NULL, NULL, NULL, NULL, '2030-01-01 11:10:00+00'),
  ('c0000000-0000-4000-8000-00000000000c', 'debug', 'Cache invalidated', 'lazyscan-api', '{"pattern":"manga:*"}', NULL, NULL, NULL, '2030-01-01 11:05:00+00');

COMMIT;
