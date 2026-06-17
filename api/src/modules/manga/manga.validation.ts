import { z } from "zod";
import { ValidationError, BusinessRuleError } from "@/shared/utility/validation";
import { badRequest } from "@/shared/http/error";
import type { MangaStatus, MangaSort, MangaOrder } from "@/modules/manga/manga.model";

const slugSchema = z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const statusSchema = z.enum(["ongoing", "completed", "hiatus", "cancelled"]);
const totalChaptersSchema = z.preprocess((value) => {
  if (value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  return value;
}, z.number().int().positive().optional());

// Published year arrives as a number (JSON) or string (multipart create), so it
// mirrors totalChaptersSchema's coercion. Bounds match the DB sanity CHECK in
// migration 012; the upper bound tracks the current year so future-dated entries
// fail validation.
const MAX_PUBLISHED_YEAR = new Date().getFullYear() + 1;
const publishedYearSchema = z.preprocess((value) => {
  if (value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  return value;
}, z.number().int().min(1000).max(MAX_PUBLISHED_YEAR).optional());

const authorTextSchema = z.string().max(200).optional();

// Tags arrive as a JSON string array or, on multipart create, a single
// comma-separated string (mirroring publishedYear's string coercion). They are
// normalized — trimmed, lowercased, inner whitespace collapsed, deduped, empties
// dropped — before the count/length bounds run, so " Sci-Fi " and "sci-fi"
// count once and a trailing comma never fails validation.
const TAG_MAX_LENGTH = 30;
const TAGS_MAX_COUNT = 10;

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (tag.length > 0) {
      seen.add(tag);
    }
  }
  return [...seen];
}

function coerceTags(value: unknown): unknown {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "string") {
    return value.split(",");
  }
  return value;
}

// Update variant: `null` (or an emptied form field) clears the tags.
function coerceNullableTags(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    return value.split(",");
  }
  return value;
}

const tagsArraySchema = z
  .array(z.string().max(200))
  .transform(normalizeTags)
  .refine((tags) => tags.length <= TAGS_MAX_COUNT, {
    message: `At most ${TAGS_MAX_COUNT} tags are allowed`,
  })
  .refine((tags) => tags.every((tag) => tag.length <= TAG_MAX_LENGTH), {
    message: `Each tag must be at most ${TAG_MAX_LENGTH} characters`,
  });

const tagsSchema = z.preprocess(coerceTags, tagsArraySchema.optional());
const updateTagsSchema = z.preprocess(
  coerceNullableTags,
  tagsArraySchema.nullable().optional()
);

// Update coercion: `undefined` keeps the field unchanged, while `null` (or an
// empty string from a form) clears it to NULL. Lets PATCH erase optional metadata
// instead of only ever setting it.
function coerceNullableInt(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    return Number(value);
  }
  return value;
}

const updateDescriptionSchema = z.string().max(5000).nullable().optional();
const updateTextSchema = z.string().max(200).nullable().optional();
const updateTotalChaptersSchema = z.preprocess(
  coerceNullableInt,
  z.number().int().positive().nullable().optional()
);
const updatePublishedYearSchema = z.preprocess(
  coerceNullableInt,
  z.number().int().min(1000).max(MAX_PUBLISHED_YEAR).nullable().optional()
);

const mangaTransportSchemas = {
  create: z.object({
    title: z.string().min(1).max(500),
    slug: slugSchema,
    description: z.string().max(5000).optional(),
    status: statusSchema.optional(),
    totalChapters: totalChaptersSchema,
    author: authorTextSchema,
    artist: authorTextSchema,
    publisher: authorTextSchema,
    publishedYear: publishedYearSchema,
    tags: tagsSchema,
  }).strict(),

  update: z.object({
    title: z.string().min(1).max(500).optional(),
    slug: slugSchema.optional(),
    description: updateDescriptionSchema,
    status: statusSchema.optional(),
    totalChapters: updateTotalChaptersSchema,
    author: updateTextSchema,
    artist: updateTextSchema,
    publisher: updateTextSchema,
    publishedYear: updatePublishedYearSchema,
    tags: updateTagsSchema,
  }).strict(),
};

export { mangaTransportSchemas };

export class MangaValidator {
  static validateCreate(input: { title: string; slug: string }): void {
    MangaValidator.validateSlug(input.slug);
  }

  static validateUpdate(input: { slug?: string }): void {
    if (input.slug) {
      MangaValidator.validateSlug(input.slug);
    }
  }

  static validateSlug(slug: string): void {
    if (slug.startsWith("-") || slug.endsWith("-")) {
      throw new BusinessRuleError(
        "Slug cannot start or end with a hyphen",
        "SLUG_INVALID_FORMAT",
        { slug }
      );
    }
  }

  static generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }
}

// GET /manga list-query filters. Parsed leniently for absent/empty values and
// strictly (400) for present-but-invalid values, matching getLimitOffsetFromQuery.
const MANGA_STATUS_VALUES = [
  "ongoing",
  "completed",
  "hiatus",
  "cancelled",
] as const;
const MANGA_SORT_VALUES = [
  "created_at",
  "updated_at",
  "title",
  "published_year",
] as const;
const MANGA_ORDER_VALUES = ["asc", "desc"] as const;

export function parseMangaStatusFilter(value: unknown): MangaStatus | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (
    typeof value === "string" &&
    (MANGA_STATUS_VALUES as readonly string[]).includes(value)
  ) {
    return value as MangaStatus;
  }
  throw badRequest(`status must be one of: ${MANGA_STATUS_VALUES.join(", ")}`, {
    code: "INVALID_MANGA_QUERY",
    details: { field: "status" },
  });
}

// Optional published-year equality filter for GET /manga. Reuses the same
// coercion/bounds as create/update so an out-of-range year is rejected uniformly.
export function parseMangaPublishedYearFilter(value: unknown): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const result = publishedYearSchema.safeParse(value);
  if (!result.success || typeof result.data !== "number") {
    throw badRequest(
      `publishedYear must be an integer between 1000 and ${MAX_PUBLISHED_YEAR}`,
      { code: "INVALID_MANGA_QUERY", details: { field: "publishedYear" } }
    );
  }
  return result.data;
}

// Optional single-tag containment filter for GET /manga. Normalized like stored
// tags so the comparison matches; present-but-unusable values are rejected.
export function parseMangaTagFilter(value: unknown): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "string") {
    const [tag] = normalizeTags([value]);
    if (tag && tag.length <= TAG_MAX_LENGTH) {
      return tag;
    }
  }
  throw badRequest(
    `tag must be a non-empty string of at most ${TAG_MAX_LENGTH} characters`,
    { code: "INVALID_MANGA_QUERY", details: { field: "tag" } }
  );
}

// Optional text filter for author, artist, or publisher. Partial match via ILIKE.
export function parseMangaTextFilter(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, 200);
  }
  throw badRequest(
    `${fieldName} must be a non-empty string of at most 200 characters`,
    { code: "INVALID_MANGA_QUERY", details: { field: fieldName } }
  );
}

// Optional year range filter for GET /manga. Accepts a single year or a range
// in the format "YYYY-YYYY" (e.g., "2020-2024"). Returns [from, to] or undefined.
export function parseMangaYearRangeFilter(value: unknown): { from: number; to: number } | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw badRequest(
      `year must be a single year (YYYY) or a range (YYYY-YYYY)`,
      { code: "INVALID_MANGA_QUERY", details: { field: "year" } }
    );
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const invalid = () =>
    badRequest(
      `year must be a single year (YYYY) or a range (YYYY-YYYY) between 1000 and ${MAX_PUBLISHED_YEAR}`,
      { code: "INVALID_MANGA_QUERY", details: { field: "year" } }
    );

  // Each part must be plain digits. Number() alone would silently accept
  // scientific ("2e3" -> 2000), hex ("0x7e4" -> 2020), and trailing-garbage
  // ("2020abc" via parseInt) forms, letting nonsense years through.
  const parseYear = (raw: string): number => {
    const s = raw.trim();
    if (!/^\d{1,4}$/.test(s)) throw invalid();
    const year = Number(s);
    if (year < 1000 || year > MAX_PUBLISHED_YEAR) throw invalid();
    return year;
  };

  const parts = trimmed.split("-");
  if (parts.length === 1) {
    const year = parseYear(parts[0]);
    return { from: year, to: year };
  }
  if (parts.length === 2) {
    const from = parseYear(parts[0]);
    const to = parseYear(parts[1]);
    if (from > to) throw invalid();
    return { from, to };
  }
  throw invalid();
}

export function parseMangaSort(value: unknown): MangaSort {
  if (value === undefined || value === "") {
    return "created_at";
  }
  if (
    typeof value === "string" &&
    (MANGA_SORT_VALUES as readonly string[]).includes(value)
  ) {
    return value as MangaSort;
  }
  throw badRequest(`sort must be one of: ${MANGA_SORT_VALUES.join(", ")}`, {
    code: "INVALID_MANGA_QUERY",
    details: { field: "sort" },
  });
}

export function parseMangaOrder(value: unknown): MangaOrder {
  if (value === undefined || value === "") {
    return "desc";
  }
  if (
    typeof value === "string" &&
    (MANGA_ORDER_VALUES as readonly string[]).includes(value)
  ) {
    return value as MangaOrder;
  }
  throw badRequest(`order must be one of: ${MANGA_ORDER_VALUES.join(", ")}`, {
    code: "INVALID_MANGA_QUERY",
    details: { field: "order" },
  });
}

export function validateMangaRequest<T>(
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
