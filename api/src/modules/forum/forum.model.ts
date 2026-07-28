import type { UUID } from "@/shared/types/id";

export type ForumReportReason = "spam" | "abuse" | "nsfw" | "other";
export type ForumReportStatus = "open" | "dismissed";
export type ForumReportTarget = "thread" | "post";

// Seeded discussion category. `threadCount` and `lastActivityAt` are derived per
// request (COUNT / MAX over threads), never stored.
export interface ForumCategoryResponse {
  id: UUID;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  threadCount: number;
  lastActivityAt: string | null;
}

// `userId` is the author's account UUID (same exposure as CommentResponse) so
// the web can gate edit/delete on the viewer's own content; `authorName` is the
// display name falling back to username. `replyCount` is derived.
export interface ForumThreadResponse {
  id: UUID;
  categoryId: UUID;
  categorySlug: string;
  userId: UUID;
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
}

export interface ForumThreadListResponse {
  threads: ForumThreadResponse[];
  total: number;
}

export interface ForumPostResponse {
  id: UUID;
  threadId: UUID;
  userId: UUID;
  authorName: string;
  authorAvatar: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ForumPostListResponse {
  posts: ForumPostResponse[];
  total: number;
}

// Admin queue row. The snippet is a truncated copy of the reported content so
// the queue is triageable without opening every target.
export interface ForumReportResponse {
  id: UUID;
  targetType: ForumReportTarget;
  targetId: UUID;
  targetSnippet: string;
  targetAuthorName: string;
  reporterName: string;
  reason: ForumReportReason;
  note: string | null;
  status: ForumReportStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ForumReportListResponse {
  reports: ForumReportResponse[];
  total: number;
}
