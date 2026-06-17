ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('user', 'superuser'));
  END IF;
END $$;

ALTER TABLE manga
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'manga_created_by_user_id_fkey'
  ) THEN
    ALTER TABLE manga
      ADD CONSTRAINT manga_created_by_user_id_fkey
      FOREIGN KEY (created_by_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_manga_created_by_user_id
  ON manga(created_by_user_id);
