import type { MangaResponse } from "@/modules/manga/manga.model";

export type LibraryList = "favorite" | "queue";

export interface LibraryEntryResponse {
  manga: MangaResponse;
  addedAt: string;
  position: number | null;
}

export interface LibraryMembershipResponse {
  favorite: boolean;
  queue: boolean;
}

// One feed row: a ready chapter from a manga the user saved (favorite or queue).
// `readyAt` is the chapter's updated_at — the publish-time proxy used everywhere
// until a dedicated ready_at column exists (see manga.repository notes).
export interface LibraryFeedEntryResponse {
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
}
