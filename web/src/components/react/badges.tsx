import type { ReactElement } from "react";
import type { Badge } from "@/api/profile";

// React counterpart of components/badges.ts (survives; profile.ts still uses it).
// The API pre-sorts badges rarest-first — a hidden contract; render order mirrors
// it. Each chip carries a rarity modifier plus a per-code class for theming.
export function Badges({ badges }: { badges: Badge[] }): ReactElement | null {
  if (!badges.length) {
    return null;
  }
  return (
    <div className="profile-badges">
      {badges.map((badge) => (
        <span
          key={badge.code}
          className={`profile-badge profile-badge--${badge.rarity} profile-badge-${badge.code}`}
          title={badge.label}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}
