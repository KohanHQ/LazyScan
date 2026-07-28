import { getDbClient } from "@/shared/database/client";
import type { TransactionClient } from "@/shared/database/transaction";
import { UUID } from "@/shared/types/id";
import type {
  ForumCategoryResponse,
  ForumPostResponse,
  ForumReportReason,
  ForumReportResponse,
  ForumReportStatus,
  ForumThreadResponse,
} from "@/modules/forum/forum.model";

const db = getDbClient();

// Author name/avatar resolve exactly like comments: profile display name
// falling back to username, and the stored avatar_url pass-through (the web
// derives a ui-avatars fallback when it is null).

// How much reported content the admin queue carries inline for triage.
const SNIPPET_LENGTH = 200;

function mapCategory(row: any): ForumCategoryResponse {
  return {
    id: row.id as UUID,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    sortOrder: row.sort_order,
    threadCount: row.thread_count,
    lastActivityAt: row.last_activity_at
      ? new Date(row.last_activity_at).toISOString()
      : null,
  };
}

function mapThread(row: any): ForumThreadResponse {
  return {
    id: row.id as UUID,
    categoryId: row.category_id as UUID,
    categorySlug: row.category_slug,
    userId: row.user_id as UUID,
    authorName: row.author_name,
    authorAvatar: row.author_avatar ?? null,
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    locked: row.locked,
    replyCount: row.reply_count,
    lastPostAt: new Date(row.last_post_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapPost(row: any): ForumPostResponse {
  return {
    id: row.id as UUID,
    threadId: row.thread_id as UUID,
    userId: row.user_id as UUID,
    authorName: row.author_name,
    authorAvatar: row.author_avatar ?? null,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapReport(row: any): ForumReportResponse {
  return {
    id: row.id as UUID,
    targetType: row.thread_id ? "thread" : "post",
    targetId: (row.thread_id ?? row.post_id) as UUID,
    targetSnippet: row.target_snippet ?? "",
    targetAuthorName: row.target_author_name,
    reporterName: row.reporter_name,
    reason: row.reason as ForumReportReason,
    note: row.note ?? null,
    status: row.status as ForumReportStatus,
    createdAt: new Date(row.created_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
  };
}

export async function listCategories(): Promise<ForumCategoryResponse[]> {
  const rows = await db`
    SELECT c.id, c.slug, c.name, c.description, c.sort_order,
           COUNT(t.id)::int AS thread_count,
           MAX(t.last_post_at) AS last_activity_at
    FROM forum_categories c
    LEFT JOIN forum_threads t ON t.category_id = c.id
    GROUP BY c.id
    ORDER BY c.sort_order ASC, c.name ASC
  `;
  return rows.map(mapCategory);
}

export async function findCategoryBySlug(
  slug: string
): Promise<{ id: UUID; slug: string } | null> {
  const rows = await db`
    SELECT id, slug FROM forum_categories WHERE slug = ${slug} LIMIT 1
  `;
  return rows.length ? { id: rows[0].id as UUID, slug: rows[0].slug } : null;
}

export async function listThreadsByCategory(
  categoryId: UUID,
  limit: number,
  offset: number
): Promise<ForumThreadResponse[]> {
  const rows = await db`
    SELECT t.id, t.category_id, c.slug AS category_slug, t.user_id, t.title,
           t.body, t.pinned, t.locked, t.last_post_at, t.created_at, t.updated_at,
           COALESCE(p.display_name, p.username, 'Unknown') AS author_name,
           p.avatar_url AS author_avatar,
           (SELECT COUNT(*)::int FROM forum_posts fp WHERE fp.thread_id = t.id)
             AS reply_count
    FROM forum_threads t
    JOIN forum_categories c ON c.id = t.category_id
    LEFT JOIN profiles p ON p.user_id = t.user_id
    WHERE t.category_id = ${categoryId}
    ORDER BY t.pinned DESC, t.last_post_at DESC, t.id DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return rows.map(mapThread);
}

export async function countThreadsByCategory(categoryId: UUID): Promise<number> {
  const [row] = await db`
    SELECT COUNT(*)::int AS total FROM forum_threads WHERE category_id = ${categoryId}
  `;
  return row?.total ?? 0;
}

export async function findThreadById(
  id: UUID
): Promise<ForumThreadResponse | null> {
  const rows = await db`
    SELECT t.id, t.category_id, c.slug AS category_slug, t.user_id, t.title,
           t.body, t.pinned, t.locked, t.last_post_at, t.created_at, t.updated_at,
           COALESCE(p.display_name, p.username, 'Unknown') AS author_name,
           p.avatar_url AS author_avatar,
           (SELECT COUNT(*)::int FROM forum_posts fp WHERE fp.thread_id = t.id)
             AS reply_count
    FROM forum_threads t
    JOIN forum_categories c ON c.id = t.category_id
    LEFT JOIN profiles p ON p.user_id = t.user_id
    WHERE t.id = ${id}
    LIMIT 1
  `;
  return rows.length ? mapThread(rows[0]) : null;
}

export async function insertThread(
  categoryId: UUID,
  userId: UUID,
  title: string,
  body: string
): Promise<UUID> {
  // Own creation counts as activity, so last_post_at starts at now() (column
  // default) — the thread sorts to the top of its category on creation.
  const [row] = await db`
    INSERT INTO forum_threads (category_id, user_id, title, body)
    VALUES (${categoryId}, ${userId}, ${title}, ${body})
    RETURNING id
  `;
  return row.id as UUID;
}

export async function updateThreadContent(
  id: UUID,
  title: string,
  body: string
): Promise<void> {
  await db`
    UPDATE forum_threads
    SET title = ${title}, body = ${body}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function setThreadLocked(id: UUID, locked: boolean): Promise<void> {
  await db`
    UPDATE forum_threads
    SET locked = ${locked}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function setThreadPinned(id: UUID, pinned: boolean): Promise<void> {
  await db`
    UPDATE forum_threads
    SET pinned = ${pinned}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function removeThreadById(id: UUID): Promise<void> {
  await db`DELETE FROM forum_threads WHERE id = ${id}`;
}

export async function listPostsByThread(
  threadId: UUID,
  limit: number,
  offset: number
): Promise<ForumPostResponse[]> {
  const rows = await db`
    SELECT fp.id, fp.thread_id, fp.user_id, fp.body, fp.created_at, fp.updated_at,
           COALESCE(p.display_name, p.username, 'Unknown') AS author_name,
           p.avatar_url AS author_avatar
    FROM forum_posts fp
    LEFT JOIN profiles p ON p.user_id = fp.user_id
    WHERE fp.thread_id = ${threadId}
    ORDER BY fp.created_at ASC, fp.id ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return rows.map(mapPost);
}

export async function countPostsByThread(threadId: UUID): Promise<number> {
  const [row] = await db`
    SELECT COUNT(*)::int AS total FROM forum_posts WHERE thread_id = ${threadId}
  `;
  return row?.total ?? 0;
}

export async function findPostById(id: UUID): Promise<ForumPostResponse | null> {
  const rows = await db`
    SELECT fp.id, fp.thread_id, fp.user_id, fp.body, fp.created_at, fp.updated_at,
           COALESCE(p.display_name, p.username, 'Unknown') AS author_name,
           p.avatar_url AS author_avatar
    FROM forum_posts fp
    LEFT JOIN profiles p ON p.user_id = fp.user_id
    WHERE fp.id = ${id}
    LIMIT 1
  `;
  return rows.length ? mapPost(rows[0]) : null;
}

export async function insertPost(
  threadId: UUID,
  userId: UUID,
  body: string,
  tx?: TransactionClient
): Promise<UUID> {
  const client = tx ?? db;
  const [row] = await client`
    INSERT INTO forum_posts (thread_id, user_id, body)
    VALUES (${threadId}, ${userId}, ${body})
    RETURNING id
  `;
  return row.id as UUID;
}

// Activity bump for the listing sort. Called in the same transaction as the
// reply insert, so a rolled-back reply never leaves the thread bumped.
export async function touchThreadLastPost(
  threadId: UUID,
  tx?: TransactionClient
): Promise<void> {
  const client = tx ?? db;
  await client`
    UPDATE forum_threads SET last_post_at = now() WHERE id = ${threadId}
  `;
}

export async function updatePostBody(id: UUID, body: string): Promise<void> {
  await db`
    UPDATE forum_posts
    SET body = ${body}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function removePostById(id: UUID): Promise<void> {
  await db`DELETE FROM forum_posts WHERE id = ${id}`;
}

export async function insertReport(input: {
  reporterId: UUID;
  threadId: UUID | null;
  postId: UUID | null;
  reason: ForumReportReason;
  note: string | null;
}): Promise<UUID> {
  const [row] = await db`
    INSERT INTO forum_reports (reporter_id, thread_id, post_id, reason, note)
    VALUES (
      ${input.reporterId},
      ${input.threadId},
      ${input.postId},
      ${input.reason},
      ${input.note}
    )
    RETURNING id
  `;
  return row.id as UUID;
}

export async function listReports(input: {
  status: ForumReportStatus;
  limit: number;
  offset: number;
}): Promise<ForumReportResponse[]> {
  const rows = await db`
    SELECT r.id, r.thread_id, r.post_id, r.reason, r.note, r.status,
           r.created_at, r.resolved_at,
           left(COALESCE(t.title || chr(10) || t.body, fp.body), ${SNIPPET_LENGTH})
             AS target_snippet,
           COALESCE(ta.display_name, ta.username, 'Unknown') AS target_author_name,
           COALESCE(rp.display_name, rp.username, 'Unknown') AS reporter_name
    FROM forum_reports r
    LEFT JOIN forum_threads t ON t.id = r.thread_id
    LEFT JOIN forum_posts fp ON fp.id = r.post_id
    LEFT JOIN profiles ta ON ta.user_id = COALESCE(t.user_id, fp.user_id)
    LEFT JOIN profiles rp ON rp.user_id = r.reporter_id
    WHERE r.status = ${input.status}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${input.limit}
    OFFSET ${input.offset}
  `;
  return rows.map(mapReport);
}

export async function countReports(status: ForumReportStatus): Promise<number> {
  const [row] = await db`
    SELECT COUNT(*)::int AS total FROM forum_reports WHERE status = ${status}
  `;
  return row?.total ?? 0;
}

// Only an open report can be dismissed; the guard makes a double-dismiss a
// no-op (false) rather than rewriting resolved_at/resolved_by.
export async function dismissReport(
  id: UUID,
  resolvedBy: UUID
): Promise<boolean> {
  const rows = await db`
    UPDATE forum_reports
    SET status = 'dismissed', resolved_at = now(), resolved_by = ${resolvedBy}
    WHERE id = ${id} AND status = 'open'
    RETURNING id
  `;
  return rows.length > 0;
}

export async function reportExists(id: UUID): Promise<boolean> {
  const rows = await db`SELECT 1 FROM forum_reports WHERE id = ${id} LIMIT 1`;
  return rows.length > 0;
}
