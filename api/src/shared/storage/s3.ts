import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3StorageConfig {
  endpoint: string;
  // Browser-reachable endpoint used only to sign presigned PUT URLs. Defaults to
  // `endpoint` when unset. See env.ts STORAGE_SIGNING_ENDPOINT for rationale.
  signingEndpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicDomain?: string;
  forcePathStyle?: boolean;
}

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  cacheControl?: string;
}

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  contentType: string;
}

/**
 * S3-compatible object storage adapter. Works against any S3 API: Cloudflare R2
 * (production) and Dockerized MinIO (local dev) both go through this class.
 *
 * Direct operations (upload/download/exists/delete) use `client`, configured with
 * the server-reachable `endpoint`. Presigned PUT URLs use `signerClient`, which is
 * a separate client bound to `signingEndpoint` only when that differs from
 * `endpoint` — letting the browser PUT against a different host (e.g. MinIO's
 * published port) than the API/worker container uses internally.
 */
export class S3CompatibleStorage {
  private client: S3Client;
  private signerClient: S3Client;
  private bucketName: string;
  private publicDomain: string;

  constructor(config: S3StorageConfig) {
    this.bucketName = config.bucketName;

    const publicDomain = config.publicDomain?.trim();
    if (!publicDomain) {
      throw new Error(
        "Storage public domain is not configured. Set STORAGE_PUBLIC_DOMAIN (or CLOUDFLARE_R2_PUBLIC_DOMAIN for R2) to the browser-reachable base URL for objects.",
      );
    }
    this.publicDomain = publicDomain;

    const credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
    const forcePathStyle = config.forcePathStyle ?? true;

    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials,
      forcePathStyle,
      // Disable extra features that R2/MinIO do not support cleanly.
      useAccelerateEndpoint: false,
      useDualstackEndpoint: false,
    });

    const signingEndpoint = config.signingEndpoint?.trim();
    this.signerClient =
      signingEndpoint && signingEndpoint !== config.endpoint
        ? new S3Client({
            region: config.region,
            endpoint: signingEndpoint,
            credentials,
            forcePathStyle,
            useAccelerateEndpoint: false,
            useDualstackEndpoint: false,
          })
        : this.client;
  }

  async upload(
    key: string,
    data: Buffer | Uint8Array | string,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: data,
      ContentType: options.contentType || "application/octet-stream",
      Metadata: options.metadata,
      CacheControl: options.cacheControl,
    });

    await this.client.send(command);

    const size = Buffer.isBuffer(data)
      ? data.length
      : data instanceof Uint8Array
        ? data.length
        : Buffer.byteLength(data, "utf8");

    return {
      key,
      url: this.getPublicUrl(key),
      size,
      contentType: options.contentType || "application/octet-stream",
    };
  }

  async createPresignedPutUrl(
    key: string,
    options: {
      contentType?: string;
      expiresInSeconds?: number;
    } = {},
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: options.contentType || "application/octet-stream",
    });

    return getSignedUrl(this.signerClient, command, {
      expiresIn: options.expiresInSeconds ?? 15 * 60,
    });
  }

  async download(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`Object not found: ${key}`);
    }

    const chunks: Uint8Array[] = [];
    const reader = response.Body.transformToWebStream().getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    await this.client.send(command);
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.client.send(command);
      return true;
    } catch (error: any) {
      if (
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw error;
    }
  }

  async getMetadata(key: string): Promise<{
    size: number;
    contentType: string;
    lastModified: Date;
    metadata?: Record<string, string>;
  }> {
    const command = new HeadObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    const response = await this.client.send(command);

    return {
      size: response.ContentLength || 0,
      contentType: response.ContentType || "application/octet-stream",
      lastModified: response.LastModified || new Date(),
      metadata: response.Metadata,
    };
  }

  getPublicUrl(key: string): string {
    const base = this.publicDomain.replace(/\/$/, "");
    return `${base}/${key}`;
  }

  static generateKey(
    prefix: string,
    filename: string,
    userId?: string,
  ): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, "_");

    const parts = [prefix];
    if (userId) parts.push(userId);
    parts.push(`${timestamp}_${random}_${sanitized}`);

    return parts.join("/");
  }
}

export function createS3Storage(config: S3StorageConfig): S3CompatibleStorage {
  return new S3CompatibleStorage(config);
}
