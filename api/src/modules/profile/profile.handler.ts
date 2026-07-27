import { Elysia, t } from "elysia";
import * as service from "@/modules/profile/profile.service";
import { mangaResponseSchema } from "@/modules/manga/manga.handler";
import { success, fail, httpStatusFromError } from "@/shared/http/response";
import { requireAuth, resolveRequiredUser } from "@/middleware/auth";
import { publicReadLimit } from "@/middleware/rate.limit";
import {
  profileTransportSchemas,
  validateProfileRequest,
  ProfileValidator,
} from "@/modules/profile/profile.validation";
import {
  ValidationError,
  BusinessRuleError,
} from "@/shared/utility/validation";

const visibilitySchema = t.Union([t.Literal("public"), t.Literal("private")]);

const badgeSchema = t.Object({
  code: t.String(),
  label: t.String(),
  rarity: t.Union([t.Literal("common"), t.Literal("rare"), t.Literal("limited")]),
});

// Owner-facing shape (GET /profile/me, PATCH /profile/me): includes the
// visibility controls and the owner's own derived badges. avatarUrl stays
// read-only here: it is null for everyone except the instance owner, whose
// owner-gated avatar upload (POST /upload, type=avatar) writes it. PATCH still
// rejects it; everyone else's avatar is derived client-side.
const profileResponseSchema = t.Object({
  username: t.Union([t.String(), t.Null()]),
  displayName: t.Union([t.String(), t.Null()]),
  bio: t.Union([t.String(), t.Null()]),
  avatarUrl: t.Union([t.String(), t.Null()]),
  profileVisibility: visibilitySchema,
  shelfVisibility: visibilitySchema,
  badges: t.Array(badgeSchema),
  createdAt: t.String(),
  updatedAt: t.String(),
});

// Public lookup shape: identity fields + derived badges + the optional favorites
// shelf. No visibility flags, no reading stats.
const publicProfileResponseSchema = t.Object({
  username: t.Union([t.String(), t.Null()]),
  displayName: t.Union([t.String(), t.Null()]),
  bio: t.Union([t.String(), t.Null()]),
  avatarUrl: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
  badges: t.Array(badgeSchema),
  shelf: t.Object({
    visible: t.Boolean(),
    favorites: t.Array(mangaResponseSchema),
  }),
});

const statsResponseSchema = t.Object({
  titlesRead: t.Number(),
  chaptersRead: t.Number(),
  pagesRead: t.Number(),
  mostReadManga: t.Array(
    t.Object({
      manga: mangaResponseSchema,
      readChapters: t.Number(),
    })
  ),
});

export const profileHandler = new Elysia({ prefix: "/profile" })
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

  // Protected routes (require auth)
  .group("", (app) =>
    app
      .use(requireAuth)
      .get(
        "/me",
        async (ctx: any) => {
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const profile = await service.getProfile(user.id);
          return success(profile);
        },
        {
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: profileResponseSchema,
            }),
          },
        }
      )
      .get(
        "/me/stats",
        async (ctx: any) => {
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const stats = await service.getProfileStats(user.id);
          return success(stats);
        },
        {
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: statsResponseSchema,
            }),
          },
        }
      )
      .patch(
        "/me",
        async (ctx: any) => {
          const { body } = ctx as { body: any };
          const sessionValue = ctx.cookie.session?.value as string | undefined;
          const user = await resolveRequiredUser(sessionValue);
          const validatedData = validateProfileRequest(
            profileTransportSchemas.update,
            body,
            ProfileValidator.validateUpdate
          );

          const profile = await service.updateProfile(user.id, validatedData);
          return success(profile);
        },
        {
          body: t.Object({
            username: t.Optional(t.String()),
            displayName: t.Optional(t.Union([t.String(), t.Null()])),
            bio: t.Optional(t.Union([t.String(), t.Null()])),
            profileVisibility: t.Optional(visibilitySchema),
            shelfVisibility: t.Optional(visibilitySchema),
            // avatarUrl is intentionally surfaced here (Elysia strips keys absent
            // from the body schema) only so the strict Zod layer can reject it:
            // the write path was removed, so sending it is a 400, not a silent
            // no-op. The avatar is derived from the display name.
            avatarUrl: t.Optional(t.Union([t.String(), t.Null()])),
          }),
          response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: profileResponseSchema,
            }),
          },
        }
      )
  )

  // Public routes (no auth required)
  .get(
    "/username/:username",
    async ({ params: { username } }) => {
      const profile = await service.getPublicProfileByUsername(username);
      return success(profile);
    },
    {
      beforeHandle: publicReadLimit,
      params: t.Object({
        username: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: publicProfileResponseSchema,
        }),
      },
    }
  );
