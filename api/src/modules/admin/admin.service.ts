import * as repo from "@/modules/admin/admin.repository";
import {
  AdminImportEntry,
  AdminImportEntryResponse,
  AdminLogEntry,
  AdminLogEntryResponse,
  AdminLogsResponse,
  AdminPruneLogsResponse,
  AdminPruneStorageResponse,
  AdminStorageResponse,
} from "@/modules/admin/admin.model";
import { ChapterImportStatus } from "@/modules/chapter/chapter.model";
import * as chapterService from "@/modules/chapter/chapter.service";
import { badRequest, forbidden } from "@/shared/http/error";
import { AuthUser } from "@/middleware/auth";
import { LogLevel } from "@/shared/utility/logger";
import { createConfig } from "@/config";
import { envSchema } from "@/env";

const config = createConfig(envSchema.parse(process.env));

const IMPORT_STATUSES: ChapterImportStatus[] = [
  "uploading",
  "processing",
  "completed",
  "failed",
];

const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

// Every admin route is superuser-only. Enforced here in the service (the
// sidebar gating in the web app is a UI affordance only).
function assertSuperuser(user: AuthUser): void {
  if (user.role !== "superuser") {
    throw forbidden("Admin access required", {
      code: "ADMIN_ACCESS_REQUIRED",
    });
  }
}

function toImportEntryResponse(entry: AdminImportEntry): AdminImportEntryResponse {
  return {
    importId: entry.importId,
    chapterId: entry.chapterId,
    mangaId: entry.mangaId,
    mangaTitle: entry.mangaTitle,
    chapterTitle: entry.chapterTitle,
    status: entry.status,
    totalFiles: entry.totalFiles,
    processedFiles: entry.processedFiles,
    failedFiles: entry.failedFiles,
    errorMessage: entry.errorMessage,
    failedPages: entry.failedPages,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export async function listImports(
  user: AuthUser,
  input: { status?: string; limit: number; offset: number }
): Promise<AdminImportEntryResponse[]> {
  assertSuperuser(user);

  let status: ChapterImportStatus | undefined;
  if (input.status !== undefined && input.status !== "") {
    if (!IMPORT_STATUSES.includes(input.status as ChapterImportStatus)) {
      throw badRequest("Invalid import status", {
        code: "INVALID_IMPORT_STATUS",
        details: { status: input.status, allowed: IMPORT_STATUSES },
      });
    }
    status = input.status as ChapterImportStatus;
  }

  const entries = await repo.listImports({
    status,
    limit: input.limit,
    offset: input.offset,
  });
  return entries.map(toImportEntryResponse);
}

export async function getStorageStats(
  user: AuthUser
): Promise<AdminStorageResponse> {
  assertSuperuser(user);
  return repo.getStorageStats();
}

// Manual storage prune: reclaim staged page originals the image service has already
// converted. Same job the periodic in-process prune runs; exposed so an admin
// can reclaim space on demand. Mirrors pruneLogs (superuser-only, returns a
// summary).
export async function pruneStorage(
  user: AuthUser
): Promise<AdminPruneStorageResponse> {
  assertSuperuser(user);
  const { deletedCount, scannedCount } =
    await chapterService.pruneStagingOriginals();
  return { deletedCount, scannedCount };
}

function toLogEntryResponse(entry: AdminLogEntry): AdminLogEntryResponse {
  return {
    id: entry.id,
    level: entry.level,
    message: entry.message,
    service: entry.service,
    context: entry.context,
    errorName: entry.errorName,
    errorMessage: entry.errorMessage,
    errorStack: entry.errorStack,
    createdAt: entry.createdAt.toISOString(),
  };
}

export async function listLogs(
  user: AuthUser,
  input: { level?: string; limit: number; offset: number }
): Promise<AdminLogsResponse> {
  assertSuperuser(user);

  let level: LogLevel | undefined;
  if (input.level !== undefined && input.level !== "") {
    if (!LOG_LEVELS.includes(input.level as LogLevel)) {
      throw badRequest("Invalid log level", {
        code: "INVALID_LOG_LEVEL",
        details: { level: input.level, allowed: LOG_LEVELS },
      });
    }
    level = input.level as LogLevel;
  }

  const [entries, levelCounts] = await Promise.all([
    repo.listLogs({ level, limit: input.limit, offset: input.offset }),
    repo.getLogLevelCounts(),
  ]);
  return { entries: entries.map(toLogEntryResponse), levelCounts };
}

export async function pruneLogs(
  user: AuthUser,
  input: { retentionDays?: number }
): Promise<AdminPruneLogsResponse> {
  assertSuperuser(user);

  const retentionDays = input.retentionDays ?? config.logs.retentionDays;
  if (retentionDays < 1) {
    throw badRequest("Retention days must be at least 1", {
      code: "INVALID_RETENTION_DAYS",
      details: { retentionDays },
    });
  }

  const deletedCount = await repo.pruneLogs(retentionDays);
  return { deletedCount, retentionDays };
}
