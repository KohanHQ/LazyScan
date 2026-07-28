import { Elysia, t, NotFoundError, type TSchema } from "elysia";
import * as service from "@/modules/forum/forum.service";
import { success, fail, httpStatusFromError } from "@/shared/http/response";
import { requireAuth, resolveRequiredUser } from "@/middleware/auth";
import {
  publicReadLimit,
  forumWriteLimit,
  forumReportLimit,
} from "@/middleware/rate.limit";
import {
  ValidationError,
  BusinessRuleError,
} from "@/shared/utility/validation";
import { badRequest, notFound, AppError } from "@/shared/http/error";
import { UUID } from "@/shared/types/id";

const categorySchema = t.Object({
  id: t.String(),
  slug: t.String(),
  name: t.String(),
  description: t.Union([t.String(), t.Null()]),
  sortOrder: t.Number(),
  threadCount: t.Number(),
  lastActivityAt: t.Union([t.String(), t.Null()]),
});

const threadSchema = t.Object({
  id: t.String(),
  categoryId: t.String(),
  categorySlug: t.String(),
  userId: t.String(),
  authorName: t.String(),
  authorAvatar: t.Union([t.String(), t.Null()]),
  title: t.String(),
  body: t.String(),
  pinned: t.Boolean(),
  locked: t.Boolean(),
  replyCount: t.Number(),
  lastPostAt: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

const postSchema = t.Object({
  id: t.String(),
  threadId: t.String(),
  userId: t.String(),
  authorName: t.String(),
  authorAvatar: t.Union([t.String(), t.Null()]),
  body: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

const reportSchema = t.Object({
  id: t.String(),
  targetType: t.Union([t.Literal("thread"), t.Literal("post")]),
  targetId: t.String(),
  targetSnippet: t.String(),
  targetAuthorName: t.String(),
  reporterName: t.String(),
  reason: t.String(),
  note: t.Union([t.String(), t.Null()]),
  status: t.String(),
  createdAt: t.String(),
  resolvedAt: t.Union([t.String(), t.Null()]),
});

const listQuerySchema = t.Object({
  limit: t.Optional(t.String()),
  cursor: t.Optional(t.String()),
});

const reportBodySchema = t.Object({
  reason: t.String(),
  note: t.Optional(t.Union([t.String(), t.Null()])),
});

// Every route shares one envelope shape; spelling it out per route (the comment
// module's style, at a third of the route count) would be pure repetition.
function envelope<T extends TSchema>(data: T) {
  return {
    200: t.Object({
      success: t.Literal(true),
      status: t.Number(),
      data,
    }),
  };
}

const MAX_LIMIT = 50;

// Forum listings share the comments page cap (max 50) rather than the shared
// pagination helper, so limit is parsed locally: default 20, clamped to [1, 50].
// The cursor is opaque here; the repository decodes it against its own shape.
function parseListQuery(query: {
  limit?: string;
  cursor?: string;
}): { limit: number; cursor: string | null } {
  const limit = parseIntQuery(query.limit, "limit", 20);
  if (limit < 1 || limit > MAX_LIMIT) {
    throw badRequest(`limit must be between 1 and ${MAX_LIMIT}`, {
      code: "INVALID_PAGINATION",
      details: { field: "limit", min: 1, max: MAX_LIMIT },
    });
  }
  return { limit, cursor: query.cursor ? query.cursor : null };
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

export const forumHandler = new Elysia()
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

  // Public reads: the whole forum is readable by guests.
  .get(
    "/forum/categories",
    async () => success(await service.listCategories()),
    {
      beforeHandle: publicReadLimit,
      response: envelope(t.Array(categorySchema)),
    }
  )

  .get(
    "/forum/categories/:slug/threads",
    async (ctx: any) => {
      const {
        params: { slug },
        query,
      } = ctx as {
        params: { slug: string };
        query: { limit?: string; cursor?: string };
      };
      const { limit, cursor } = parseListQuery(query);
      return success(await service.listThreads(slug, limit, cursor));
    },
    {
      beforeHandle: publicReadLimit,
      params: t.Object({ slug: t.String() }),
      query: listQuerySchema,
      response: envelope(
        t.Object({
          threads: t.Array(threadSchema),
          total: t.Number(),
          nextCursor: t.Union([t.String(), t.Null()]),
        })
      ),
    }
  )

  .get(
    "/forum/threads/:id",
    async (ctx: any) => {
      const {
        params: { id },
      } = ctx as { params: { id: string } };
      return success(await service.getThread(id as UUID));
    },
    {
      beforeHandle: publicReadLimit,
      params: t.Object({ id: t.String() }),
      response: envelope(threadSchema),
    }
  )

  .get(
    "/forum/threads/:id/posts",
    async (ctx: any) => {
      const {
        params: { id },
        query,
      } = ctx as {
        params: { id: string };
        query: { limit?: string; cursor?: string };
      };
      const { limit, cursor } = parseListQuery(query);
      return success(await service.listPosts(id as UUID, limit, cursor));
    },
    {
      beforeHandle: publicReadLimit,
      params: t.Object({ id: t.String() }),
      query: listQuerySchema,
      response: envelope(
        t.Object({
          posts: t.Array(postSchema),
          total: t.Number(),
          nextCursor: t.Union([t.String(), t.Null()]),
        })
      ),
    }
  )

  .group("", (app) =>
    app
      .use(requireAuth)
      .post(
        "/forum/categories/:slug/threads",
        async (ctx: any) => {
          const {
            params: { slug },
            body,
          } = ctx as {
            params: { slug: string };
            body: { title: string; body: string };
          };
          const user = await resolveRequiredUser(ctx.cookie.session?.value);
          return success(
            await service.createThread(user.id, slug, body.title, body.body)
          );
        },
        {
          beforeHandle: forumWriteLimit,
          params: t.Object({ slug: t.String() }),
          body: t.Object({ title: t.String(), body: t.String() }),
          response: envelope(threadSchema),
        }
      )
      .post(
        "/forum/threads/:id/posts",
        async (ctx: any) => {
          const {
            params: { id },
            body,
          } = ctx as { params: { id: string }; body: { body: string } };
          const user = await resolveRequiredUser(ctx.cookie.session?.value);
          return success(
            await service.createPost(user.id, id as UUID, body.body)
          );
        },
        {
          beforeHandle: forumWriteLimit,
          params: t.Object({ id: t.String() }),
          body: t.Object({ body: t.String() }),
          response: envelope(postSchema),
        }
      )
      .put(
        "/forum/threads/:id",
        async (ctx: any) => {
          const {
            params: { id },
            body,
          } = ctx as {
            params: { id: string };
            body: { title: string; body: string };
          };
          const user = await resolveRequiredUser(ctx.cookie.session?.value);
          return success(
            await service.updateThread(user, id as UUID, body.title, body.body)
          );
        },
        {
          beforeHandle: forumWriteLimit,
          params: t.Object({ id: t.String() }),
          body: t.Object({ title: t.String(), body: t.String() }),
          response: envelope(threadSchema),
        }
      )
      .put(
        "/forum/posts/:id",
        async (ctx: any) => {
          const {
            params: { id },
            body,
          } = ctx as { params: { id: string }; body: { body: string } };
          const user = await resolveRequiredUser(ctx.cookie.session?.value);
          return success(await service.updatePost(user, id as UUID, body.body));
        },
        {
          beforeHandle: forumWriteLimit,
          params: t.Object({ id: t.String() }),
          body: t.Object({ body: t.String() }),
          response: envelope(postSchema),
        }
      )
      .delete(
        "/forum/threads/:id",
        async (ctx: any) => {
          const {
            params: { id },
          } = ctx as { params: { id: string } };
          const user = await resolveRequiredUser(ctx.cookie.session?.value);
          await service.deleteThread(user, id as UUID);
          return success(null);
        },
        {
          beforeHandle: forumWriteLimit,
          params: t.Object({ id: t.String() }),
          response: envelope(t.Null()),
        }
      )
      .delete(
        "/forum/posts/:id",
        async (ctx: any) => {
          const {
            params: { id },
          } = ctx as { params: { id: string } };
          const user = await resolveRequiredUser(ctx.cookie.session?.value);
          await service.deletePost(user, id as UUID);
          return success(null);
        },
        {
          beforeHandle: forumWriteLimit,
          params: t.Object({ id: t.String() }),
          response: envelope(t.Null()),
        }
      )

      .post(
        "/forum/threads/:id/report",
        async (ctx: any) => {
          const {
            params: { id },
            body,
          } = ctx as {
            params: { id: string };
            body: { reason: string; note?: string | null };
          };
          const user = await resolveRequiredUser(ctx.cookie.session?.value);
          await service.reportThread(user.id, id as UUID, body.reason, body.note);
          return success(null);
        },
        {
          beforeHandle: forumReportLimit,
          params: t.Object({ id: t.String() }),
          body: reportBodySchema,
          response: envelope(t.Null()),
        }
      )
      .post(
        "/forum/posts/:id/report",
        async (ctx: any) => {
          const {
            params: { id },
            body,
          } = ctx as {
            params: { id: string };
            body: { reason: string; note?: string | null };
          };
          const user = await resolveRequiredUser(ctx.cookie.session?.value);
          await service.reportPost(user.id, id as UUID, body.reason, body.note);
          return success(null);
        },
        {
          beforeHandle: forumReportLimit,
          params: t.Object({ id: t.String() }),
          body: reportBodySchema,
          response: envelope(t.Null()),
        }
      )

      // Superuser moderation surface. The role gate lives in the service, like
      // every other /admin route; content deletion reuses the public DELETEs.
      .get(
        "/admin/forum/reports",
        async (ctx: any) => {
          const { query } = ctx as {
            query: { status?: string; limit?: string; cursor?: string };
          };
          const user = await resolveRequiredUser(ctx.cookie.session?.value);
          const { limit, cursor } = parseListQuery(query);
          return success(
            await service.listReports(user, {
              status: query.status,
              limit,
              cursor,
            })
          );
        },
        {
          query: t.Object({
            status: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            cursor: t.Optional(t.String()),
          }),
          response: envelope(
            t.Object({
              reports: t.Array(reportSchema),
              total: t.Number(),
              nextCursor: t.Union([t.String(), t.Null()]),
            })
          ),
        }
      )
      .post(
        "/admin/forum/reports/:id/dismiss",
        async (ctx: any) => {
          const {
            params: { id },
          } = ctx as { params: { id: string } };
          const user = await resolveRequiredUser(ctx.cookie.session?.value);
          await service.dismissReport(user, id as UUID);
          return success(null);
        },
        {
          params: t.Object({ id: t.String() }),
          response: envelope(t.Null()),
        }
      )
      .post(
        "/admin/forum/threads/:id/lock",
        async (ctx: any) => threadFlagRoute(ctx, "locked", true),
        {
          params: t.Object({ id: t.String() }),
          response: envelope(threadSchema),
        }
      )
      .post(
        "/admin/forum/threads/:id/unlock",
        async (ctx: any) => threadFlagRoute(ctx, "locked", false),
        {
          params: t.Object({ id: t.String() }),
          response: envelope(threadSchema),
        }
      )
      .post(
        "/admin/forum/threads/:id/pin",
        async (ctx: any) => threadFlagRoute(ctx, "pinned", true),
        {
          params: t.Object({ id: t.String() }),
          response: envelope(threadSchema),
        }
      )
      .post(
        "/admin/forum/threads/:id/unpin",
        async (ctx: any) => threadFlagRoute(ctx, "pinned", false),
        {
          params: t.Object({ id: t.String() }),
          response: envelope(threadSchema),
        }
      )
  );

async function threadFlagRoute(
  ctx: any,
  flag: "locked" | "pinned",
  value: boolean
) {
  const id = ctx.params.id as UUID;
  const user = await resolveRequiredUser(ctx.cookie.session?.value);
  const thread =
    flag === "locked"
      ? await service.setThreadLocked(user, id, value)
      : await service.setThreadPinned(user, id, value);
  return success(thread);
}
