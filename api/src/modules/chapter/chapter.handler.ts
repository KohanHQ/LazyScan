import { Elysia, t } from "elysia";
import * as service from "@/modules/chapter/chapter.service";
import { success, fail, httpStatusFromError } from "@/shared/http/response";
import { requireAuth, resolveRequiredUser } from "@/middleware/auth";
import { uploadStatusLimit, uploadPageLimit } from "@/middleware/rate.limit";
import {
  ChapterValidator,
  chapterTransportSchemas,
  validateChapterRequest,
} from "@/modules/chapter/chapter.validation";
import {
  ValidationError,
  BusinessRuleError,
} from "@/shared/utility/validation";
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

const chapterImportSchema = t.Object({
  id: t.String(),
  chapterId: t.String(),
  status: t.Union([
    t.Literal("uploading"),
    t.Literal("processing"),
    t.Literal("completed"),
    t.Literal("failed"),
  ]),
  totalFiles: t.Number(),
  processedFiles: t.Number(),
  failedFiles: t.Number(),
  errorMessage: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
});

const chapterPageSchema = t.Object({
  id: t.String(),
  chapterId: t.String(),
  pageNumber: t.Number(),
  originalFilename: t.String(),
  originalKey: t.String(),
  storageKey: t.String(),
  imageUrl: t.Union([t.String(), t.Null()]),
  width: t.Union([t.Number(), t.Null()]),
  height: t.Union([t.Number(), t.Null()]),
  sizeBytes: t.Union([t.Number(), t.Null()]),
  status: t.Union([
    t.Literal("waiting_upload"),
    t.Literal("processing"),
    t.Literal("ready"),
    t.Literal("failed"),
  ]),
  errorMessage: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
});

const uploadTargetSchema = t.Object({
  pageId: t.String(),
  pageNumber: t.Number(),
  filename: t.String(),
  originalKey: t.String(),
  uploadUrl: t.String(),
  expiresAt: t.String(),
});

const importDetailSchema = t.Object({
  chapter: chapterSchema,
  import: chapterImportSchema,
  pages: t.Array(chapterPageSchema),
});

const chapterPreviewSchema = t.Object({
  chapter: chapterSchema,
  pages: t.Array(chapterPageSchema),
});

const chapterResponseSchema = t.Object({
  success: t.Literal(true),
  status: t.Number(),
  data: chapterSchema,
});

export const chapterHandler = new Elysia()
  .use(requireAuth)
  .onError(({ error, set }) => {
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

  .post(
    "/manga/:id/chapter",
    async (ctx: any) => {
      const {
        params: { id: mangaId },
        body,
      } = ctx as { params: { id: string }; body: any };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);

      const validatedData = validateChapterRequest(
        chapterTransportSchemas.create,
        body,
        ChapterValidator.validateCreate
      );

      const result = await service.createChapterImport({
        mangaId: mangaId as UUID,
        userId: user.id,
        title: validatedData.title,
        chapterNumber: validatedData.chapterNumber,
        volume: validatedData.volume,
        sortOrder: validatedData.sortOrder,
        files: validatedData.files,
      }, user);

      return success(result);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        title: t.String(),
        chapterNumber: t.Optional(t.Number()),
        volume: t.Optional(t.Number()),
        sortOrder: t.Optional(t.Number()),
        files: t.Array(t.Object({
          filename: t.String(),
          contentType: t.String(),
          sizeBytes: t.Optional(t.Number()),
        })),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Object({
            chapter: chapterSchema,
            import: chapterImportSchema,
            pages: t.Array(chapterPageSchema),
            uploads: t.Array(uploadTargetSchema),
          }),
        }),
      },
    }
  )

  .get(
    "/manga/:id/chapter/uploads/:uploadId",
    async (ctx: any) => {
      const {
        params: { id: mangaId, uploadId },
      } = ctx as { params: { id: string; uploadId: string } };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const result = await service.getMangaChapterUpload(
        mangaId as UUID,
        uploadId as UUID,
        user
      );
      return success(result);
    },
    {
      // Exempt from the global cap (see isUploadStatusPoll); this loose bucket is
      // the only limit so progress polling can't drain the IP's global budget.
      beforeHandle: uploadStatusLimit,
      params: t.Object({
        id: t.String(),
        uploadId: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: importDetailSchema,
        }),
      },
    }
  )

  .post(
    "/manga/:id/chapter/uploads/:uploadId/complete",
    async (ctx: any) => {
      const {
        params: { id: mangaId, uploadId },
      } = ctx as { params: { id: string; uploadId: string } };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      // Body is optional and backward-compatible: legacy callers send none and
      // get publish-on-ready; holdAsDraft=true keeps the chapter unpublished.
      const { holdAsDraft } = validateChapterRequest(
        chapterTransportSchemas.complete,
        ctx.body ?? {}
      );
      const result = await service.completeMangaChapterUpload(
        mangaId as UUID,
        uploadId as UUID,
        user,
        { holdAsDraft }
      );
      return success(result);
    },
    {
      params: t.Object({
        id: t.String(),
        uploadId: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: importDetailSchema,
        }),
      },
    }
  )

  .post(
    "/manga/:id/chapter/uploads/:uploadId/pages/:pageId/upload",
    async (ctx: any) => {
      const {
        params: { id: mangaId, uploadId, pageId },
        body,
      } = ctx as {
        params: { id: string; uploadId: string; pageId: string };
        body: any;
      };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const { file } = body;

      if (!file) {
        throw new ValidationError(
          "No file provided",
          "file",
          "NO_FILE_PROVIDED"
        );
      }

      const result = await service.uploadMangaChapterPage(
        mangaId as UUID,
        uploadId as UUID,
        pageId as UUID,
        user,
        file
      );
      return success(result);
    },
    {
      // Exempt from the global cap (see isUploadExempt); this bucket alone
      // limits per-page uploads so a bulk chapter can't 429 the whole IP.
      beforeHandle: uploadPageLimit,
      params: t.Object({
        id: t.String(),
        uploadId: t.String(),
        pageId: t.String(),
      }),
      body: t.Object({
        file: t.File(),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: chapterPageSchema,
        }),
      },
    }
  )

  .post(
    "/manga/:id/chapter/uploads/:uploadId/retry",
    async (ctx: any) => {
      const {
        params: { id: mangaId, uploadId },
      } = ctx as { params: { id: string; uploadId: string } };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const result = await service.retryMangaChapterUpload(
        mangaId as UUID,
        uploadId as UUID,
        user
      );
      return success(result);
    },
    {
      params: t.Object({
        id: t.String(),
        uploadId: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: importDetailSchema,
        }),
      },
    }
  )

  // --- Chapter management after upload (owner/superuser) ---

  .get(
    "/manga/:id/chapters",
    async (ctx: any) => {
      const {
        params: { id: mangaId },
      } = ctx as { params: { id: string } };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const result = await service.listMangaChapters(mangaId as UUID, user);
      return success(result);
    },
    {
      params: t.Object({ id: t.String() }),
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
    "/manga/:id/chapters/:chapterId/preview",
    async (ctx: any) => {
      const {
        params: { id: mangaId, chapterId },
      } = ctx as { params: { id: string; chapterId: string } };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const result = await service.previewChapter(
        mangaId as UUID,
        chapterId as UUID,
        user
      );
      return success(result);
    },
    {
      params: t.Object({ id: t.String(), chapterId: t.String() }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: chapterPreviewSchema,
        }),
      },
    }
  )

  .patch(
    "/manga/:id/chapters/:chapterId",
    async (ctx: any) => {
      const {
        params: { id: mangaId, chapterId },
        body,
      } = ctx as { params: { id: string; chapterId: string }; body: any };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const validated = validateChapterRequest(
        chapterTransportSchemas.update,
        body ?? {}
      );
      const result = await service.updateChapter(
        mangaId as UUID,
        chapterId as UUID,
        user,
        validated
      );
      return success(result);
    },
    {
      params: t.Object({ id: t.String(), chapterId: t.String() }),
      body: t.Object({
        title: t.Optional(t.String()),
        chapterNumber: t.Optional(t.Union([t.Number(), t.Null()])),
        volume: t.Optional(t.Union([t.Number(), t.Null()])),
        sortOrder: t.Optional(t.Number()),
      }),
      response: { 200: chapterResponseSchema },
    }
  )

  .delete(
    "/manga/:id/chapters/:chapterId",
    async (ctx: any) => {
      const {
        params: { id: mangaId, chapterId },
      } = ctx as { params: { id: string; chapterId: string } };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      await service.deleteChapter(mangaId as UUID, chapterId as UUID, user);
      return success({ deleted: true });
    },
    {
      params: t.Object({ id: t.String(), chapterId: t.String() }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Object({ deleted: t.Boolean() }),
        }),
      },
    }
  )

  .post(
    "/manga/:id/chapters/:chapterId/publish",
    async (ctx: any) => {
      const {
        params: { id: mangaId, chapterId },
      } = ctx as { params: { id: string; chapterId: string } };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const result = await service.publishChapter(
        mangaId as UUID,
        chapterId as UUID,
        user
      );
      return success(result);
    },
    {
      params: t.Object({ id: t.String(), chapterId: t.String() }),
      response: { 200: chapterResponseSchema },
    }
  )

  .post(
    "/manga/:id/chapters/:chapterId/unpublish",
    async (ctx: any) => {
      const {
        params: { id: mangaId, chapterId },
      } = ctx as { params: { id: string; chapterId: string } };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const result = await service.unpublishChapter(
        mangaId as UUID,
        chapterId as UUID,
        user
      );
      return success(result);
    },
    {
      params: t.Object({ id: t.String(), chapterId: t.String() }),
      response: { 200: chapterResponseSchema },
    }
  )

  .post(
    "/manga/:id/chapters/:chapterId/pages/reorder",
    async (ctx: any) => {
      const {
        params: { id: mangaId, chapterId },
        body,
      } = ctx as { params: { id: string; chapterId: string }; body: any };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const { pageIds } = validateChapterRequest(
        chapterTransportSchemas.reorderPages,
        body
      );
      const result = await service.reorderChapterPages(
        mangaId as UUID,
        chapterId as UUID,
        user,
        pageIds
      );
      return success(result);
    },
    {
      params: t.Object({ id: t.String(), chapterId: t.String() }),
      body: t.Object({ pageIds: t.Array(t.String()) }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: chapterPreviewSchema,
        }),
      },
    }
  );
