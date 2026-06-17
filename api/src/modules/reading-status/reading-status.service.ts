import * as statusRepo from "@/modules/reading-status/reading-status.repository";
import * as mangaRepo from "@/modules/manga/manga.repository";
import { notFound } from "@/shared/http/error";
import { UUID } from "@/shared/types/id";
import { assertUuid } from "@/shared/identity/uuid";
import type {
  ReadingStatus,
  ReadingStatusEntryResponse,
  ReadingStatusResponse,
} from "@/modules/reading-status/reading-status.model";

export async function listByStatus(
  userId: UUID,
  status: ReadingStatus
): Promise<ReadingStatusEntryResponse[]> {
  return statusRepo.listEntries(userId, status);
}

export async function getStatus(
  userId: UUID,
  mangaId: UUID
): Promise<ReadingStatusResponse> {
  const id = assertUuid(mangaId, "manga id");
  const status = await statusRepo.getStatus(userId, id);
  return { status };
}

export async function setStatus(
  userId: UUID,
  mangaId: UUID,
  status: ReadingStatus
): Promise<void> {
  const id = assertUuid(mangaId, "manga id");
  const manga = await mangaRepo.findById(id);
  if (!manga) {
    throw notFound("Manga not found", { code: "MANGA_NOT_FOUND" });
  }
  // Idempotent set/switch: the repository's ON CONFLICT DO UPDATE overwrites any
  // existing status for this manga.
  await statusRepo.upsertStatus(userId, id, status);
}

export async function clearStatus(userId: UUID, mangaId: UUID): Promise<void> {
  const id = assertUuid(mangaId, "manga id");
  // Idempotent: clearing an absent status is a no-op (no 404).
  await statusRepo.removeStatus(userId, id);
}
