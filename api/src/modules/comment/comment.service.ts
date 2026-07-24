import * as commentRepo from "@/modules/comment/comment.repository";
import * as mangaRepo from "@/modules/manga/manga.repository";
import { parseCommentBody } from "@/modules/comment/comment.validation";
import { forbidden, notFound } from "@/shared/http/error";
import { UUID } from "@/shared/types/id";
import { assertUuid } from "@/shared/identity/uuid";
import type { AuthUser } from "@/middleware/auth";
import type {
  CommentListResponse,
  CommentResponse,
} from "@/modules/comment/comment.model";

export async function listComments(
  mangaId: UUID,
  limit: number,
  offset: number
): Promise<CommentListResponse> {
  const id = assertUuid(mangaId, "manga id");
  const [comments, total] = await Promise.all([
    commentRepo.listByManga(id, limit, offset),
    commentRepo.countByManga(id),
  ]);
  return { comments, total };
}

export async function createComment(
  userId: UUID,
  mangaId: UUID,
  rawBody: unknown
): Promise<CommentResponse> {
  const id = assertUuid(mangaId, "manga id");
  const body = parseCommentBody(rawBody);
  const manga = await mangaRepo.findById(id);
  if (!manga) {
    throw notFound("Manga not found", { code: "MANGA_NOT_FOUND" });
  }
  const commentId = await commentRepo.insert(id, userId, body);
  return loadOrThrow(commentId);
}

export async function updateComment(
  userId: UUID,
  commentId: UUID,
  rawBody: unknown
): Promise<CommentResponse> {
  const id = assertUuid(commentId, "comment id");
  const body = parseCommentBody(rawBody);
  const existing = await commentRepo.findById(id);
  if (!existing) {
    throw notFound("Comment not found", { code: "COMMENT_NOT_FOUND" });
  }
  if (existing.userId !== userId) {
    throw forbidden("You can only edit your own comments", {
      code: "COMMENT_EDIT_FORBIDDEN",
    });
  }
  await commentRepo.updateBody(id, body);
  return loadOrThrow(id);
}

// Owner or superuser (the app's admin role) may delete; anyone else is 403.
export async function deleteComment(
  user: AuthUser,
  commentId: UUID
): Promise<void> {
  const id = assertUuid(commentId, "comment id");
  const existing = await commentRepo.findById(id);
  if (!existing) {
    throw notFound("Comment not found", { code: "COMMENT_NOT_FOUND" });
  }
  if (existing.userId !== user.id && user.role !== "superuser") {
    throw forbidden("You can only delete your own comments", {
      code: "COMMENT_DELETE_FORBIDDEN",
    });
  }
  await commentRepo.removeById(id);
}

async function loadOrThrow(id: UUID): Promise<CommentResponse> {
  const comment = await commentRepo.findById(id);
  if (!comment) {
    throw notFound("Comment not found", { code: "COMMENT_NOT_FOUND" });
  }
  return comment;
}
