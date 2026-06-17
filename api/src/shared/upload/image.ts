import sharp from "sharp";
import { badRequest } from "@/shared/http/error";

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

  let image = sharp(buffer).rotate();
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw badRequest("Invalid image file", {
      code: "INVALID_IMAGE",
    });
  }

  const maxWidth = options.maxWidth || VERTICAL_READER_IMAGE_OPTIONS.maxWidth;
  const maxHeight = options.maxHeight || VERTICAL_READER_IMAGE_OPTIONS.maxHeight;

  if (metadata.width > maxWidth || metadata.height > maxHeight) {
    image = image.resize(maxWidth, maxHeight, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const format = options.format || VERTICAL_READER_IMAGE_OPTIONS.format;
  const quality = options.quality || VERTICAL_READER_IMAGE_OPTIONS.quality;

  let processedBuffer: Buffer;
  let contentType: string;

  switch (format) {
    case "jpeg":
      processedBuffer = await image.jpeg({ quality }).toBuffer();
      contentType = "image/jpeg";
      break;
    case "png":
      processedBuffer = await image.png({ quality }).toBuffer();
      contentType = "image/png";
      break;
    case "webp":
    default:
      processedBuffer = await image.webp({ quality }).toBuffer();
      contentType = "image/webp";
      break;
  }

  const processedMetadata = await sharp(processedBuffer).metadata();

  return {
    buffer: processedBuffer,
    contentType,
    width: processedMetadata.width || 0,
    height: processedMetadata.height || 0,
    size: processedBuffer.length,
  };
}

export function generateImageKey(prefix: string, filename: string, extension: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const sanitized = filename.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  
  return `${prefix}/${timestamp}_${random}_${sanitized}.${extension}`;
}
