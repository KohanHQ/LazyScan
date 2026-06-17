import * as mangaRepo from "@/modules/manga/manga.repository";
import { Manga, CreateMangaInput, UpdateMangaInput, MangaResponse, ListMangaOptions } from "@/modules/manga/manga.model";
import { conflict, forbidden, notFound } from "@/shared/http/error";
import { UUID } from "@/shared/types/id";
import { assertUuid } from "@/shared/identity/uuid";
import { createMangaCoverUpload } from "@/modules/upload/upload.service";
import { createStorageService } from "@/shared/storage";
import { envSchema } from "@/env";
import { createConfig, staticConfig } from "@/config";
import { cacheGet, cacheSet, cacheInvalidate } from "@/shared/cache/redis";
import { AuthUser } from "@/middleware/auth";
import { logError, logWarn } from "@/shared/utility/logger";
import { withTransaction } from "@/shared/database/transaction";
import { invalidateMangaReaderCache } from "@/modules/reader/reader.service";

const env = envSchema.parse(process.env);
const config = createConfig(env);

// Manga metadata detail caches (behind ENABLE_CACHE). One key per id and per
// slug; both invalidated on update/delete. Read-heavy and rarely mutated.
// (POPULAR_CACHE_PREFIX stays near the popularity helpers it serves.)
const MANGA_DETAIL_PREFIX = "manga:detail:";
const MANGA_SLUG_PREFIX = "manga:slug:";

export function toResponse(manga: Manga): MangaResponse {
  return {
    id: manga.id,
    title: manga.title,
    slug: manga.slug,
    coverUrl: manga.coverUrl,
    description: manga.description,
    status: manga.status,
    totalChapters: manga.totalChapters,
    author: manga.author,
    artist: manga.artist,
    publisher: manga.publisher,
    publishedYear: manga.publishedYear,
    tags: manga.tags,
    createdByUserId: manga.createdByUserId,
    createdAt: manga.createdAt.toISOString(),
    updatedAt: manga.updatedAt.toISOString(),
  };
}

function canManageManga(manga: Manga, user: AuthUser): boolean {
  return user.role === "superuser" || manga.createdByUserId === user.id;
}

export async function assertCanManageMangaById(
  id: UUID,
  user: AuthUser
): Promise<Manga> {
  const mangaId = assertUuid(id, "manga id");
  const manga = await mangaRepo.findById(mangaId);

  if (!manga) {
    throw notFound("Manga not found", {
      code: "MANGA_NOT_FOUND",
    });
  }

  if (!canManageManga(manga, user)) {
    throw forbidden("You do not have permission to manage this manga", {
      code: "MANGA_MANAGEMENT_FORBIDDEN",
      details: { mangaId },
    });
  }

  return manga;
}

export async function getMangaById(id: UUID): Promise<MangaResponse> {
  const mangaId = assertUuid(id, "manga id");
  const cacheKey = `${MANGA_DETAIL_PREFIX}${mangaId}`;

  if (config.features.cache) {
    const cached = await cacheGet<MangaResponse>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const manga = await mangaRepo.findById(mangaId);

  if (!manga) {
    throw notFound("Manga not found", {
      code: "MANGA_NOT_FOUND",
    });
  }

  const response = toResponse(manga);
  if (config.features.cache) {
    void cacheSet(cacheKey, response, staticConfig.cache.mangaDetailTtlMs);
  }
  return response;
}

export async function getMangaBySlug(slug: string): Promise<MangaResponse> {
  const cacheKey = `${MANGA_SLUG_PREFIX}${slug}`;

  if (config.features.cache) {
    const cached = await cacheGet<MangaResponse>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const manga = await mangaRepo.findBySlug(slug);

  if (!manga) {
    throw notFound("Manga not found", {
      code: "MANGA_NOT_FOUND",
    });
  }

  const response = toResponse(manga);
  if (config.features.cache) {
    void cacheSet(cacheKey, response, staticConfig.cache.mangaDetailTtlMs);
  }
  return response;
}

export async function listManga(
  options: ListMangaOptions = {}
): Promise<MangaResponse[]> {
  const mangaList = await mangaRepo.findAll(options);
  return mangaList.map(toResponse);
}

// Distinct catalog tags for the library filter UI, alphabetical.
export async function listMangaTags(): Promise<string[]> {
  return mangaRepo.findAllTags();
}

// Cache key prefix for popularity results; the per-window/tz/limit key is
// appended. The trailing ":" lets cacheInvalidate clear every variant at once.
const POPULAR_CACHE_PREFIX = "manga:popular:";

export type PopularRange = keyof typeof staticConfig.popular.ranges;

export interface ListPopularOptions {
  limit?: number;
  // "week" | "month"; anything else falls back to the default range, matching
  // the lenient parsing the popular endpoint already applies to `limit`.
  range?: string;
  // IANA timezone name (e.g. "Asia/Jakarta"). Anchors the trailing window to the
  // client's local "today"; invalid/missing values fall back to the server TZ.
  tz?: string;
}

// True only for an IANA zone the runtime accepts; an unknown name makes the SQL
// `AT TIME ZONE` throw, so guard before it ever reaches a query.
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Returns the most-read manga over a trailing window (`week` or `month`). Results
// are identical for every caller sharing the same window+tz and recomputed often,
// so they are cached behind the `cache` feature flag (ENABLE_CACHE) for a short
// TTL; catalog mutations clear them. An empty array means no reads in the window
// yet — the caller falls back.
export async function listPopularManga(
  options: ListPopularOptions = {}
): Promise<MangaResponse[]> {
  const { ranges, defaultRange, defaultLimit, maxLimit } = staticConfig.popular;
  const range = (
    options.range && options.range in ranges ? options.range : defaultRange
  ) as PopularRange;
  const windowDays = ranges[range];
  const clamped = Math.min(
    Math.max(Math.trunc(options.limit ?? defaultLimit), 1),
    maxLimit
  );
  const tz =
    options.tz && isValidTimeZone(options.tz) ? options.tz : undefined;
  const cacheKey = `${POPULAR_CACHE_PREFIX}${windowDays}:${tz ?? "srv"}:${clamped}`;

  if (config.features.cache) {
    const cached = await cacheGet<MangaResponse[]>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const mangaList = await mangaRepo.findPopular(windowDays, clamped, tz);
  const response = mangaList.map(toResponse);

  if (config.features.cache) {
    // Fire-and-forget: caching is best-effort and must not delay the response.
    void cacheSet(cacheKey, response, staticConfig.cache.popularTtlMs);
  }
  return response;
}

// Manga ordered by their most recently published (ready) chapter — "what got new
// chapters", distinct from newest metadata (`sort=created_at`) and popularity
// (read counts). Lenient `limit` clamping mirrors listPopularManga. Not cached:
// one indexed aggregate at current scale; adopt the cache helpers only if
// profiling shows value.
export async function listRecentlyUpdatedManga(options: { limit?: number } = {}): Promise<MangaResponse[]> {
  const { defaultLimit, maxLimit } = staticConfig.recentUpdates;
  const clamped = Math.min(
    Math.max(Math.trunc(options.limit ?? defaultLimit), 1),
    maxLimit
  );
  const mangaList = await mangaRepo.findRecentlyUpdated(clamped);
  return mangaList.map(toResponse);
}

export async function createManga(input: CreateMangaInput, coverFile?: File, user?: AuthUser): Promise<MangaResponse> {
  const existingSlug = await mangaRepo.findBySlug(input.slug);
  if (existingSlug) {
    throw conflict("Manga with this slug already exists", {
      code: "MANGA_SLUG_EXISTS",
      details: { slug: input.slug },
    });
  }

  let coverUrl: string | undefined;

  if (coverFile && user) {
    const storage = createStorageService(config);
    
    const uploadResult = await createMangaCoverUpload(
      {
        userId: user.id,
        mangaSlug: input.slug,
        uploadType: "cover",
        filename: coverFile.name,
        contentType: coverFile.type,
        metadata: {
          mangaTitle: input.title,
        },
      },
      coverFile,
      storage
    );

    coverUrl = uploadResult.processedUrl || undefined;
  }

  const manga = await mangaRepo.create({
    ...input,
    coverUrl,
    createdByUserId: user?.id,
  });
  return toResponse(manga);
}

export async function updateManga(id: UUID, input: UpdateMangaInput, coverFile?: File, user?: AuthUser): Promise<MangaResponse> {
  const existing = user
    ? await assertCanManageMangaById(id, user)
    : await mangaRepo.findById(assertUuid(id, "manga id"));

  if (!existing) {
    throw notFound("Manga not found", {
      code: "MANGA_NOT_FOUND",
    });
  }

  const mangaId = existing.id;

  if (input.slug && input.slug !== existing.slug) {
    const slugExists = await mangaRepo.findBySlug(input.slug);
    if (slugExists) {
      throw conflict("Manga with this slug already exists", {
        code: "MANGA_SLUG_EXISTS",
        details: { slug: input.slug },
      });
    }
  }

  let coverUrl = existing.coverUrl ?? undefined;

  if (coverFile && user) {
    const storage = createStorageService(config);
    
    const mangaSlug = input.slug || existing.slug;
    
    const uploadResult = await createMangaCoverUpload(
      {
        userId: user.id,
        mangaSlug,
        uploadType: "cover",
        filename: coverFile.name,
        contentType: coverFile.type,
        metadata: {
          mangaTitle: input.title || existing.title,
        },
      },
      coverFile,
      storage
    );

    coverUrl = uploadResult.processedUrl || undefined;
  }

  // Update the row and (after a slug rename) re-point upload rows from the old
  // slug atomically: delete-time storage cleanup matches uploads by the manga's
  // current slug, so a partial failure that updated the row but not the uploads
  // would orphan them. Relink runs after the update so it never points uploads at
  // a slug the manga does not have; the transaction makes both succeed or neither.
  const manga = await withTransaction(async (tx) => {
    const updated = await mangaRepo.update(mangaId, { ...input, coverUrl }, tx);
    if (!updated) {
      throw notFound("Manga not found", {
        code: "MANGA_NOT_FOUND",
      });
    }

    if (input.slug && input.slug !== existing.slug) {
      await mangaRepo.relinkUploadsMangaSlug(existing.slug, updated.slug, tx);
    }

    return updated;
  });

  // Title/slug/cover changes may be reflected in a cached popular entry. Fire-and-
  // forget so the mutation never blocks on or fails from cache health.
  void cacheInvalidate(POPULAR_CACHE_PREFIX);
  // Drop the detail caches: by id, by the old slug, and (on rename) the new slug.
  void cacheInvalidate(`${MANGA_DETAIL_PREFIX}${mangaId}`);
  void cacheInvalidate(`${MANGA_SLUG_PREFIX}${existing.slug}`);
  if (manga.slug !== existing.slug) {
    void cacheInvalidate(`${MANGA_SLUG_PREFIX}${manga.slug}`);
  }

  return toResponse(manga);
}

async function deleteStorageKeysBestEffort(keys: string[]): Promise<void> {
  const uniqueKeys = [...new Set(keys)];
  if (!uniqueKeys.length) {
    return;
  }

  if (!config.storage.isConfigured) {
    logWarn("Skipped manga storage cleanup because storage is not configured", {
      keyCount: uniqueKeys.length,
    });
    return;
  }

  const storage = createStorageService(config);
  for (const key of uniqueKeys) {
    try {
      await storage.delete(key);
    } catch (error) {
      logError(
        "Manga storage cleanup failed",
        error instanceof Error ? error : new Error(String(error)),
        { key }
      );
    }
  }
}

export async function deleteManga(id: UUID, user: AuthUser): Promise<void> {
  const existing = await assertCanManageMangaById(id, user);
  const storageKeys = await mangaRepo.findStorageKeysById(existing.id);

  await withTransaction(async (tx) => {
    await mangaRepo.deleteUploadsByMangaSlug(existing.slug, tx);
    await mangaRepo.deleteById(existing.id, tx);
  });

  // Drop popularity cache so a deleted manga can't linger in the carousel (which
  // would 404 on click). Its manga_views rows are removed by ON DELETE CASCADE.
  // Fire-and-forget so the delete never blocks on or fails from cache health.
  void cacheInvalidate(POPULAR_CACHE_PREFIX);
  // Drop detail caches and the reader caches (its chapters cascade-deleted, so a
  // cached chapter list/detail would otherwise serve a deleted manga until TTL).
  void cacheInvalidate(`${MANGA_DETAIL_PREFIX}${existing.id}`);
  void cacheInvalidate(`${MANGA_SLUG_PREFIX}${existing.slug}`);
  void invalidateMangaReaderCache(existing.id);

  await deleteStorageKeysBestEffort(storageKeys);
}
