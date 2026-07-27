-- Additive: nullable, no default, existing rows stay NULL. Text is stored raw —
-- the profanity guard rejects at validation, never censors.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio TEXT;
