import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  PORT: z.coerce.number().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("1d"),
  SUPERUSER_EMAILS: z.string().default(""),
  DEFAULT_SUPERUSER_EMAIL: z.string().default(""),
  DEFAULT_SUPERUSER_PASSWORD: z.string().default(""),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_ACCESS_KEY_ID: z.string().optional(),
  CLOUDFLARE_SECRET_ACCESS_KEY: z.string().optional(),
  CLOUDFLARE_R2_BUCKET: z.string().optional(),
  CLOUDFLARE_R2_PUBLIC_DOMAIN: z.string().optional(),
  // Storage provider selection. `r2` (default) keeps production reading the
  // CLOUDFLARE_* vars above unchanged. `minio`/`s3` read the generic STORAGE_*
  // vars below, used for the local Dockerized MinIO dev profile.
  STORAGE_PROVIDER: z.enum(["r2", "minio", "s3"]).default("r2"),
  STORAGE_ENDPOINT: z.string().optional(),
  // Browser-reachable S3 API endpoint used ONLY to sign presigned PUT URLs.
  // In Docker the API/worker reach MinIO at `http://minio:9000` (STORAGE_ENDPOINT)
  // but the browser must reach the published port `http://localhost:9000`. Presigning
  // is a local crypto op (no network), so a separate signing host keeps the SigV4
  // host header valid for the browser. Defaults to STORAGE_ENDPOINT when unset, so
  // R2 (one public endpoint for both) is unaffected.
  STORAGE_SIGNING_ENDPOINT: z.string().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_PUBLIC_DOMAIN: z.string().optional(),
  STORAGE_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((val) => val === "true"),
  // Hard storage byte cap (lite self-host): chapter-import admission rejects 507
  // when projected usage exceeds it. 8 GiB default (under R2's free 10 GB).
  STORAGE_QUOTA_BYTES: z.coerce.number().int().positive().default(8_589_934_592),
  // Sync image worker base URL. The API POSTs avatar/cover bytes to
  // `{IMAGE_SVC_URL}/convert` (replaces the inline `sharp` dependency).
  IMAGE_SVC_URL: z.string().url().default("http://image:8001"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  ENABLE_RATE_LIMIT: z
    .enum(["true", "false"])
    .default("false")
    .transform((val) => val === "true"),
  // When true, key the limiter on the proxy-set `X-Real-IP` instead of the socket
  // peer. Enable only behind the trusted nginx (fills X-Real-IP from CF-Connecting-IP).
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((val) => val === "true"),
  ENABLE_CACHE: z
    .enum(["true", "false"])
    .default("true")
    .transform((val) => val === "true"),
  // Default retention window (days) for the logs prune op. Used when
  // POST /admin/logs/prune is called without an explicit retentionDays; the
  // prune_logs function deletes rows older than this. Floor of 1 day.
  LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  // Storage prune (lite self-host): periodically delete staged page originals
  // that the image service has already converted, reclaiming ~half of page storage so usage
  // stays under the MinIO bucket quota. Off by default so existing (R2)
  // deployments are unchanged; the bundled compose turns it on.
  ENABLE_STORAGE_PRUNE: z
    .enum(["true", "false"])
    .default("false")
    .transform((val) => val === "true"),
  // How often the in-process prune runs, in milliseconds. Default 1 hour.
  STORAGE_PRUNE_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
});

export type Env = z.infer<typeof envSchema>;
