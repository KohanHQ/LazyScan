import { badRequest, AppError } from "@/shared/http/error";
import { envSchema } from "@/env";
import { createConfig, type AppConfig } from "@/config";

// Image service URL, resolved lazily + memoized so the size-limit guard
// below stays usable without a fully-populated env (e.g. the unit test).
let cachedConfig: AppConfig | undefined;
function imageSvcUrl(): string {
  cachedConfig ??= createConfig(envSchema.parse(process.env));
  return cachedConfig.imageSvc.url;
}

export interface ImageProcessingOptions {
  maxWidth?: number;
  maxHeight?: number;
  maxInputBytes?: number;
  quality?: number;
  format?: "jpeg" | "png" | "webp";
}

export interface ProcessedImage {
  buffer: Buffer;
  contentType: string;
  width: number;
  height: number;
  size: number;
}

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

export const VERTICAL_READER_IMAGE_OPTIONS: Required<Pick<
  ImageProcessingOptions,
  "maxWidth" | "maxHeight" | "maxInputBytes" | "quality" | "format"
>> = {
  maxWidth: 1080,
  maxHeight: 1920,
  maxInputBytes: MAX_IMAGE_UPLOAD_BYTES,
  quality: 88,
  format: "webp",
};

export async function validateAndProcessImage(
  file: File,
  options: ImageProcessingOptions = {}
): Promise<ProcessedImage> {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw badRequest("Invalid image type. Only JPEG, PNG, and WebP are allowed", {
      code: "INVALID_IMAGE_TYPE",
      details: { allowedTypes: ALLOWED_MIME_TYPES },
    });
  }

  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw badRequest("Image file too large. Maximum size is 10MB", {
      code: "FILE_TOO_LARGE",
      details: { maxSize: MAX_IMAGE_UPLOAD_BYTES, actualSize: file.size },
    });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return processImageBuffer(buffer, options);
}

export async function processImageBuffer(
  buffer: Buffer,
  options: ImageProcessingOptions = {}
): Promise<ProcessedImage> {
  const maxInputBytes = options.maxInputBytes ?? MAX_IMAGE_UPLOAD_BYTES;
  if (buffer.length > maxInputBytes) {
    const maxSizeMB = (maxInputBytes / (1024 * 1024)).toFixed(0);
    throw badRequest(`Image file too large. Maximum size is ${maxSizeMB}MB`, {
      code: "FILE_TOO_LARGE",
      details: { maxSize: maxInputBytes, actualSize: buffer.length },
    });
  }

  const maxWidth = options.maxWidth || VERTICAL_READER_IMAGE_OPTIONS.maxWidth;
  const maxHeight = options.maxHeight || VERTICAL_READER_IMAGE_OPTIONS.maxHeight;
  const quality = options.quality || VERTICAL_READER_IMAGE_OPTIONS.quality;

  // Delegate decode/rotate/fit/encode to the image service over HTTP; it emits
  // WebP regardless of the requested format, matching every caller's profile.
  let response: Response;
  try {
    response = await fetch(
      `${imageSvcUrl()}/convert?w=${maxWidth}&h=${maxHeight}&q=${quality}`,
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array(buffer),
      },
    );
  } catch (cause) {
    throw new AppError({
      code: "IMAGE_PROCESSING_UNAVAILABLE",
      message: "Image processing service is unavailable",
      status: 502,
      details: { cause: cause instanceof Error ? cause.message : String(cause) },
    });
  }

  // The image service returns 422 for an undecodable image (the old null-metadata case).
  if (response.status === 422) {
    throw badRequest("Invalid image file", { code: "INVALID_IMAGE" });
  }
  if (!response.ok) {
    throw new AppError({
      code: "IMAGE_PROCESSING_FAILED",
      message: "Image processing failed",
      status: 502,
      details: { status: response.status },
    });
  }

  let result: { webp: string; width: number; height: number };
  try {
    result = (await response.json()) as {
      webp: string;
      width: number;
      height: number;
    };
  } catch (cause) {
    throw new AppError({
      code: "IMAGE_PROCESSING_FAILED",
      message: "Image processing returned an unreadable response",
      status: 502,
      details: { cause: cause instanceof Error ? cause.message : String(cause) },
    });
  }

  // A 200 must carry the encoded image and real dimensions; surface a malformed
  // payload as 502 rather than silently storing empty bytes or zero dimensions.
  if (
    !result.webp ||
    !Number.isFinite(result.width) ||
    !Number.isFinite(result.height) ||
    result.width <= 0 ||
    result.height <= 0
  ) {
    throw new AppError({
      code: "IMAGE_PROCESSING_FAILED",
      message: "Image processing returned an invalid result",
      status: 502,
      details: { width: result.width, height: result.height },
    });
  }

  const processedBuffer = Buffer.from(result.webp, "base64");

  return {
    buffer: processedBuffer,
    contentType: "image/webp",
    width: result.width,
    height: result.height,
    size: processedBuffer.length,
  };
}

export function generateImageKey(prefix: string, filename: string, extension: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const sanitized = filename.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  
  return `${prefix}/${timestamp}_${random}_${sanitized}.${extension}`;
}
