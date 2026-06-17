import { Elysia, t } from "elysia";
import * as service from "@/modules/upload/upload.service";
import { success, fail, httpStatusFromError } from "@/shared/http/response";
import { AppError } from "@/shared/http/error";
import { requireAuth, resolveRequiredUser } from "@/middleware/auth";
import {
  ValidationError,
  BusinessRuleError,
} from "@/shared/utility/validation";

const uploadStatusSchema = t.Object({
  id: t.String(),
  status: t.Union([
    t.Literal("pending"),
    t.Literal("processing"),
    t.Literal("completed"),
    t.Literal("failed"),
  ]),
  originalUrl: t.Union([t.String(), t.Null()]),
  processedUrl: t.Union([t.String(), t.Null()]),
  errorMessage: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
});

function genericUploadNotImplemented(): AppError {
  return new AppError({
    code: "GENERIC_UPLOAD_NOT_IMPLEMENTED",
    message:
      "Generic uploads are not implemented. Use manga-scoped routes for covers and chapters.",
    status: 501,
  });
}

export const uploadHandler = new Elysia({ prefix: "/upload" })
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

  // First implemented generic upload use case: the owner avatar. Any other
  // `type` keeps the reserved 501 behavior (covers/chapter pages stay on their
  // manga-scoped routes).
  .post(
    "/",
    async (ctx: any) => {
      const { body } = ctx as { body: { file?: File; type?: string } };
      const sessionValue = ctx.cookie.session?.value as string | undefined;
      const user = await resolveRequiredUser(sessionValue);

      if (body.type !== "avatar") {
        throw genericUploadNotImplemented();
      }

      if (!body.file) {
        throw new ValidationError(
          "No file provided",
          "file",
          "NO_FILE_PROVIDED"
        );
      }

      const result = await service.createAvatarUpload(user, body.file);
      return success(result);
    },
    {
      body: t.Object({
        file: t.File(),
        type: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Object({
            upload: uploadStatusSchema,
            avatarUrl: t.String(),
          }),
        }),
        501: t.Object({
          success: t.Literal(false),
          status: t.Number(),
          code: t.Literal("GENERIC_UPLOAD_NOT_IMPLEMENTED"),
          message: t.String(),
          data: t.Optional(t.Unknown()),
        }),
      },
    }
  )

  .get(
    "/list",
    () => {
      throw genericUploadNotImplemented();
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
          data: t.Array(uploadStatusSchema),
        }),
        501: t.Object({
          success: t.Literal(false),
          status: t.Number(),
          code: t.Literal("GENERIC_UPLOAD_NOT_IMPLEMENTED"),
          message: t.String(),
          data: t.Optional(t.Unknown()),
        }),
      },
    }
  )

  .get(
    "/:id",
    () => {
      throw genericUploadNotImplemented();
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: uploadStatusSchema,
        }),
        501: t.Object({
          success: t.Literal(false),
          status: t.Number(),
          code: t.Literal("GENERIC_UPLOAD_NOT_IMPLEMENTED"),
          message: t.String(),
          data: t.Optional(t.Unknown()),
        }),
      },
    }
  );
