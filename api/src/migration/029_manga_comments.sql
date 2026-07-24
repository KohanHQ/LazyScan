-- Public per-manga discussion. One row per comment; profanity is masked in the
-- app before storing, and the length CHECK is the DB-side backstop for the
-- service-side body validation (1..1000 chars). Listed newest-first per manga,
-- served by the (manga_id, created_at DESC) index.
CREATE TABLE IF NOT EXISTS manga_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manga_id UUID NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manga_comments_manga_created
  ON manga_comments(manga_id, created_at DESC, id DESC);
