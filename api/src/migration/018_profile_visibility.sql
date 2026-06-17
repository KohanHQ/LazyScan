-- Profile visibility controls. Two independent flags on the 1:1 `profiles` row
-- govern what the public username lookup (`GET /profile/username/:username`)
-- exposes to other users:
--
--   profile_visibility: 'private' hides the profile from lookup entirely (the
--     endpoint returns 404 to others, indistinguishable from "no such user", so
--     it does not enable enumeration). The owner always sees their own `/me`.
--   shelf_visibility: whether the public favorites shelf appears on the profile.
--     Independent of profile_visibility so "show identity, hide library" works.
--
-- Defaults preserve current behavior: profiles stay publicly lookup-able, while
-- the favorites shelf stays private until the owner opts in (no silent exposure
-- of existing users' favorites). Reading stats are never exposed here; they live
-- behind the authenticated `/profile/me/stats` route.
--
-- Additive only: NOT NULL columns with DEFAULTs, so existing rows backfill to the
-- defaults and no separate backfill step is needed.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS profile_visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (profile_visibility IN ('public', 'private')),
  ADD COLUMN IF NOT EXISTS shelf_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (shelf_visibility IN ('public', 'private'));
