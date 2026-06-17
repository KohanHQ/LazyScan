import { S3CompatibleStorage } from "./s3";

export interface CloudflareR2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicDomain?: string;
  region?: string;
}

/**
 * R2 convenience wrapper over the generic S3-compatible adapter. Cloudflare R2
 * is just an S3 API behind `https://<account>.r2.cloudflarestorage.com` with
 * path-style addressing and region "auto". Kept as a named profile/back-compat
 * entry point; new callers should use the generic adapter via the storage factory.
 */
export class CloudflareR2Storage extends S3CompatibleStorage {
  constructor(config: CloudflareR2Config) {
    super({
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      region: config.region ?? "auto",
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      bucketName: config.bucketName,
      publicDomain: config.publicDomain,
      forcePathStyle: true,
    });
  }
}

export function createCloudflareR2Storage(config: CloudflareR2Config): CloudflareR2Storage {
  return new CloudflareR2Storage(config);
}
