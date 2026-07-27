import { Elysia, t } from "elysia";
import * as service from "@/modules/auth/auth.service";
import { success, fail, httpStatusFromError } from "@/shared/http/response";
import { requireAuth, resolveRequiredUser } from "@/middleware/auth";
import { verifySessionToken } from "@/shared/crypto/jwt";
import { revokeSession } from "@/shared/auth/denylist";
import { authStrictLimit, authLooseLimit } from "@/middleware/rate.limit";
import * as profileRepo from "@/modules/profile/profile.repository";
import {
  authTransportSchemas,
  validateAuthRequest,
  AuthValidator,
} from "@/modules/auth/auth.validation";
import {
  ValidationError,
  BusinessRuleError,
} from "@/shared/utility/validation";
import type { AppConfig } from "@/config";

function sessionCookie(token: string, config: AppConfig) {
  return {
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.isProduction,
    path: "/",
  };
}

export const authHandler = new Elysia({ prefix: "/auth" })
  .onError(({ code, error, set }) => {
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

  // Hard verify: register never sets the session cookie. The pending OTP is
  // delivered by the mail service (outbox -> events:email); the session is minted by
  // /verify-email below.
  .post(
    "/register",
    async (ctx: any) => {
      const { body, config } = ctx;
      const validatedData = validateAuthRequest(
        authTransportSchemas.register,
        body,
        AuthValidator.validateRegistration
      );

      const { user } = await service.register(validatedData, {
        superuserEmails: config.auth.superuserEmails,
      });

      return success({
        email: user.email,
        verificationRequired: true as const,
      });
    },
    {
      beforeHandle: authStrictLimit,
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 8 }),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Object({
            email: t.String({ format: "email" }),
            verificationRequired: t.Literal(true),
          }),
        }),
      },
    }
  )

  .post(
    "/verify-email",
    async (ctx: any) => {
      const { body, set, config } = ctx;
      const validatedData = validateAuthRequest(
        authTransportSchemas.verifyEmail,
        body
      );

      const { user, token } = await service.verifyEmail(validatedData, {
        jwtExpiresIn: config.jwt.expiresIn,
        superuserEmails: config.auth.superuserEmails,
      });

      set.cookie = {
        session: sessionCookie(token, config),
      };

      return success({
        id: user.displayId,
        email: user.email,
      });
    },
    {
      beforeHandle: authLooseLimit,
      body: t.Object({
        email: t.String({ format: "email" }),
        code: t.String({ minLength: 6, maxLength: 6 }),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Object({
            id: t.String(),
            email: t.String({ format: "email" }),
          }),
        }),
      },
    }
  )

  // Uniform 200 whether or not the email exists or is already verified; the
  // cooldown is enforced silently (no enumeration / spam surface).
  .post(
    "/resend-verification",
    async (ctx: any) => {
      const { body } = ctx;
      const validatedData = validateAuthRequest(
        authTransportSchemas.resendVerification,
        body
      );

      await service.resendVerification(validatedData);

      return success({ ok: true });
    },
    {
      beforeHandle: authStrictLimit,
      body: t.Object({
        email: t.String({ format: "email" }),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Object({
            ok: t.Boolean(),
          }),
        }),
      },
    }
  )

  // Uniform 200 like resend-verification: unknown email, unverified account,
  // and cooldown suppression are all indistinguishable to the caller.
  .post(
    "/forgot-password",
    async (ctx: any) => {
      const { body } = ctx;
      const validatedData = validateAuthRequest(
        authTransportSchemas.forgotPassword,
        body
      );

      await service.requestPasswordReset(validatedData);

      return success({ ok: true });
    },
    {
      beforeHandle: authStrictLimit,
      body: t.Object({
        email: t.String({ format: "email" }),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Object({
            ok: t.Boolean(),
          }),
        }),
      },
    }
  )

  // Consumes the reset code; mints no session (the user logs in again).
  .post(
    "/reset-password",
    async (ctx: any) => {
      const { body } = ctx;
      const validatedData = validateAuthRequest(
        authTransportSchemas.resetPassword,
        body,
        AuthValidator.validatePasswordReset
      );

      await service.resetPassword(validatedData);

      return success({ ok: true });
    },
    {
      beforeHandle: authLooseLimit,
      body: t.Object({
        email: t.String({ format: "email" }),
        code: t.String({ minLength: 6, maxLength: 6 }),
        newPassword: t.String({ minLength: 8 }),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Object({
            ok: t.Boolean(),
          }),
        }),
      },
    }
  )

  .post(
    "/login",
    async (ctx: any) => {
      const { body, set, config } = ctx;
      const { user, token } = await service.login(body, {
        jwtExpiresIn: config.jwt.expiresIn,
        superuserEmails: config.auth.superuserEmails,
      });

      set.cookie = {
        session: sessionCookie(token, config),
      };

      return success({
        id: user.displayId,
        email: user.email,
      });
    },
    {
      beforeHandle: authLooseLimit,
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Object({
            id: t.String(),
            email: t.String({ format: "email" }),
          }),
        }),
      },
    }
  )

  .group("", (app) =>
    app.use(requireAuth).get(
      "/me",
      async (ctx: any) => {
        const sessionValue = ctx.cookie.session?.value as string | undefined;
        const user = await resolveRequiredUser(sessionValue);
        const currentUser = await service.getUserById(user.id);
        // Profile fields let the UI show username/displayName and derive an
        // avatar; null-safe so a user without a profile row still resolves.
        const profile = await profileRepo.findByUserId(currentUser.id);

        return success({
          id: currentUser.displayId,
          userId: currentUser.id,
          email: currentUser.email,
          role: currentUser.role,
          createdAt: currentUser.createdAt.toISOString(),
          username: profile?.username ?? null,
          displayName: profile?.displayName ?? null,
          avatarUrl: profile?.avatarUrl ?? null,
        });
      },
      {
        response: {
            200: t.Object({
              success: t.Literal(true),
              status: t.Number(),
              data: t.Object({
                id: t.String(),
              userId: t.String(),
              email: t.String({ format: "email" }),
              role: t.Union([t.Literal("user"), t.Literal("superuser")]),
              createdAt: t.String(),
              username: t.Union([t.String(), t.Null()]),
              displayName: t.Union([t.String(), t.Null()]),
              avatarUrl: t.Union([t.String(), t.Null()]),
            }),
          }),
        },
      }
    )
  )

  .post(
    "/logout",
    async ({ cookie, set }) => {
      // Revoke the session server-side (denylist its jti for its remaining life)
      // so the JWT can't be replayed before it expires, then clear the cookie.
      // Best-effort: an invalid/expired token has nothing to revoke.
      const token = cookie.session?.value as string | undefined;
      if (token) {
        try {
          const { jti, exp } = await verifySessionToken(token);
          if (jti && exp) {
            await revokeSession(jti, exp * 1000 - Date.now());
          }
        } catch {
          // Invalid or already-expired token: nothing to revoke.
        }
      }

      set.cookie = {
        session: {
          value: "",
          maxAge: 0,
          path: "/",
        },
      };

      return success({ success: true });
    },
    {
      response: {
        200: t.Object({
          success: t.Literal(true),
          status: t.Number(),
          data: t.Object({
            success: t.Boolean(),
          }),
        }),
      },
    }
  );
