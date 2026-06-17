import { icons } from "@/components/icons";
import { navigateTo } from "@/router";
import { getSession, logout } from "@/state/session";
import { resolveAvatar } from "@/utils/avatar";
import { escapeHtml, renderCover, wireCoverFallbacks } from "@/utils/dom";

function isActive(path: string, route: string): boolean {
  if (route === "/") {
    return path === "/" || path.startsWith("/manga");
  }
  return path === route || path.startsWith(`${route}/`);
}

export function renderSidebar(container: HTMLElement): void {
  const path = window.location.pathname;
  const session = getSession();

  const navItem = (route: string, label: string, icon: string): string => {
    const active = isActive(path, route);
    return `
      <button
        class="sidebar-link${active ? " sidebar-link-active" : ""}"
        type="button"
        data-route="${route}"
        title="${label}"
        ${active ? 'aria-current="page"' : ""}
      >
        <span class="sidebar-icon" aria-hidden="true">${icon}</span>
        <span class="sidebar-label">${label}</span>
      </button>
    `;
  };

  // Account avatar (authenticated only) links to the profile. A custom avatar
  // (owner-only upload) wins; otherwise it derives from the display name's
  // first word.
  const accountName = session.user
    ? session.user.displayName || session.user.username || session.user.email
    : "";
  const accountItem = session.user
    ? `
      <button class="sidebar-link sidebar-account" type="button" data-route="/profile" title="${escapeHtml(accountName)}">
        <span class="sidebar-icon sidebar-avatar" aria-hidden="true">${renderCover({
          url: resolveAvatar(session.user.avatarUrl, accountName),
          seed: accountName,
          placeholderClass: "user-avatar",
          imgAttrs: 'class="user-avatar"',
        })}</span>
        <span class="sidebar-label">${escapeHtml(accountName)}</span>
      </button>
    `
    : "";

  const authLabel = session.user ? "Logout" : "Login";

  container.innerHTML = `
    <nav class="sidebar-nav" aria-label="Primary">
      ${navItem("/", "Library", icons.library())}
      ${navItem("/forum", "Forum", icons.forum())}
      ${session.user ? navItem("/feed", "Feed", icons.rss()) : ""}
      ${session.user ? navItem("/favorites", "Favorites", icons.heart()) : ""}
      ${session.user ? navItem("/status", "Tracking", icons.inbox()) : ""}
      ${session.user ? navItem("/history", "History", icons.history()) : ""}
      ${session.user ? navItem("/manage", "Manage", icons.edit()) : ""}
      ${session.user ? navItem("/user", "Find user", icons.user()) : ""}
      ${session.user?.role === "superuser" ? navItem("/settings", "Settings", icons.gear()) : ""}
    </nav>
    <div class="sidebar-footer">
      ${accountItem}
      <button class="sidebar-link sidebar-door" type="button" data-action="auth" title="${authLabel}" aria-label="${authLabel}">
        <span class="sidebar-icon" aria-hidden="true">${icons.door()}</span>
        <span class="sidebar-label">${authLabel}</span>
      </button>
      <p class="sidebar-copy">© 2026 LazyScan</p>
    </div>
  `;

  wireCoverFallbacks(container);

  container.querySelectorAll<HTMLElement>("[data-route]").forEach((element) => {
    element.addEventListener("click", () => {
      const route = element.dataset.route;
      if (route) {
        navigateTo(route);
      }
    });
  });

  container
    .querySelector<HTMLElement>("[data-action='auth']")
    ?.addEventListener("click", async () => {
      if (getSession().user) {
        await logout();
        navigateTo("/");
      } else {
        navigateTo("/login");
      }
    });
}
