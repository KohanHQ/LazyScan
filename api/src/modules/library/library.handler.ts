import { Elysia, t, NotFoundError } from "elysia";
import * as service from "@/modules/library/library.service";
import {
  parseLibraryList,
  parseLibrarySort,
} from "@/modules/library/library.validation";
import { parseMangaYearRangeFilter } from "@/modules/manga/manga.validation";
import { mangaResponseSchema } from "@/modules/manga/manga.handler";
import { success, fail, httpStatusFromError } from "@/shared/http/response";
import { requireAuth, resolveRequiredUser } from "@/middleware/auth";
import {
  ValidationError,
  BusinessRuleError,
} from "@/shared/utility/validation";
import { notFound, AppError } from "@/shared/http/error";
import { UUID } from "@/shared/types/id";

const libraryEntrySchema = t.Object({
  manga: mangaResponseSchema,
  addedAt: t.String(),
  position: t.Union([t.Number(), t.Null()]),
});

const membershipSchema = t.Object({
  favorite: t.Boolean(),
  queue: t.Boolean(),
});

const feedEntrySchema = t.Object({
  manga: t.Object({
    id: t.String(),
    title: t.String(),
    coverUrl: t.Union([t.String(), t.Null()]),
  }),
  chapter: t.Object({
    id: t.String(),
    title: t.String(),
    chapterNumber: t.Union([t.Number(), t.Null()]),
  }),
  readyAt: t.String(),
});

export const libraryHandler = new Elysia()
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
      .get(
        "/library/membership/:mangaId",
        async (ctx: any) => {
          const {
            params: { mangaId },
          } = ctx as { params: { mangaId: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const result = await service.getMembership(user.id, mangaId as UUID);
          return success(result);
        },
        {
          params: t.Object({ mangaId: t.String() }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: membershipSchema,
            }),
          },
        }
      )
      // New-chapters feed across saved manga. Static path, registered before
      // `/library/:list` so the param route never captures "feed". `limit` is
      // parsed leniently; the service clamps it.
      .get(
        "/library/feed",
        async (ctx: any) => {
          const { query } = ctx as { query: { limit?: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const parsed = Number(query.limit);
          const limit = Number.isFinite(parsed) ? parsed : undefined;
          const result = await service.listFeed(user.id, { limit });
          return success(result);
        },
        {
          query: t.Object({ limit: t.Optional(t.String()) }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: t.Array(feedEntrySchema),
            }),
          },
        }
      )
      .get(
        "/library/:list",
        async (ctx: any) => {
          const {
            params: { list },
            query,
          } = ctx as { params: { list: string }; query: { sort?: string; year?: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          // Validate the year string the same way GET /manga does, so a nonsense
          // year (e.g. "2e3", "2020abc") is rejected with 400 instead of silently
          // filtering on a garbage bound.
          const yearRange = parseMangaYearRangeFilter(query.year);
          const result = await service.listLibrary(
            user.id,
            parseLibraryList(list),
            parseLibrarySort(query.sort),
            yearRange?.from,
            yearRange?.to
          );
          return success(result);
        },
        {
          params: t.Object({ list: t.String() }),
          query: t.Object({
            sort: t.Optional(t.String()),
            year: t.Optional(t.String()),
          }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: t.Array(libraryEntrySchema),
            }),
          },
        }
      )
      .post(
        "/library/:list",
        async (ctx: any) => {
          const {
            params: { list },
            body,
          } = ctx as { params: { list: string }; body: { mangaId: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          await service.addToLibrary(
            user.id,
            body.mangaId as UUID,
            parseLibraryList(list)
          );
          return success(null);
        },
        {
          params: t.Object({ list: t.String() }),
          body: t.Object({ mangaId: t.String() }),
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
        "/library/:list/:mangaId",
        async (ctx: any) => {
          const {
            params: { list, mangaId },
          } = ctx as { params: { list: string; mangaId: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          await service.removeFromLibrary(
            user.id,
            mangaId as UUID,
            parseLibraryList(list)
          );
          return success(null);
        },
        {
          params: t.Object({ list: t.String(), mangaId: t.String() }),
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
