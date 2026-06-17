import { apiRequest } from "@/api/client";
import type { Manga } from "@/api/manga";

export type LibraryList = "favorite" | "queue";

export type LibraryEntry = {
  manga: Manga;
  addedAt: string;
  position: number | null;
};

export type LibraryMembership = {
  favorite: boolean;
  queue: boolean;
};

export function getLibrary(
  list: LibraryList,
  sort?: string,
  year?: string
): Promise<LibraryEntry[]> {
  const query = new URLSearchParams();
  if (sort) query.set("sort", sort);
  if (year) query.set("year", year);
  const qs = query.toString();
  return apiRequest<LibraryEntry[]>(`/library/${list}${qs ? "?" + qs : ""}`);
}

export function addToLibrary(list: LibraryList, mangaId: string): Promise<null> {
  return apiRequest<null>(`/library/${list}`, {
    method: "POST",
    body: { mangaId },
  });
}

export function removeFromLibrary(
  list: LibraryList,
  mangaId: string
): Promise<null> {
  return apiRequest<null>(`/library/${list}/${encodeURIComponent(mangaId)}`, {
    method: "DELETE",
  });
}

export function getLibraryMembership(
  mangaId: string
): Promise<LibraryMembership> {
  return apiRequest<LibraryMembership>(
    `/library/membership/${encodeURIComponent(mangaId)}`
  );
}

// Newest ready chapters across the user's saved manga (favorites + queue,
// deduped server-side). `readyAt` is the chapter's publish-time proxy.
export type LibraryFeedEntry = {
  manga: {
    id: string;
    title: string;
    coverUrl: string | null;
  };
  chapter: {
    id: string;
    title: string;
    chapterNumber: number | null;
  };
  readyAt: string;
};

export function getLibraryFeed(limit = 15): Promise<LibraryFeedEntry[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  return apiRequest<LibraryFeedEntry[]>(`/library/feed?${query.toString()}`);
}
