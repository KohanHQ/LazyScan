import { z } from "zod";

export const commonSchemas = {
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(128),
  uuid: z.string().uuid(),
  displayId: z.string().min(1).max(50),
  nonEmptyString: z.string().min(1).trim(),
  positiveInt: z.number().int().positive(),
  timestamp: z.string().datetime(),
};

export function validateEmail(email: string): boolean {
  return commonSchemas.email.safeParse(email).success;
}

export function validatePassword(password: string): boolean {
  return commonSchemas.password.safeParse(password).success;
}

export function createTransportSchema<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public code: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class BusinessRuleError extends Error {
  constructor(
    message: string,
    public rule: string,
    public context?: Record<string, any>,
  ) {
    super(message);
    this.name = "BusinessRuleError";
  }
}