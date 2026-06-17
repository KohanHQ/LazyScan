import { t } from "elysia";
import { staticConfig } from "@/config";
import { badRequest } from "@/shared/http/error";

export type PaginationQuery = {
  page?: number;
  pageSize?: number;
};

export type PaginationParams = {
  page: number;
  pageSize: number;
  offset: number;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

export type LimitOffsetQuery = {
  limit?: number | string;
  offset?: number | string;
};

export type LimitOffsetParams = {
  limit: number;
  offset: number;
};

export type PaginatedData<T> = {
  items: T[];
  pagination: PaginationMeta;
};

export const paginationQuerySchema = t.Object({
  page: t.Optional(t.Number({ minimum: 1, default: 1 })),
  pageSize: t.Optional(
    t.Number({
      minimum: 1,
      maximum: staticConfig.pagination.maxPageSize,
      default: staticConfig.pagination.defaultPageSize,
    }),
  ),
});

export function parsePagination(query: PaginationQuery): PaginationParams {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(
    Math.max(1, query.pageSize ?? staticConfig.pagination.defaultPageSize),
    staticConfig.pagination.maxPageSize,
  );
  const offset = (page - 1) * pageSize;

  return {
    page,
    pageSize,
    offset,
  };
}

export function createPaginationMeta(
  total: number,
  params: PaginationParams,
): PaginationMeta {
  const totalPages = Math.ceil(total / params.pageSize);

  return {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages,
    hasNext: params.page < totalPages,
    hasPrevious: params.page > 1,
  };
}

export function createPaginatedResponse<T>(
  items: T[],
  total: number,
  params: PaginationParams,
): PaginatedData<T> {
  return {
    items,
    pagination: createPaginationMeta(total, params),
  };
}

export function getPaginationFromQuery(query: {
  page?: number | string;
  pageSize?: number | string;
}): PaginationParams {
  return parsePagination({
    page: typeof query.page === "string" ? Number(query.page) : query.page,
    pageSize:
      typeof query.pageSize === "string"
        ? Number(query.pageSize)
        : query.pageSize,
  });
}

function parseIntegerQueryValue(
  value: number | string | undefined,
  field: "limit" | "offset",
  defaultValue: number,
): number {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isInteger(parsed)) {
    throw badRequest(`${field} must be an integer`, {
      code: "INVALID_PAGINATION",
      details: { field },
    });
  }

  return parsed;
}

export function getLimitOffsetFromQuery(
  query: LimitOffsetQuery,
): LimitOffsetParams {
  const limit = parseIntegerQueryValue(
    query.limit,
    "limit",
    staticConfig.pagination.defaultPageSize,
  );
  const offset = parseIntegerQueryValue(query.offset, "offset", 0);

  if (limit < 1 || limit > staticConfig.pagination.maxPageSize) {
    throw badRequest(
      `limit must be between 1 and ${staticConfig.pagination.maxPageSize}`,
      {
        code: "INVALID_PAGINATION",
        details: {
          field: "limit",
          min: 1,
          max: staticConfig.pagination.maxPageSize,
        },
      },
    );
  }

  if (offset < 0) {
    throw badRequest("offset must be greater than or equal to 0", {
      code: "INVALID_PAGINATION",
      details: { field: "offset", min: 0 },
    });
  }

  return { limit, offset };
}
