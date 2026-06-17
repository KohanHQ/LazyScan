import * as libraryRepo from "@/modules/library/library.repository";
import * as mangaRepo from "@/modules/manga/manga.repository";
import { notFound } from "@/shared/http/error";
import { UUID } from "@/shared/types/id";
import { assertUuid } from "@/shared/identity/uuid";
import { staticConfig } from "@/config";
import type {
  LibraryList,
  LibraryEntryResponse,
  LibraryFeedEntryResponse,
  LibraryMembershipResponse,
} from "@/modules/library/library.model";

export async function listLibrary(
  userId: UUID,
  list: LibraryList,
  sort?: libraryRepo.LibrarySort,
  yearFrom?: number,
  yearTo?: number
): Promise<LibraryEntryResponse[]> {
  return libraryRepo.listEntries(userId, list, sort, yearFrom, yearTo);
}

// New-chapters feed for the signed-in user's saved manga (favorites + queue).
// Lenient `limit` clamping mirrors the manga module's list endpoints.
export async function listFeed(
  userId: UUID,
  options: { limit?: number } = {}
): Promise<LibraryFeedEntryResponse[]> {
  const { defaultLimit, maxLimit } = staticConfig.libraryFeed;
  const clamped = Math.min(
    Math.max(Math.trunc(options.limit ?? defaultLimit), 1),
    maxLimit
  );
  const rows = await libraryRepo.listFeedEntries(userId, clamped);
  return rows.map((row) => ({
    manga: {
      id: row.manga_id,
      title: row.manga_title,
      coverUrl: row.cover_url,
    },
    chapter: {
      id: row.chapter_id,
      title: row.chapter_title,
      chapterNumber:
        row.chapter_number === null ? null : Number(row.chapter_number),
    },
    readyAt: new Date(row.ready_at).toISOString(),
  }));
}

export async function addToLibrary(
  userId: UUID,
  mangaId: UUID,
  list: LibraryList
): Promise<void> {
  const id = assertUuid(mangaId, "manga id");
  const manga = await mangaRepo.findById(id);
  if (!manga) {
    throw notFound("Manga not found", { code: "MANGA_NOT_FOUND" });
  }
  // Idempotent: the repository's ON CONFLICT DO NOTHING ignores a duplicate add.
  await libraryRepo.addEntry(userId, id, list);
}

export async function removeFromLibrary(
  userId: UUID,
  mangaId: UUID,
  list: LibraryList
): Promise<void> {
  const id = assertUuid(mangaId, "manga id");
  // Idempotent: removing an absent entry is a no-op (no 404).
  await libraryRepo.removeEntry(userId, id, list);
}

export async function getMembership(
  userId: UUID,
  mangaId: UUID
): Promise<LibraryMembershipResponse> {
  const id = assertUuid(mangaId, "manga id");
  return libraryRepo.getMembership(userId, id);
}

// Queue auto-feed: called when a manga gets a newly published chapter. Appends
// the manga to the queue of users who favorited but have not queued it. Best-
// effort and idempotent — callers invoke it fire-and-forget so it never blocks or
// faults the publish path. Returns the number of users enqueued.
export async function autoFeedNewChapter(mangaId: UUID): Promise<number> {
  const id = assertUuid(mangaId, "manga id");
  return libraryRepo.enqueueFavoritersForManga(id);
}
