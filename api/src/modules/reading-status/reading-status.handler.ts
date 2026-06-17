import { Elysia, t, NotFoundError } from "elysia";
import * as service from "@/modules/reading-status/reading-status.service";
import { parseReadingStatus } from "@/modules/reading-status/reading-status.validation";
import { mangaResponseSchema } from "@/modules/manga/manga.handler";
import { success, fail, httpStatusFromError } from "@/shared/http/response";
import { requireAuth, resolveRequiredUser } from "@/middleware/auth";
import {
  ValidationError,
  BusinessRuleError,
} from "@/shared/utility/validation";
import { notFound, AppError } from "@/shared/http/error";
import { UUID } from "@/shared/types/id";

const statusEntrySchema = t.Object({
  manga: mangaResponseSchema,
  updatedAt: t.String(),
});

const statusValueSchema = t.Object({
  status: t.Union([t.String(), t.Null()]),
});

export const readingStatusHandler = new Elysia()
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

  .group("", (app) =>
    app
      .use(requireAuth)
      // Per-manga status routes use a static "manga" segment and are registered
      // before `/reading-status/:status` so the param route never captures it.
      .get(
        "/reading-status/manga/:mangaId",
        async (ctx: any) => {
          const {
            params: { mangaId },
          } = ctx as { params: { mangaId: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const result = await service.getStatus(user.id, mangaId as UUID);
          return success(result);
        },
        {
          params: t.Object({ mangaId: t.String() }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: statusValueSchema,
            }),
          },
        }
      )
      .put(
        "/reading-status/manga/:mangaId",
        async (ctx: any) => {
          const {
            params: { mangaId },
            body,
          } = ctx as { params: { mangaId: string }; body: { status: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          await service.setStatus(
            user.id,
            mangaId as UUID,
            parseReadingStatus(body.status)
          );
          return success(null);
        },
        {
          params: t.Object({ mangaId: t.String() }),
          body: t.Object({ status: t.String() }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: t.Null(),
            }),
          },
        }
      )
      .delete(
        "/reading-status/manga/:mangaId",
        async (ctx: any) => {
          const {
            params: { mangaId },
          } = ctx as { params: { mangaId: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          await service.clearStatus(user.id, mangaId as UUID);
          return success(null);
        },
        {
          params: t.Object({ mangaId: t.String() }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: t.Null(),
            }),
          },
        }
      )
      .get(
        "/reading-status/:status",
        async (ctx: any) => {
          const {
            params: { status },
          } = ctx as { params: { status: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const result = await service.listByStatus(
            user.id,
            parseReadingStatus(status)
          );
          return success(result);
        },
        {
          params: t.Object({ status: t.String() }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: t.Array(statusEntrySchema),
            }),
          },
        }
      )
  );
