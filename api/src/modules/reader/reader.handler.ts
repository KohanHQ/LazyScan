import { Elysia, t, NotFoundError } from "elysia";
import * as service from "@/modules/reader/reader.service";
import { success, fail, httpStatusFromError } from "@/shared/http/response";
import { requireAuth, resolveRequiredUser } from "@/middleware/auth";
import {
  ValidationError,
  BusinessRuleError,
} from "@/shared/utility/validation";
import { notFound, AppError } from "@/shared/http/error";
import { getLimitOffsetFromQuery } from "@/shared/utility/pagination";
import { UUID } from "@/shared/types/id";

const chapterSchema = t.Object({
  id: t.String(),
  mangaId: t.String(),
  title: t.String(),
  chapterNumber: t.Union([t.Number(), t.Null()]),
  volume: t.Union([t.Number(), t.Null()]),
  sortOrder: t.Number(),
  status: t.Union([
    t.Literal("draft"),
    t.Literal("importing"),
    t.Literal("processing"),
    t.Literal("ready"),
    t.Literal("failed"),
  ]),
  publishedAt: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
});

const readerChapterPageSchema = t.Object({
  id: t.String(),
  chapterId: t.String(),
  pageNumber: t.Number(),
  imageUrl: t.String(),
  width: t.Union([t.Number(), t.Null()]),
  height: t.Union([t.Number(), t.Null()]),
  sizeBytes: t.Union([t.Number(), t.Null()]),
});

const readerChapterDetailSchema = t.Object({
  chapter: chapterSchema,
  pages: t.Array(readerChapterPageSchema),
});

const readingProgressSchema = t.Object({
  mangaId: t.String(),
  chapterId: t.String(),
  pageId: t.String(),
  pageNumber: t.Number(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

const mangaHistorySchema = t.Object({
  mangaId: t.String(),
  title: t.String(),
  slug: t.String(),
  coverUrl: t.Union([t.String(), t.Null()]),
  chapterId: t.String(),
  chapterTitle: t.String(),
  chapterNumber: t.Union([t.Number(), t.Null()]),
  chapterPageCount: t.Number(),
  hasNextChapter: t.Boolean(),
  pageId: t.String(),
  pageNumber: t.Number(),
  updatedAt: t.String(),
});

export const readerHandler = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof NotFoundError) {
      set.status = 404;
      return fail(notFound("Not found"));
    }

    if (error instanceof AppError) {
      set.status = error.status;
      return fail(error);
    }

    if (
      error instanceof ValidationError ||
      error instanceof BusinessRuleError
    ) {
      set.status = 400;
      return fail(error);
    }

    set.status = httpStatusFromError(error);
    return fail(error);
  })

  .get(
    "/reader/manga/:id/chapters",
    async ({ params: { id } }) => {
      const result = await service.listReadyChaptersForManga(id as UUID);
      return success(result);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Array(chapterSchema),
        }),
      },
    }
  )

  .get(
    "/reader/manga/:id/chapters/:chapterId",
    async ({ params: { id, chapterId } }) => {
      const result = await service.getReadyChapterForReader(
        id as UUID,
        chapterId as UUID
      );
      return success(result);
    },
    {
      params: t.Object({
        id: t.String(),
        chapterId: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: readerChapterDetailSchema,
        }),
      },
    }
  )

  .group("", (app) =>
    app
      .use(requireAuth)
      .get(
        "/reader/manga/:id/progress",
        async (ctx: any) => {
          const {
            params: { id: mangaId },
          } = ctx as { params: { id: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const result = await service.getReadingProgress(
            mangaId as UUID,
            user.id
          );
          return success(result);
        },
        {
          params: t.Object({
            id: t.String(),
          }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: t.Union([readingProgressSchema, t.Null()]),
            }),
          },
        }
      )
      .put(
        "/reader/manga/:id/progress",
        async (ctx: any) => {
          const {
            params: { id: mangaId },
            body,
          } = ctx as {
            params: { id: string };
            body: { chapterId: string; pageId: string };
          };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const result = await service.saveReadingProgress({
            mangaId: mangaId as UUID,
            userId: user.id,
            chapterId: body.chapterId as UUID,
            pageId: body.pageId as UUID,
          });
          return success(result);
        },
        {
          params: t.Object({
            id: t.String(),
          }),
          body: t.Object({
            chapterId: t.String(),
            pageId: t.String(),
          }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: readingProgressSchema,
            }),
          },
        }
      )
      .delete(
        "/reader/manga/:id/progress",
        async (ctx: any) => {
          const {
            params: { id: mangaId },
          } = ctx as { params: { id: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const cleared = await service.clearReadingProgress(
            mangaId as UUID,
            user.id
          );
          return success({ cleared });
        },
        {
          params: t.Object({
            id: t.String(),
          }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: t.Object({ cleared: t.Boolean() }),
            }),
          },
        }
      )
      .post(
        "/reader/manga/:id/read-all",
        async (ctx: any) => {
          const {
            params: { id: mangaId },
          } = ctx as { params: { id: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const result = await service.markMangaRead(mangaId as UUID, user.id);
          return success(result);
        },
        {
          params: t.Object({
            id: t.String(),
          }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: readingProgressSchema,
            }),
          },
        }
      )
      .get(
        "/reader/manga/:id/reads",
        async (ctx: any) => {
          const {
            params: { id: mangaId },
          } = ctx as { params: { id: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const result = await service.listReadChapterIds(
            mangaId as UUID,
            user.id
          );
          return success(result);
        },
        {
          params: t.Object({
            id: t.String(),
          }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: t.Array(t.String()),
            }),
          },
        }
      )
      .put(
        "/reader/manga/:id/chapters/:chapterId/read",
        async (ctx: any) => {
          const {
            params: { id: mangaId, chapterId },
          } = ctx as { params: { id: string; chapterId: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const read = await service.markChapterRead(
            mangaId as UUID,
            chapterId as UUID,
            user.id
          );
          return success({ read });
        },
        {
          params: t.Object({
            id: t.String(),
            chapterId: t.String(),
          }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: t.Object({ read: t.Boolean() }),
            }),
          },
        }
      )
      .delete(
        "/reader/manga/:id/chapters/:chapterId/read",
        async (ctx: any) => {
          const {
            params: { id: mangaId, chapterId },
          } = ctx as { params: { id: string; chapterId: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          await service.unmarkChapterRead(
            mangaId as UUID,
            chapterId as UUID,
            user.id
          );
          return success({ read: false });
        },
        {
          params: t.Object({
            id: t.String(),
            chapterId: t.String(),
          }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: t.Object({ read: t.Boolean() }),
            }),
          },
        }
      )
      .get(
        "/reader/history",
        async (ctx: any) => {
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const { limit, offset } = getLimitOffsetFromQuery(ctx.query);
          const result = await service.getReadingHistory(user.id, limit, offset);
          return success(result);
        },
        {
          query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
          }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: t.Array(mangaHistorySchema),
            }),
          },
        }
      )
  );
