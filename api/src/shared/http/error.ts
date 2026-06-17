import {
  BusinessRuleError,
  ValidationError,
} from "@/shared/utility/validation";

export type ErrorCode = string;

export type ErrorDetails = Record<string, unknown>;

export type NormalizedError = {
  code: ErrorCode;
  message: string;
  status: number;
  details?: ErrorDetails;
};

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: ErrorDetails;

  constructor(input: {
    code: ErrorCode;
    message: string;
    status: number;
    details?: ErrorDetails;
  }) {
    super(input.message);
    this.name = "AppError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

function normalizeElysiaValidationError(err: Error): NormalizedError | null {
  try {
    const parsed = JSON.parse(err.message) as {
      type?: string;
      on?: string;
      property?: string;
      message?: string;
      summary?: string;
      errors?: unknown;
    };

    if (parsed.type !== "validation") {
      return null;
    }

    return {
      code: "VALIDATION_ERROR",
      message: parsed.summary ?? parsed.message ?? "Validation failed",
      status: 400,
      details: {
        on: parsed.on,
        property: parsed.property,
        errors: parsed.errors,
      },
    };
  } catch {
    return null;
  }
}

export function normalizeError(err: unknown): NormalizedError {
  if (err instanceof AppError) {
    return {
      code: err.code,
      message: err.message,
      status: err.status,
      details: err.details,
    };
  }

  if (err instanceof ValidationError) {
    return {
      code: err.code,
      message: err.message,
      status: 400,
      details: { field: err.field },
    };
  }

  if (err instanceof BusinessRuleError) {
    return {
      code: err.rule,
      message: err.message,
      status: 400,
      details: err.context,
    };
  }

  if (err instanceof Error) {
    const validationError = normalizeElysiaValidationError(err);
    if (validationError) {
      return validationError;
    }

    return {
      code: "INTERNAL_ERROR",
      message: err.message || "Internal error",
      status: 500,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "Internal error",
    status: 500,
  };
}

export function badRequest(
  message = "Bad request",
  input?: { code?: ErrorCode; details?: ErrorDetails },
): AppError {
  return new AppError({
    code: input?.code ?? "BAD_REQUEST",
    message,
    status: 400,
    details: input?.details,
  });
}

export function unauthorized(
  message = "Unauthorized",
  input?: { code?: ErrorCode; details?: ErrorDetails },
): AppError {
  return new AppError({
    code: input?.code ?? "UNAUTHORIZED",
    message,
    status: 401,
    details: input?.details,
  });
}

export function forbidden(
  message = "Forbidden",
  input?: { code?: ErrorCode; details?: ErrorDetails },
): AppError {
  return new AppError({
    code: input?.code ?? "FORBIDDEN",
    message,
    status: 403,
    details: input?.details,
  });
}

export function notFound(
  message = "Not found",
  input?: { code?: ErrorCode; details?: ErrorDetails },
): AppError {
  return new AppError({
    code: input?.code ?? "NOT_FOUND",
    message,
    status: 404,
    details: input?.details,
  });
}

export function conflict(
  message = "Conflict",
  input?: { code?: ErrorCode; details?: ErrorDetails },
): AppError {
  return new AppError({
    code: input?.code ?? "CONFLICT",
    message,
    status: 409,
    details: input?.details,
  });
}

export function insufficientStorage(
  message = "Insufficient storage",
  input?: { code?: ErrorCode; details?: ErrorDetails },
): AppError {
  return new AppError({
    code: input?.code ?? "INSUFFICIENT_STORAGE",
    message,
    status: 507,
    details: input?.details,
  });
}
