import { z } from "zod";
import { ValidationError, BusinessRuleError } from "@/shared/utility/validation";
import { MAX_IMAGE_UPLOAD_BYTES } from "@/shared/upload";

const allowedContentTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const allowedExtensions = ["png", "jpg", "jpeg", "webp"];

const fileSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().regex(/^image\/(png|jpeg|jpg|webp)$/),
  sizeBytes: z.number().int().positive().optional(),
}).strict();

export const chapterTransportSchemas = {
  create: z.object({
    title: z.string().min(1).max(500),
    chapterNumber: z.number().positive().optional(),
    // NUMERIC(10,2) in Postgres; decimals allowed (omnibus volumes like 1.5).
    volume: z.number().min(0).max(9999).optional(),
    sortOrder: z.number().int().optional(),
    files: z.array(fileSchema).min(1).max(300),
  }).strict(),

  // Finalize step: holdAsDraft skips auto-publish so the chapter can be previewed
  // before becoming reader-visible. Defaults to publish-on-ready (legacy behavior).
  complete: z.object({
    holdAsDraft: z.boolean().optional(),
  }).strict(),

  // Editable chapter metadata. Nullable fields clear the value; an empty object is
  // a no-op. Mirrors the create field bounds.
  update: z.object({
    title: z.string().min(1).max(500).optional(),
    chapterNumber: z.number().positive().nullable().optional(),
    volume: z.number().min(0).max(9999).nullable().optional(),
    sortOrder: z.number().int().optional(),
  }).strict(),

  // Page reorder: the full set of page ids in the desired order (validated as a
  // permutation in the service). 300 mirrors the per-chapter page cap.
  reorderPages: z.object({
    pageIds: z.array(z.string().uuid()).min(1).max(300),
  }).strict(),
};

export class ChapterValidator {
  static validateCreate(input: {
    files: { filename: string; contentType: string; sizeBytes?: number }[];
  }): void {
    for (const file of input.files) {
      if (!allowedContentTypes.includes(file.contentType)) {
        throw new BusinessRuleError(
          "Invalid content type. Only PNG, JPEG, and WebP images are allowed",
          "INVALID_CONTENT_TYPE",
          { filename: file.filename, contentType: file.contentType, allowedContentTypes }
        );
      }

      const ext = file.filename.split(".").pop()?.toLowerCase();
      if (!ext || !allowedExtensions.includes(ext)) {
        throw new BusinessRuleError(
          "Invalid file extension",
          "INVALID_FILE_EXTENSION",
          { filename: file.filename, allowedExtensions }
        );
      }

      if (file.sizeBytes && file.sizeBytes > MAX_IMAGE_UPLOAD_BYTES) {
        throw new BusinessRuleError(
          "Image file too large. Maximum size is 10MB",
          "FILE_TOO_LARGE",
          {
            filename: file.filename,
            maxSize: MAX_IMAGE_UPLOAD_BYTES,
            actualSize: file.sizeBytes,
          }
        );
      }
    }
  }
}

export function validateChapterRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  businessValidator?: (validData: T) => void
): T {
  const parseResult = schema.safeParse(data);

  if (!parseResult.success) {
    const firstError = parseResult.error.issues[0];
    throw new ValidationError(
      firstError.message,
      firstError.path.join("."),
      "TRANSPORT_VALIDATION_FAILED"
    );
  }

  const validData = parseResult.data;

  if (businessValidator) {
    businessValidator(validData);
  }

  return validData;
}
