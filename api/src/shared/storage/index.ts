import { CloudflareR2Storage, createCloudflareR2Storage } from "./cloudflare";
import { S3CompatibleStorage, createS3Storage } from "./s3";
import type { AppConfig } from "@/config";

export interface StorageService {
  upload(key: string, data: Buffer | Uint8Array | string, options?: {
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<{
    key: string;
    url: string;
    size: number;
    contentType: string;
  }>;

  createPresignedPutUrl(key: string, options?: {
    contentType?: string;
    expiresInSeconds?: number;
  }): Promise<string>;
  
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export function createStorageService(config: AppConfig): StorageService {
  const storage = config.storage;
  if (!storage.isConfigured) {
    throw new Error(
      storage.provider === "r2"
        ? "Cloudflare R2 is not configured. Please set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ACCESS_KEY_ID, CLOUDFLARE_SECRET_ACCESS_KEY, CLOUDFLARE_R2_BUCKET, and CLOUDFLARE_R2_PUBLIC_DOMAIN"
        : "Storage is not configured. Please set STORAGE_ENDPOINT, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, STORAGE_BUCKET, and STORAGE_PUBLIC_DOMAIN"
    );
  }

  return createS3Storage({
    endpoint: storage.endpoint!,
    signingEndpoint: storage.signingEndpoint,
    region: storage.region,
    accessKeyId: storage.accessKeyId!,
    secretAccessKey: storage.secretAccessKey!,
    bucketName: storage.bucket!,
    publicDomain: storage.publicDomain,
    forcePathStyle: storage.forcePathStyle,
  });
}

export { CloudflareR2Storage, createCloudflareR2Storage, S3CompatibleStorage, createS3Storage };
