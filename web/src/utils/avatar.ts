// Default avatar derived from a name via ui-avatars. Only the first word of the
// seed is used (e.g. "John Doe" -> "John") so the generated initials follow the
// display name without spilling the full name into the request.
export function defaultAvatar(seed: string | null | undefined): string {
  const firstWord = (seed ?? "").trim().split(/\s+/)[0] || "User";
  return `https://eu.ui-avatars.com/api/?name=${encodeURIComponent(firstWord)}`;
}

// Resolves the avatar to show: a custom URL when set, otherwise the derived one.
export function resolveAvatar(
  avatarUrl: string | null | undefined,
  seed: string | null | undefined
): string {
  const trimmed = avatarUrl?.trim();
  return trimmed ? trimmed : defaultAvatar(seed);
}
