// Pure path → Route matching, split out from the renderer so it is testable
// without a DOM or the page-module import graph. `index.ts` feeds it
// `window.location.pathname`; tests feed it plain strings.

// The reader's path shape, shared with the app shell (which hides chrome on it).
// Capture groups are for matchRoute below; the shell only .test()s.
export const READER_ROUTE = /^\/manga\/([^/]+)\/chapter\/([^/]+)$/;

export type Route =
  | { name: "home" }
  | { name: "favorites" }
  | { name: "status" }
  | { name: "feed" }
  | { name: "forum" }
  | { name: "settings" }
  | { name: "history" }
  | { name: "login" }
  | { name: "register" }
  | { name: "profile" }
  | { name: "profile-edit" }
  | { name: "user-lookup" }
  | { name: "user-profile"; username: string }
  | { name: "manage" }
  | { name: "manga-create" }
  | { name: "manga-edit"; id: string }
  | { name: "manga-chapter-upload"; id: string }
  | { name: "manga"; id: string }
  | { name: "reader"; mangaId: string; chapterId: string };

export function matchRoute(path: string): Route {
  if (path === "/login") {
    return { name: "login" };
  }

  if (path === "/register") {
    return { name: "register" };
  }

  if (path === "/favorites") {
    return { name: "favorites" };
  }

  if (path === "/status") {
    return { name: "status" };
  }

  if (path === "/feed") {
    return { name: "feed" };
  }

  if (path === "/forum") {
    return { name: "forum" };
  }

  if (path === "/settings") {
    return { name: "settings" };
  }

  if (path === "/history") {
    return { name: "history" };
  }

  if (path === "/profile/edit") {
    return { name: "profile-edit" };
  }

  if (path === "/profile") {
    return { name: "profile" };
  }

  if (path === "/user") {
    return { name: "user-lookup" };
  }

  const userMatch = path.match(/^\/user\/([^/]+)$/);
  if (userMatch?.[1]) {
    return { name: "user-profile", username: decodeURIComponent(userMatch[1]) };
  }

  if (path === "/manage") {
    return { name: "manage" };
  }

  if (path === "/manage/manga/new") {
    return { name: "manga-create" };
  }

  const chapterUploadMatch = path.match(/^\/manage\/manga\/([^/]+)\/chapter$/);
  if (chapterUploadMatch?.[1]) {
    return {
      name: "manga-chapter-upload",
      id: decodeURIComponent(chapterUploadMatch[1]),
    };
  }

  const mangaEditMatch = path.match(/^\/manage\/manga\/([^/]+)$/);
  if (mangaEditMatch?.[1]) {
    return { name: "manga-edit", id: decodeURIComponent(mangaEditMatch[1]) };
  }

  const readerMatch = path.match(READER_ROUTE);
  if (readerMatch?.[1] && readerMatch?.[2]) {
    return {
      name: "reader",
      mangaId: decodeURIComponent(readerMatch[1]),
      chapterId: decodeURIComponent(readerMatch[2]),
    };
  }

  const mangaMatch = path.match(/^\/manga\/([^/]+)$/);
  if (mangaMatch?.[1]) {
    return { name: "manga", id: decodeURIComponent(mangaMatch[1]) };
  }

  return { name: "home" };
}
