import { getDbClient } from "@/shared/database/client";
import { UUID } from "@/shared/types/id";
import { mapRow as mapMangaRow } from "@/modules/manga/manga.repository";
import { toResponse as toMangaResponse } from "@/modules/manga/manga.service";
import type {
  ReadingStatus,
  ReadingStatusEntryResponse,
} from "@/modules/reading-status/reading-status.model";

const db = getDbClient();

// Joins the user's status rows to manga and reuses the canonical manga mappers so
// new manga fields flow through automatically. Newest-updated first (the order in
// which the user last changed the status).
export async function listEntries(
  userId: UUID,
  status: ReadingStatus
): Promise<ReadingStatusEntryResponse[]> {
  // Alias rs.updated_at so it does not collide with manga's own updated_at
  // (m.* already projects it); mapMangaRow then reads the real manga.updated_at.
  const rows = await db`
    SELECT m.*, rs.updated_at AS status_updated_at
    FROM reading_status rs
    JOIN manga m ON m.id = rs.manga_id
    WHERE rs.user_id = ${userId} AND rs.status = ${status}
    ORDER BY rs.updated_at DESC
  `;

  return rows.map((row) => ({
    manga: toMangaResponse(mapMangaRow(row)),
    updatedAt: new Date(row.status_updated_at).toISOString(),
  }));
}

export async function getStatus(
  userId: UUID,
  mangaId: UUID
): Promise<ReadingStatus | null> {
  const [row] = await db`
    SELECT status FROM reading_status
    WHERE user_id = ${userId} AND manga_id = ${mangaId}
  `;
  return row ? (row.status as ReadingStatus) : null;
}

// Set or switch status. The (user_id, manga_id) primary key makes this a single
// upsert: a second call for the same manga overwrites the status and bumps
// updated_at instead of inserting a duplicate row.
export async function upsertStatus(
  userId: UUID,
  mangaId: UUID,
  status: ReadingStatus
): Promise<void> {
  await db`
    INSERT INTO reading_status (user_id, manga_id, status)
    VALUES (${userId}, ${mangaId}, ${status})
    ON CONFLICT (user_id, manga_id)
    DO UPDATE SET status = EXCLUDED.status, updated_at = now()
  `;
}

export async function removeStatus(
  userId: UUID,
  mangaId: UUID
): Promise<boolean> {
  const result = await db`
    DELETE FROM reading_status
    WHERE user_id = ${userId} AND manga_id = ${mangaId}
  `;
  return result.count > 0;
}
