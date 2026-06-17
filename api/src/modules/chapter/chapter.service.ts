import * as repo from "@/modules/chapter/chapter.repository";
import * as mangaService from "@/modules/manga/manga.service";
import * as libraryService from "@/modules/library/library.service";
import * as readerService from "@/modules/reader/reader.service";
import {
  Chapter,
  ChapterImport,
  ChapterImportDetailResponse,
  ChapterImportFileInput,
  ChapterImportResponse,
  ChapterPage,
  ChapterPageResponse,
  ChapterPreviewResponse,
  ChapterResponse,
  CreateChapterImportInput,
  CreateChapterImportResponse,
  UpdateChapterInput,
} from "@/modules/chapter/chapter.model";
import { assertUuid } from "@/shared/identity/uuid";
import { badRequest, insufficientStorage, notFound } from "@/shared/http/error";
import { logError, logInfo, logWarn } from "@/shared/utility/logger";
import { withTransaction } from "@/shared/database/transaction";
import { createStorageService, StorageService } from "@/shared/storage";
import {
  CHAPTER_PAGE_EVENT_SCHEMA_VERSION,
  CHAPTER_PAGE_PROCESSING_REQUESTED,
  insertOutboxEvents,
} from "@/shared/outbox/outbox";
import { envSchema } from "@/env";
import { createConfig } from "@/config";
import { UUID } from "@/shared/types/id";
import { MAX_IMAGE_UPLOAD_BYTES } from "@/shared/upload";
import { AuthUser } from "@/middleware/auth";

const env = envSchema.parse(process.env);
const config = createConfig(env);

const filenameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

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

function toImportResponse(chapterImport: ChapterImport): ChapterImportResponse {
  return {
    id: chapterImport.id,
    chapterId: chapterImport.chapterId,
    status: chapterImport.status,
    totalFiles: chapterImport.totalFiles,
    processedFiles: chapterImport.processedFiles,
    failedFiles: chapterImport.failedFiles,
    errorMessage: chapterImport.errorMessage,
    createdAt: chapterImport.createdAt.toISOString(),
    updatedAt: chapterImport.updatedAt.toISOString(),
  };
}

function toPageResponse(page: ChapterPage): ChapterPageResponse {
  return {
    id: page.id,
    chapterId: page.chapterId,
    pageNumber: page.pageNumber,
    originalFilename: page.originalFilename,
    originalKey: page.originalKey,
    storageKey: page.storageKey,
    imageUrl: page.imageUrl,
    width: page.width,
    height: page.height,
    sizeBytes: page.sizeBytes,
    status: page.status,
    errorMessage: page.errorMessage,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.-]/g, "_").substring(0, 80);
}

function sortFiles(files: ChapterImportFileInput[]): ChapterImportFileInput[] {
  return [...files].sort((a, b) =>
    filenameCollator.compare(a.filename, b.filename),
  );
}

function pageNumberLabel(pageNumber: number): string {
  return pageNumber.toString().padStart(3, "0");
}

function createOriginalKey(
  importId: UUID,
  pageNumber: number,
  filename: string,
): string {
  return `imports/${importId}/originals/${pageNumberLabel(pageNumber)}-${sanitizeFilename(filename)}`;
}

function createFinalKey(
  mangaSlug: string,
  chapterId: UUID,
  pageNumber: number,
): string {
  return `manga/${mangaSlug}/chapters/${chapterId}/pages/${pageNumberLabel(pageNumber)}.webp`;
}

function getStorage(): StorageService {
  // Gate on the resolved storage profile, not the R2-specific cloudflare block,
  // so the MinIO/S3 profile (self-host, no CLOUDFLARE_* set) is supported —
  // matching manga cover, avatar upload, and the chapter cleanup path.
  if (!config.storage.isConfigured) {
    throw badRequest("Storage is not configured", {
      code: "STORAGE_NOT_CONFIGURED",
    });
  }

  return createStorageService(config);
}

// Fire-and-forget queue auto-feed (Phase 2): when a chapter transitions to
// published, append the manga to the queue of users who favorited it. Must never
// block or fault the publish path — idempotent and retry-safe on the repo side.
function autoFeedAfterPublish(mangaId: UUID): void {
  void libraryService
    .autoFeedNewChapter(mangaId)
    .catch((error) =>
      logError(
        "Queue auto-feed failed",
        error instanceof Error ? error : new Error(String(error)),
        { mangaId },
      ),
    );
}

// Drop the manga's reader read-caches (chapter list + chapter details) after a
// mutation so a publish/unpublish/edit/delete/reorder shows immediately rather
// than after TTL. Fire-and-forget; invalidation is already best-effort.
function invalidateReaderCache(mangaId: UUID): void {
  void readerService
    .invalidateMangaReaderCache(mangaId)
    .catch((error) =>
      logError(
        "Reader cache invalidation failed",
        error instanceof Error ? error : new Error(String(error)),
        { mangaId },
      ),
    );
}

async function assertImportBelongsToManga(
  importId: UUID,
  user: AuthUser,
  mangaId: UUID,
): Promise<void> {
  const scopedMangaId = assertUuid(mangaId, "manga id");
  const scopedImportId = assertUuid(importId, "chapter upload id");
  const found =
    user.role === "superuser"
      ? await repo.findImportById(scopedImportId)
      : await repo.findImportForUser(scopedImportId, user.id);

  if (!found || found.chapter.mangaId !== scopedMangaId) {
    throw notFound("Chapter upload not found", {
      code: "CHAPTER_UPLOAD_NOT_FOUND",
    });
  }

  await mangaService.assertCanManageMangaById(scopedMangaId, user);
}

export async function createChapterImport(
  input: CreateChapterImportInput,
  user: AuthUser,
): Promise<CreateChapterImportResponse> {
  const mangaId = assertUuid(input.mangaId, "manga id");
  const manga = await mangaService.assertCanManageMangaById(mangaId, user);

  const sortedFiles = sortFiles(input.files);

  // Storage hardcap: reject before staging when projected usage exceeds the
  // quota. Usage counts only 'ready' pages, so this undercounts (see repo note).
  const incomingBytes = sortedFiles.reduce(
    (sum, file) => sum + (file.sizeBytes ?? 0),
    0,
  );
  const usedBytes = await repo.sumReadyPageBytes();
  if (usedBytes + incomingBytes > config.storageQuotaBytes) {
    throw insufficientStorage("Storage quota exceeded", {
      code: "STORAGE_QUOTA_EXCEEDED",
      details: { quotaBytes: config.storageQuotaBytes, usedBytes, incomingBytes },
    });
  }

  const storage = getStorage();
  const expiresInSeconds = 15 * 60;
  const expiresAt = new Date(
    Date.now() + expiresInSeconds * 1000,
  ).toISOString();

  const created = await withTransaction(async (tx) => {
    const chapter = await repo.createChapter(
      {
        mangaId,
        title: input.title,
        chapterNumber: input.chapterNumber,
        volume: input.volume,
        sortOrder: input.sortOrder,
      },
      tx,
    );

    const chapterImport = await repo.createImport(
      {
        chapterId: chapter.id,
        userId: user.id,
        totalFiles: sortedFiles.length,
      },
      tx,
    );

    const pageInputs = sortedFiles.map((file, index) => {
      const pageNumber = index + 1;
      return {
        pageNumber,
        originalFilename: file.filename,
        originalKey: createOriginalKey(
          chapterImport.id,
          pageNumber,
          file.filename,
        ),
        storageKey: createFinalKey(manga.slug, chapter.id, pageNumber),
      };
    });

    const pages = await repo.createPages(
      {
        importId: chapterImport.id,
        chapterId: chapter.id,
        pages: pageInputs,
      },
      tx,
    );

    return { chapter, chapterImport, pages };
  });

  let uploads;
  try {
    uploads = await Promise.all(
      created.pages.map(async (page) => {
        const file = sortedFiles[page.pageNumber - 1];
        const uploadUrl = await storage.createPresignedPutUrl(
          page.originalKey,
          {
            contentType: file.contentType,
            expiresInSeconds,
          },
        );

        return {
          pageId: page.id,
          pageNumber: page.pageNumber,
          filename: page.originalFilename,
          originalKey: page.originalKey,
          uploadUrl,
          expiresAt,
        };
      }),
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to generate presigned upload URLs";
    await repo.updateImportStatus(
      created.chapterImport.id,
      "failed",
      errorMessage,
    );
    await repo.updateChapterStatus(created.chapter.id, "failed");
    throw error;
  }

  return {
    chapter: toChapterResponse(created.chapter),
    import: toImportResponse(created.chapterImport),
    pages: created.pages.map(toPageResponse),
    uploads,
  };
}

export async function getMangaChapterUpload(
  mangaId: UUID,
  uploadId: UUID,
  user: AuthUser,
): Promise<ChapterImportDetailResponse> {
  await assertImportBelongsToManga(uploadId, user, mangaId);
  return getChapterImport(uploadId, user);
}

export async function getChapterImport(
  id: UUID,
  user: AuthUser,
): Promise<ChapterImportDetailResponse> {
  const importId = assertUuid(id, "chapter import id");
  const found =
    user.role === "superuser"
      ? await repo.findImportById(importId)
      : await repo.findImportForUser(importId, user.id);

  if (!found) {
    throw notFound("Chapter import not found", {
      code: "CHAPTER_IMPORT_NOT_FOUND",
    });
  }

  const pages = await repo.findPagesByChapterId(found.chapter.id);

  return {
    chapter: toChapterResponse(found.chapter),
    import: toImportResponse(found.import),
    pages: pages.map(toPageResponse),
  };
}

export async function completeMangaChapterUpload(
  mangaId: UUID,
  uploadId: UUID,
  user: AuthUser,
  options: { holdAsDraft?: boolean } = {},
): Promise<ChapterImportDetailResponse> {
  await assertImportBelongsToManga(uploadId, user, mangaId);
  return completeChapterImport(uploadId, user, options);
}

export async function completeChapterImport(
  id: UUID,
  user: AuthUser,
  options: { holdAsDraft?: boolean } = {},
): Promise<ChapterImportDetailResponse> {
  const importId = assertUuid(id, "chapter import id");
  const found =
    user.role === "superuser"
      ? await repo.findImportById(importId)
      : await repo.findImportForUser(importId, user.id);

  if (!found) {
    throw notFound("Chapter import not found", {
      code: "CHAPTER_IMPORT_NOT_FOUND",
    });
  }

  if (found.import.status !== "uploading" && found.import.status !== "failed") {
    throw badRequest("Chapter import is not waiting for upload completion", {
      code: "CHAPTER_IMPORT_NOT_UPLOADABLE",
      details: { status: found.import.status },
    });
  }

  const pages = await repo.findPagesByChapterId(found.chapter.id);
  const storage = getStorage();

  for (const page of pages) {
    const exists = await storage.exists(page.originalKey);
    if (!exists) {
      throw badRequest("Expected staged chapter page is missing", {
        code: "CHAPTER_PAGE_ORIGINAL_MISSING",
        details: {
          pageId: page.id,
          pageNumber: page.pageNumber,
          originalKey: page.originalKey,
        },
      });
    }
  }

  // Publish intent is set here (the owner's finalize step), not at Kiln's
  // ready flip — so the visibility transition is API-observable (auto-feed
  // hooks it in Phase 2). Default publishes; holdAsDraft leaves published_at
  // NULL so the owner can preview and publish later. Visibility still also
  // requires status 'ready' (Kiln), so an auto-published chapter only appears
  // once processing finishes.
  const publishNow = options.holdAsDraft !== true;
  // Only a NULL -> published transition triggers auto-feed (a re-complete of an
  // already-published chapter must not re-enqueue).
  const becamePublished = publishNow && !found.chapter.publishedAt;

  // The outbox is the only processing backend. Rows are written in the same
  // tx as the status flips (the transactional-outbox guarantee); the
  // dispatcher publishes to Kiln after commit, and a failed insert rolls the
  // whole completion back. Ready pages no-op at the consumer.
  await withTransaction(async (tx) => {
    await repo.markImportProcessing(found.import.id, found.chapter.id, tx);
    if (publishNow) {
      await repo.setChapterPublished(found.chapter.id, new Date(), tx);
    }
    await insertOutboxEvents(
      pages.map((page) => ({
        eventType: CHAPTER_PAGE_PROCESSING_REQUESTED,
        schemaVersion: CHAPTER_PAGE_EVENT_SCHEMA_VERSION,
        aggregateType: "chapter_page",
        aggregateId: page.id,
        payload: {
          importId: found.import.id,
          chapterId: found.chapter.id,
          pageId: page.id,
        },
      })),
      tx,
    );
  });

  if (becamePublished) {
    autoFeedAfterPublish(found.chapter.mangaId);
  }
  invalidateReaderCache(found.chapter.mangaId);

  return getChapterImport(found.import.id, user);
}

export async function uploadMangaChapterPage(
  mangaId: UUID,
  uploadId: UUID,
  pageId: UUID,
  user: AuthUser,
  file: File,
): Promise<ChapterPageResponse> {
  await assertImportBelongsToManga(uploadId, user, mangaId);
  return uploadChapterImportPage(uploadId, pageId, user, file);
}

export async function uploadChapterImportPage(
  importIdInput: UUID,
  pageIdInput: UUID,
  user: AuthUser,
  file: File,
): Promise<ChapterPageResponse> {
  const importId = assertUuid(importIdInput, "chapter import id");
  const pageId = assertUuid(pageIdInput, "chapter page id");
  const found =
    user.role === "superuser"
      ? await repo.findImportById(importId)
      : await repo.findImportForUser(importId, user.id);

  if (!found) {
    throw notFound("Chapter import not found", {
      code: "CHAPTER_IMPORT_NOT_FOUND",
    });
  }

  if (found.import.status !== "uploading" && found.import.status !== "failed") {
    throw badRequest("Chapter import is not accepting page uploads", {
      code: "CHAPTER_IMPORT_NOT_UPLOADABLE",
      details: { status: found.import.status },
    });
  }

  const page =
    user.role === "superuser"
      ? await repo.findPageForImport(importId, pageId)
      : await repo.findPageForImportAndUser(importId, pageId, user.id);

  if (!page) {
    throw notFound("Chapter page not found", {
      code: "CHAPTER_PAGE_NOT_FOUND",
    });
  }

  const expectedExtension = page.originalFilename
    .split(".")
    .pop()
    ?.toLowerCase();
  const actualExtension = file.name.split(".").pop()?.toLowerCase();

  if (
    expectedExtension &&
    actualExtension &&
    expectedExtension !== actualExtension
  ) {
    throw badRequest("Uploaded file extension does not match the import page", {
      code: "CHAPTER_PAGE_FILE_MISMATCH",
      details: {
        expectedFilename: page.originalFilename,
        actualFilename: file.name,
      },
    });
  }

  const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    throw badRequest(
      "Invalid image type. Only JPEG, PNG, and WebP are allowed",
      {
        code: "INVALID_IMAGE_TYPE",
        details: { contentType: file.type, allowedTypes },
      },
    );
  }

  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw badRequest("File size exceeds maximum allowed size", {
      code: "FILE_TOO_LARGE",
      details: { size: file.size, max: MAX_IMAGE_UPLOAD_BYTES },
    });
  }

  const storage = getStorage();
  const buffer = Buffer.from(await file.arrayBuffer());
  await storage.upload(page.originalKey, buffer, {
    contentType: file.type,
    metadata: {
      originalFilename: page.originalFilename,
      uploadedAt: new Date().toISOString(),
    },
  });

  return toPageResponse(page);
}

export async function retryMangaChapterUpload(
  mangaId: UUID,
  uploadId: UUID,
  user: AuthUser,
): Promise<ChapterImportDetailResponse> {
  await assertImportBelongsToManga(uploadId, user, mangaId);
  return requeueChapterImport(uploadId, user);
}

export async function requeueChapterImport(
  id: UUID,
  user: AuthUser,
): Promise<ChapterImportDetailResponse> {
  const detail = await getChapterImport(id, user);
  const pagesToRequeue = detail.pages.filter((page) => page.status !== "ready");

  if (pagesToRequeue.length === 0) {
    return getChapterImport(id, user);
  }

  // The retry mints fresh events — a new outbox row per non-ready page (new
  // eventId from the DB default, same pageId), in the same tx as the status
  // flips. Kiln's processed-events dedup is keyed by eventId, so a reused id
  // would no-op; a fresh one reprocesses.
  await withTransaction(async (tx) => {
    await insertOutboxEvents(
      pagesToRequeue.map((page) => ({
        eventType: CHAPTER_PAGE_PROCESSING_REQUESTED,
        schemaVersion: CHAPTER_PAGE_EVENT_SCHEMA_VERSION,
        aggregateType: "chapter_page",
        aggregateId: page.id as UUID,
        payload: {
          importId: detail.import.id,
          chapterId: detail.chapter.id,
          pageId: page.id,
        },
      })),
      tx,
    );
    await repo.updateImportStatus(detail.import.id as UUID, "processing", undefined, tx);
    await repo.updateChapterStatus(detail.chapter.id as UUID, "processing", tx);
  });
  // Status flips ready -> processing, so a published chapter leaves the
  // reader-visible set until it re-readies.
  invalidateReaderCache(detail.chapter.mangaId as UUID);

  return getChapterImport(id, user);
}

// ---------------------------------------------------------------------------
// Chapter management after upload (Cluster A): edit / delete / reorder pages /
// publish / unpublish / preview. All owner-gated through the manga ownership
// check, mirroring the upload routes.
// ---------------------------------------------------------------------------

// Loads a chapter scoped to a manage-able manga, ignoring status/published so the
// owner can act on drafts and failed chapters too. 404 when the chapter does not
// belong to the manga.
async function loadManagedChapter(
  mangaIdInput: UUID,
  chapterIdInput: UUID,
  user: AuthUser,
): Promise<Chapter> {
  const mangaId = assertUuid(mangaIdInput, "manga id");
  const chapterId = assertUuid(chapterIdInput, "chapter id");
  await mangaService.assertCanManageMangaById(mangaId, user);

  const chapter = await repo.findChapterForManga(mangaId, chapterId);
  if (!chapter) {
    throw notFound("Chapter not found", { code: "CHAPTER_NOT_FOUND" });
  }
  return chapter;
}

// Best-effort R2 cleanup that never throws — a failed delete is logged, not
// propagated, so a chapter delete still succeeds when storage is down or
// unconfigured (mirrors manga delete).
async function deleteStorageKeysBestEffort(keys: (string | null)[]): Promise<void> {
  const uniqueKeys = [...new Set(keys.filter((key): key is string => !!key))];
  if (!uniqueKeys.length) {
    return;
  }

  if (!config.storage.isConfigured) {
    logWarn("Skipped chapter storage cleanup because storage is not configured", {
      keyCount: uniqueKeys.length,
    });
    return;
  }

  const storage = createStorageService(config);
  for (const key of uniqueKeys) {
    try {
      await storage.delete(key);
    } catch (error) {
      logError(
        "Chapter storage cleanup failed",
        error instanceof Error ? error : new Error(String(error)),
        { key },
      );
    }
  }
}

// Storage prune (lite self-host): reclaim staged originals of already-processed
// (ready) pages. Kiln writes the final WebP (storage_key) but never deletes the
// staged original, so each processed page keeps both objects (~2x page storage);
// the 10 GB MinIO quota is the hard backstop and this keeps usage under it.
// Best-effort and idempotent: each original is deleted, then the row is stamped
// (migration 027) so it is reclaimed exactly once and never rescanned. A failed
// delete is left unstamped and retried on the next run. Failed pages are skipped
// — their original is the source the retry path re-reads.
export async function pruneStagingOriginals(
  options: { batchSize?: number; maxBatches?: number } = {},
): Promise<{ deletedCount: number; scannedCount: number }> {
  const batchSize = options.batchSize ?? 200;
  const maxBatches = options.maxBatches ?? 50;

  if (!config.storage.isConfigured) {
    logWarn("Storage prune skipped: storage is not configured");
    return { deletedCount: 0, scannedCount: 0 };
  }

  const storage = createStorageService(config);
  let deletedCount = 0;
  let scannedCount = 0;

  for (let batch = 0; batch < maxBatches; batch++) {
    const pages = await repo.listPrunableOriginalKeys(batchSize);
    if (pages.length === 0) {
      break;
    }
    scannedCount += pages.length;

    const prunedIds: UUID[] = [];
    for (const page of pages) {
      try {
        // S3 delete of an already-gone key succeeds, so this is safe to re-run.
        await storage.delete(page.originalKey);
        prunedIds.push(page.id);
      } catch (error) {
        // Storage error: leave the row unstamped so the next run retries it.
        logError(
          "Storage prune delete failed",
          error instanceof Error ? error : new Error(String(error)),
          { key: page.originalKey },
        );
      }
    }

    if (prunedIds.length > 0) {
      await repo.markOriginalsPruned(prunedIds);
      deletedCount += prunedIds.length;
    }

    // Whole batch failed -> storage is down; stop rather than spin the rest
    // against a dead backend. Short batch -> no rows remain.
    if (prunedIds.length === 0 || pages.length < batchSize) {
      break;
    }
  }

  if (deletedCount > 0) {
    logInfo("Storage prune reclaimed staged originals", {
      deletedCount,
      scannedCount,
    });
  }

  return { deletedCount, scannedCount };
}

// Lists every chapter of a manga (any status/published state) for the owner
// management surface.
export async function listMangaChapters(
  mangaIdInput: UUID,
  user: AuthUser,
): Promise<ChapterResponse[]> {
  const mangaId = assertUuid(mangaIdInput, "manga id");
  await mangaService.assertCanManageMangaById(mangaId, user);
  const chapters = await repo.findChaptersByMangaId(mangaId);
  return chapters.map(toChapterResponse);
}

export async function updateChapter(
  mangaIdInput: UUID,
  chapterIdInput: UUID,
  user: AuthUser,
  input: UpdateChapterInput,
): Promise<ChapterResponse> {
  const chapter = await loadManagedChapter(mangaIdInput, chapterIdInput, user);
  const updated = await repo.updateChapterMeta(chapter.id, input);
  invalidateReaderCache(chapter.mangaId);
  return toChapterResponse(updated ?? chapter);
}

// Publishes a chapter (sets reader visibility). Idempotent: already-published
// returns as-is. Allowed regardless of status — visibility still requires
// status 'ready', so publishing a still-processing chapter just pre-arms it.
export async function publishChapter(
  mangaIdInput: UUID,
  chapterIdInput: UUID,
  user: AuthUser,
): Promise<ChapterResponse> {
  const chapter = await loadManagedChapter(mangaIdInput, chapterIdInput, user);
  if (chapter.publishedAt) {
    return toChapterResponse(chapter);
  }
  const updated = await repo.setChapterPublished(chapter.id, new Date());
  // NULL -> published transition: enqueue favoriters (fire-and-forget).
  autoFeedAfterPublish(chapter.mangaId);
  invalidateReaderCache(chapter.mangaId);
  return toChapterResponse(updated ?? chapter);
}

// Unpublishes a chapter (clears reader visibility). Idempotent.
export async function unpublishChapter(
  mangaIdInput: UUID,
  chapterIdInput: UUID,
  user: AuthUser,
): Promise<ChapterResponse> {
  const chapter = await loadManagedChapter(mangaIdInput, chapterIdInput, user);
  if (!chapter.publishedAt) {
    return toChapterResponse(chapter);
  }
  const updated = await repo.setChapterPublished(chapter.id, null);
  invalidateReaderCache(chapter.mangaId);
  return toChapterResponse(updated ?? chapter);
}

// Deletes a chapter and best-effort cleans its R2 objects. DB children
// (imports/pages/reads/progress) cascade via FKs.
export async function deleteChapter(
  mangaIdInput: UUID,
  chapterIdInput: UUID,
  user: AuthUser,
): Promise<void> {
  const chapter = await loadManagedChapter(mangaIdInput, chapterIdInput, user);
  const keys = await repo.findPageStorageKeysByChapterId(chapter.id);

  await repo.deleteChapter(chapter.id);
  invalidateReaderCache(chapter.mangaId);

  await deleteStorageKeysBestEffort(
    keys.flatMap((key) => [key.storageKey, key.originalKey]),
  );
}

// Reorders a chapter's pages. orderedPageIds must be a permutation of the
// chapter's pages — every page exactly once — so the resulting 1..N numbering is
// total and gap-free.
export async function reorderChapterPages(
  mangaIdInput: UUID,
  chapterIdInput: UUID,
  user: AuthUser,
  orderedPageIds: string[],
): Promise<ChapterPreviewResponse> {
  const chapter = await loadManagedChapter(mangaIdInput, chapterIdInput, user);
  const pages = await repo.findPagesByChapterId(chapter.id);

  const providedIds = orderedPageIds.map((id) => assertUuid(id, "page id"));
  const existingIds = new Set(pages.map((page) => page.id));
  const uniqueProvided = new Set(providedIds);

  const isPermutation =
    providedIds.length === existingIds.size &&
    uniqueProvided.size === providedIds.length &&
    providedIds.every((id) => existingIds.has(id));

  if (!isPermutation) {
    throw badRequest("Page order must list every page of the chapter exactly once", {
      code: "INVALID_PAGE_ORDER",
      details: { expectedPages: existingIds.size, receivedPages: providedIds.length },
    });
  }

  await withTransaction((tx) =>
    repo.reorderChapterPages(chapter.id, providedIds, tx),
  );
  invalidateReaderCache(chapter.mangaId);

  const reordered = await repo.findPagesByChapterId(chapter.id);
  return {
    chapter: toChapterResponse(chapter),
    pages: reordered.map(toPageResponse),
  };
}

// Owner preview of a chapter's pages regardless of publish/processing state.
export async function previewChapter(
  mangaIdInput: UUID,
  chapterIdInput: UUID,
  user: AuthUser,
): Promise<ChapterPreviewResponse> {
  const chapter = await loadManagedChapter(mangaIdInput, chapterIdInput, user);
  const pages = await repo.findPagesByChapterId(chapter.id);
  return {
    chapter: toChapterResponse(chapter),
    pages: pages.map(toPageResponse),
  };
}
