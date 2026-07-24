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
  windowMs: number;
  maxRequests: number;
  // Bucket namespace; distinct prefixes keep separate counters in the shared
  // store (e.g. the global cap and a per-route cap never collide for one IP).
  keyPrefix?: string;
  forceEnabled?: boolean;
}

// Fixed-window counter. Callable from a plugin hook or a route `beforeHandle`;
// throws 429 when the bucket is exhausted, else sets X-RateLimit-* headers.
export function enforceRateLimit(ctx: any, options: RateLimitOptions): void {
  const { request, server, set, config } = ctx;
  const { windowMs, maxRequests, keyPrefix, forceEnabled = false } = options;

  if (!forceEnabled && !config?.features.rateLimit) {
    return;
  }

  const socketIp = server?.requestIP(request)?.address;

  // Behind the proxy the socket peer is nginx; when trustProxy is on use the
  // proxy-set X-Real-IP (nginx fills it from CF-Connecting-IP, not client-spoofable).
  const ip = config?.server?.trustProxy
    ? request.headers.get("x-real-ip")?.trim() || socketIp
    : socketIp;

  // No detectable client IP: fail closed rather than collapse into one bucket.
  if (!ip) {
    throw tooManyRequests(Math.ceil(windowMs / 1000));
  }

  const key = keyPrefix ? `${keyPrefix}:${ip}` : ip;
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
}

// Routes exempt from the global cap because one chapter import legitimately
// fires hundreds of them; each carries its own bucket instead
// (uploadStatusLimit for the GET poll, uploadPageLimit for page POSTs).
// Prefix-agnostic — matches with or without the /api/v1 mount.
const UPLOAD_STATUS_POLL = /\/manga\/[^/]+\/chapter\/uploads\/[^/]+$/;
const UPLOAD_PAGE_POST =
  /\/manga\/[^/]+\/chapter\/uploads\/[^/]+\/pages\/[^/]+\/upload$/;
function isUploadExempt(request: Request): boolean {
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return false;
  }
  if (request.method === "GET") {
    return UPLOAD_STATUS_POLL.test(pathname);
  }
  if (request.method === "POST") {
    return UPLOAD_PAGE_POST.test(pathname);
  }
  return false;
}

// App-wide. `as:"global"` so the hook fires for sibling routes (default local
// scope is stripped on `.use()`); `seed` avoids Elysia name+seed dedup. See findings.md.
export const globalRateLimit = new Elysia({ name: "rateLimit", seed: "global" })
  .onBeforeHandle({ as: "global" }, (ctx: any) => {
    if (isUploadExempt(ctx.request)) {
      return; // own buckets (uploadStatusLimit / uploadPageLimit) apply instead
    }
    enforceRateLimit(ctx, {
      windowMs: staticConfig.rateLimit.windowMs,
      maxRequests: staticConfig.rateLimit.maxRequests,
    });
  });

// Per-route limiters used as a route `beforeHandle`. Strict = SMTP-cost paths
// (register/resend); loose = OTP-typo/password retries (verify/login).
export const authStrictLimit = (ctx: any): void =>
  enforceRateLimit(ctx, {
    windowMs: staticConfig.rateLimit.auth.strict.windowMs,
    maxRequests: staticConfig.rateLimit.auth.strict.maxRequests,
    keyPrefix: "auth:strict",
  });

export const authLooseLimit = (ctx: any): void =>
  enforceRateLimit(ctx, {
    windowMs: staticConfig.rateLimit.auth.loose.windowMs,
    maxRequests: staticConfig.rateLimit.auth.loose.maxRequests,
    keyPrefix: "auth:loose",
  });

// Short-window burst cap on public reads (catalog/reader/profile); bounds
// scraping under the global cap without tripping normal browsing.
export const publicReadLimit = (ctx: any): void =>
  enforceRateLimit(ctx, {
    windowMs: staticConfig.rateLimit.publicRead.windowMs,
    maxRequests: staticConfig.rateLimit.publicRead.maxRequests,
    keyPrefix: "public",
  });

// Import-progress poll. Generous own bucket; this route is exempt from the global
// cap (see isUploadStatusPoll) so polling a large import can't self-DoS the IP.
export const uploadStatusLimit = (ctx: any): void =>
  enforceRateLimit(ctx, {
    windowMs: staticConfig.rateLimit.uploadStatus.windowMs,
    maxRequests: staticConfig.rateLimit.uploadStatus.maxRequests,
    keyPrefix: "upload:status",
  });

// Per-page upload POSTs. Exempt from the global cap (see isUploadExempt);
// this bucket alone bounds abuse without starving a bulk chapter import.
export const uploadPageLimit = (ctx: any): void =>
  enforceRateLimit(ctx, {
    windowMs: staticConfig.rateLimit.uploadPages.windowMs,
    maxRequests: staticConfig.rateLimit.uploadPages.maxRequests,
    keyPrefix: "upload:pages",
  });

// Comment write POST/PUT/DELETE. Tight per-IP bucket to bound spam.
export const commentWriteLimit = (ctx: any): void =>
  enforceRateLimit(ctx, {
    windowMs: staticConfig.rateLimit.comment.windowMs,
    maxRequests: staticConfig.rateLimit.comment.maxRequests,
    keyPrefix: "comment:write",
  });
