import type { ReactElement } from "react";

// ponytail: dark-only — the theme toggle is hidden and dark is enforced
// (state/theme.ts). Topbar renders nothing until chrome returns here; the
// account avatar + login/logout live in the sidebar footer.
export function Topbar(): ReactElement | null {
  return null;
}
