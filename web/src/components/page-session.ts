import { renderLoading } from "@/components/states";
import { renderLoginRequired } from "@/components/auth-required";
import { onSessionReady } from "@/state/session";
import type { CurrentUser } from "@/api/auth";

// Shared lifecycle for auth-gated pages: show a loading state, wait for session
// bootstrap, bail if the user navigated away (path no longer matches), render the
// login-required block for anonymous visitors, otherwise hand the resolved user to
// `onReady`. The API stays the real guard; this only controls the affordance.
export function requireSessionForPage(
  container: HTMLElement,
  path: string,
  options: {
    loading?: string;
    loginMessage?: string;
    onReady: (user: CurrentUser) => void;
  }
): void {
  container.innerHTML = renderLoading(options.loading ?? "Loading");
  onSessionReady((session) => {
    if (window.location.pathname !== path) {
      return;
    }
    if (!session.user) {
      renderLoginRequired(container, options.loginMessage);
      return;
    }
    options.onReady(session.user);
  });
}
