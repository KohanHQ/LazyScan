import { renderFavoritesPage } from "@/pages/favorites";
import { renderFeedPage } from "@/pages/feed";
import { renderForumPage } from "@/pages/forum";
import { renderHistoryPage } from "@/pages/history";
import { renderHomePage } from "@/pages/home";
import { renderLoginPage } from "@/pages/login";
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
import { renderStatusPage } from "@/pages/status";
import { renderUserPage } from "@/pages/user";
import { matchRoute, type Route } from "./match";

export type { Route } from "./match";

export function navigateTo(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("app:navigate"));
}

export async function renderRoute(container: HTMLElement): Promise<void> {
  const route: Route = matchRoute(window.location.pathname);
  container.scrollTo({ top: 0 });

  if (route.name === "login") {
    renderLoginPage(container, "login");
    return;
  }

  if (route.name === "register") {
    renderLoginPage(container, "register");
    return;
  }

  if (route.name === "favorites") {
    renderFavoritesPage(container);
    return;
  }

  if (route.name === "status") {
    renderStatusPage(container);
    return;
  }

  if (route.name === "feed") {
    renderFeedPage(container);
    return;
  }

  if (route.name === "forum") {
    renderForumPage(container);
    return;
  }

  if (route.name === "settings") {
    renderSettingsPage(container);
    return;
  }

  if (route.name === "history") {
    renderHistoryPage(container);
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
    await renderUserPage(container);
    return;
  }

  if (route.name === "user-profile") {
    await renderUserPage(container, route.username);
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

  await renderHomePage(container);
}
