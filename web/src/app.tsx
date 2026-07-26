import { Menu } from "lucide-react";
import {
  Component,
  useEffect,
  useRef,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from "react";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { navigateTo, routeElement, useLocationPath } from "@/router";
import { READER_ROUTE } from "@/router/match";
import { useSession } from "@/state/hooks";
import { bootstrapSession } from "@/state/session";

// Subtle enter animation for a freshly-rendered route. Web Animations re-triggers
// on every call without a reflow hack and is a no-op under reduced motion.
function animateIn(el: HTMLElement): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  el.animate(
    [
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 200, easing: "ease-out" }
  );
}

// Route render failures land here instead of tearing down the whole shell.
class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Route render failed:", error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="state-block state-error">
          <h2>Something went wrong</h2>
          <p>{this.state.error.message || "Unable to load page"}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App(): ReactElement {
  const path = useLocationPath();
  const session = useSession();
  const shellRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const isReader = READER_ROUTE.test(path);
  // Login/register are standalone full-screen pages — hide the app chrome.
  const isAuth = path === "/login" || path === "/register";

  useEffect(() => {
    // Transparent topbar over the home hero turns solid once scrolled. Read on the
    // window (the page scrolls on the body, not an inner container). Harmless off-home
    // since only `[data-hero="true"]` styling consumes `data-scrolled`.
    const onScroll = (): void => {
      shellRef.current?.setAttribute(
        "data-scrolled",
        window.scrollY > 40 ? "true" : "false"
      );
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    // Bootstrap failure (API/network down) leaves the no-user view already
    // rendered; log and stay on it instead of throwing an unhandled rejection.
    void bootstrapSession().catch((error) => {
      console.error("Session bootstrap failed:", error);
    });
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    const main = mainRef.current;
    if (!shell || !main) {
      return;
    }
    shell.setAttribute("data-reader", isReader ? "true" : "false");
    shell.setAttribute("data-auth", isAuth ? "true" : "false");
    // Reset the immersive-hero flag each navigation; the home page re-sets it to
    // "true" only when it actually mounts a hero (not on its empty state).
    shell.setAttribute("data-hero", "false");
    shell.setAttribute("data-drawer", "closed");
    window.scrollTo({ top: 0 });
    // Auth screens run their own mount fade (they're position:fixed, so a
    // transform on <main> would reparent that fixed box). Every other route
    // gets a subtle enter fade on each navigation.
    if (!isAuth) {
      animateIn(main);
    }
  }, [path, isReader, isAuth]);

  const toggleDrawer = (): void => {
    // Overlay drawer at every breakpoint (MangaDex-style); no persistent rail.
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    const open = shell.getAttribute("data-drawer") === "open";
    shell.setAttribute("data-drawer", open ? "closed" : "open");
  };

  const closeDrawer = (): void =>
    shellRef.current?.setAttribute("data-drawer", "closed");

  // Remount the page across null→user so session-dependent routes refetch once
  // bootstrap resolves; also resets the error boundary on every navigation.
  const routeKey = `${path}::${session.user?.userId ?? "anon"}`;

  return (
    <div
      ref={shellRef}
      className="app-shell"
      data-sidebar="expanded"
      data-drawer="closed"
      data-reader="false"
      data-auth="false"
    >
      <header className="app-topbar">
        <button
          className="topbar-toggle"
          type="button"
          aria-label="Toggle navigation"
          onClick={toggleDrawer}
        >
          <Menu className="icon" size={20} />
        </button>
        <button
          className="brand-button"
          type="button"
          onClick={() => navigateTo("/")}
        >
          LazyScan
        </button>
        <div className="topbar-spacer"></div>
        <Topbar />
      </header>
      <div className="app-body">
        <aside className="app-sidebar">
          <Sidebar path={path} />
        </aside>
        <div
          className="app-backdrop"
          aria-hidden="true"
          onClick={closeDrawer}
        ></div>
        <main ref={mainRef} className="app-main" tabIndex={-1}>
          <RouteErrorBoundary key={routeKey}>
            {routeElement(path)}
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}
