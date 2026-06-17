import { icons } from "@/components/icons";
import { renderSidebar } from "@/components/sidebar";
import { renderTopbarActions } from "@/components/topbar";
import { navigateTo, renderRoute } from "@/router";
import { bootstrapSession, getSession, subscribeSession } from "@/state/session";
import { animateIn } from "@/utils/dom";

const READER_ROUTE = /^\/manga\/[^/]+\/chapter\/[^/]+$/;

export function startApp(root: HTMLElement): void {
  root.innerHTML = `
    <div class="app-shell" data-sidebar="expanded" data-drawer="closed" data-reader="false" data-auth="false">
      <header class="app-topbar">
        <button class="topbar-toggle" type="button" data-action="sidebar-toggle" aria-label="Toggle navigation">
          ${icons.menu()}
        </button>
        <button class="brand-button" type="button" data-action="brand">LazyScan</button>
        <div class="topbar-spacer"></div>
        <div id="topbar-actions" class="topbar-actions"></div>
      </header>
      <div class="app-body">
        <aside id="app-sidebar" class="app-sidebar"></aside>
        <div class="app-backdrop" data-action="sidebar-close" aria-hidden="true"></div>
        <main id="app-main" class="app-main" tabindex="-1"></main>
      </div>
    </div>
  `;

  const shell = root.querySelector<HTMLElement>(".app-shell");
  const sidebar = root.querySelector<HTMLElement>("#app-sidebar");
  const topbarActions = root.querySelector<HTMLElement>("#topbar-actions");
  const main = root.querySelector<HTMLElement>("#app-main");
  const toggle = root.querySelector<HTMLElement>("[data-action='sidebar-toggle']");
  const backdrop = root.querySelector<HTMLElement>("[data-action='sidebar-close']");
  const brand = root.querySelector<HTMLElement>("[data-action='brand']");

  if (!shell || !sidebar || !topbarActions || !main) {
    throw new Error("App layout failed to initialize");
  }

  const closeDrawer = (): void => shell.setAttribute("data-drawer", "closed");

  toggle?.addEventListener("click", () => {
    // Overlay drawer at every breakpoint (MangaDex-style); no persistent rail.
    const open = shell.getAttribute("data-drawer") === "open";
    shell.setAttribute("data-drawer", open ? "closed" : "open");
  });
  backdrop?.addEventListener("click", closeDrawer);
  brand?.addEventListener("click", () => navigateTo("/"));

  // Transparent topbar over the home hero turns solid once scrolled. Read on the
  // window (the page scrolls on the body, not an inner container). Harmless off-home
  // since only `[data-hero="true"]` styling consumes `data-scrolled`.
  const onScroll = (): void => {
    shell.setAttribute("data-scrolled", window.scrollY > 40 ? "true" : "false");
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const render = (): void => {
    const path = window.location.pathname;
    const isReader = READER_ROUTE.test(path);
    const isAuth = path === "/login" || path === "/register";
    shell.setAttribute("data-reader", isReader ? "true" : "false");
    // Login/register are standalone full-screen pages — hide the app chrome.
    shell.setAttribute("data-auth", isAuth ? "true" : "false");
    // Reset the immersive-hero flag each navigation; the home page re-sets it to
    // "true" only when it actually mounts a hero (not on its empty state).
    shell.setAttribute("data-hero", "false");
    closeDrawer();
    renderSidebar(sidebar);
    renderTopbarActions(topbarActions);
    renderRoute(main)
      .then(() => {
        // Auth screens run their own mount fade (they're position:fixed, so a
        // transform on <main> would reparent that fixed box). Every other route
        // gets a subtle enter fade on each navigation.
        if (!isAuth) {
          animateIn(main);
        }
      })
      .catch((error) => {
        console.error("Route render failed:", error);
        main.innerHTML = `
        <div class="state-block state-error">
          <h2>Something went wrong</h2>
          <p>${error instanceof Error ? error.message : "Unable to load page"}</p>
        </div>
      `;
      });
  };

  subscribeSession(() => {
    renderSidebar(sidebar);
    renderTopbarActions(topbarActions);
  });

  window.addEventListener("popstate", render);
  window.addEventListener("app:navigate", render);

  render();
  void bootstrapSession()
    .then(() => {
      // Session-dependent routes (/history, reader progress) rendered before
      // bootstrap resolved with no user. Re-render once a user is known.
      if (getSession().user) {
        render();
      }
    })
    .catch((error) => {
      // Bootstrap failure (API/network down) leaves the no-user view already
      // rendered; log and stay on it instead of throwing an unhandled rejection.
      console.error("Session bootstrap failed:", error);
    });
}
