import { Elysia, t } from "elysia";
import * as service from "@/modules/admin/admin.service";
import { success, fail, httpStatusFromError } from "@/shared/http/response";
import { requireAuth, resolveRequiredUser } from "@/middleware/auth";
import { getLimitOffsetFromQuery } from "@/shared/utility/pagination";
import {
  ValidationError,
  BusinessRuleError,
} from "@/shared/utility/validation";
import { AdminPruneLogsResponse } from "@/modules/admin/admin.model";

const importStatusSchema = t.Union([
  t.Literal("uploading"),
  t.Literal("processing"),
  t.Literal("completed"),
  t.Literal("failed"),
]);

const adminImportEntrySchema = t.Object({
  importId: t.String(),
  chapterId: t.String(),
  mangaId: t.String(),
  mangaTitle: t.String(),
  chapterTitle: t.String(),
  status: importStatusSchema,
  totalFiles: t.Number(),
  processedFiles: t.Number(),
  failedFiles: t.Number(),
  errorMessage: t.Union([t.String(), t.Null()]),
  failedPages: t.Array(
    t.Object({
      pageNumber: t.Number(),
      originalFilename: t.String(),
      errorMessage: t.Union([t.String(), t.Null()]),
    })
  ),
  createdAt: t.String(),
  updatedAt: t.String(),
});

const logLevelSchema = t.Union([
  t.Literal("debug"),
  t.Literal("info"),
  t.Literal("warn"),
  t.Literal("error"),
]);

const adminLogEntrySchema = t.Object({
  id: t.String(),
  level: logLevelSchema,
  message: t.String(),
  service: t.String(),
  // context is free-form JSONB written by the logger; no fixed shape.
  context: t.Union([t.Record(t.String(), t.Unknown()), t.Null()]),
  errorName: t.Union([t.String(), t.Null()]),
  errorMessage: t.Union([t.String(), t.Null()]),
  errorStack: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
});

const adminLogsSchema = t.Object({
  entries: t.Array(adminLogEntrySchema),
  levelCounts: t.Object({
    debug: t.Number(),
    info: t.Number(),
    warn: t.Number(),
    error: t.Number(),
  }),
});

const adminPruneLogsRequestSchema = t.Object({
  retentionDays: t.Optional(t.Number({ minimum: 1 })),
});

const adminPruneLogsResponseSchema = t.Object({
  deletedCount: t.Number(),
  retentionDays: t.Number(),
});

const adminPruneStorageResponseSchema = t.Object({
  deletedCount: t.Number(),
  scannedCount: t.Number(),
});

const adminStorageSchema = t.Object({
  readyPagesBytes: t.Number(),
  readyPagesCount: t.Number(),
  totalPagesCount: t.Number(),
  mangaCount: t.Number(),
  chapterCount: t.Number(),
  coverUploadsCount: t.Number(),
  failedImportsCount: t.Number(),
  processingImportsCount: t.Number(),
  byManga: t.Array(
    t.Object({
      mangaId: t.String(),
      title: t.String(),
      bytes: t.Number(),
      pages: t.Number(),
    })
  ),
});

// Superuser-only operational visibility: chapter import health (retry targets),
// a storage usage estimate, and the audit log trail. The role gate lives in
// the service.
export const adminHandler = new Elysia({ prefix: "/admin" })
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

  .get(
    "/imports",
    async (ctx: any) => {
      const { query } = ctx as {
        query: { status?: string; limit?: string; offset?: string };
      };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const { limit, offset } = getLimitOffsetFromQuery(query);
      const result = await service.listImports(user, {
        status: query.status,
        limit,
        offset,
      });
      return success(result);
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Array(adminImportEntrySchema),
        }),
      },
    }
  )

  .get(
    "/storage",
    async (ctx: any) => {
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const result = await service.getStorageStats(user);
      return success(result);
    },
    {
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: adminStorageSchema,
        }),
      },
    }
  )

  .get(
    "/logs",
    async (ctx: any) => {
      const { query } = ctx as {
        query: { level?: string; limit?: string; offset?: string };
      };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const { limit, offset } = getLimitOffsetFromQuery(query);
      const result = await service.listLogs(user, {
        level: query.level,
        limit,
        offset,
      });
      return success(result);
    },
    {
      query: t.Object({
        level: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: adminLogsSchema,
        }),
      },
    }
  )

  .post(
    "/logs/prune",
    async (ctx: any) => {
      const { body } = ctx as { body: { retentionDays?: number } };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const result = await service.pruneLogs(user, {
        retentionDays: body.retentionDays,
      });
      return success(result);
    },
    {
      body: adminPruneLogsRequestSchema,
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: adminPruneLogsResponseSchema,
        }),
      },
    }
  )

  .post(
    "/storage/prune",
    async (ctx: any) => {
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);
      const result = await service.pruneStorage(user);
      return success(result);
    },
    {
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: adminPruneStorageResponseSchema,
        }),
      },
    }
  );
