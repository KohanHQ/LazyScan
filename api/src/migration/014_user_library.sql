-- User-curated lists: 'favorite' (save/follow, unordered) and 'queue' (ordered
-- read-next). One row per (user, manga, list); `position` orders the queue and is
-- NULL for favorites.
CREATE TABLE IF NOT EXISTS user_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manga_id UUID NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  list TEXT NOT NULL CHECK (list IN ('favorite', 'queue')),
  position INTEGER,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, manga_id, list)
);

CREATE INDEX IF NOT EXISTS idx_user_library_user_list ON user_library(user_id, list);
CREATE INDEX IF NOT EXISTS idx_user_library_manga_id ON user_library(manga_id);
