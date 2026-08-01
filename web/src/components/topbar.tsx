import type { ReactElement } from "react";

// Topbar renders nothing until chrome returns here; the account avatar +
// login/logout live in the sidebar footer.
export function Topbar(): ReactElement | null {
  return null;
}
