import type { Badge } from "@/api/profile";
import { escapeHtml } from "@/utils/dom";

// Shared badge-chip rendering for profiles (own + public). The API already sorts
// badges by rarity (rarest first); each chip carries a rarity modifier class plus
// a per-code class (`profile-badge-admin`, ...) for badge-specific theming.
// Returns "" when there are no badges.
export function renderBadges(badges: Badge[]): string {
  if (!badges.length) {
    return "";
  }
  return `<div class="profile-badges">${badges
    .map(
      (badge) =>
        `<span class="profile-badge profile-badge--${escapeHtml(badge.rarity)} profile-badge-${escapeHtml(badge.code)}" title="${escapeHtml(badge.label)}">${escapeHtml(badge.label)}</span>`
    )
    .join("")}</div>`;
}
