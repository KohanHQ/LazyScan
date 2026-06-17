import { getDbClient } from "@/shared/database/client";
import { select } from "@/shared/database/query";
import { UUID } from "@/shared/types/id";
import { ReadingProgress } from "@/modules/reader/reader.model";

const db = getDbClient();

const READING_PROGRESS_COLUMNS = [
  "id",
  "user_id",
  "manga_id",
  "chapter_id",
  "page_id",
  "page_number",
  "created_at",
  "updated_at",
] as const;

function mapReadingProgress(row: any): ReadingProgress {
  return {
    id: row.id as UUID,
    userId: row.user_id as UUID,
    mangaId: row.manga_id as UUID,
    chapterId: row.chapter_id as UUID,
    pageId: row.page_id as UUID,
    pageNumber: row.page_number,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function findReadingProgress(
  userId: UUID,
  mangaId: UUID
): Promise<ReadingProgress | null> {
  const rows = await select("reading_progress", READING_PROGRESS_COLUMNS)
    .whereEq("user_id", userId)
    .whereEq("manga_id", mangaId)
    .limit(1)
    .build();
  return rows.length ? mapReadingProgress(rows[0]) : null;
}

export async function upsertReadingProgress(input: {
  userId: UUID;
  mangaId: UUID;
  chapterId: UUID;
  pageId: UUID;
  pageNumber: number;
}): Promise<ReadingProgress> {
  const rows = await db`
    INSERT INTO reading_progress (
      user_id,
      manga_id,
      chapter_id,
      page_id,
      page_number
    )
    VALUES (
      ${input.userId},
      ${input.mangaId},
      ${input.chapterId},
      ${input.pageId},
      ${input.pageNumber}
    )
    ON CONFLICT (user_id, manga_id)
    DO UPDATE SET
      chapter_id = EXCLUDED.chapter_id,
      page_id = EXCLUDED.page_id,
      page_number = EXCLUDED.page_number,
      updated_at = now()
    RETURNING ${db([...READING_PROGRESS_COLUMNS])}
  `;
  return mapReadingProgress(rows[0]);
}

// Clears a user's progress for one manga (used by history "remove"). Idempotent:
// returns false when there was no row. Orphaned rows can't accumulate — the FKs
// are ON DELETE CASCADE — so this is purely the user-facing clear.
export async function deleteReadingProgress(
  userId: UUID,
  mangaId: UUID
): Promise<boolean> {
  const result = await db`
    DELETE FROM reading_progress
    WHERE user_id = ${userId} AND manga_id = ${mangaId}
  `;
  return result.count > 0;
}

// Raw DB row shape for the reading-history join; the service maps it to the
// camelCase MangaHistoryResponse.
export interface RawMangaHistoryRow {
  manga_id: string;
  title: string;
  slug: string;
  cover_url: string | null;
  chapter_id: string;
  chapter_title: string;
  chapter_number: string | number | null;
  chapter_page_count: string | number;
  has_next_chapter: boolean;
  page_id: string;
  page_number: number;
  updated_at: string | Date;
}

// Joins the pinned chapter's title/number, counts its ready pages, and flags
// whether a later ready chapter exists, so history entries can show "Page x/y",
// a percent, and continue-reading surfaces can hide fully-finished titles. The
// subqueries run per returned row (history pages are small) over indexed
// chapter columns. "Later" uses the reader's chapter ordering (sort_order,
// chapter_number NULLS LAST, created_at, id) — COALESCE to numeric Infinity
// replicates NULLS LAST inside the row comparison.
export async function findReadingHistory(
  userId: UUID,
  limit = 20,
  offset = 0
): Promise<RawMangaHistoryRow[]> {
  const rows = await db<RawMangaHistoryRow[]>`
    SELECT
      m.id AS manga_id,
      m.title,
      m.slug,
      m.cover_url,
      rp.chapter_id,
      c.title AS chapter_title,
      c.chapter_number,
      (
        SELECT COUNT(*)
        FROM chapter_pages cp
        WHERE cp.chapter_id = rp.chapter_id AND cp.status = 'ready'
      ) AS chapter_page_count,
      EXISTS (
        SELECT 1
        FROM chapters c2
        WHERE c2.manga_id = rp.manga_id
          AND c2.status = 'ready'
          AND c2.published_at IS NOT NULL
          AND (c2.sort_order, COALESCE(c2.chapter_number, 'Infinity'::numeric), c2.created_at, c2.id)
            > (c.sort_order, COALESCE(c.chapter_number, 'Infinity'::numeric), c.created_at, c.id)
      ) AS has_next_chapter,
      rp.page_id,
      rp.page_number,
      rp.updated_at
    FROM reading_progress rp
    JOIN manga m ON m.id = rp.manga_id
    JOIN chapters c ON c.id = rp.chapter_id
    WHERE rp.user_id = ${userId}
    ORDER BY rp.updated_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return rows;
}

// Per-chapter read state lives in `chapter_reads`, one row per (user, chapter).
// Presence = read; absence = unread. Distinct from `reading_progress` (the single
// continue-reading position): a user can mark chapters read out of order.

export async function findReadChapterIds(
  userId: UUID,
  mangaId: UUID
): Promise<UUID[]> {
  const rows = await db<{ chapter_id: UUID }[]>`
    SELECT chapter_id
    FROM chapter_reads
    WHERE user_id = ${userId} AND manga_id = ${mangaId}
  `;
  return rows.map((row) => row.chapter_id);
}

// Marks one chapter read. Idempotent: a repeat read is a no-op via the PK.
export async function markChapterRead(input: {
  userId: UUID;
  mangaId: UUID;
  chapterId: UUID;
}): Promise<void> {
  await db`
    INSERT INTO chapter_reads (user_id, chapter_id, manga_id)
    VALUES (${input.userId}, ${input.chapterId}, ${input.mangaId})
    ON CONFLICT (user_id, chapter_id) DO NOTHING
  `;
}

// Bulk-marks chapters read (used by mark-all-read). Idempotent per row.
export async function markChaptersRead(input: {
  userId: UUID;
  mangaId: UUID;
  chapterIds: UUID[];
}): Promise<void> {
  if (input.chapterIds.length === 0) {
    return;
  }

  const rows = input.chapterIds.map((chapterId) => ({
    user_id: input.userId,
    chapter_id: chapterId,
    manga_id: input.mangaId,
  }));

  await db`
    INSERT INTO chapter_reads ${db(rows)}
    ON CONFLICT (user_id, chapter_id) DO NOTHING
  `;
}

// Clears one chapter's read mark. Idempotent: returns false when there was no row.
export async function deleteChapterRead(
  userId: UUID,
  chapterId: UUID
): Promise<boolean> {
  const result = await db`
    DELETE FROM chapter_reads
    WHERE user_id = ${userId} AND chapter_id = ${chapterId}
  `;
  return result.count > 0;
}
