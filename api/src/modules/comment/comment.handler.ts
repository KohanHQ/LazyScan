import { Elysia, t, NotFoundError } from "elysia";
import * as service from "@/modules/comment/comment.service";
import { success, fail, httpStatusFromError } from "@/shared/http/response";
import { requireAuth, resolveRequiredUser } from "@/middleware/auth";
import { publicReadLimit, commentWriteLimit } from "@/middleware/rate.limit";
import {
  ValidationError,
  BusinessRuleError,
} from "@/shared/utility/validation";
import { badRequest, notFound, AppError } from "@/shared/http/error";
import { UUID } from "@/shared/types/id";

const commentSchema = t.Object({
  id: t.String(),
  mangaId: t.String(),
  userId: t.String(),
  authorName: t.String(),
  body: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

const MAX_LIMIT = 50;

// Comments have a tighter page cap (max 50) than the shared pagination helper,
// so limit/offset are parsed locally: default 20, clamped to [1, 50], offset >= 0.
function parseListQuery(query: {
  limit?: string;
  offset?: string;
}): { limit: number; offset: number } {
  const limit = parseIntQuery(query.limit, "limit", 20);
  const offset = parseIntQuery(query.offset, "offset", 0);
  if (limit < 1 || limit > MAX_LIMIT) {
    throw badRequest(`limit must be between 1 and ${MAX_LIMIT}`, {
      code: "INVALID_PAGINATION",
      details: { field: "limit", min: 1, max: MAX_LIMIT },
    });
  }
  if (offset < 0) {
    throw badRequest("offset must be greater than or equal to 0", {
      code: "INVALID_PAGINATION",
      details: { field: "offset", min: 0 },
    });
  }
  return { limit, offset };
}

function parseIntQuery(
  value: string | undefined,
  field: string,
  fallback: number
): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw badRequest(`${field} must be an integer`, {
      code: "INVALID_PAGINATION",
      details: { field },
    });
  }
  return parsed;
}

export const commentHandler = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof NotFoundError) {
      set.status = 404;
      return fail(notFound("Not found"));
    }
    if (error instanceof AppError) {
      set.status = error.status;
      return fail(error);
    }
    if (error instanceof ValidationError || error instanceof BusinessRuleError) {
      set.status = 400;
      return fail(error);
    }
    set.status = httpStatusFromError(error);
    return fail(error);
  })

  // Public read: anyone can list a manga's comments, newest first.
  .get(
    "/manga/:mangaId/comments",
    async (ctx: any) => {
      const {
        params: { mangaId },
        query,
      } = ctx as {
        params: { mangaId: string };
        query: { limit?: string; offset?: string };
      };
      const { limit, offset } = parseListQuery(query);
      const result = await service.listComments(
        mangaId as UUID,
        limit,
        offset
      );
      return success(result);
    },
    {
      beforeHandle: publicReadLimit,
      params: t.Object({ mangaId: t.String() }),
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Object({
            comments: t.Array(commentSchema),
            total: t.Number(),
          }),
        }),
      },
    }
  )

  .group("", (app) =>
    app
      .use(requireAuth)
      .post(
        "/manga/:mangaId/comments",
        async (ctx: any) => {
          const {
            params: { mangaId },
            body,
          } = ctx as { params: { mangaId: string }; body: { body: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const result = await service.createComment(
            user.id,
            mangaId as UUID,
            body.body
          );
          return success(result);
        },
        {
          beforeHandle: commentWriteLimit,
          params: t.Object({ mangaId: t.String() }),
          body: t.Object({ body: t.String() }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: commentSchema,
            }),
          },
        }
      )
      .put(
        "/comments/:id",
        async (ctx: any) => {
          const {
            params: { id },
            body,
          } = ctx as { params: { id: string }; body: { body: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const result = await service.updateComment(
            user.id,
            id as UUID,
            body.body
          );
          return success(result);
        },
        {
          beforeHandle: commentWriteLimit,
          params: t.Object({ id: t.String() }),
          body: t.Object({ body: t.String() }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: commentSchema,
            }),
          },
        }
      )
      .delete(
        "/comments/:id",
        async (ctx: any) => {
          const {
            params: { id },
          } = ctx as { params: { id: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          await service.deleteComment(user, id as UUID);
          return success(null);
        },
        {
          beforeHandle: commentWriteLimit,
          params: t.Object({ id: t.String() }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: t.Null(),
            }),
          },
        }
      )
  );
