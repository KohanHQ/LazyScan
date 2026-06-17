CREATE TABLE IF NOT EXISTS manga (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(200) NOT NULL UNIQUE,
  cover_url TEXT,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'completed', 'hiatus', 'cancelled')),
  total_chapters INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manga_slug ON manga(slug);
CREATE INDEX IF NOT EXISTS idx_manga_status ON manga(status);
CREATE INDEX IF NOT EXISTS idx_manga_created_at ON manga(created_at DESC);
