import { useSyncExternalStore, type ReactElement } from "react";
import { FavoritesPage } from "@/pages/favorites";
import { FeedPage } from "@/pages/feed";
import { ForumPage } from "@/pages/forum";
import { HistoryPage } from "@/pages/history";
import { HomePage } from "@/pages/home";
import { LoginPage } from "@/pages/login";
import { ChapterUploadPage } from "@/pages/manage-chapter";
import { ManagePage } from "@/pages/manage";
import { MangaCreatePage, MangaEditPage } from "@/pages/manage-manga";
import { MangaPage } from "@/pages/manga";
import { ProfilePage, ProfileEditPage } from "@/pages/profile";
import { ReaderPage } from "@/pages/reader";
import { SettingsPage } from "@/pages/settings";
import { StatusPage } from "@/pages/status";
import { UserPage } from "@/pages/user";
import { matchRoute, type Route } from "./match";

export type { Route } from "./match";

// Pre-navigation hook: the app shell registers the home↔auth curtain wipe
// here. `proceed` performs the actual commit, so the hook controls timing.
// Back/forward (popstate) bypasses the hook — instant, native-feeling.
export type RouteTransition = (
  from: string,
  to: string,
  proceed: () => void
) => void;

let routeTransition: RouteTransition | null = null;

export function setRouteTransition(hook: RouteTransition | null): void {
  routeTransition = hook;
}

export function navigateTo(path: string): void {
  if (routeTransition !== null) {
    routeTransition(window.location.pathname, path, () =>
      commitNavigate(path)
    );
    return;
  }
  commitNavigate(path);
}

function commitNavigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("app:navigate"));
}

function subscribeLocation(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  window.addEventListener("app:navigate", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("app:navigate", callback);
  };
}

// Current pathname as a reactive store; navigateTo and the back/forward buttons
// both notify subscribers so the shell re-renders the matched page.
export function useLocationPath(): string {
  return useSyncExternalStore(subscribeLocation, () => window.location.pathname);
}

export function routeElement(path: string): ReactElement {
  const route: Route = matchRoute(path);

  switch (route.name) {
    case "login":
      return <LoginPage mode="login" />;
    case "register":
      return <LoginPage mode="register" />;
    case "favorites":
      return <FavoritesPage />;
    case "status":
      return <StatusPage />;
    case "feed":
      return <FeedPage />;
    case "forum":
      return <ForumPage />;
    case "settings":
      return <SettingsPage />;
    case "history":
      return <HistoryPage />;
    case "profile":
      return <ProfilePage />;
    case "profile-edit":
      return <ProfileEditPage />;
    case "user-lookup":
      return <UserPage />;
    case "user-profile":
      return <UserPage username={route.username} />;
    case "manage":
      return <ManagePage />;
    case "manga-create":
      return <MangaCreatePage />;
    case "manga-edit":
      return <MangaEditPage id={route.id} />;
    case "manga-chapter-upload":
      return <ChapterUploadPage id={route.id} />;
    case "reader":
      return <ReaderPage mangaId={route.mangaId} chapterId={route.chapterId} />;
    case "manga":
      return <MangaPage id={route.id} />;
    default:
      return <HomePage />;
  }
}
