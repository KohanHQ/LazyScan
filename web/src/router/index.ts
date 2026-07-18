import { FavoritesPage } from "@/pages/favorites";
import { FeedPage } from "@/pages/feed";
import { ForumPage } from "@/pages/forum";
import { HistoryPage } from "@/pages/history";
import { HomePage } from "@/pages/home";
import { LoginPage } from "@/pages/login";
import { renderChapterUploadPage } from "@/pages/manage-chapter";
import { renderManagePage } from "@/pages/manage";
import {
  renderMangaCreatePage,
  renderMangaEditPage,
} from "@/pages/manage-manga";
import { renderMangaPage } from "@/pages/manga";
import { renderProfilePage, renderProfileEditPage } from "@/pages/profile";
import { renderReaderPage } from "@/pages/reader";
import { renderSettingsPage } from "@/pages/settings";
import { StatusPage } from "@/pages/status";
import { UserPage } from "@/pages/user";
import { createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { matchRoute, type Route } from "./match";

export type { Route } from "./match";

// React and the vanilla pages share one <main>. Every vanilla page assigns
// innerHTML, which would strand a live root's DOM, so unmount before each render.
let activeRoot: Root | null = null;

// createElement keeps this surviving .ts file free of JSX.
function mountReact<P extends object>(
  container: HTMLElement,
  page: ComponentType<P>,
  props?: P
): void {
  activeRoot = createRoot(container);
  activeRoot.render(createElement(page, props ?? null));
}

export function navigateTo(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("app:navigate"));
}

export async function renderRoute(container: HTMLElement): Promise<void> {
  activeRoot?.unmount();
  activeRoot = null;

  container.scrollTo({ top: 0 });

  const route: Route = matchRoute(window.location.pathname);

  if (route.name === "login") {
    mountReact(container, LoginPage, { mode: "login" });
    return;
  }

  if (route.name === "register") {
    mountReact(container, LoginPage, { mode: "register" });
    return;
  }

  if (route.name === "favorites") {
    mountReact(container, FavoritesPage);
    return;
  }

  if (route.name === "status") {
    mountReact(container, StatusPage);
    return;
  }

  if (route.name === "feed") {
    mountReact(container, FeedPage);
    return;
  }

  if (route.name === "forum") {
    mountReact(container, ForumPage);
    return;
  }

  if (route.name === "settings") {
    renderSettingsPage(container);
    return;
  }

  if (route.name === "history") {
    mountReact(container, HistoryPage);
    return;
  }

  if (route.name === "profile") {
    await renderProfilePage(container);
    return;
  }

  if (route.name === "profile-edit") {
    await renderProfileEditPage(container);
    return;
  }

  if (route.name === "user-lookup") {
    mountReact(container, UserPage);
    return;
  }

  if (route.name === "user-profile") {
    mountReact(container, UserPage, { username: route.username });
    return;
  }

  if (route.name === "manage") {
    renderManagePage(container);
    return;
  }

  if (route.name === "manga-create") {
    renderMangaCreatePage(container);
    return;
  }

  if (route.name === "manga-edit") {
    renderMangaEditPage(container, route.id);
    return;
  }

  if (route.name === "manga-chapter-upload") {
    renderChapterUploadPage(container, route.id);
    return;
  }

  if (route.name === "reader") {
    await renderReaderPage(container, route.mangaId, route.chapterId);
    return;
  }

  if (route.name === "manga") {
    await renderMangaPage(container, route.id);
    return;
  }

  mountReact(container, HomePage);
}
