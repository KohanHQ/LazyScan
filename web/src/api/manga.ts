import { apiRequest } from "@/api/client";

export type MangaStatus = "ongoing" | "completed" | "hiatus" | "cancelled";

export type Manga = {
  id: string;
  title: string;
  slug: string;
  coverUrl: string | null;
  description: string | null;
  status: MangaStatus;
  totalChapters: number | null;
  author: string | null;
  artist: string | null;
  publisher: string | null;
  publishedYear: number | null;
  tags: string[];
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const MANGA_STATUSES: MangaStatus[] = [
  "ongoing",
  "completed",
  "hiatus",
  "cancelled",
];

// On update (PATCH) a `null` clears the field; `undefined`/omitted leaves it
// unchanged. On create, nullable fields should simply be omitted.
export type MangaInput = {
  title: string;
  slug: string;
  description?: string | null;
  status?: MangaStatus;
  totalChapters?: number | null;
  author?: string | null;
  artist?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  // `null` clears the tags on update; the API normalizes (lowercase/dedupe).
  tags?: string[] | null;
};

export type ListMangaParams = {
  search?: string;
  status?: MangaStatus;
  tag?: string;
  author?: string;
  artist?: string;
  publisher?: string;
  year?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
};

export function listManga(params: ListMangaParams = {}): Promise<Manga[]> {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 50));
  query.set("offset", String(params.offset ?? 0));
  if (params.search) {
    query.set("search", params.search);
  }
  if (params.status) {
    query.set("status", params.status);
  }
  if (params.tag) {
    query.set("tag", params.tag);
  }
  if (params.author) {
    query.set("author", params.author);
  }
  if (params.artist) {
    query.set("artist", params.artist);
  }
  if (params.publisher) {
    query.set("publisher", params.publisher);
  }
  if (params.year) {
    query.set("year", params.year);
  }
  if (params.sort) {
    query.set("sort", params.sort);
  }
  if (params.order) {
    query.set("order", params.order);
  }
  return apiRequest<Manga[]>(`/manga?${query.toString()}`);
}

// Distinct catalog tags (normalized lowercase, alphabetical) for the filter UI.
export function listMangaTags(): Promise<string[]> {
  return apiRequest<string[]>("/manga/tags");
}

export function getManga(id: string): Promise<Manga> {
  return apiRequest<Manga>(`/manga/${encodeURIComponent(id)}`);
}

// Most-read titles over the backend's trailing window, for the home hero. Returns
// an empty array when there are no reads yet; the caller falls back to newest.
// `range` picks the window ("week" default or "month"); `tz` defaults to the
// browser's IANA zone so the window edge follows the user's local "today".
export function listPopularManga(
  limit = 10,
  range: "week" | "month" = "week",
  tz: string = Intl.DateTimeFormat().resolvedOptions().timeZone
): Promise<Manga[]> {
  const query = new URLSearchParams({ limit: String(limit), range });
  if (tz) {
    query.set("tz", tz);
  }
  return apiRequest<Manga[]>(`/manga/popular?${query.toString()}`);
}

// Manga ordered by their most recently published (ready) chapter, for the home
// "Recently updated" rail. Empty when no chapters are ready yet; the rail hides.
export function listRecentlyUpdatedManga(limit = 10): Promise<Manga[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  return apiRequest<Manga[]>(`/manga/updates?${query.toString()}`);
}

// Create accepts an optional cover in the same request. With a cover we send
// multipart/form-data; without one a plain JSON body keeps the call simple.
export function createManga(input: MangaInput, cover?: File): Promise<Manga> {
  if (cover) {
    const form = new FormData();
    form.set("title", input.title);
    form.set("slug", input.slug);
    // Create only ever sets values; nullable fields are omitted (clearing is an
    // update concern), so `!= null` skips both undefined and null.
    if (input.description != null) {
      form.set("description", input.description);
    }
    if (input.status !== undefined) {
      form.set("status", input.status);
    }
    if (input.totalChapters != null) {
      form.set("totalChapters", String(input.totalChapters));
    }
    if (input.author != null) {
      form.set("author", input.author);
    }
    if (input.artist != null) {
      form.set("artist", input.artist);
    }
    if (input.publisher != null) {
      form.set("publisher", input.publisher);
    }
    if (input.publishedYear != null) {
      form.set("publishedYear", String(input.publishedYear));
    }
    if (input.tags != null && input.tags.length > 0) {
      // Multipart carries tags as one comma-separated field; the API splits it.
      form.set("tags", input.tags.join(","));
    }
    form.set("cover", cover);
    return apiRequest<Manga>("/manga", { method: "POST", body: form });
  }

  return apiRequest<Manga>("/manga", { method: "POST", body: input });
}

export function updateManga(
  id: string,
  input: Partial<MangaInput>
): Promise<Manga> {
  return apiRequest<Manga>(`/manga/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
}

export function uploadMangaCover(id: string, file: File): Promise<Manga> {
  const form = new FormData();
  form.set("file", file);
  return apiRequest<Manga>(`/manga/${encodeURIComponent(id)}/cover`, {
    method: "POST",
    body: form,
  });
}

export function deleteManga(id: string): Promise<null> {
  return apiRequest<null>(`/manga/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// Mirrors the backend owner-or-superuser guard for UI affordances only; the
// API stays authoritative and still rejects unauthorized writes with 403.
export function canManageManga(
  manga: Pick<Manga, "createdByUserId">,
  user: { userId: string; role: string } | null
): boolean {
  if (!user) {
    return false;
  }
  // Compare against the account UUID (`userId`), not the public display id (`id`):
  // manga.createdByUserId is a UUID, so comparing it to the display id never
  // matched and hid manage controls from non-superuser owners.
  return user.role === "superuser" || manga.createdByUserId === user.userId;
}
