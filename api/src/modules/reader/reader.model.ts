import { ChapterResponse } from "@/modules/chapter/chapter.model";
import { UUID } from "@/shared/types/id";

export interface ReadingProgress {
  id: UUID;
  userId: UUID;
  mangaId: UUID;
  chapterId: UUID;
  pageId: UUID;
  pageNumber: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReaderChapterPageResponse {
  id: string;
  chapterId: string;
  pageNumber: number;
  imageUrl: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
}

export interface ReaderChapterDetailResponse {
  chapter: ChapterResponse;
  pages: ReaderChapterPageResponse[];
}

export interface ReadingProgressResponse {
  mangaId: string;
  chapterId: string;
  pageId: string;
  pageNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveReadingProgressInput {
  mangaId: UUID;
  userId: UUID;
  chapterId: UUID;
  pageId: UUID;
}

export interface ChapterRead {
  userId: UUID;
  chapterId: UUID;
  mangaId: UUID;
  readAt: Date;
}

export interface MangaHistoryResponse {
  mangaId: string;
  title: string;
  slug: string;
  coverUrl: string | null;
  chapterId: string;
  // Pinned chapter context for continue-reading UI: title/number plus the
  // chapter's ready-page count so clients can render "Page x/y" and a percent.
  chapterTitle: string;
  chapterNumber: number | null;
  chapterPageCount: number;
  // True when a later ready chapter exists (reader ordering). Lets resume
  // surfaces hide titles whose pinned position is the catalog's end.
  hasNextChapter: boolean;
  pageId: string;
  pageNumber: number;
  updatedAt: string;
}
