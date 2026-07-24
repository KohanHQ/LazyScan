import type { UUID } from "@/shared/types/id";

// A single manga comment as returned to clients. `userId` is the author's
// account UUID (exposed the same way manga.createdByUserId already is) so the
// web can gate edit/delete on the viewer's own comments; `authorName` is the
// author's display name, falling back to their username.
export interface CommentResponse {
  id: UUID;
  mangaId: UUID;
  userId: UUID;
  authorName: string;
  // Stored avatar_url pass-through (like the profile response); null when unset,
  // in which case the web derives a ui-avatars fallback from the author name.
  authorAvatar: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentListResponse {
  comments: CommentResponse[];
  total: number;
}
