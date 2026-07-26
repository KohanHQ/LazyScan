import { UUID } from "@/shared/types/id";

export type ChapterStatus = "draft" | "importing" | "processing" | "ready" | "failed";
export type ChapterImportStatus = "uploading" | "processing" | "completed" | "failed";
export type ChapterPageStatus = "waiting_upload" | "processing" | "ready" | "failed";

export interface Chapter {
  id: UUID;
  mangaId: UUID;
  title: string;
  chapterNumber: number | null;
  volume: number | null;
  sortOrder: number;
  status: ChapterStatus;
  // API-owned reader-visibility timestamp, orthogonal to `status` (image-service-owned).
  // null = not published (draft/hidden); reader visibility = status 'ready' AND
  // published_at IS NOT NULL.
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChapterImport {
  id: UUID;
  chapterId: UUID;
  userId: UUID;
  status: ChapterImportStatus;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChapterPage {
  id: UUID;
  chapterId: UUID;
  pageNumber: number;
  originalFilename: string;
  originalKey: string;
  storageKey: string;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  status: ChapterPageStatus;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChapterPageWithManga extends ChapterPage {
  mangaId: UUID;
  mangaSlug: string;
  importId: UUID;
  importStatus: ChapterImportStatus;
}

export interface CreateChapterImportInput {
  mangaId: UUID;
  userId: UUID;
  title: string;
  chapterNumber?: number;
  volume?: number;
  sortOrder?: number;
  files: ChapterImportFileInput[];
}

export interface ChapterImportFileInput {
  filename: string;
  contentType: string;
  sizeBytes?: number;
}

// Editable chapter metadata (chapter management after upload). Persistence/
// visibility (`status`, `published_at`) is not edited here — publish/unpublish
// own that.
export interface UpdateChapterInput {
  title?: string;
  chapterNumber?: number | null;
  volume?: number | null;
  sortOrder?: number;
}

export interface ChapterImportResponse {
  id: string;
  chapterId: string;
  status: ChapterImportStatus;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterResponse {
  id: string;
  mangaId: string;
  title: string;
  chapterNumber: number | null;
  volume: number | null;
  sortOrder: number;
  status: ChapterStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterPageResponse {
  id: string;
  chapterId: string;
  pageNumber: number;
  originalFilename: string;
  originalKey: string;
  storageKey: string;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  status: ChapterPageStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterImportUploadTarget {
  pageId: string;
  pageNumber: number;
  filename: string;
  originalKey: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface CreateChapterImportResponse {
  chapter: ChapterResponse;
  import: ChapterImportResponse;
  pages: ChapterPageResponse[];
  uploads: ChapterImportUploadTarget[];
}

export interface ChapterImportDetailResponse {
  chapter: ChapterResponse;
  import: ChapterImportResponse;
  pages: ChapterPageResponse[];
}

// Owner preview of a chapter's pages regardless of publish/processing state, so
// drafts can be inspected before publishing.
export interface ChapterPreviewResponse {
  chapter: ChapterResponse;
  pages: ChapterPageResponse[];
}
