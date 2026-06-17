import { getDbClient } from "@/shared/database/client";
import { select } from "@/shared/database/query";
import type { TransactionClient } from "@/shared/database/transaction";
import { UUID } from "@/shared/types/id";
import {
  Chapter,
  ChapterImport,
  ChapterImportStatus,
  ChapterPage,
  ChapterPageWithManga,
  ChapterStatus,
  UpdateChapterInput,
} from "@/modules/chapter/chapter.model";

const db = getDbClient();

const CHAPTER_COLUMNS = [
  "id",
  "manga_id",
  "title",
  "chapter_number",
  "volume",
  "sort_order",
  "status",
  "published_at",
  "created_at",
  "updated_at",
] as const;

const CHAPTER_IMPORT_COLUMNS = [
  "id",
  "chapter_id",
  "user_id",
  "status",
  "total_files",
  "processed_files",
  "failed_files",
  "error_message",
  "created_at",
  "updated_at",
] as const;

const CHAPTER_PAGE_COLUMNS = [
  "id",
  "chapter_id",
  "page_number",
  "original_filename",
  "original_key",
  "storage_key",
  "image_url",
  "width",
  "height",
  "size_bytes",
  "status",
  "error_message",
  "created_at",
  "updated_at",
] as const;

function mapChapter(row: any): Chapter {
  return {
    id: row.id as UUID,
    mangaId: row.manga_id as UUID,
    title: row.title,
    chapterNumber: row.chapter_number === null ? null : Number(row.chapter_number),
    volume: row.volume === null ? null : Number(row.volume),
    sortOrder: row.sort_order,
    status: row.status,
    publishedAt: row.published_at === null ? null : new Date(row.published_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapImport(row: any): ChapterImport {
  return {
    id: row.id as UUID,
    chapterId: row.chapter_id as UUID,
    userId: row.user_id as UUID,
    status: row.status,
    totalFiles: row.total_files,
    processedFiles: row.processed_files,
    failedFiles: row.failed_files,
    errorMessage: row.error_message,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapPage(row: any): ChapterPage {
  return {
    id: row.id as UUID,
    chapterId: row.chapter_id as UUID,
    pageNumber: row.page_number,
    originalFilename: row.original_filename,
    originalKey: row.original_key,
    storageKey: row.storage_key,
    imageUrl: row.image_url,
    width: row.width,
    height: row.height,
    sizeBytes: row.size_bytes,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapPageWithManga(row: any): ChapterPageWithManga {
  return {
    ...mapPage(row),
    mangaId: row.manga_id as UUID,
    mangaSlug: row.manga_slug,
    importId: row.import_id as UUID,
    importStatus: row.import_status,
  };
}

export async function createChapter(input: {
  mangaId: UUID;
  title: string;
  chapterNumber?: number;
  volume?: number;
  sortOrder?: number;
}, tx?: TransactionClient): Promise<Chapter> {
  const client = tx ?? db;
  const rows = await client`
    INSERT INTO chapters (manga_id, title, chapter_number, volume, sort_order, status)
    VALUES (
      ${input.mangaId},
      ${input.title},
      ${input.chapterNumber ?? null},
      ${input.volume ?? null},
      ${input.sortOrder ?? 0},
      'importing'
    )
    RETURNING ${client([...CHAPTER_COLUMNS])}
  `;
  return mapChapter(rows[0]);
}

export async function createImport(input: {
  chapterId: UUID;
  userId: UUID;
  totalFiles: number;
}, tx?: TransactionClient): Promise<ChapterImport> {
  const client = tx ?? db;
  const rows = await client`
    INSERT INTO chapter_imports (chapter_id, user_id, status, total_files)
    VALUES (${input.chapterId}, ${input.userId}, 'uploading', ${input.totalFiles})
    RETURNING ${client([...CHAPTER_IMPORT_COLUMNS])}
  `;
  return mapImport(rows[0]);
}

export async function createPages(input: {
  importId: UUID;
  chapterId: UUID;
  pages: {
    pageNumber: number;
    originalFilename: string;
    originalKey: string;
    storageKey: string;
  }[];
}, tx?: TransactionClient): Promise<ChapterPage[]> {
  if (input.pages.length === 0) {
    return [];
  }

  const client = tx ?? db;

  const pageRows = input.pages.map(page => ({
    import_id: input.importId,
    chapter_id: input.chapterId,
    page_number: page.pageNumber,
    original_filename: page.originalFilename,
    original_key: page.originalKey,
    storage_key: page.storageKey,
    status: 'waiting_upload',
  }));

  const rows = await client`
    INSERT INTO chapter_pages ${client(pageRows)}
    RETURNING ${client([...CHAPTER_PAGE_COLUMNS])}
  `;

  return rows.map(mapPage);
}

export async function findImportForUser(
  id: UUID,
  userId: UUID
): Promise<{ chapter: Chapter; import: ChapterImport } | null> {
  const rows = await db`
    SELECT
      c.id AS chapter_id_for_map,
      c.*,
      ci.id AS import_id,
      ci.chapter_id AS import_chapter_id,
      ci.user_id,
      ci.status AS import_status,
      ci.total_files,
      ci.processed_files,
      ci.failed_files,
      ci.error_message AS import_error_message,
      ci.created_at AS import_created_at,
      ci.updated_at AS import_updated_at
    FROM chapter_imports ci
    JOIN chapters c ON c.id = ci.chapter_id
    WHERE ci.id = ${id}
      AND ci.user_id = ${userId}
    LIMIT 1
  `;

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  return {
    chapter: mapChapter(row),
    import: mapImport({
      id: row.import_id,
      chapter_id: row.import_chapter_id,
      user_id: row.user_id,
      status: row.import_status,
      total_files: row.total_files,
      processed_files: row.processed_files,
      failed_files: row.failed_files,
      error_message: row.import_error_message,
      created_at: row.import_created_at,
      updated_at: row.import_updated_at,
    }),
  };
}

export async function findImportById(
  id: UUID
): Promise<{ chapter: Chapter; import: ChapterImport } | null> {
  const rows = await db`
    SELECT
      c.id AS chapter_id_for_map,
      c.*,
      ci.id AS import_id,
      ci.chapter_id AS import_chapter_id,
      ci.user_id,
      ci.status AS import_status,
      ci.total_files,
      ci.processed_files,
      ci.failed_files,
      ci.error_message AS import_error_message,
      ci.created_at AS import_created_at,
      ci.updated_at AS import_updated_at
    FROM chapter_imports ci
    JOIN chapters c ON c.id = ci.chapter_id
    WHERE ci.id = ${id}
    LIMIT 1
  `;

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  return {
    chapter: mapChapter(row),
    import: mapImport({
      id: row.import_id,
      chapter_id: row.import_chapter_id,
      user_id: row.user_id,
      status: row.import_status,
      total_files: row.total_files,
      processed_files: row.processed_files,
      failed_files: row.failed_files,
      error_message: row.import_error_message,
      created_at: row.import_created_at,
      updated_at: row.import_updated_at,
    }),
  };
}

export async function findPagesByChapterId(chapterId: UUID): Promise<ChapterPage[]> {
  const rows = await select("chapter_pages", CHAPTER_PAGE_COLUMNS)
    .whereEq("chapter_id", chapterId)
    .orderBy("page_number", "asc")
    .build();
  return rows.map(mapPage);
}

// Reader-visible chapters: processed (status 'ready') AND published by the owner.
export async function findReadyChaptersByMangaId(mangaId: UUID): Promise<Chapter[]> {
  const rows = await select("chapters", CHAPTER_COLUMNS)
    .whereEq("manga_id", mangaId)
    .whereEq("status", "ready")
    .where(db`published_at IS NOT NULL`)
    .orderByRaw(db`sort_order ASC, chapter_number ASC NULLS LAST, created_at ASC, id ASC`)
    .build();
  return rows.map(mapChapter);
}

export async function findReadyChapterForManga(
  mangaId: UUID,
  chapterId: UUID
): Promise<Chapter | null> {
  const rows = await select("chapters", CHAPTER_COLUMNS)
    .whereEq("id", chapterId)
    .whereEq("manga_id", mangaId)
    .whereEq("status", "ready")
    .where(db`published_at IS NOT NULL`)
    .limit(1)
    .build();
  return rows.length ? mapChapter(rows[0]) : null;
}

// All chapters of a manga regardless of status/published, in reader order, for
// the owner management surface (the ownership check is enforced by the service).
export async function findChaptersByMangaId(mangaId: UUID): Promise<Chapter[]> {
  const rows = await select("chapters", CHAPTER_COLUMNS)
    .whereEq("manga_id", mangaId)
    .orderByRaw(db`sort_order ASC, chapter_number ASC NULLS LAST, created_at ASC, id ASC`)
    .build();
  return rows.map(mapChapter);
}

// Owner-scoped chapter lookup that ignores status/published, for management and
// preview surfaces (the manga ownership check is enforced by the service).
export async function findChapterForManga(
  mangaId: UUID,
  chapterId: UUID
): Promise<Chapter | null> {
  const rows = await select("chapters", CHAPTER_COLUMNS)
    .whereEq("id", chapterId)
    .whereEq("manga_id", mangaId)
    .limit(1)
    .build();
  return rows.length ? mapChapter(rows[0]) : null;
}

export async function findReadyPagesByChapterId(chapterId: UUID): Promise<ChapterPage[]> {
  const rows = await select("chapter_pages", CHAPTER_PAGE_COLUMNS)
    .whereEq("chapter_id", chapterId)
    .whereEq("status", "ready")
    .where(db`image_url IS NOT NULL`)
    .orderBy("page_number", "asc")
    .build();
  return rows.map(mapPage);
}

export async function findReadyPageForChapter(
  chapterId: UUID,
  pageId: UUID
): Promise<ChapterPage | null> {
  const rows = await select("chapter_pages", CHAPTER_PAGE_COLUMNS)
    .whereEq("id", pageId)
    .whereEq("chapter_id", chapterId)
    .whereEq("status", "ready")
    .where(db`image_url IS NOT NULL`)
    .limit(1)
    .build();
  return rows.length ? mapPage(rows[0]) : null;
}

export async function findPageForImportAndUser(
  importId: UUID,
  pageId: UUID,
  userId: UUID
): Promise<ChapterPage | null> {
  const rows = await db`
    SELECT cp.*
    FROM chapter_pages cp
    JOIN chapter_imports ci ON ci.id = cp.import_id
    WHERE ci.id = ${importId}
      AND ci.user_id = ${userId}
      AND cp.id = ${pageId}
    LIMIT 1
  `;
  return rows.length ? mapPage(rows[0]) : null;
}

export async function findPageForImport(
  importId: UUID,
  pageId: UUID
): Promise<ChapterPage | null> {
  const rows = await db`
    SELECT cp.*
    FROM chapter_pages cp
    WHERE cp.import_id = ${importId}
      AND cp.id = ${pageId}
    LIMIT 1
  `;
  return rows.length ? mapPage(rows[0]) : null;
}

export async function findPageForProcessing(id: UUID): Promise<ChapterPageWithManga | null> {
  const rows = await db`
    SELECT
      cp.*,
      c.manga_id,
      m.slug AS manga_slug,
      ci.id AS import_id,
      ci.status AS import_status
    FROM chapter_pages cp
    JOIN chapters c ON c.id = cp.chapter_id
    JOIN manga m ON m.id = c.manga_id
    JOIN chapter_imports ci ON ci.id = cp.import_id
    WHERE cp.id = ${id}
    LIMIT 1
  `;
  return rows.length ? mapPageWithManga(rows[0]) : null;
}

export async function updateChapterStatus(
  id: UUID,
  status: ChapterStatus,
  tx?: TransactionClient
): Promise<void> {
  const client = tx ?? db;
  await client`
    UPDATE chapters
    SET status = ${status}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function updateImportStatus(
  id: UUID,
  status: ChapterImportStatus,
  errorMessage?: string,
  tx?: TransactionClient
): Promise<void> {
  const client = tx ?? db;
  await client`
    UPDATE chapter_imports
    SET
      status = ${status},
      error_message = ${errorMessage ?? null},
      updated_at = now()
    WHERE id = ${id}
  `;
}

export async function markImportProcessing(
  importId: UUID,
  chapterId: UUID,
  tx?: TransactionClient
): Promise<void> {
  const client = tx ?? db;
  await client`
    UPDATE chapter_imports
    SET status = 'processing', error_message = NULL, updated_at = now()
    WHERE id = ${importId}
  `;
  await client`
    UPDATE chapters
    SET status = 'processing', updated_at = now()
    WHERE id = ${chapterId}
  `;
  await client`
    UPDATE chapter_pages
    SET status = 'processing', error_message = NULL, updated_at = now()
    WHERE chapter_id = ${chapterId}
      AND status != 'ready'
  `;
}

// Sets or clears the API-owned publish timestamp (reader visibility). Passing a
// Date publishes; passing null unpublishes. Returns the updated chapter, or null
// when the chapter no longer exists.
export async function setChapterPublished(
  chapterId: UUID,
  publishedAt: Date | null,
  tx?: TransactionClient
): Promise<Chapter | null> {
  const client = tx ?? db;
  const rows = await client`
    UPDATE chapters
    SET published_at = ${publishedAt}, updated_at = now()
    WHERE id = ${chapterId}
    RETURNING ${client([...CHAPTER_COLUMNS])}
  `;
  return rows.length ? mapChapter(rows[0]) : null;
}

// Updates editable chapter metadata only (title/number/volume/sort_order). Never
// touches status or published_at. Returns null when the chapter does not exist.
export async function updateChapterMeta(
  chapterId: UUID,
  input: UpdateChapterInput,
  tx?: TransactionClient
): Promise<Chapter | null> {
  const client = tx ?? db;
  const fields: Record<string, unknown> = {};
  if (input.title !== undefined) fields.title = input.title;
  if (input.chapterNumber !== undefined) fields.chapter_number = input.chapterNumber;
  if (input.volume !== undefined) fields.volume = input.volume;
  if (input.sortOrder !== undefined) fields.sort_order = input.sortOrder;

  const rows = Object.keys(fields).length
    ? await client`
        UPDATE chapters
        SET ${client(fields)}, updated_at = now()
        WHERE id = ${chapterId}
        RETURNING ${client([...CHAPTER_COLUMNS])}
      `
    : await client`
        UPDATE chapters
        SET updated_at = now()
        WHERE id = ${chapterId}
        RETURNING ${client([...CHAPTER_COLUMNS])}
      `;
  return rows.length ? mapChapter(rows[0]) : null;
}

// Deletes a chapter. chapter_imports/chapter_pages/chapter_reads/reading_progress
// rows cascade via their ON DELETE CASCADE FKs; R2 cleanup is the caller's job.
export async function deleteChapter(
  chapterId: UUID,
  tx?: TransactionClient
): Promise<boolean> {
  const client = tx ?? db;
  const result = await client`
    DELETE FROM chapters WHERE id = ${chapterId}
  `;
  return result.count > 0;
}

// Storage keys for every page of a chapter (final + staged original), for
// best-effort R2 cleanup on chapter delete.
export async function findPageStorageKeysByChapterId(
  chapterId: UUID
): Promise<{ storageKey: string | null; originalKey: string | null }[]> {
  const rows = await db<{ storage_key: string | null; original_key: string | null }[]>`
    SELECT storage_key, original_key
    FROM chapter_pages
    WHERE chapter_id = ${chapterId}
  `;
  return rows.map((row) => ({
    storageKey: row.storage_key,
    originalKey: row.original_key,
  }));
}

// Ready pages whose staged original has not yet been reclaimed. Drives the
// storage prune (migration 027): the original is dead weight once Kiln has
// written the final WebP, so it is safe to delete for ready pages only. Failed
// pages keep their original (the retry path re-reads it). Oldest-first via the
// partial idx_chapter_pages_prunable.
export async function listPrunableOriginalKeys(
  limit: number
): Promise<{ id: UUID; originalKey: string }[]> {
  const rows = await db<{ id: UUID; original_key: string }[]>`
    SELECT id, original_key
    FROM chapter_pages
    WHERE status = 'ready'
      AND original_pruned_at IS NULL
      AND original_key IS NOT NULL
    ORDER BY created_at
    LIMIT ${limit}
  `;
  return rows.map((row) => ({ id: row.id, originalKey: row.original_key }));
}

// Stamps original_pruned_at so a reclaimed original is never rescanned. Called
// only after the object delete succeeded (S3 delete of an already-gone key is a
// success, so an idempotent re-run still stamps it).
export async function markOriginalsPruned(pageIds: UUID[]): Promise<number> {
  if (pageIds.length === 0) {
    return 0;
  }
  const result = await db`
    UPDATE chapter_pages
    SET original_pruned_at = now()
    WHERE id = ANY(${pageIds})
  `;
  return result.count;
}

// Reassigns page_number to 1..N in the given page-id order. The
// (chapter_id, page_number) UNIQUE constraint and page_number > 0 CHECK are
// non-deferrable, so every page is first lifted above the live range, then set to
// its final number — no transient collision. Must run inside a transaction; the
// caller validates that orderedPageIds is a permutation of the chapter's pages.
const PAGE_REORDER_OFFSET = 1_000_000;

export async function reorderChapterPages(
  chapterId: UUID,
  orderedPageIds: UUID[],
  tx: TransactionClient
): Promise<void> {
  await tx`
    UPDATE chapter_pages
    SET page_number = page_number + ${PAGE_REORDER_OFFSET}, updated_at = now()
    WHERE chapter_id = ${chapterId}
  `;
  for (let index = 0; index < orderedPageIds.length; index++) {
    await tx`
      UPDATE chapter_pages
      SET page_number = ${index + 1}, updated_at = now()
      WHERE id = ${orderedPageIds[index]} AND chapter_id = ${chapterId}
    `;
  }
}
