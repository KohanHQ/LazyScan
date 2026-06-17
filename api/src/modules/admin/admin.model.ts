import { UUID } from "@/shared/types/id";
import { ChapterImportStatus } from "@/modules/chapter/chapter.model";
import { LogLevel } from "@/shared/utility/logger";

// Lightweight per-page failure detail surfaced on the import list so worker
// failures are debuggable from the settings page without reading logs or Redis.
export interface AdminImportFailedPage {
  pageNumber: number;
  originalFilename: string;
  errorMessage: string | null;
}

export interface AdminImportEntry {
  importId: UUID;
  chapterId: UUID;
  mangaId: UUID;
  mangaTitle: string;
  chapterTitle: string;
  status: ChapterImportStatus;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  errorMessage: string | null;
  failedPages: AdminImportFailedPage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminImportEntryResponse {
  importId: string;
  chapterId: string;
  mangaId: string;
  mangaTitle: string;
  chapterTitle: string;
  status: ChapterImportStatus;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  errorMessage: string | null;
  failedPages: AdminImportFailedPage[];
  createdAt: string;
  updatedAt: string;
}

// Audit trail rows read straight from the logs table (written by
// shared/utility/logger.saveLog). Superuser-only visibility; context JSONB may
// carry request data, which is acceptable at the admin trust level.
export interface AdminLogEntry {
  id: UUID;
  level: LogLevel;
  message: string;
  service: string;
  context: Record<string, unknown> | null;
  errorName: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  createdAt: Date;
}

export interface AdminLogEntryResponse {
  id: string;
  level: LogLevel;
  message: string;
  service: string;
  context: Record<string, unknown> | null;
  errorName: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  createdAt: string;
}

export interface AdminLogLevelCounts {
  debug: number;
  info: number;
  warn: number;
  error: number;
}

export interface AdminLogsResponse {
  entries: AdminLogEntryResponse[];
  // Totals per level across the whole table (not the current page) — feeds the
  // settings header chips.
  levelCounts: AdminLogLevelCounts;
}

// Storage usage is an estimate: only processed final pages record size_bytes.
// Staged originals and covers have no recorded sizes, so they are reported as
// counts, not bytes.
export interface AdminStorageByManga {
  mangaId: string;
  title: string;
  bytes: number;
  pages: number;
}

export interface AdminStorageResponse {
  readyPagesBytes: number;
  readyPagesCount: number;
  totalPagesCount: number;
  mangaCount: number;
  chapterCount: number;
  coverUploadsCount: number;
  failedImportsCount: number;
  processingImportsCount: number;
  // Top titles by ready-page bytes (settings pie chart); the client derives an
  // "Other" slice from readyPagesBytes minus the listed slices.
  byManga: AdminStorageByManga[];
}

// Response for the log pruning operation.
export interface AdminPruneLogsResponse {
  deletedCount: number;
  retentionDays: number;
}

// Response for the storage pruning operation: staged page originals reclaimed
// (deletedCount) out of the rows scanned this run (scannedCount).
export interface AdminPruneStorageResponse {
  deletedCount: number;
  scannedCount: number;
}
