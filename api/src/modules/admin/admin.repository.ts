import { getDbClient } from "@/shared/database/client";
import { UUID } from "@/shared/types/id";
import {
  AdminImportEntry,
  AdminImportFailedPage,
  AdminLogEntry,
  AdminLogLevelCounts,
  AdminStorageByManga,
  AdminStorageResponse,
} from "@/modules/admin/admin.model";
import { ChapterImportStatus } from "@/modules/chapter/chapter.model";
import { LogLevel } from "@/shared/utility/logger";

const db = getDbClient();

function mapImportEntry(row: any): AdminImportEntry {
  return {
    importId: row.import_id as UUID,
    chapterId: row.chapter_id as UUID,
    mangaId: row.manga_id as UUID,
    mangaTitle: row.manga_title,
    chapterTitle: row.chapter_title,
    status: row.status,
    totalFiles: row.total_files,
    processedFiles: row.processed_files,
    failedFiles: row.failed_files,
    errorMessage: row.error_message,
    failedPages: (row.failed_pages ?? []) as AdminImportFailedPage[],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// Imports joined to their chapter + manga so each row carries everything the
// settings page needs to display and retry it (the retry route is manga-scoped:
// POST /manga/:id/chapter/uploads/:uploadId/retry). Failed page details ride
// along as a JSON aggregate — one query, no N+1.
export async function listImports(input: {
  status?: ChapterImportStatus;
  limit: number;
  offset: number;
}): Promise<AdminImportEntry[]> {
  const rows = await db`
    SELECT
      ci.id AS import_id,
      ci.chapter_id,
      c.manga_id,
      m.title AS manga_title,
      c.title AS chapter_title,
      ci.status,
      ci.total_files,
      ci.processed_files,
      ci.failed_files,
      ci.error_message,
      ci.created_at,
      ci.updated_at,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'pageNumber', cp.page_number,
              'originalFilename', cp.original_filename,
              'errorMessage', cp.error_message
            )
            ORDER BY cp.page_number
          )
          FROM chapter_pages cp
          WHERE cp.import_id = ci.id AND cp.status = 'failed'
        ),
        '[]'::json
      ) AS failed_pages
    FROM chapter_imports ci
    JOIN chapters c ON c.id = ci.chapter_id
    JOIN manga m ON m.id = c.manga_id
    ${input.status ? db`WHERE ci.status = ${input.status}` : db``}
    ORDER BY ci.updated_at DESC
    LIMIT ${input.limit}
    OFFSET ${input.offset}
  `;
  return rows.map(mapImportEntry);
}

function mapLogEntry(row: any): AdminLogEntry {
  return {
    id: row.id as UUID,
    level: row.level,
    message: row.message,
    service: row.service,
    context: row.context ?? null,
    errorName: row.error_name,
    errorMessage: row.error_message,
    errorStack: row.error_stack,
    createdAt: new Date(row.created_at),
  };
}

// Newest-first page over the logs table; the optional level filter rides the
// (level, created_at) index, the unfiltered scan rides created_at DESC.
export async function listLogs(input: {
  level?: LogLevel;
  limit: number;
  offset: number;
}): Promise<AdminLogEntry[]> {
  const rows = await db`
    SELECT id, level, message, service, context, error_name, error_message, error_stack, created_at
    FROM logs
    ${input.level ? db`WHERE level = ${input.level}` : db``}
    ORDER BY created_at DESC
    LIMIT ${input.limit}
    OFFSET ${input.offset}
  `;
  return rows.map(mapLogEntry);
}

// Whole-table totals per level (settings header chips). Levels with no rows
// fold to 0 so the response shape is always the full four keys.
export async function getLogLevelCounts(): Promise<AdminLogLevelCounts> {
  const rows = await db`
    SELECT level, COUNT(*)::int AS count
    FROM logs
    GROUP BY level
  `;
  const counts: AdminLogLevelCounts = { debug: 0, info: 0, warn: 0, error: 0 };
  for (const row of rows) {
    if (row.level in counts) {
      counts[row.level as LogLevel] = row.count;
    }
  }
  return counts;
}

// How many per-title slices the storage breakdown returns; the client folds
// the remainder into an "Other" slice.
const STORAGE_BY_MANGA_LIMIT = 8;

// One round trip of scalar subqueries; all small aggregates over indexed or
// low-cardinality tables. size_bytes only exists for processed final pages, so
// the byte total is the final-page estimate (originals/covers are counts only).
export async function getStorageStats(): Promise<AdminStorageResponse> {
  const byMangaRows = await db`
    SELECT
      m.id AS manga_id,
      m.title,
      COALESCE(SUM(cp.size_bytes), 0)::bigint AS bytes,
      COUNT(*)::int AS pages
    FROM chapter_pages cp
    JOIN chapters c ON c.id = cp.chapter_id
    JOIN manga m ON m.id = c.manga_id
    WHERE cp.status = 'ready'
    GROUP BY m.id, m.title
    ORDER BY bytes DESC, m.title ASC
    LIMIT ${STORAGE_BY_MANGA_LIMIT}
  `;
  const byManga: AdminStorageByManga[] = byMangaRows.map((row) => ({
    mangaId: row.manga_id,
    title: row.title,
    bytes: Number(row.bytes),
    pages: row.pages,
  }));

  const rows = await db`
    SELECT
      COALESCE((SELECT SUM(size_bytes) FROM chapter_pages WHERE status = 'ready'), 0)::bigint AS ready_pages_bytes,
      (SELECT COUNT(*) FROM chapter_pages WHERE status = 'ready')::int AS ready_pages_count,
      (SELECT COUNT(*) FROM chapter_pages)::int AS total_pages_count,
      (SELECT COUNT(*) FROM manga)::int AS manga_count,
      (SELECT COUNT(*) FROM chapters)::int AS chapter_count,
      (SELECT COUNT(*) FROM uploads WHERE type = 'manga_cover' AND status = 'completed')::int AS cover_uploads_count,
      (SELECT COUNT(*) FROM chapter_imports WHERE status = 'failed')::int AS failed_imports_count,
      (SELECT COUNT(*) FROM chapter_imports WHERE status = 'processing')::int AS processing_imports_count
  `;
  const row = rows[0];
  return {
    readyPagesBytes: Number(row.ready_pages_bytes),
    readyPagesCount: row.ready_pages_count,
    totalPagesCount: row.total_pages_count,
    mangaCount: row.manga_count,
    chapterCount: row.chapter_count,
    coverUploadsCount: row.cover_uploads_count,
    failedImportsCount: row.failed_imports_count,
    processingImportsCount: row.processing_imports_count,
    byManga,
  };
}

// Prune log entries older than the specified retention window.
// Uses the prune_logs SQL function created in migration 026_logs_prune.sql.
export async function pruneLogs(retentionDays: number): Promise<number> {
  const rows = await db`SELECT prune_logs(${retentionDays}) AS deleted_count`;
  return Number(rows[0]?.deleted_count ?? 0);
}
