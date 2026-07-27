-- Optional free-text bio ("about me") on the 1:1 `profiles` row. Short self-
-- description, capped at 256 chars and profanity-guarded at the API validation
-- layer (reject, never censor — the raw text is stored). Shown on the owner's
-- profile and on the public username lookup when profile_visibility is public;
-- there is no separate bio-level visibility flag.
--
-- Additive only: nullable, no default, existing rows stay NULL (no bio).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio TEXT;
