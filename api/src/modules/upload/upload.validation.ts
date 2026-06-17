import { z } from "zod";
import { ValidationError, BusinessRuleError } from "@/shared/utility/validation";

const uploadTypeSchema = z.enum(["manga_cover", "chapter_page"]);
const metadataSchema = z
  .union([
    z.record(z.string(), z.any()),
    z.string().transform((value, ctx) => {
      if (value === "") {
        return undefined;
      }

      try {
        const parsed = JSON.parse(value);
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        ) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Fall through to a single explicit validation issue.
      }

      ctx.addIssue({
        code: "custom",
        message: "metadata must be a valid JSON object",
      });
      return z.NEVER;
    }),
  ])
  .optional();

export const uploadTransportSchemas = {
  createDirect: z.object({
    type: uploadTypeSchema,
    filename: z.string().min(1).max(255),
    contentType: z.string().regex(/^image\/(png|jpeg|jpg|webp)$/),
    metadata: metadataSchema,
  }).strict(),
};

export class UploadValidator {
  static validateCreate(input: { contentType: string; filename: string }): void {
    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    
    if (!allowedTypes.includes(input.contentType)) {
      throw new BusinessRuleError(
        "Invalid content type. Only PNG, JPEG, and WebP images are allowed",
        "INVALID_CONTENT_TYPE",
        { contentType: input.contentType, allowedTypes }
      );
    }

    const ext = input.filename.split('.').pop()?.toLowerCase();
    if (!ext || !["png", "jpg", "jpeg", "webp"].includes(ext)) {
      throw new BusinessRuleError(
        "Invalid file extension",
        "INVALID_FILE_EXTENSION",
        { filename: input.filename }
      );
    }
  }
}

export function validateUploadRequest<T>(
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
