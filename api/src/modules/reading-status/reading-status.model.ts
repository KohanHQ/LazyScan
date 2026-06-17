import type { MangaResponse } from "@/modules/manga/manga.model";

// Fixed, single-select tracking state per (user, manga). Distinct from the
// user_library favorites/queue lists: a manga carries at most one status.
export type ReadingStatus =
  | "reading"
  | "completed"
  | "plan_to_read"
  | "on_hold"
  | "dropped";

export interface ReadingStatusEntryResponse {
  manga: MangaResponse;
  updatedAt: string;
}

export interface ReadingStatusResponse {
  status: ReadingStatus | null;
}
