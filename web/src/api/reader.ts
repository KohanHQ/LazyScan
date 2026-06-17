import { apiRequest } from "@/api/client";
import type { ReaderChapter } from "@/api/chapter";

export type ReaderChapterPage = {
  id: string;
  chapterId: string;
  pageNumber: number;
  imageUrl: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
};

export type ReaderChapterDetail = {
  chapter: ReaderChapter;
  pages: ReaderChapterPage[];
};

export type ReadingProgress = {
  mangaId: string;
  chapterId: string;
  pageId: string;
  pageNumber: number;
  createdAt: string;
  updatedAt: string;
};

export function getChapterWithPages(
  mangaId: string,
  chapterId: string
): Promise<ReaderChapterDetail> {
  return apiRequest<ReaderChapterDetail>(
    `/reader/manga/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterId)}`
  );
}

export function getReadingProgress(
  mangaId: string
): Promise<ReadingProgress | null> {
  return apiRequest<ReadingProgress | null>(
    `/reader/manga/${encodeURIComponent(mangaId)}/progress`
  );
}

export function saveReadingProgress(
  mangaId: string,
  chapterId: string,
  pageId: string
): Promise<ReadingProgress> {
  return apiRequest<ReadingProgress>(
    `/reader/manga/${encodeURIComponent(mangaId)}/progress`,
    {
      method: "PUT",
      body: { chapterId, pageId },
    }
  );
}

// Clears progress for one manga (history "remove"). Idempotent server-side.
export function clearReadingProgress(
  mangaId: string
): Promise<{ cleared: boolean }> {
  return apiRequest<{ cleared: boolean }>(
    `/reader/manga/${encodeURIComponent(mangaId)}/progress`,
    { method: "DELETE" }
  );
}

// Pins progress to the last ready chapter's last page ("mark all read"). Also
// records an explicit per-chapter read for every ready chapter (server-side).
export function markMangaRead(mangaId: string): Promise<ReadingProgress> {
  return apiRequest<ReadingProgress>(
    `/reader/manga/${encodeURIComponent(mangaId)}/read-all`,
    { method: "POST" }
  );
}

// Chapter ids the signed-in user has explicitly read for this manga. Distinct
// from progress: reads can be set out of order and persist per chapter.
export function getReadChapters(mangaId: string): Promise<string[]> {
  return apiRequest<string[]>(
    `/reader/manga/${encodeURIComponent(mangaId)}/reads`
  );
}

// Marks one chapter read (idempotent server-side).
export function markChapterRead(
  mangaId: string,
  chapterId: string
): Promise<{ read: boolean }> {
  return apiRequest<{ read: boolean }>(
    `/reader/manga/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterId)}/read`,
    { method: "PUT" }
  );
}

// Clears one chapter's read mark (idempotent server-side).
export function unmarkChapterRead(
  mangaId: string,
  chapterId: string
): Promise<{ read: boolean }> {
  return apiRequest<{ read: boolean }>(
    `/reader/manga/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterId)}/read`,
    { method: "DELETE" }
  );
}

export type MangaHistoryEntry = {
  mangaId: string;
  title: string;
  slug: string;
  coverUrl: string | null;
  chapterId: string;
  // Pinned chapter context: title/number + ready-page count, so entries can
  // render the chapter, "Page x/y", and a progress percent.
  chapterTitle: string;
  chapterNumber: number | null;
  chapterPageCount: number;
  // True when a later ready chapter exists; false means the pinned position is
  // the catalog's end (resume surfaces hide those entries).
  hasNextChapter: boolean;
  pageId: string;
  pageNumber: number;
  updatedAt: string;
};

export function getReadingHistory(
  params: { limit?: number; offset?: number } = {}
): Promise<MangaHistoryEntry[]> {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 20));
  query.set("offset", String(params.offset ?? 0));
  return apiRequest<MangaHistoryEntry[]>(`/reader/history?${query.toString()}`);
}
