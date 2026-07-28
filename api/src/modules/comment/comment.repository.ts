import { getDbClient } from "@/shared/database/client";
import { UUID } from "@/shared/types/id";
import { decodeCursor, takePage } from "@/shared/utility/cursor";
import type { CommentResponse } from "@/modules/comment/comment.model";

const db = getDbClient();

// Keyset cursor shape in ORDER BY order. Decoding lives beside the query so the
// shape can never drift from its SQL.
const COMMENT_CURSOR = ["timestamp", "uuid"] as const;

// The author name is the profile display name, falling back to username; the
// profile row always exists (created at registration), so LEFT JOIN + COALESCE
// is defensive rather than expected to hit the 'Unknown' arm. `authorAvatar` is
// the stored avatar_url pass-through (currently always null — the web derives a
// ui-avatars fallback from the name via resolveAvatar), matching the profile
// response shape.
function mapRow(row: any): CommentResponse {
  return {
    id: row.id as UUID,
    mangaId: row.manga_id as UUID,
    userId: row.user_id as UUID,
    authorName: row.author_name,
    authorAvatar: row.author_avatar ?? null,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

// Descending sort, so the row comparison is `<` against
// idx_manga_comments_manga_created. The `::text` out and `::text::timestamptz`
// back keep the key at real microsecond precision (see cursor.ts).
export async function listByManga(
  mangaId: UUID,
  limit: number,
  cursor: string | null
): Promise<{ comments: CommentResponse[]; nextCursor: string | null }> {
  const keys = cursor === null ? null : decodeCursor(COMMENT_CURSOR, cursor);
  const rows = await db`
    SELECT c.id, c.manga_id, c.user_id, c.body, c.created_at, c.updated_at,
           c.created_at::text AS cursor_created_at,
           COALESCE(p.display_name, p.username, 'Unknown') AS author_name,
           p.avatar_url AS author_avatar
    FROM manga_comments c
    LEFT JOIN profiles p ON p.user_id = c.user_id
    WHERE c.manga_id = ${mangaId}
      ${
        keys === null
          ? db``
          : db`AND (c.created_at, c.id) < (${keys[0]}::text::timestamptz, ${keys[1]}::uuid)`
      }
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ${limit + 1}
  `;
  const { page, nextCursor } = takePage(rows, limit, COMMENT_CURSOR, (row) => [
    row.cursor_created_at,
    row.id,
  ]);
  return { comments: page.map(mapRow), nextCursor };
}

export async function countByManga(mangaId: UUID): Promise<number> {
  const [row] = await db`
    SELECT COUNT(*)::int AS total FROM manga_comments WHERE manga_id = ${mangaId}
  `;
  return row?.total ?? 0;
}

export async function findById(id: UUID): Promise<CommentResponse | null> {
  const rows = await db`
    SELECT c.id, c.manga_id, c.user_id, c.body, c.created_at, c.updated_at,
           COALESCE(p.display_name, p.username, 'Unknown') AS author_name,
           p.avatar_url AS author_avatar
    FROM manga_comments c
    LEFT JOIN profiles p ON p.user_id = c.user_id
    WHERE c.id = ${id}
    LIMIT 1
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

export async function insert(
  mangaId: UUID,
  userId: UUID,
  body: string
): Promise<UUID> {
  const [row] = await db`
    INSERT INTO manga_comments (manga_id, user_id, body)
    VALUES (${mangaId}, ${userId}, ${body})
    RETURNING id
  `;
  return row.id as UUID;
}

export async function updateBody(id: UUID, body: string): Promise<void> {
  await db`
    UPDATE manga_comments
    SET body = ${body}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function removeById(id: UUID): Promise<void> {
  await db`DELETE FROM manga_comments WHERE id = ${id}`;
}
