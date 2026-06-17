import { Elysia, NotFoundError } from "elysia";
import { envSchema } from "@/env";
import { createConfig, staticConfig } from "@/config";
import { authHandler } from "@/modules/auth/auth.handler";
import { profileHandler } from "@/modules/profile/profile.handler";
import { mangaHandler } from "@/modules/manga/manga.handler";
import { uploadHandler } from "@/modules/upload/upload.handler";
import { chapterHandler } from "@/modules/chapter/chapter.handler";
import { readerHandler } from "@/modules/reader/reader.handler";
import { libraryHandler } from "@/modules/library/library.handler";
import { readingStatusHandler } from "@/modules/reading-status/reading-status.handler";
import { adminHandler } from "@/modules/admin/admin.handler";
import { globalRateLimit } from "@/middleware/rate.limit";
import { authMiddleware } from "@/middleware/auth";
import {
  registry,
  metricsOnRequest,
  metricsOnAfterResponse,
} from "@/shared/metrics/metrics";
import { logger, setupLogger, logError } from "@/shared/utility/logger";
import { fail, httpStatusFromError, success } from "@/shared/http/response";
import { notFound, AppError } from "@/shared/http/error";

const healthStatus = {
  healthy: "healthy",
  partialHealthy: "partial_healthy",
  degraded: "degraded",
  down: "down",
} as const;

export function createApp() {
  const env = envSchema.parse(process.env);
  const config = createConfig(env);

  return (
    new Elysia()
      .decorate("config", config)
      .decorate("staticConfig", staticConfig)

      .onStart(() => {
        setupLogger(config.isDevelopment ? "debug" : "info");
      })

      // Before the logger and rate limiter: scrapes every 15s are
      // unlogged and unthrottled. Reachable only on :3000 — /metrics is
      // not in the Aegis routing contract (known-constraints.md).
      .get("/metrics", async ({ set }) => {
        set.headers["content-type"] = registry.contentType;
        return await registry.metrics();
      })
      // RED hooks sit on the root instance, not a plugin — plugin hooks
      // are local-scoped and never fire for sibling routes.
      .onRequest(metricsOnRequest)
      .onAfterResponse(metricsOnAfterResponse)

      .use(logger({ skip: ["/health", "/metrics"] }))
      .use(globalRateLimit)
      .use(authMiddleware)

      .onBeforeHandle(({ config }) => {
        if (config && config.isDevelopment) {
        }
      })

      // Business routes are versioned under /api/v1 (single origin; nginx proxies
      // /api → here). Ops endpoints (/health, /metrics) stay at root, unversioned.
      .use(
        new Elysia({ prefix: "/api/v1" })
          .use(authHandler)
          .use(profileHandler)
          .use(mangaHandler)
          .use(uploadHandler)
          .use(chapterHandler)
          .use(readerHandler)
          .use(libraryHandler)
          .use(readingStatusHandler)
          .use(adminHandler),
      )

      .get("/health", ({ config }) =>
        success({
          status: healthStatus.healthy,
          environment: config?.isProduction ? "production" : "development",
          features: config?.features,
          timestamp: new Date().toISOString(),
        })
      )

      .onError(({ code, error, set, config }) => {
        logError("Request error", error instanceof Error ? error : undefined, {
          code,
        });

        if (config?.isProduction) {
          if (error instanceof NotFoundError) {
            set.status = 404;
            return fail(notFound("Not found"));
          }

          if (error instanceof AppError) {
            set.status = error.status;
            return fail(error);
          }

          set.status = 500;
          return fail(
            new AppError({
              code: "INTERNAL_ERROR",
              message: "Internal server error",
              status: 500,
            })
          );
        }

        // Development: standardized envelope with stack details.
        set.status = httpStatusFromError(error);
        const response = fail(error);

        if (error instanceof Error && error.stack) {
          response.error.details = {
            ...response.error.details,
            stack: error.stack,
            code,
          };
        }

        return response;
      })
  );
}
