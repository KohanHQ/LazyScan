import { z } from "zod";
import { commonSchemas, ValidationError, BusinessRuleError } from "@/shared/utility/validation";

export const authTransportSchemas = {
  register: z.object({
    email: commonSchemas.email,
    password: commonSchemas.password,
  }).strict(),

  login: z.object({
    email: commonSchemas.email,
    password: commonSchemas.nonEmptyString,
  }).strict(),

  verifyEmail: z.object({
    email: commonSchemas.email,
    code: z.string().regex(/^\d{6}$/, "Verification code must be 6 digits"),
  }).strict(),

  resendVerification: z.object({
    email: commonSchemas.email,
  }).strict(),

  forgotPassword: z.object({
    email: commonSchemas.email,
  }).strict(),

  resetPassword: z.object({
    email: commonSchemas.email,
    code: z.string().regex(/^\d{6}$/, "Verification code must be 6 digits"),
    newPassword: commonSchemas.password,
  }).strict(),
};

export class AuthValidator {
  static validateRegistration(input: { email: string; password: string }): void {
    AuthValidator.validatePasswordStrength(input.password);

    if (input.email.includes('+')) {
      throw new BusinessRuleError(
        "Email aliases are not allowed",
        "EMAIL_ALIAS_BLOCKED"
      );
    }

    const emailDomain = input.email.split('@')[1];
    const blockedDomains = [
      'tempmail.com', '10minutemail.com', 'guerrillamail.com',
      'mailinator.com', 'yopmail.com', 'temp-mail.org',
      'throwaway.email', 'getnada.com', 'maildrop.cc'
    ];

    if (blockedDomains.includes(emailDomain)) {
      throw new BusinessRuleError(
        "Email domain is not allowed",
        "EMAIL_DOMAIN_BLOCKED",
        { domain: emailDomain }
      );
    }
  }

  // A reset password must clear the same bar as a registration password —
  // the email rules do not apply (the account already exists).
  static validatePasswordReset(input: { newPassword: string }): void {
    AuthValidator.validatePasswordStrength(input.newPassword);
  }

  static validatePasswordStrength(password: string): void {

    if (!/[A-Z]/.test(password)) {
      throw new BusinessRuleError(
        "Password must contain at least one uppercase letter",
        "PASSWORD_UPPERCASE_REQUIRED"
      );
    }

    if (!/[a-z]/.test(password)) {
      throw new BusinessRuleError(
        "Password must contain at least one lowercase letter",
        "PASSWORD_LOWERCASE_REQUIRED"
      );
    }

    if (!/\d/.test(password)) {
      throw new BusinessRuleError(
        "Password must contain at least one number",
        "PASSWORD_NUMBER_REQUIRED"
      );
    }

    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      throw new BusinessRuleError(
        "Password must contain at least one special character",
        "PASSWORD_SPECIAL_REQUIRED"
      );
    }
  }

  static validateLogin(input: { email: string; password: string }): void {
    if (input.password.length === 0) {
      throw new BusinessRuleError(
        "Password cannot be empty",
        "PASSWORD_EMPTY"
      );
    }
  }

  static validateUserAccess(userId: string, requestedUserId?: string): void {
    if (requestedUserId && userId !== requestedUserId) {
      throw new BusinessRuleError(
        "Access denied: cannot access other user's data",
        "ACCESS_DENIED_USER_MISMATCH",
        { userId, requestedUserId }
      );
    }
  }
}

// Combined validation function for handlers
export function validateAuthRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  businessValidator?: (validData: T) => void
): T {
  const parseResult = schema.safeParse(data);
  
  if (!parseResult.success) {
    const firstError = parseResult.error.issues[0];
    throw new ValidationError(
      firstError.message,
      firstError.path.join('.'),
      'TRANSPORT_VALIDATION_FAILED'
    );
  }

  const validData = parseResult.data;

  if (businessValidator) {
    businessValidator(validData);
  }

  return validData;
}