import { z } from "zod";
import { ValidationError, BusinessRuleError } from "@/shared/utility/validation";
import { containsProfanity } from "@/shared/utility/profanity";

const usernameSchema = z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/);

const visibilitySchema = z.enum(["public", "private"]);

// displayName accepts "" or null to clear the field (mapped to null); a non-empty
// value must still satisfy its format. username cannot be cleared.
const clearable = <T extends z.ZodTypeAny>(value: T) =>
  z
    .union([value, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" ? null : v));

// `.strict()` rejects unknown keys. `avatarUrl` was removed from the write path
// (the avatar is derived from the display name and there is no upload flow), so a
// client that still sends it now gets a 400 rather than having it silently stored.
export const profileTransportSchemas = {
  update: z.object({
    username: usernameSchema.optional(),
    displayName: clearable(z.string().min(1).max(100)),
    bio: clearable(z.string().min(1).max(256)),
    profileVisibility: visibilitySchema.optional(),
    shelfVisibility: visibilitySchema.optional(),
  }).strict(),
};

const RESERVED_USERNAMES = [
  "admin", "administrator", "root", "system", "support",
  "help", "api", "www", "mail", "localhost",
];

export class ProfileValidator {
  static validateUsername(username: string): void {
    if (RESERVED_USERNAMES.includes(username.toLowerCase())) {
      throw new BusinessRuleError(
        "This username is reserved",
        "USERNAME_RESERVED",
        { username }
      );
    }

    if (/^\d+$/.test(username)) {
      throw new BusinessRuleError(
        "Username cannot be only numbers",
        "USERNAME_ONLY_NUMBERS"
      );
    }
  }

  static validateUpdate(input: { username?: string; bio?: string | null }): void {
    if (input.username) {
      ProfileValidator.validateUsername(input.username);
    }
    // Reject, never censor: the bio is stored raw. null (cleared) skips this.
    if (input.bio && containsProfanity(input.bio)) {
      throw new BusinessRuleError(
        "Bio contains prohibited language",
        "PROFILE_BIO_PROFANITY"
      );
    }
  }
}

export function validateProfileRequest<T>(
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
