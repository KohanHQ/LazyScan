import { Elysia, t } from "elysia";
import * as service from "@/modules/manga/manga.service";
import { success, fail, httpStatusFromError } from "@/shared/http/response";
import { requireAuth, resolveRequiredUser } from "@/middleware/auth";
import {
  mangaTransportSchemas,
  validateMangaRequest,
  MangaValidator,
  parseMangaStatusFilter,
  parseMangaPublishedYearFilter,
  parseMangaTagFilter,
  parseMangaSort,
  parseMangaOrder,
  parseMangaTextFilter,
  parseMangaYearRangeFilter,
} from "@/modules/manga/manga.validation";
import {
  ValidationError,
  BusinessRuleError,
} from "@/shared/utility/validation";
import { getLimitOffsetFromQuery } from "@/shared/utility/pagination";
import { UUID } from "@/shared/types/id";

export const mangaResponseSchema = t.Object({
  id: t.String(),
  title: t.String(),
  slug: t.String(),
  coverUrl: t.Union([t.String(), t.Null()]),
  description: t.Union([t.String(), t.Null()]),
  status: t.Union([
    t.Literal("ongoing"),
    t.Literal("completed"),
    t.Literal("hiatus"),
    t.Literal("cancelled"),
  ]),
  totalChapters: t.Union([t.Number(), t.Null()]),
  author: t.Union([t.String(), t.Null()]),
  artist: t.Union([t.String(), t.Null()]),
  publisher: t.Union([t.String(), t.Null()]),
  publishedYear: t.Union([t.Number(), t.Null()]),
  tags: t.Array(t.String()),
  createdByUserId: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const mangaHandler = new Elysia({ prefix: "/manga" })
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

  // Public routes (no auth required)
  .get(
    "/",
    async ({ query }) => {
      const { limit, offset } = getLimitOffsetFromQuery(query);
      const rawSearch =
        typeof query.search === "string" ? query.search.trim().slice(0, 100) : "";
      const search = rawSearch.length > 0 ? rawSearch : undefined;
      const status = parseMangaStatusFilter(query.status);
      const publishedYear = parseMangaPublishedYearFilter(query.publishedYear);
      const tag = parseMangaTagFilter(query.tag);
      const sort = parseMangaSort(query.sort);
      const order = parseMangaOrder(query.order);
      const author = parseMangaTextFilter(query.author, "author");
      const artist = parseMangaTextFilter(query.artist, "artist");
      const publisher = parseMangaTextFilter(query.publisher, "publisher");
      const yearRange = parseMangaYearRangeFilter(query.year);
      const mangaList = await service.listManga({
        limit,
        offset,
        search,
        status,
        publishedYear,
        tag,
        sort,
        order,
        author,
        artist,
        publisher,
        yearFrom: yearRange?.from,
        yearTo: yearRange?.to,
      });
      return success(mangaList);
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        search: t.Optional(t.String()),
        status: t.Optional(t.String()),
        publishedYear: t.Optional(t.String()),
        tag: t.Optional(t.String()),
        sort: t.Optional(t.String()),
        order: t.Optional(t.String()),
        author: t.Optional(t.String()),
        artist: t.Optional(t.String()),
        publisher: t.Optional(t.String()),
        year: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Array(mangaResponseSchema),
        }),
      },
    }
  )

  // Popularity ranking for the home carousel. Static path, registered before
  // `/:id` so it is never shadowed by the id route. `limit`/`range`/`tz` are
  // parsed leniently; the service clamps and validates them. `range` is "week"
  // (default) or "month"; `tz` is the client IANA zone so the window edge follows
  // the caller's local "today". Returns the standard manga array (no view counts).
  .get(
    "/popular",
    async ({ query }) => {
      const parsed = Number(query.limit);
      const limit = Number.isFinite(parsed) ? parsed : undefined;
      const mangaList = await service.listPopularManga({
        limit,
        range: query.range,
        tz: query.tz,
      });
      return success(mangaList);
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        range: t.Optional(t.String()),
        tz: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Array(mangaResponseSchema),
        }),
      },
    }
  )

  // Distinct catalog tags for the library filter UI. Static path, registered
  // before `/:id` so it is never shadowed.
  .get(
    "/tags",
    async () => {
      const tags = await service.listMangaTags();
      return success(tags);
    },
    {
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Array(t.String()),
        }),
      },
    }
  )

  // Manga ordered by latest ready chapter for the home "Recently updated" rail.
  // Static path, registered before `/:id` so it is never shadowed. `limit` is
  // parsed leniently like `/popular`; the service clamps it. Returns the standard
  // manga array.
  .get(
    "/updates",
    async ({ query }) => {
      const parsed = Number(query.limit);
      const limit = Number.isFinite(parsed) ? parsed : undefined;
      const mangaList = await service.listRecentlyUpdatedManga({ limit });
      return success(mangaList);
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Array(mangaResponseSchema),
        }),
      },
    }
  )

  .get(
    "/slug/:slug",
    async ({ params: { slug } }) => {
      const manga = await service.getMangaBySlug(slug);
      return success(manga);
    },
    {
      params: t.Object({
        slug: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: mangaResponseSchema,
        }),
      },
    }
  )

  .get(
    "/:id",
    async ({ params: { id } }) => {
      const manga = await service.getMangaById(id as UUID);
      return success(manga);
    },
    {
      params: t.Object({
        id: t.String({ format: "uuid" }),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: mangaResponseSchema,
        }),
      },
    }
  )

  // Protected routes (require auth)
  .group("", (app) =>
    app
      .use(requireAuth)
      .post(
        "/",
        async (ctx: any) => {
          const { body } = ctx as { body: any };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const { cover, ...data } = body;

          const validatedData = validateMangaRequest(
            mangaTransportSchemas.create,
            data,
            MangaValidator.validateCreate
          );

          const manga = await service.createManga(
            validatedData,
            cover,
            user
          );
          return success(manga);
        },
        {
          body: t.Object({
            title: t.String(),
            slug: t.String(),
            cover: t.Optional(t.File()),
            description: t.Optional(t.String()),
            status: t.Optional(
              t.Union([
                t.Literal("ongoing"),
                t.Literal("completed"),
                t.Literal("hiatus"),
                t.Literal("cancelled"),
              ])
            ),
            totalChapters: t.Optional(t.Union([t.Number(), t.String()])),
            author: t.Optional(t.String()),
            artist: t.Optional(t.String()),
            publisher: t.Optional(t.String()),
            publishedYear: t.Optional(t.Union([t.Number(), t.String()])),
            // JSON array, or a comma-separated string on multipart create.
            tags: t.Optional(t.Union([t.Array(t.String()), t.String()])),
          }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: mangaResponseSchema,
            }),
          },
        }
      )
      .post(
        "/:id/cover",
        async (ctx: any) => {
          const {
            params: { id },
            body,
          } = ctx as { params: { id: string }; body: any };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const { file } = body;

          const manga = await service.updateManga(
            id as UUID,
            {},
            file,
            user
          );
          return success(manga);
        },
        {
          params: t.Object({
            id: t.String({ format: "uuid" }),
          }),
          body: t.Object({
            file: t.File(),
          }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: mangaResponseSchema,
            }),
          },
        }
      )
      .patch(
        "/:id",
        async (ctx: any) => {
          const {
            params: { id },
            body,
          } = ctx as { params: { id: string }; body: any };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const { cover, ...data } = body;

          const validatedData = validateMangaRequest(
            mangaTransportSchemas.update,
            data,
            MangaValidator.validateUpdate
          );

          const manga = await service.updateManga(
            id as UUID,
            validatedData,
            cover,
            user
          );
          return success(manga);
        },
        {
          params: t.Object({
            id: t.String({ format: "uuid" }),
          }),
          body: t.Object({
            title: t.Optional(t.String()),
            slug: t.Optional(t.String()),
            cover: t.Optional(t.File()),
            description: t.Optional(t.Union([t.String(), t.Null()])),
            status: t.Optional(
              t.Union([
                t.Literal("ongoing"),
                t.Literal("completed"),
                t.Literal("hiatus"),
                t.Literal("cancelled"),
              ])
            ),
            totalChapters: t.Optional(t.Union([t.Number(), t.String(), t.Null()])),
            author: t.Optional(t.Union([t.String(), t.Null()])),
            artist: t.Optional(t.Union([t.String(), t.Null()])),
            publisher: t.Optional(t.Union([t.String(), t.Null()])),
            publishedYear: t.Optional(t.Union([t.Number(), t.String(), t.Null()])),
            // `null` clears the tags (the column resets to the empty array).
            tags: t.Optional(t.Union([t.Array(t.String()), t.String(), t.Null()])),
          }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: mangaResponseSchema,
            }),
          },
        }
      )
      .delete(
        "/:id",
        async (ctx: any) => {
          const {
            params: { id },
          } = ctx as { params: { id: string } };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          await service.deleteManga(id as UUID, user);
          return success(null);
        },
        {
          params: t.Object({
            id: t.String({ format: "uuid" }),
          }),
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
