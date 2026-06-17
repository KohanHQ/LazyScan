import { apiRequest } from "@/api/client";
import type { Manga } from "@/api/manga";

// Fixed, single-select tracking state per manga. Mirrors the backend
// reading-status module; distinct from the favorites/queue lists in library.ts.
export type ReadingStatus =
  | "reading"
  | "completed"
  | "plan_to_read"
  | "on_hold"
  | "dropped";

export type ReadingStatusEntry = {
  manga: Manga;
  updatedAt: string;
};

export function getReadingStatusList(
  status: ReadingStatus
): Promise<ReadingStatusEntry[]> {
  return apiRequest<ReadingStatusEntry[]>(`/reading-status/${status}`);
}

export function getReadingStatus(
  mangaId: string
): Promise<{ status: ReadingStatus | null }> {
  return apiRequest<{ status: ReadingStatus | null }>(
    `/reading-status/manga/${encodeURIComponent(mangaId)}`
  );
}

export function setReadingStatus(
  mangaId: string,
  status: ReadingStatus
): Promise<null> {
  return apiRequest<null>(
    `/reading-status/manga/${encodeURIComponent(mangaId)}`,
    {
      method: "PUT",
      body: { status },
    }
  );
}

export function clearReadingStatus(mangaId: string): Promise<null> {
  return apiRequest<null>(
    `/reading-status/manga/${encodeURIComponent(mangaId)}`,
    {
      method: "DELETE",
    }
  );
}
