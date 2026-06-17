CREATE TABLE IF NOT EXISTS chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manga_id UUID NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  chapter_number NUMERIC(10, 2),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'importing', 'processing', 'ready', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chapter_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'processing', 'completed', 'failed')),
  total_files INTEGER NOT NULL CHECK (total_files > 0),
  processed_files INTEGER NOT NULL DEFAULT 0 CHECK (processed_files >= 0),
  failed_files INTEGER NOT NULL DEFAULT 0 CHECK (failed_files >= 0),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chapter_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  original_filename TEXT NOT NULL,
  original_key TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  image_url TEXT,
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting_upload' CHECK (status IN ('waiting_upload', 'processing', 'ready', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chapter_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_chapters_manga_id ON chapters(manga_id);
CREATE INDEX IF NOT EXISTS idx_chapters_status ON chapters(status);
CREATE INDEX IF NOT EXISTS idx_chapters_sort_order ON chapters(manga_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_chapter_imports_chapter_id ON chapter_imports(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_imports_user_id ON chapter_imports(user_id);
CREATE INDEX IF NOT EXISTS idx_chapter_imports_status ON chapter_imports(status);

CREATE INDEX IF NOT EXISTS idx_chapter_pages_chapter_id ON chapter_pages(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_pages_status ON chapter_pages(status);
CREATE INDEX IF NOT EXISTS idx_chapter_pages_original_key ON chapter_pages(original_key);
