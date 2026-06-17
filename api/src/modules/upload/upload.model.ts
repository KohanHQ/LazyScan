import { UUID } from "@/shared/types/id";

export type UploadStatus = "pending" | "processing" | "completed" | "failed";
export type UploadType = "manga_cover" | "chapter_page" | "avatar";

export interface Upload {
  id: UUID;
  userId: UUID;
  type: UploadType;
  status: UploadStatus;
  originalKey: string;
  processedKey: string | null;
  originalUrl: string | null;
  processedUrl: string | null;
  metadata: Record<string, any> | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUploadInput {
  userId: UUID;
  type: UploadType;
  filename: string;
  contentType: string;
  metadata?: Record<string, any>;
}

export interface MangaUploadInput {
  userId: UUID;
  mangaSlug: string;
  uploadType: "cover" | "chapter";
  filename: string;
  contentType: string;
  chapterOrder?: number;
  metadata?: Record<string, any>;
}

export interface UploadStatusResponse {
  id: string;
  status: UploadStatus;
  originalUrl: string | null;
  processedUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
