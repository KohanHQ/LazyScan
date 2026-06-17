import { apiRequest } from "@/api/client";
import type { ChapterImportStatus } from "@/api/chapter";

// Superuser-only operational endpoints backing the settings page. The API
// enforces the role; these calls 403 for everyone else.

export type AdminImportFailedPage = {
  pageNumber: number;
  originalFilename: string;
  errorMessage: string | null;
};

export type AdminImportEntry = {
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
};

export type AdminStorageByManga = {
  mangaId: string;
  title: string;
  bytes: number;
  pages: number;
};

export type AdminStorageStats = {
  readyPagesBytes: number;
  readyPagesCount: number;
  totalPagesCount: number;
  mangaCount: number;
  chapterCount: number;
  coverUploadsCount: number;
  failedImportsCount: number;
  processingImportsCount: number;
  // Top titles by ready-page bytes; remainder is the "Other" pie slice.
  byManga: AdminStorageByManga[];
};

export type AdminLogLevel = "debug" | "info" | "warn" | "error";

export type AdminLogEntry = {
  id: string;
  level: AdminLogLevel;
  message: string;
  service: string;
  context: Record<string, unknown> | null;
  errorName: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  createdAt: string;
};

export type AdminLogsResult = {
  entries: AdminLogEntry[];
  // Whole-table totals per level, not the current page.
  levelCounts: Record<AdminLogLevel, number>;
};

export function listAdminImports(
  status?: ChapterImportStatus,
  limit = 50
): Promise<AdminImportEntry[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (status) {
    query.set("status", status);
  }
  return apiRequest<AdminImportEntry[]>(`/admin/imports?${query.toString()}`);
}

export function getAdminStorageStats(): Promise<AdminStorageStats> {
  return apiRequest<AdminStorageStats>("/admin/storage");
}

export function listAdminLogs(
  level?: AdminLogLevel,
  limit = 50,
  offset = 0
): Promise<AdminLogsResult> {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (level) {
    query.set("level", level);
  }
  return apiRequest<AdminLogsResult>(`/admin/logs?${query.toString()}`);
}
