import type { ReactElement } from "react";
import type { Badge } from "@/api/profile";

// The API pre-sorts badges rarest-first — a hidden contract; render order mirrors
// it. Each chip carries a rarity modifier plus a per-code class for theming.
export function Badges({ badges }: { badges: Badge[] }): ReactElement | null {
  if (!badges.length) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge.code}
          className={`inline-flex items-center rounded-full bg-primary px-2.5 py-[3px] text-[0.75rem] font-bold tracking-[0.01em] text-primary-foreground profile-badge--${badge.rarity} profile-badge-${badge.code}`}
          title={badge.label}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}
