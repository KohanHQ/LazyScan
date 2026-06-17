-- Avatars are now derived from the username (ui-avatars) when avatar_url is null,
-- so drop the previously stored default URL. Custom avatars are untouched.
UPDATE profiles
SET avatar_url = NULL
WHERE avatar_url = 'https://avatar.iran.liara.run/public';
