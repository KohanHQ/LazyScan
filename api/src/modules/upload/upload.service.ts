import * as uploadRepo from "@/modules/upload/upload.repository";
import * as profileRepo from "@/modules/profile/profile.repository";
import {
  Upload,
  CreateUploadInput,
  UploadStatusResponse,
  MangaUploadInput,
} from "@/modules/upload/upload.model";
import { badRequest, forbidden, notFound } from "@/shared/http/error";
import { UUID } from "@/shared/types/id";
import { assertUuid } from "@/shared/identity/uuid";
import { createStorageService, type StorageService } from "@/shared/storage";
import { validateAndProcessImage, VERTICAL_READER_IMAGE_OPTIONS } from "@/shared/upload";
import {
  generateMangaPath,
  generateGenericPath,
} from "@/shared/storage/path.generator";
import { envSchema } from "@/env";
import { createConfig, isOwnerEmail } from "@/config";
import { AuthUser } from "@/middleware/auth";
import { logInfo } from "@/shared/utility/logger";
import { logger } from "@/shared/utility/logger";

const env = envSchema.parse(process.env);
const config = createConfig(env);

// Avatars render in small square slots; 512px inside-fit WebP keeps them sharp
// on high-DPI screens without storing reader-sized images.
const AVATAR_IMAGE_OPTIONS = {
  maxWidth: 512,
  maxHeight: 512,
  quality: 88,
  format: "webp",
} as const;

function generateUploadKey(
  userId: UUID,
  type: string,
  filename: string
): string {
  return generateGenericPath({ userId, type, filename });
}

function toStatusResponse(upload: Upload): UploadStatusResponse {
  return {
    id: upload.id,
    status: upload.status,
    originalUrl: upload.originalUrl,
    processedUrl: upload.processedUrl,
    errorMessage: upload.errorMessage,
    createdAt: upload.createdAt.toISOString(),
    updatedAt: upload.updatedAt.toISOString(),
  };
}

// Owner avatar upload — the first (and currently only) implemented use of the
// generic /upload route. Explicitly owner-gated: the avatar stays derived from
// the display name for everyone else, and PATCH /profile/me keeps rejecting
// avatarUrl (the upload route is the only write path).
//
// The processed key is deterministic (avatars/{userId}.webp) so replacing the
// avatar overwrites the same object instead of orphaning old ones; the stored
// avatar_url carries a `?v=` cache-buster so browsers/CDNs pick up the new
// bytes despite the unchanged key.
export async function createAvatarUpload(
  user: AuthUser,
  file: File
): Promise<{ upload: UploadStatusResponse; avatarUrl: string }> {
  if (!isOwnerEmail(config, user.email)) {
    throw forbidden("Avatar upload is restricted to the instance owner", {
      code: "AVATAR_UPLOAD_OWNER_ONLY",
    });
  }

  if (!config.storage.isConfigured) {
    throw badRequest("Storage is not configured", {
      code: "STORAGE_NOT_CONFIGURED",
    });
  }
  const storage = createStorageService(config);

  const processed = await validateAndProcessImage(file, {
    ...AVATAR_IMAGE_OPTIONS,
  });

  const sanitized = file.name.replace(/[^a-zA-Z0-9.-]/g, "_").substring(0, 80);
  const originalKey = `avatars/${user.id}/${sanitized}`;
  const processedKey = `avatars/${user.id}.webp`;

  const uploadResult = await storage.upload(processedKey, processed.buffer, {
    contentType: processed.contentType,
    metadata: {
      originalWidth: processed.width.toString(),
      originalHeight: processed.height.toString(),
      processedAt: new Date().toISOString(),
      uploadType: "avatar",
    },
  });

  const upload = await uploadRepo.create({
    userId: user.id,
    type: "avatar",
    filename: file.name,
    contentType: file.type,
    originalKey,
  });

  const completedUpload = await uploadRepo.updateStatus(upload.id, "completed", {
    processedKey,
    processedUrl: uploadResult.url,
  });

  const avatarUrl = `${uploadResult.url}?v=${Date.now()}`;
  await profileRepo.setAvatarUrl(user.id, avatarUrl);

  logInfo("Avatar upload completed", {
    uploadId: upload.id,
    userId: user.id,
  });

  return {
    upload: toStatusResponse(completedUpload!),
    avatarUrl,
  };
}

export async function createGenericUpload(
  input: CreateUploadInput,
  file: File,
  storage: StorageService
): Promise<UploadStatusResponse> {
  const key = generateUploadKey(input.userId, input.type, input.filename);

  const processed = await validateAndProcessImage(file, {
    ...VERTICAL_READER_IMAGE_OPTIONS,
  });

  const processedKey = key.replace(/\.[^.]+$/, ".webp");

  const uploadResult = await storage.upload(processedKey, processed.buffer, {
    contentType: processed.contentType,
    metadata: {
      originalWidth: processed.width.toString(),
      originalHeight: processed.height.toString(),
      processedAt: new Date().toISOString(),
      ...input.metadata,
    },
  });

  const upload = await uploadRepo.create({
    ...input,
    originalKey: key,
  });

  const completedUpload = await uploadRepo.updateStatus(
    upload.id,
    "completed",
    {
      processedKey,
      processedUrl: uploadResult.url,
    }
  );

  return toStatusResponse(completedUpload!);
}

export async function createMangaCoverUpload(
  input: MangaUploadInput,
  file: File,
  storage: StorageService
): Promise<UploadStatusResponse> {
  const key = generateMangaPath({
    mangaSlug: input.mangaSlug,
    type: input.uploadType,
    filename: input.filename,
    chapterOrder: input.chapterOrder,
  });

  const processed = await validateAndProcessImage(file, {
    ...VERTICAL_READER_IMAGE_OPTIONS,
  });

  const processedKey = key.replace(/\.[^.]+$/, ".webp");

  const uploadResult = await storage.upload(processedKey, processed.buffer, {
    contentType: processed.contentType,
    metadata: {
      originalWidth: processed.width.toString(),
      originalHeight: processed.height.toString(),
      processedAt: new Date().toISOString(),
      mangaSlug: input.mangaSlug,
      uploadType: input.uploadType,
      ...(input.chapterOrder && {
        chapterOrder: input.chapterOrder.toString(),
      }),
      ...input.metadata,
    },
  });

  const upload = await uploadRepo.create({
    userId: input.userId,
    type: input.uploadType === "cover" ? "manga_cover" : "chapter_page",
    filename: input.filename,
    contentType: file.type,
    originalKey: key,
    metadata: {
      mangaSlug: input.mangaSlug,
      uploadType: input.uploadType,
      ...(input.chapterOrder && { chapterOrder: input.chapterOrder }),
      ...input.metadata,
    },
  });

  const completedUpload = await uploadRepo.updateStatus(
    upload.id,
    "completed",
    {
      processedKey,
      processedUrl: uploadResult.url,
    }
  );

  logInfo("Upload completed", {
    uploadId: upload.id,
    userId: input.userId,
    type: input.uploadType,
    mangaSlug: input.mangaSlug,
  });

  return toStatusResponse(completedUpload!);
}

export async function createMangaChapterPageUpload(
  input: MangaUploadInput,
  file: File,
  storage: StorageService
): Promise<UploadStatusResponse> {
  if (input.uploadType !== "chapter") {
    throw new Error("This function is only for chapter page uploads");
  }

  return createMangaCoverUpload(input, file, storage);
}

export async function createMangaChapterUpload(
  mangaSlug: string,
  chapterOrder: number,
  files: File[],
  userId: UUID,
  storage: StorageService
): Promise<UploadStatusResponse[]> {
  const results: UploadStatusResponse[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const pageNumber = i + 1;

    // Generate filename with page number (001.webp, 002.webp, etc.)
    const filename = `${pageNumber.toString().padStart(3, "0")}.webp`;

    const uploadResult = await createMangaChapterPageUpload(
      {
        userId,
        mangaSlug,
        uploadType: "chapter",
        filename,
        contentType: file.type,
        chapterOrder,
        metadata: {
          pageNumber,
          totalPages: files.length,
        },
      },
      file,
      storage
    );

    results.push(uploadResult);
  }

  return results;
}

export async function getUploadStatus(
  id: UUID,
  userId: UUID
): Promise<UploadStatusResponse> {
  const uploadId = assertUuid(id, "upload id");
  const upload = await uploadRepo.findByIdForUser(uploadId, userId);

  if (!upload) {
    throw notFound("Upload not found", {
      code: "UPLOAD_NOT_FOUND",
    });
  }

  return toStatusResponse(upload);
}

export async function listUserUploads(
  userId: UUID,
  limit = 20,
  offset = 0
): Promise<UploadStatusResponse[]> {
  const uploads = await uploadRepo.findByUserId(userId, limit, offset);
  return uploads.map(toStatusResponse);
}
