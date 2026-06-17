import * as chapterRepo from "@/modules/chapter/chapter.repository";
import * as mangaRepo from "@/modules/manga/manga.repository";
import * as readerRepo from "@/modules/reader/reader.repository";
import {
  Chapter,
  ChapterPage,
  ChapterResponse,
} from "@/modules/chapter/chapter.model";
import {
  ReaderChapterDetailResponse,
  ReaderChapterPageResponse,
  ReadingProgress,
  ReadingProgressResponse,
  SaveReadingProgressInput,
  MangaHistoryResponse,
} from "@/modules/reader/reader.model";
import { assertUuid } from "@/shared/identity/uuid";
import { notFound, badRequest } from "@/shared/http/error";
import { logError } from "@/shared/utility/logger";
import { UUID } from "@/shared/types/id";
import { cacheGet, cacheSet, cacheInvalidate } from "@/shared/cache/redis";
import { createConfig, staticConfig } from "@/config";
import { envSchema } from "@/env";

const config = createConfig(envSchema.parse(process.env));

// Reader read-cache keys (behind ENABLE_CACHE). List is one key per manga; detail
// is one key per (manga, chapter). The detail prefix `reader:chapter:{mangaId}:`
// lets a single manga's chapter details be invalidated together.
const readerChaptersKey = (mangaId: UUID): string => `reader:chapters:${mangaId}`;
const readerChapterKey = (mangaId: UUID, chapterId: UUID): string =>
  `reader:chapter:${mangaId}:${chapterId}`;
const readerChapterPrefix = (mangaId: UUID): string =>
  `reader:chapter:${mangaId}:`;

// Drops every reader cache entry for a manga (its chapter list + all chapter
// details). Called fire-and-forget on chapter mutations and manga delete so a
// publish/unpublish/edit/delete/reorder is reflected immediately, not after TTL.
export async function invalidateMangaReaderCache(mangaId: UUID): Promise<void> {
  await Promise.all([
    cacheInvalidate(readerChaptersKey(mangaId)),
    cacheInvalidate(readerChapterPrefix(mangaId)),
  ]);
}

function toChapterResponse(chapter: Chapter): ChapterResponse {
  return {
    id: chapter.id,
    mangaId: chapter.mangaId,
    title: chapter.title,
    chapterNumber: chapter.chapterNumber,
    volume: chapter.volume,
    sortOrder: chapter.sortOrder,
    status: chapter.status,
    publishedAt: chapter.publishedAt ? chapter.publishedAt.toISOString() : null,
    createdAt: chapter.createdAt.toISOString(),
    updatedAt: chapter.updatedAt.toISOString(),
  };
}

function toReaderPageResponse(page: ChapterPage): ReaderChapterPageResponse {
  if (!page.imageUrl) {
    throw notFound("Chapter page not found", {
      code: "CHAPTER_PAGE_NOT_FOUND",
    });
  }

  return {
    id: page.id,
    chapterId: page.chapterId,
    pageNumber: page.pageNumber,
    imageUrl: page.imageUrl,
    width: page.width,
    height: page.height,
    sizeBytes: page.sizeBytes,
  };
}

function toReadingProgressResponse(
  progress: ReadingProgress
): ReadingProgressResponse {
  return {
    mangaId: progress.mangaId,
    chapterId: progress.chapterId,
    pageId: progress.pageId,
    pageNumber: progress.pageNumber,
    createdAt: progress.createdAt.toISOString(),
    updatedAt: progress.updatedAt.toISOString(),
  };
}

export async function listReadyChaptersForManga(
  mangaIdInput: UUID
): Promise<ChapterResponse[]> {
  const mangaId = assertUuid(mangaIdInput, "manga id");

  const cacheKey = readerChaptersKey(mangaId);
  if (config.features.cache) {
    const cached = await cacheGet<ChapterResponse[]>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const manga = await mangaRepo.findById(mangaId);

  if (!manga) {
    throw notFound("Manga not found", {
      code: "MANGA_NOT_FOUND",
    });
  }

  const chapters = await chapterRepo.findReadyChaptersByMangaId(mangaId);
  const response = chapters.map(toChapterResponse);

  if (config.features.cache) {
    // Fire-and-forget: caching is best-effort and must not delay the response.
    void cacheSet(cacheKey, response, staticConfig.cache.readerTtlMs);
  }
  return response;
}

// Opening a ready chapter counts as a read for popularity ranking. Fire-and-
// forget: this hot, public path must not block on or fail from the views write.
// Fired on both cache hit and miss so caching never undercounts reads.
function recordChapterView(mangaId: UUID): void {
  void mangaRepo.recordMangaView(mangaId).catch((error) =>
    logError(
      "Failed to record manga view",
      error instanceof Error ? error : new Error(String(error)),
      { mangaId }
    )
  );
}

export async function getReadyChapterForReader(
  mangaIdInput: UUID,
  chapterIdInput: UUID
): Promise<ReaderChapterDetailResponse> {
  const mangaId = assertUuid(mangaIdInput, "manga id");
  const chapterId = assertUuid(chapterIdInput, "chapter id");

  const cacheKey = readerChapterKey(mangaId, chapterId);
  if (config.features.cache) {
    const cached = await cacheGet<ReaderChapterDetailResponse>(cacheKey);
    if (cached) {
      recordChapterView(mangaId);
      return cached;
    }
  }

  const manga = await mangaRepo.findById(mangaId);

  if (!manga) {
    throw notFound("Manga not found", {
      code: "MANGA_NOT_FOUND",
    });
  }

  const chapter = await chapterRepo.findReadyChapterForManga(mangaId, chapterId);

  if (!chapter) {
    throw notFound("Chapter not found", {
      code: "CHAPTER_NOT_FOUND",
    });
  }

  const pages = await chapterRepo.findReadyPagesByChapterId(chapter.id);

  const response: ReaderChapterDetailResponse = {
    chapter: toChapterResponse(chapter),
    pages: pages.map(toReaderPageResponse),
  };

  recordChapterView(mangaId);

  if (config.features.cache) {
    // Fire-and-forget: caching is best-effort and must not delay the response.
    void cacheSet(cacheKey, response, staticConfig.cache.readerTtlMs);
  }

  return response;
}

export async function getReadingProgress(
  mangaIdInput: UUID,
  userId: UUID
): Promise<ReadingProgressResponse | null> {
  const mangaId = assertUuid(mangaIdInput, "manga id");
  const manga = await mangaRepo.findById(mangaId);

  if (!manga) {
    throw notFound("Manga not found", {
      code: "MANGA_NOT_FOUND",
    });
  }

  const progress = await readerRepo.findReadingProgress(userId, mangaId);
  return progress ? toReadingProgressResponse(progress) : null;
}

export async function saveReadingProgress(
  input: SaveReadingProgressInput
): Promise<ReadingProgressResponse> {
  const mangaId = assertUuid(input.mangaId, "manga id");
  const chapterId = assertUuid(input.chapterId, "chapter id");
  const pageId = assertUuid(input.pageId, "chapter page id");
  const manga = await mangaRepo.findById(mangaId);

  if (!manga) {
    throw notFound("Manga not found", {
      code: "MANGA_NOT_FOUND",
    });
  }

  const chapter = await chapterRepo.findReadyChapterForManga(mangaId, chapterId);

  if (!chapter) {
    throw notFound("Chapter not found", {
      code: "CHAPTER_NOT_FOUND",
    });
  }

  const page = await chapterRepo.findReadyPageForChapter(chapter.id, pageId);

  if (!page) {
    throw notFound("Chapter page not found", {
      code: "CHAPTER_PAGE_NOT_FOUND",
    });
  }

  const progress = await readerRepo.upsertReadingProgress({
    userId: input.userId,
    mangaId,
    chapterId: chapter.id,
    pageId: page.id,
    pageNumber: page.pageNumber,
  });

  return toReadingProgressResponse(progress);
}

export async function clearReadingProgress(
  mangaIdInput: UUID,
  userId: UUID
): Promise<boolean> {
  const mangaId = assertUuid(mangaIdInput, "manga id");
  return readerRepo.deleteReadingProgress(userId, mangaId);
}

// Marks a manga fully read. Records an explicit per-chapter read for every ready
// chapter and pins progress to the last ready chapter's last page so the
// continue-reading position lands at the end. Returns the pinned progress for
// backward compatibility with the existing read-all response.
export async function markMangaRead(
  mangaIdInput: UUID,
  userId: UUID
): Promise<ReadingProgressResponse> {
  const mangaId = assertUuid(mangaIdInput, "manga id");
  const manga = await mangaRepo.findById(mangaId);
  if (!manga) {
    throw notFound("Manga not found", { code: "MANGA_NOT_FOUND" });
  }

  const chapters = await chapterRepo.findReadyChaptersByMangaId(mangaId);
  const lastChapter = chapters[chapters.length - 1];
  if (!lastChapter) {
    throw badRequest("No ready chapters to mark read", {
      code: "NO_READY_CHAPTERS",
    });
  }

  const pages = await chapterRepo.findReadyPagesByChapterId(lastChapter.id);
  const lastPage = pages[pages.length - 1];
  if (!lastPage) {
    throw badRequest("The last chapter has no ready pages", {
      code: "NO_READY_PAGES",
    });
  }

  await readerRepo.markChaptersRead({
    userId,
    mangaId,
    chapterIds: chapters.map((chapter) => chapter.id),
  });

  const progress = await readerRepo.upsertReadingProgress({
    userId,
    mangaId,
    chapterId: lastChapter.id,
    pageId: lastPage.id,
    pageNumber: lastPage.pageNumber,
  });
  return toReadingProgressResponse(progress);
}

// Lists the chapter ids the user has explicitly read for one manga. Validates the
// manga exists so callers get a consistent 404 for unknown manga.
export async function listReadChapterIds(
  mangaIdInput: UUID,
  userId: UUID
): Promise<string[]> {
  const mangaId = assertUuid(mangaIdInput, "manga id");
  const manga = await mangaRepo.findById(mangaId);
  if (!manga) {
    throw notFound("Manga not found", { code: "MANGA_NOT_FOUND" });
  }
  return readerRepo.findReadChapterIds(userId, mangaId);
}

// Marks one chapter read. Validates the chapter belongs to the manga and is ready
// (same guard as progress saves), so hidden/non-ready chapters return 404.
export async function markChapterRead(
  mangaIdInput: UUID,
  chapterIdInput: UUID,
  userId: UUID
): Promise<boolean> {
  const mangaId = assertUuid(mangaIdInput, "manga id");
  const chapterId = assertUuid(chapterIdInput, "chapter id");
  const manga = await mangaRepo.findById(mangaId);
  if (!manga) {
    throw notFound("Manga not found", { code: "MANGA_NOT_FOUND" });
  }

  const chapter = await chapterRepo.findReadyChapterForManga(mangaId, chapterId);
  if (!chapter) {
    throw notFound("Chapter not found", { code: "CHAPTER_NOT_FOUND" });
  }

  await readerRepo.markChapterRead({ userId, mangaId, chapterId: chapter.id });
  return true;
}

// Clears one chapter's read mark. Idempotent: a missing manga still 404s, but an
// already-unread chapter is a no-op (returns false). Does not require the chapter
// to be ready so a user can always unmark.
export async function unmarkChapterRead(
  mangaIdInput: UUID,
  chapterIdInput: UUID,
  userId: UUID
): Promise<boolean> {
  const mangaId = assertUuid(mangaIdInput, "manga id");
  const chapterId = assertUuid(chapterIdInput, "chapter id");
  const manga = await mangaRepo.findById(mangaId);
  if (!manga) {
    throw notFound("Manga not found", { code: "MANGA_NOT_FOUND" });
  }
  return readerRepo.deleteChapterRead(userId, chapterId);
}

export async function getReadingHistory(
  userId: UUID,
  limit = 20,
  offset = 0
): Promise<MangaHistoryResponse[]> {
  const rows = await readerRepo.findReadingHistory(userId, limit, offset);
  return rows.map((row) => ({
    mangaId: row.manga_id as string,
    title: row.title as string,
    slug: row.slug as string,
    coverUrl: row.cover_url as string | null,
    chapterId: row.chapter_id as string,
    chapterTitle: row.chapter_title,
    chapterNumber:
      row.chapter_number === null ? null : Number(row.chapter_number),
    chapterPageCount: Number(row.chapter_page_count),
    hasNextChapter: row.has_next_chapter,
    pageId: row.page_id as string,
    pageNumber: row.page_number as number,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}
