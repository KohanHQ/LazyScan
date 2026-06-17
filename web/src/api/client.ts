export type ApiSuccessResponse<T> = {
  status: number;
  success: true;
  data: T;
};

export type ApiErrorResponse = {
  status: number;
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export class ApiClientError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(response: ApiErrorResponse) {
    super(response.error.message);
    this.name = "ApiClientError";
    this.code = response.error.code;
    this.status = response.status;
    this.details = response.error.details;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown>;
};

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  let body = options.body;

  if (body && !(body instanceof FormData) && !(body instanceof Blob)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(path, {
    ...options,
    body: body as BodyInit | undefined,
    headers,
    credentials: "include",
  });

  // Read the body exactly once. Reading it twice (e.g. json() then text())
  // throws "Body has already been consumed", which masks the real error when a
  // response is not JSON (e.g. an unproxied path returning the SPA HTML).
  const raw = await response.text();

  if (!raw) {
    throw new ApiClientError({
      status: response.status,
      success: false,
      error: {
        code: "EMPTY_RESPONSE",
        message: `Empty response (HTTP ${response.status})`,
      },
    });
  }

  let payload: ApiResponse<T>;
  try {
    payload = JSON.parse(raw) as ApiResponse<T>;
  } catch (error) {
    throw new ApiClientError({
      status: response.status,
      success: false,
      error: {
        code: "INVALID_RESPONSE",
        message: `Failed to parse response (HTTP ${response.status})`,
        details: {
          body: raw.slice(0, 300),
          originalError: error instanceof Error ? error.message : String(error),
        },
      },
    });
  }

  if (!payload.success) {
    throw new ApiClientError(payload);
  }

  return payload.data;
}
