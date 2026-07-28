import * as forumRepo from "@/modules/forum/forum.repository";
import {
  parsePostBody,
  parseReportNote,
  parseReportReason,
  parseReportStatus,
  parseThreadBody,
  parseThreadTitle,
} from "@/modules/forum/forum.validation";
import { conflict, forbidden, notFound } from "@/shared/http/error";
import { withTransaction } from "@/shared/database/transaction";
import { UUID } from "@/shared/types/id";
import { assertUuid } from "@/shared/identity/uuid";
import type { AuthUser } from "@/middleware/auth";
import type {
  ForumCategoryResponse,
  ForumPostListResponse,
  ForumPostResponse,
  ForumReportListResponse,
  ForumThreadListResponse,
  ForumThreadResponse,
} from "@/modules/forum/forum.model";

// Postgres SQLSTATEs the write paths race against: a duplicate open report
// (partial unique index) and a target deleted between the load and the insert.
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

// Every admin route is superuser-only, enforced here (mirrors admin.service).
function assertSuperuser(user: AuthUser): void {
  if (user.role !== "superuser") {
    throw forbidden("Admin access required", { code: "ADMIN_ACCESS_REQUIRED" });
  }
}

export function listCategories(): Promise<ForumCategoryResponse[]> {
  return forumRepo.listCategories();
}

export async function listThreads(
  slug: string,
  limit: number,
  offset: number
): Promise<ForumThreadListResponse> {
  const category = await categoryOrThrow(slug);
  const [threads, total] = await Promise.all([
    forumRepo.listThreadsByCategory(category.id, limit, offset),
    forumRepo.countThreadsByCategory(category.id),
  ]);
  return { threads, total };
}

export async function getThread(threadId: UUID): Promise<ForumThreadResponse> {
  return threadOrThrow(assertUuid(threadId, "thread id"));
}

export async function listPosts(
  threadId: UUID,
  limit: number,
  offset: number
): Promise<ForumPostListResponse> {
  const id = assertUuid(threadId, "thread id");
  await threadOrThrow(id);
  const [posts, total] = await Promise.all([
    forumRepo.listPostsByThread(id, limit, offset),
    forumRepo.countPostsByThread(id),
  ]);
  return { posts, total };
}

export async function createThread(
  userId: UUID,
  slug: string,
  rawTitle: unknown,
  rawBody: unknown
): Promise<ForumThreadResponse> {
  const title = parseThreadTitle(rawTitle);
  const body = parseThreadBody(rawBody);
  const category = await categoryOrThrow(slug);
  const threadId = await forumRepo.insertThread(
    category.id,
    userId,
    title,
    body
  );
  return threadOrThrow(threadId);
}

export async function createPost(
  userId: UUID,
  threadId: UUID,
  rawBody: unknown
): Promise<ForumPostResponse> {
  const id = assertUuid(threadId, "thread id");
  const body = parsePostBody(rawBody);
  const thread = await threadOrThrow(id);
  assertNotLocked(thread);

  // Insert + activity bump share one transaction: the listing sort can never
  // show a bump without its reply, nor a reply without its bump. A thread
  // deleted between the load above and the insert trips the FK and reads gone.
  try {
    const postId = await withTransaction(async (tx) => {
      const inserted = await forumRepo.insertPost(id, userId, body, tx);
      await forumRepo.touchThreadLastPost(id, tx);
      return inserted;
    });
    return await postOrThrow(postId);
  } catch (error) {
    if (sqlState(error) === FOREIGN_KEY_VIOLATION) {
      throw notFound("Thread not found", { code: "FORUM_THREAD_NOT_FOUND" });
    }
    throw error;
  }
}

// Owner only. A locked thread also blocks the owner's edit; superusers are
// exempt from the lock (they are the ones who set it).
export async function updateThread(
  user: AuthUser,
  threadId: UUID,
  rawTitle: unknown,
  rawBody: unknown
): Promise<ForumThreadResponse> {
  const id = assertUuid(threadId, "thread id");
  const title = parseThreadTitle(rawTitle);
  const body = parseThreadBody(rawBody);
  const thread = await threadOrThrow(id);
  if (thread.userId !== user.id) {
    throw forbidden("You can only edit your own threads", {
      code: "FORUM_THREAD_EDIT_FORBIDDEN",
    });
  }
  if (user.role !== "superuser") {
    assertNotLocked(thread);
  }
  await forumRepo.updateThreadContent(id, title, body);
  return threadOrThrow(id);
}

export async function updatePost(
  user: AuthUser,
  postId: UUID,
  rawBody: unknown
): Promise<ForumPostResponse> {
  const id = assertUuid(postId, "post id");
  const body = parsePostBody(rawBody);
  const post = await postOrThrow(id);
  if (post.userId !== user.id) {
    throw forbidden("You can only edit your own posts", {
      code: "FORUM_POST_EDIT_FORBIDDEN",
    });
  }
  if (user.role !== "superuser") {
    assertNotLocked(await threadOrThrow(post.threadId));
  }
  await forumRepo.updatePostBody(id, body);
  return postOrThrow(id);
}

// Owner or superuser (the app's admin role) may delete; anyone else is 403.
// Superuser deletion is the moderation path — no separate admin endpoint.
export async function deleteThread(
  user: AuthUser,
  threadId: UUID
): Promise<void> {
  const id = assertUuid(threadId, "thread id");
  const thread = await threadOrThrow(id);
  if (thread.userId !== user.id && user.role !== "superuser") {
    throw forbidden("You can only delete your own threads", {
      code: "FORUM_THREAD_DELETE_FORBIDDEN",
    });
  }
  await forumRepo.removeThreadById(id);
}

export async function deletePost(user: AuthUser, postId: UUID): Promise<void> {
  const id = assertUuid(postId, "post id");
  const post = await postOrThrow(id);
  if (post.userId !== user.id && user.role !== "superuser") {
    throw forbidden("You can only delete your own posts", {
      code: "FORUM_POST_DELETE_FORBIDDEN",
    });
  }
  await forumRepo.removePostById(id);
}

export async function reportThread(
  userId: UUID,
  threadId: UUID,
  rawReason: unknown,
  rawNote: unknown
): Promise<void> {
  const id = assertUuid(threadId, "thread id");
  const reason = parseReportReason(rawReason);
  const note = parseReportNote(rawNote);
  await threadOrThrow(id);
  await insertReport({
    reporterId: userId,
    threadId: id,
    postId: null,
    reason,
    note,
  });
}

export async function reportPost(
  userId: UUID,
  postId: UUID,
  rawReason: unknown,
  rawNote: unknown
): Promise<void> {
  const id = assertUuid(postId, "post id");
  const reason = parseReportReason(rawReason);
  const note = parseReportNote(rawNote);
  await postOrThrow(id);
  await insertReport({
    reporterId: userId,
    threadId: null,
    postId: id,
    reason,
    note,
  });
}

// The role gate runs before the status is validated, so a non-superuser gets
// 403 for every query shape (mirrors admin.service).
export async function listReports(
  user: AuthUser,
  input: { status?: string; limit: number; offset: number }
): Promise<ForumReportListResponse> {
  assertSuperuser(user);
  const status = parseReportStatus(input.status);
  const [reports, total] = await Promise.all([
    forumRepo.listReports({ status, limit: input.limit, offset: input.offset }),
    forumRepo.countReports(status),
  ]);
  return { reports, total };
}

// Idempotent: dismissing an already-dismissed report is a no-op, an unknown id
// is a 404. The row is kept (status only) so the queue does not lose history.
export async function dismissReport(
  user: AuthUser,
  reportId: UUID
): Promise<void> {
  assertSuperuser(user);
  const id = assertUuid(reportId, "report id");
  const dismissed = await forumRepo.dismissReport(id, user.id);
  if (!dismissed && !(await forumRepo.reportExists(id))) {
    throw notFound("Report not found", { code: "FORUM_REPORT_NOT_FOUND" });
  }
}

export async function setThreadLocked(
  user: AuthUser,
  threadId: UUID,
  locked: boolean
): Promise<ForumThreadResponse> {
  assertSuperuser(user);
  const id = assertUuid(threadId, "thread id");
  await threadOrThrow(id);
  await forumRepo.setThreadLocked(id, locked);
  return threadOrThrow(id);
}

export async function setThreadPinned(
  user: AuthUser,
  threadId: UUID,
  pinned: boolean
): Promise<ForumThreadResponse> {
  assertSuperuser(user);
  const id = assertUuid(threadId, "thread id");
  await threadOrThrow(id);
  await forumRepo.setThreadPinned(id, pinned);
  return threadOrThrow(id);
}

// The partial unique indexes are the duplicate check, not a pre-SELECT: two
// concurrent reports from one reporter would both pass a read-then-write guard.
// A target deleted mid-flight trips the FK instead and reads as gone.
async function insertReport(
  input: Parameters<typeof forumRepo.insertReport>[0]
): Promise<void> {
  try {
    await forumRepo.insertReport(input);
  } catch (error) {
    if (sqlState(error) === UNIQUE_VIOLATION) {
      throw conflict("You have already reported this", {
        code: "FORUM_REPORT_DUPLICATE",
      });
    }
    if (sqlState(error) === FOREIGN_KEY_VIOLATION) {
      throw notFound("Reported content not found", {
        code: "FORUM_REPORT_TARGET_NOT_FOUND",
      });
    }
    throw error;
  }
}

function assertNotLocked(thread: ForumThreadResponse): void {
  if (thread.locked) {
    throw forbidden("This thread is locked", { code: "FORUM_THREAD_LOCKED" });
  }
}

async function categoryOrThrow(slug: string): Promise<{ id: UUID }> {
  const category = await forumRepo.findCategoryBySlug(slug);
  if (!category) {
    throw notFound("Category not found", { code: "FORUM_CATEGORY_NOT_FOUND" });
  }
  return category;
}

async function threadOrThrow(id: UUID): Promise<ForumThreadResponse> {
  const thread = await forumRepo.findThreadById(id);
  if (!thread) {
    throw notFound("Thread not found", { code: "FORUM_THREAD_NOT_FOUND" });
  }
  return thread;
}

async function postOrThrow(id: UUID): Promise<ForumPostResponse> {
  const post = await forumRepo.findPostById(id);
  if (!post) {
    throw notFound("Post not found", { code: "FORUM_POST_NOT_FOUND" });
  }
  return post;
}
