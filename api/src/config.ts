import type { Env } from "@/env";

export interface AppConfig {
  // Environment
  isProduction: boolean;
  isDevelopment: boolean;

  // Server
  server: {
    port: number;
    host: string;
    url: string;
    trustProxy: boolean;
  };

  // Database
  database: {
    url: string;
  };

  // Authentication
  jwt: {
    secret: string;
    expiresIn: string;
  };

  auth: {
    superuserEmails: string[];
    // The instance "owner": the DEFAULT_SUPERUSER_EMAIL account. Unlike
    // `defaultSuperuser` (which also needs the bootstrap password), this is set
    // whenever the email alone is configured — it gates owner-only behavior
    // (owner badge, avatar upload), not account creation.
    ownerEmail?: string;
    defaultSuperuser?: {
      email: string;
      password: string;
    };
  };

  // Cloudflare R2 (R2-specific profile source; also consumed by the
  // backfill-r2-public-domain maintenance script).
  cloudflare: {
    accountId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    r2Bucket?: string;
    r2PublicDomain?: string;
    isConfigured: boolean;
  };

  // Active storage profile, resolved from STORAGE_PROVIDER. `r2` derives its
  // values from `cloudflare` above (production unchanged); `minio`/`s3` read the
  // generic STORAGE_* env. This is the provider-agnostic object the storage
  // factory, boot ping, and cleanup paths consume.
  storage: {
    provider: "r2" | "minio" | "s3";
    endpoint?: string;
    // Browser-reachable endpoint used only to sign presigned PUT URLs; falls
    // back to `endpoint` (so R2 is unaffected). See env.ts for the rationale.
    signingEndpoint?: string;
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    bucket?: string;
    publicDomain?: string;
    forcePathStyle: boolean;
    isConfigured: boolean;
  };

  redis: {
    url: string;
  };

  // Feature Flags
  features: {
    rateLimit: boolean;
    cache: boolean;
  };

  // Log retention
  logs: {
    // Default retention window (days) for the prune op; overridable per-request.
    retentionDays: number;
  };

  // Storage prune (lite self-host): reclaim staged page originals Kiln already
  // converted. `enabled` gates the in-process periodic run; the admin endpoint
  // works regardless.
  storagePrune: {
    enabled: boolean;
    intervalMs: number;
  };

  // Sync image worker (ex-Kiln): avatars/covers POST to `${url}/convert`.
  imageSvc: {
    url: string;
  };

  // Hard storage byte cap enforced at chapter-import admission (507 over cap).
  storageQuotaBytes: number;
}

export function createConfig(env: Env): AppConfig {
  const defaultSuperuserEmail = env.DEFAULT_SUPERUSER_EMAIL.trim().toLowerCase();

  const cloudflare = {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    accessKeyId: env.CLOUDFLARE_ACCESS_KEY_ID,
    secretAccessKey: env.CLOUDFLARE_SECRET_ACCESS_KEY,
    r2Bucket: env.CLOUDFLARE_R2_BUCKET,
    r2PublicDomain: env.CLOUDFLARE_R2_PUBLIC_DOMAIN,
    isConfigured: !!(
      env.CLOUDFLARE_ACCOUNT_ID &&
      env.CLOUDFLARE_ACCESS_KEY_ID &&
      env.CLOUDFLARE_SECRET_ACCESS_KEY &&
      env.CLOUDFLARE_R2_BUCKET &&
      env.CLOUDFLARE_R2_PUBLIC_DOMAIN
    ),
  };

  const storage = resolveStorageConfig(env, cloudflare);

  return {
    isProduction: env.NODE_ENV === "production",
    isDevelopment: env.NODE_ENV === "development",

    server: {
      port: env.PORT,
      host: env.HOST,
      url: env.APP_URL,
      trustProxy: env.TRUST_PROXY,
    },

    database: {
      url: env.DATABASE_URL,
    },

    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
    },

    auth: {
      superuserEmails: env.SUPERUSER_EMAILS
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
      ownerEmail: defaultSuperuserEmail || undefined,
      defaultSuperuser:
        defaultSuperuserEmail && env.DEFAULT_SUPERUSER_PASSWORD
          ? {
              email: defaultSuperuserEmail,
              password: env.DEFAULT_SUPERUSER_PASSWORD,
            }
          : undefined,
    },

    cloudflare,
    storage,

    redis: {
      url: env.REDIS_URL,
    },

    features: {
      rateLimit: env.ENABLE_RATE_LIMIT,
      cache: env.ENABLE_CACHE,
    },

    logs: {
      retentionDays: env.LOG_RETENTION_DAYS,
    },

    storagePrune: {
      enabled: env.ENABLE_STORAGE_PRUNE,
      intervalMs: env.STORAGE_PRUNE_INTERVAL_MS,
    },

    imageSvc: {
      url: env.IMAGE_SVC_URL,
    },

    storageQuotaBytes: env.STORAGE_QUOTA_BYTES,
  };
}

// Resolve the active storage profile from STORAGE_PROVIDER.
//
// - `r2`: production profile, derived entirely from the CLOUDFLARE_* values so
//   existing deployments behave identically. The S3 endpoint is the R2 account
//   endpoint and there is a single public endpoint (no separate signing host).
// - `minio` / `s3`: generic profile read from STORAGE_* (used by the local
//   Dockerized MinIO dev setup). `signingEndpoint` lets the browser presign
//   against a different host than the API/worker direct-ops endpoint.
function resolveStorageConfig(
  env: Env,
  cloudflare: AppConfig["cloudflare"],
): AppConfig["storage"] {
  if (env.STORAGE_PROVIDER === "r2") {
    return {
      provider: "r2",
      endpoint: cloudflare.accountId
        ? `https://${cloudflare.accountId}.r2.cloudflarestorage.com`
        : undefined,
      signingEndpoint: undefined,
      region: "auto",
      accessKeyId: cloudflare.accessKeyId,
      secretAccessKey: cloudflare.secretAccessKey,
      bucket: cloudflare.r2Bucket,
      publicDomain: cloudflare.r2PublicDomain,
      forcePathStyle: true,
      isConfigured: cloudflare.isConfigured,
    };
  }

  return {
    provider: env.STORAGE_PROVIDER,
    endpoint: env.STORAGE_ENDPOINT,
    signingEndpoint: env.STORAGE_SIGNING_ENDPOINT,
    region: env.STORAGE_REGION ?? "us-east-1",
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    bucket: env.STORAGE_BUCKET,
    publicDomain: env.STORAGE_PUBLIC_DOMAIN,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    isConfigured: !!(
      env.STORAGE_ENDPOINT &&
      env.STORAGE_ACCESS_KEY_ID &&
      env.STORAGE_SECRET_ACCESS_KEY &&
      env.STORAGE_BUCKET &&
      env.STORAGE_PUBLIC_DOMAIN
    ),
  };
}

// Whether an account email is the instance owner (DEFAULT_SUPERUSER_EMAIL).
// Stored emails are not guaranteed lowercase, so normalize before comparing;
// config.auth.ownerEmail is already lowercased.
export function isOwnerEmail(
  config: AppConfig,
  email: string | null | undefined,
): boolean {
  const owner = config.auth.ownerEmail;
  return !!owner && !!email && email.trim().toLowerCase() === owner;
}

// Optional: Static config that doesn't come from env
export const staticConfig = {
  pagination: {
    defaultPageSize: 20,
    maxPageSize: 100,
  },

  upload: {
    maxFileSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ["image/jpeg", "image/png", "image/webp"],
  },

  rateLimit: {
    // Abuse backstop, not the primary control (per-route buckets below are).
    // Must absorb real SPA traffic: ~6 calls per page view plus one progress
    // PUT per reader page flip — 100/15min starved a normal reading session.
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 600,
    // Per-route auth buckets (per IP). Strict = SMTP-cost register/resend; loose
    // = verify/login (OTP attempt cap is the real brute-force control).
    auth: {
      strict: { windowMs: 15 * 60 * 1000, maxRequests: 5 },
      loose: { windowMs: 15 * 60 * 1000, maxRequests: 20 },
    },
    // Burst cap on public reads (catalog/reader/profile) — anti-scraping.
    publicRead: { windowMs: 60 * 1000, maxRequests: 60 },
    // Import-progress poll (manage-chapter polls for the whole conversion). Own
    // generous bucket + exempt from the global cap so a large chapter's polling
    // can't drain the IP's global budget (F-006).
    uploadStatus: { windowMs: 60 * 1000, maxRequests: 120 },
    // Per-page upload POSTs during a chapter import; exempt from the global cap
    // for the same reason. 300/min covers a large chapter at client concurrency.
    uploadPages: { windowMs: 60 * 1000, maxRequests: 300 },
  },

  // Email verification OTP (Herald pipeline).
  // The attempt cap is the real brute-force control for a 6-digit space; the
  // cooldown bounds resend spam alongside the auth rate limiter.
  emailVerification: {
    codeTtlMs: 10 * 60 * 1000, // 10 minutes
    maxAttempts: 5,
    resendCooldownMs: 60 * 1000, // 1 minute
  },

  cache: {
    ttl: 60 * 60, // 1 hour in seconds
    // Popular ranking is read-heavy and recomputed often; a short TTL absorbs the
    // aggregation cost while keeping the home carousel reasonably fresh. New reads
    // ride this window; catalog mutations invalidate the key explicitly.
    popularTtlMs: 60 * 1000, // 1 minute
    // Reader chapter list/detail. Mutations (publish/edit/delete/reorder)
    // invalidate explicitly; the short TTL bounds the one gap we can't hook —
    // Kiln flipping a chapter to ready is external to the API (see
    // known-constraints.md).
    readerTtlMs: 30 * 1000, // 30 seconds
    // Manga metadata detail (by id and slug). Invalidated on manga update/delete.
    mangaDetailTtlMs: 60 * 1000, // 1 minute
  },

  // Popularity ranking window + carousel size. `ranges` maps the public
  // `range` query value to a trailing-window length in days; `windowDays` is the
  // default-window fallback (kept so the no-range path is unchanged).
  popular: {
    windowDays: 7,
    defaultLimit: 10,
    maxLimit: 20,
    ranges: { week: 7, month: 30 },
    defaultRange: "week",
  },

  // "Recently updated" rail size (manga ordered by latest ready chapter).
  recentUpdates: {
    defaultLimit: 10,
    maxLimit: 20,
  },

  // Sidebar new-chapters feed size (ready chapters across saved manga).
  libraryFeed: {
    defaultLimit: 15,
    maxLimit: 30,
  },
} as const;
