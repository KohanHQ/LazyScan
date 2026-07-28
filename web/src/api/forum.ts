import { apiRequest } from "@/api/client";

// Forum surface: public reads (categories → threads → flat posts), auth writes,
// reports, and the superuser moderation calls. Shapes mirror
// api/src/modules/forum/forum.model.ts exactly.

export type ForumCategory = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  threadCount: number;
  lastActivityAt: string | null;
};

// `userId` is the author's account UUID (gates own-content edit/delete);
// `replyCount` and `lastPostAt` drive the listing's activity line.
export type ForumThread = {
  id: string;
  categoryId: string;
  categorySlug: string;
  userId: string;
  authorName: string;
  authorAvatar: string | null;
  title: string;
  body: string;
  pinned: boolean;
  locked: boolean;
  replyCount: number;
  lastPostAt: string;
  createdAt: string;
  updatedAt: string;
};

// `nextCursor` is the opaque keyset cursor for the following page, null once the
// page returned reaches the end of the list.
export type ForumThreadPage = {
  threads: ForumThread[];
  total: number;
  nextCursor: string | null;
};

export type ForumPost = {
  id: string;
  threadId: string;
  userId: string;
  authorName: string;
  authorAvatar: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type ForumPostPage = {
  posts: ForumPost[];
  total: number;
  nextCursor: string | null;
};

export type ForumReportReason = "spam" | "abuse" | "nsfw" | "other";
export type ForumReportStatus = "open" | "dismissed";

// Admin queue row. Post targets carry no thread id, so only thread reports can
// be linked back to a page (see forum-reports-panel).
export type ForumReport = {
  id: string;
  targetType: "thread" | "post";
  targetId: string;
  targetSnippet: string;
  targetAuthorName: string;
  reporterName: string;
  reason: ForumReportReason;
  note: string | null;
  status: ForumReportStatus;
  createdAt: string;
  resolvedAt: string | null;
};

export type ForumReportPage = {
  reports: ForumReport[];
  total: number;
  nextCursor: string | null;
};

// Server-side bounds (forum.validation.ts). Mirrored so inputs stop typing at
// the same cap the API would reject.
export const MAX_THREAD_TITLE = 200;
export const MAX_THREAD_BODY = 5000;
export const MAX_POST_BODY = 1000;
export const MAX_REPORT_NOTE = 500;

export const REPORT_REASONS: ForumReportReason[] = [
  "spam",
  "abuse",
  "nsfw",
  "other",
];

// Listings share the comments page cap (server clamps limit to [1, 50]).
const PAGE_SIZE = 20;

// Cursors are opaque to the client: pass back whatever nextCursor carried, and
// null for the first page.
function pageQuery(cursor: string | null, limit: number): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor !== null) {
    params.set("cursor", cursor);
  }
  return params.toString();
}

export function listForumCategories(): Promise<ForumCategory[]> {
  return apiRequest<ForumCategory[]>("/forum/categories");
}

export function listForumThreads(
  slug: string,
  cursor: string | null = null,
  limit = PAGE_SIZE
): Promise<ForumThreadPage> {
  return apiRequest<ForumThreadPage>(
    `/forum/categories/${encodeURIComponent(slug)}/threads?${pageQuery(cursor, limit)}`
  );
}

export function getForumThread(id: string): Promise<ForumThread> {
  return apiRequest<ForumThread>(`/forum/threads/${encodeURIComponent(id)}`);
}

export function listForumPosts(
  threadId: string,
  cursor: string | null = null,
  limit = PAGE_SIZE
): Promise<ForumPostPage> {
  return apiRequest<ForumPostPage>(
    `/forum/threads/${encodeURIComponent(threadId)}/posts?${pageQuery(cursor, limit)}`
  );
}

export function createForumThread(
  slug: string,
  title: string,
  body: string
): Promise<ForumThread> {
  return apiRequest<ForumThread>(
    `/forum/categories/${encodeURIComponent(slug)}/threads`,
    { method: "POST", body: { title, body } }
  );
}

export function createForumPost(
  threadId: string,
  body: string
): Promise<ForumPost> {
  return apiRequest<ForumPost>(
    `/forum/threads/${encodeURIComponent(threadId)}/posts`,
    { method: "POST", body: { body } }
  );
}

export function updateForumThread(
  id: string,
  title: string,
  body: string
): Promise<ForumThread> {
  return apiRequest<ForumThread>(`/forum/threads/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { title, body },
  });
}

export function updateForumPost(id: string, body: string): Promise<ForumPost> {
  return apiRequest<ForumPost>(`/forum/posts/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { body },
  });
}

export function removeForumThread(id: string): Promise<null> {
  return apiRequest<null>(`/forum/threads/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function removeForumPost(id: string): Promise<null> {
  return apiRequest<null>(`/forum/posts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// Blank notes are omitted rather than sent as "": the API collapses either to
// null, but omitting keeps the payload honest about "no note given".
function reportBody(
  reason: ForumReportReason,
  note: string
): { reason: ForumReportReason; note?: string } {
  const trimmed = note.trim();
  return trimmed ? { reason, note: trimmed } : { reason };
}

export function reportForumThread(
  id: string,
  reason: ForumReportReason,
  note: string
): Promise<null> {
  return apiRequest<null>(`/forum/threads/${encodeURIComponent(id)}/report`, {
    method: "POST",
    body: reportBody(reason, note),
  });
}

export function reportForumPost(
  id: string,
  reason: ForumReportReason,
  note: string
): Promise<null> {
  return apiRequest<null>(`/forum/posts/${encodeURIComponent(id)}/report`, {
    method: "POST",
    body: reportBody(reason, note),
  });
}

export function listForumReports(
  status: ForumReportStatus,
  cursor: string | null = null,
  limit = PAGE_SIZE
): Promise<ForumReportPage> {
  return apiRequest<ForumReportPage>(
    `/admin/forum/reports?status=${status}&${pageQuery(cursor, limit)}`
  );
}

export function dismissForumReport(id: string): Promise<null> {
  return apiRequest<null>(
    `/admin/forum/reports/${encodeURIComponent(id)}/dismiss`,
    { method: "POST" }
  );
}

export function setForumThreadLocked(
  id: string,
  locked: boolean
): Promise<ForumThread> {
  return apiRequest<ForumThread>(
    `/admin/forum/threads/${encodeURIComponent(id)}/${locked ? "lock" : "unlock"}`,
    { method: "POST" }
  );
}

export function setForumThreadPinned(
  id: string,
  pinned: boolean
): Promise<ForumThread> {
  return apiRequest<ForumThread>(
    `/admin/forum/threads/${encodeURIComponent(id)}/${pinned ? "pin" : "unpin"}`,
    { method: "POST" }
  );
}
