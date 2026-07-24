import { apiRequest } from "@/api/client";

// A manga comment. `userId` is the author's account UUID (used to gate edit/
// delete on the viewer's own comments); `authorName` is their display name.
export type Comment = {
  id: string;
  mangaId: string;
  userId: string;
  authorName: string;
  authorAvatar: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type CommentPage = {
  comments: Comment[];
  total: number;
};

const PAGE_SIZE = 20;

export function listComments(
  mangaId: string,
  offset = 0,
  limit = PAGE_SIZE
): Promise<CommentPage> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return apiRequest<CommentPage>(
    `/manga/${encodeURIComponent(mangaId)}/comments?${params.toString()}`
  );
}

export function createComment(
  mangaId: string,
  body: string
): Promise<Comment> {
  return apiRequest<Comment>(
    `/manga/${encodeURIComponent(mangaId)}/comments`,
    {
      method: "POST",
      body: { body },
    }
  );
}

export function updateComment(id: string, body: string): Promise<Comment> {
  return apiRequest<Comment>(`/comments/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { body },
  });
}

export function removeComment(id: string): Promise<null> {
  return apiRequest<null>(`/comments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
