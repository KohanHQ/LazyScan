import type { NormalizedError } from "@/shared/http/error";
import { normalizeError } from "@/shared/http/error";

export type ApiMeta = {
  requestId?: string;
};

export type ApiSuccessResponse<T> = {
  status: number;
  success: true;
  data: T;
  meta?: ApiMeta;
};

export type ApiErrorResponse = {
  status: number;
  success: false;
  error: Omit<NormalizedError, "status">;
  meta?: ApiMeta;
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export function success<T>(
  data: T,
  meta?: ApiMeta,
  status = 200,
): ApiSuccessResponse<T> {
  return {
    status,
    success: true,
    data,
    meta,
  };
}

export function fail(err: unknown, meta?: ApiMeta): ApiErrorResponse {
  const normalized = normalizeError(err);
  return {
    status: normalized.status,
    success: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
    },
    meta,
  };
}

export function httpStatusFromError(err: unknown): number {
  return normalizeError(err).status;
}
