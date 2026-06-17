import { apiRequest } from "@/api/client";

export type ReaderChapter = {
  id: string;
  mangaId: string;
  title: string;
  chapterNumber: number | null;
  volume: number | null;
  sortOrder: number;
  status: "draft" | "importing" | "processing" | "ready" | "failed";
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function listReadyChapters(mangaId: string): Promise<ReaderChapter[]> {
  return apiRequest<ReaderChapter[]>(
    `/reader/manga/${encodeURIComponent(mangaId)}/chapters`
  );
}

// --- Chapter upload (management) ---

export type ChapterImportStatus =
  | "uploading"
  | "processing"
  | "completed"
  | "failed";

export type ChapterPageStatus =
  | "waiting_upload"
  | "processing"
  | "ready"
  | "failed";

export type ChapterImport = {
  id: string;
  chapterId: string;
  status: ChapterImportStatus;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChapterPage = {
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
};

export type ChapterUploadTarget = {
  pageId: string;
  pageNumber: number;
  filename: string;
  originalKey: string;
  uploadUrl: string;
  expiresAt: string;
};

export type ChapterUploadFileMeta = {
  filename: string;
  contentType: string;
  sizeBytes?: number;
};

export type CreateChapterUploadInput = {
  title: string;
  chapterNumber?: number;
  volume?: number;
  sortOrder?: number;
  files: ChapterUploadFileMeta[];
};

export type CreateChapterUploadResponse = {
  chapter: ReaderChapter;
  import: ChapterImport;
  pages: ChapterPage[];
  uploads: ChapterUploadTarget[];
};

export type ChapterImportDetail = {
  chapter: ReaderChapter;
  import: ChapterImport;
  pages: ChapterPage[];
};

export function createChapterUpload(
  mangaId: string,
  input: CreateChapterUploadInput
): Promise<CreateChapterUploadResponse> {
  return apiRequest<CreateChapterUploadResponse>(
    `/manga/${encodeURIComponent(mangaId)}/chapter`,
    { method: "POST", body: input }
  );
}

// Uploads page bytes straight to R2 via the presigned URL. This is a
// cross-origin PUT to the storage host, not the API, so it bypasses the
// envelope client and must not send credentials. The Content-Type must match
// what the URL was signed with (the file's type).
export async function putToPresignedUrl(
  uploadUrl: string,
  file: File
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });

  if (!response.ok) {
    throw new Error(
      `Upload failed for ${file.name} (${response.status} ${response.statusText})`
    );
  }
}

export function completeChapterUpload(
  mangaId: string,
  uploadId: string,
  options: { holdAsDraft?: boolean } = {}
): Promise<ChapterImportDetail> {
  return apiRequest<ChapterImportDetail>(
    `/manga/${encodeURIComponent(mangaId)}/chapter/uploads/${encodeURIComponent(uploadId)}/complete`,
    { method: "POST", body: options }
  );
}

export function getChapterUpload(
  mangaId: string,
  uploadId: string
): Promise<ChapterImportDetail> {
  return apiRequest<ChapterImportDetail>(
    `/manga/${encodeURIComponent(mangaId)}/chapter/uploads/${encodeURIComponent(uploadId)}`
  );
}

export function retryChapterUpload(
  mangaId: string,
  uploadId: string
): Promise<ChapterImportDetail> {
  return apiRequest<ChapterImportDetail>(
    `/manga/${encodeURIComponent(mangaId)}/chapter/uploads/${encodeURIComponent(uploadId)}/retry`,
    { method: "POST" }
  );
}

// --- Chapter management after upload ---

export type ChapterPreview = {
  chapter: ReaderChapter;
  pages: ChapterPage[];
};

// All chapters of a manga (any status/publish state) for the owner management UI.
// Distinct from listReadyChapters, which returns only reader-visible chapters.
export function listMangaChapters(mangaId: string): Promise<ReaderChapter[]> {
  return apiRequest<ReaderChapter[]>(
    `/manga/${encodeURIComponent(mangaId)}/chapters`
  );
}

export type UpdateChapterInput = {
  title?: string;
  chapterNumber?: number | null;
  volume?: number | null;
  sortOrder?: number;
};

// Owner preview: a chapter's pages regardless of publish/processing state.
export function previewChapter(
  mangaId: string,
  chapterId: string
): Promise<ChapterPreview> {
  return apiRequest<ChapterPreview>(
    `/manga/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterId)}/preview`
  );
}

export function updateChapter(
  mangaId: string,
  chapterId: string,
  input: UpdateChapterInput
): Promise<ReaderChapter> {
  return apiRequest<ReaderChapter>(
    `/manga/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterId)}`,
    { method: "PATCH", body: input }
  );
}

export function deleteChapter(
  mangaId: string,
  chapterId: string
): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(
    `/manga/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterId)}`,
    { method: "DELETE" }
  );
}

export function publishChapter(
  mangaId: string,
  chapterId: string
): Promise<ReaderChapter> {
  return apiRequest<ReaderChapter>(
    `/manga/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterId)}/publish`,
    { method: "POST" }
  );
}

export function unpublishChapter(
  mangaId: string,
  chapterId: string
): Promise<ReaderChapter> {
  return apiRequest<ReaderChapter>(
    `/manga/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterId)}/unpublish`,
    { method: "POST" }
  );
}

// Reorders a chapter's pages. pageIds must list every page of the chapter
// exactly once, in the desired order.
export function reorderChapterPages(
  mangaId: string,
  chapterId: string,
  pageIds: string[]
): Promise<ChapterPreview> {
  return apiRequest<ChapterPreview>(
    `/manga/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterId)}/pages/reorder`,
    { method: "POST", body: { pageIds } }
  );
}
