import { getDbClient } from "@/shared/database/client";
import { UUID } from "@/shared/types/id";
import { mapRow as mapMangaRow } from "@/modules/manga/manga.repository";
import { toResponse as toMangaResponse } from "@/modules/manga/manga.service";
import type {
  LibraryList,
  LibraryEntryResponse,
  LibraryMembershipResponse,
} from "@/modules/library/library.model";

const db = getDbClient();

// Sort options for library entries
export type LibrarySort = "newest" | "title" | "year";

export async function listEntries(
  userId: UUID,
  list: LibraryList,
  sort: LibrarySort = "newest",
  yearFrom?: number,
  yearTo?: number
): Promise<LibraryEntryResponse[]> {
  let orderClause;
  switch (sort) {
    case "title":
      orderClause = db`m.title ASC`;
      break;
    case "year":
      orderClause = db`m.published_year DESC NULLS LAST, m.title ASC`;
      break;
    case "newest":
    default:
      orderClause =
        list === "queue"
          ? db`ul.position ASC NULLS LAST, ul.added_at ASC`
          : db`ul.added_at DESC`;
      break;
  }

  // Year bounds are validated/parsed upstream (parseMangaYearRangeFilter in the
  // handler), so here they are trusted numbers — never raw user strings.
  const hasYearFilter = yearFrom !== undefined && yearTo !== undefined;

  const rows = await db`
    SELECT m.*, ul.added_at, ul.position
    FROM user_library ul
    JOIN manga m ON m.id = ul.manga_id
    WHERE ul.user_id = ${userId} AND ul.list = ${list}
    ${hasYearFilter ? db` AND m.published_year IS NOT NULL AND m.published_year >= ${yearFrom} AND m.published_year <= ${yearTo}` : db``}
    ORDER BY ${orderClause}
  `;

  return rows.map((row) => ({
    manga: toMangaResponse(mapMangaRow(row)),
    addedAt: new Date(row.added_at).toISOString(),
    position: row.position,
  }));
}

export async function addEntry(
  userId: UUID,
  mangaId: UUID,
  list: LibraryList
): Promise<void> {
  if (list === "queue") {
    // Append to the end of the queue. NULLIF/COALESCE keeps the first insert at 1.
    await db`
      INSERT INTO user_library (user_id, manga_id, list, position)
      VALUES (
        ${userId},
        ${mangaId},
        'queue',
        COALESCE(
          (SELECT MAX(position) FROM user_library WHERE user_id = ${userId} AND list = 'queue'),
          0
        ) + 1
      )
      ON CONFLICT (user_id, manga_id, list) DO NOTHING
    `;
    return;
  }

  await db`
    INSERT INTO user_library (user_id, manga_id, list)
    VALUES (${userId}, ${mangaId}, 'favorite')
    ON CONFLICT (user_id, manga_id, list) DO NOTHING
  `;
}

export async function removeEntry(
  userId: UUID,
  mangaId: UUID,
  list: LibraryList
): Promise<boolean> {
  const result = await db`
    DELETE FROM user_library
    WHERE user_id = ${userId} AND manga_id = ${mangaId} AND list = ${list}
  `;
  return result.count > 0;
}

// Raw row shape for the new-chapters feed; the service maps it to camelCase.
export interface RawLibraryFeedRow {
  chapter_id: string;
  chapter_title: string;
  chapter_number: string | number | null;
  ready_at: string | Date;
  manga_id: string;
  manga_title: string;
  cover_url: string | null;
}

// Newest published chapters across every manga the user saved (favorites and
// queue, deduped via DISTINCT since a title can sit in both lists). Read state is
// not filtered: the feed shows what is new, not what is unread. `published_at` is
// the publish time (set by the API at finalize/publish), so it is stable against
// later chapter edits — unlike the old `updated_at` proxy.
export async function listFeedEntries(
  userId: UUID,
  limit: number
): Promise<RawLibraryFeedRow[]> {
  const rows = await db<RawLibraryFeedRow[]>`
    SELECT
      c.id AS chapter_id,
      c.title AS chapter_title,
      c.chapter_number,
      c.published_at AS ready_at,
      m.id AS manga_id,
      m.title AS manga_title,
      m.cover_url
    FROM (
      SELECT DISTINCT manga_id
      FROM user_library
      WHERE user_id = ${userId}
    ) saved
    JOIN chapters c
      ON c.manga_id = saved.manga_id
      AND c.status = 'ready'
      AND c.published_at IS NOT NULL
    JOIN manga m ON m.id = saved.manga_id
    ORDER BY c.published_at DESC, c.id DESC
    LIMIT ${limit}
  `;
  return rows;
}

// Queue auto-feed: when a manga gets a newly published chapter, append it to the
// queue of every user who favorited it but does not already have it queued. One
// row per such user, positioned at that user's current queue tail. The NOT EXISTS
// skips users who already queued it; ON CONFLICT is a belt-and-suspenders guard
// against the unique (user_id, manga_id, list). Idempotent and safe to re-run.
// Returns how many users were enqueued (for logging).
export async function enqueueFavoritersForManga(mangaId: UUID): Promise<number> {
  const result = await db`
    INSERT INTO user_library (user_id, manga_id, list, position)
    SELECT
      fav.user_id,
      ${mangaId},
      'queue',
      COALESCE(
        (SELECT MAX(q.position) FROM user_library q
          WHERE q.user_id = fav.user_id AND q.list = 'queue'),
        0
      ) + 1
    FROM user_library fav
    WHERE fav.manga_id = ${mangaId}
      AND fav.list = 'favorite'
      AND NOT EXISTS (
        SELECT 1 FROM user_library q2
        WHERE q2.user_id = fav.user_id
          AND q2.manga_id = ${mangaId}
          AND q2.list = 'queue'
      )
    ON CONFLICT (user_id, manga_id, list) DO NOTHING
  `;
  return result.count;
}

export async function getMembership(
  userId: UUID,
  mangaId: UUID
): Promise<LibraryMembershipResponse> {
  const rows = await db`
    SELECT list FROM user_library
    WHERE user_id = ${userId} AND manga_id = ${mangaId}
  `;
  const lists = new Set(rows.map((row) => row.list as string));
  return { favorite: lists.has("favorite"), queue: lists.has("queue") };
}
