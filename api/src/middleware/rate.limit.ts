import { Elysia } from "elysia";
import { staticConfig } from "@/config";
import { AppError } from "@/shared/http/error";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL = 60 * 1000; // 1 minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

function tooManyRequests(retryAfter: number): AppError {
  return new AppError({
    code: "RATE_LIMIT_EXCEEDED",
    message: "Too many requests, please try again later",
    status: 429,
    details: { retryAfter },
  });
}

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (request: Request, ip: string) => string;
  forceEnabled?: boolean;
}

export function rateLimitMiddleware(options: RateLimitOptions = {}) {
  const {
    windowMs = staticConfig.rateLimit.windowMs,
    maxRequests = staticConfig.rateLimit.maxRequests,
    keyGenerator = (_req: Request, ip: string) => ip,
    forceEnabled = false,
  } = options;

  return new Elysia({ name: "rateLimit" })
    .derive(({ request, server }) => {
      const ip = server?.requestIP(request)?.address ?? "unknown";
      return { clientIp: ip };
    })
    .onBeforeHandle((ctx: any) => {
      const { request, clientIp, set, config } = ctx;
      if (!forceEnabled && !config?.features.rateLimit) {
        return;
      }

      // Behind a trusted reverse proxy the socket peer is the proxy, so every
      // client would share one bucket. Use the proxy-set `X-Real-IP` (nginx sets
      // it to `$remote_addr`, so it is not client-spoofable) when trustProxy is on;
      // otherwise stay on the spoof-proof socket address.
      const ip =
        config?.server?.trustProxy
          ? request.headers.get("x-real-ip")?.trim() || clientIp
          : clientIp;

      const key = keyGenerator(request, ip);
      const now = Date.now();
      const entry = store.get(key);

      if (!entry || entry.resetAt <= now) {
        store.set(key, {
          count: 1,
          resetAt: now + windowMs,
        });
        return;
      }

      entry.count++;

      if (entry.count > maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        set.headers["Retry-After"] = String(retryAfter);
        set.headers["X-RateLimit-Limit"] = String(maxRequests);
        set.headers["X-RateLimit-Remaining"] = "0";
        set.headers["X-RateLimit-Reset"] = String(entry.resetAt);
        throw tooManyRequests(retryAfter);
      }

      set.headers["X-RateLimit-Limit"] = String(maxRequests);
      set.headers["X-RateLimit-Remaining"] = String(maxRequests - entry.count);
      set.headers["X-RateLimit-Reset"] = String(entry.resetAt);
    });
}

export const globalRateLimit = rateLimitMiddleware();

export const strictRateLimit = rateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,
});

export const authRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,
  keyGenerator: (req, ip) => `auth:${ip}`,
});
