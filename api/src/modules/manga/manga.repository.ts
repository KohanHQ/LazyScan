import { getDbClient } from "@/shared/database/client";
import type { TransactionClient } from "@/shared/database/transaction";
import { Manga, CreateMangaInput, UpdateMangaInput, ListMangaOptions } from "@/modules/manga/manga.model";
import { UUID } from "@/shared/types/id";

const db = getDbClient();

export function mapRow(row: any): Manga {
  return {
    id: row.id as UUID,
    title: row.title,
    slug: row.slug,
    coverUrl: row.cover_url,
    description: row.description,
    status: row.status,
    totalChapters: row.total_chapters,
    author: row.author,
    artist: row.artist,
    publisher: row.publisher,
    publishedYear: row.published_year,
    tags: row.tags ?? [],
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function findById(id: UUID): Promise<Manga | null> {
  const rows = await db`
    SELECT id, title, slug, cover_url, description, status, total_chapters, author, artist, publisher, published_year, tags, created_by_user_id, created_at, updated_at
    FROM manga
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

export async function findBySlug(slug: string): Promise<Manga | null> {
  const rows = await db`
    SELECT id, title, slug, cover_url, description, status, total_chapters, author, artist, publisher, published_year, tags, created_by_user_id, created_at, updated_at
    FROM manga
    WHERE slug = ${slug}
    LIMIT 1
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

// Escapes LIKE/ILIKE wildcards so a user query is matched literally (default
// Postgres escape character is backslash).
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function findAll(options: ListMangaOptions = {}): Promise<Manga[]> {
  const {
    limit = 20,
    offset = 0,
    search,
    status,
    publishedYear,
    tag,
    sort = "created_at",
    order = "desc",
    author,
    artist,
    publisher,
    yearFrom,
    yearTo,
  } = options;

  // Compose optional filters as AND-joined SQL fragments. An empty list yields
  // no WHERE clause, preserving the unfiltered list behavior.
  const conditions = [];
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    // A bare 4-digit query also matches published_year, so "2026" finds that
    // year's titles (the metadata search is otherwise text-only).
    const yearMatch = /^\d{4}$/.test(search) ? Number(search) : null;
    conditions.push(
      yearMatch !== null
        ? db`(title ILIKE ${pattern} OR slug ILIKE ${pattern} OR author ILIKE ${pattern} OR artist ILIKE ${pattern} OR publisher ILIKE ${pattern} OR published_year = ${yearMatch})`
        : db`(title ILIKE ${pattern} OR slug ILIKE ${pattern} OR author ILIKE ${pattern} OR artist ILIKE ${pattern} OR publisher ILIKE ${pattern})`
    );
  }
  if (status) {
    conditions.push(db`status = ${status}`);
  }
  if (publishedYear !== undefined) {
    conditions.push(db`published_year = ${publishedYear}`);
  }
  if (tag) {
    // Containment over the normalized lowercase tags array; served by the GIN
    // index from migration 019.
    conditions.push(db`tags @> ARRAY[${tag}]::text[]`);
  }
  if (author) {
    conditions.push(db`author ILIKE ${`%${escapeLike(author)}%`}`);
  }
  if (artist) {
    conditions.push(db`artist ILIKE ${`%${escapeLike(artist)}%`}`);
  }
  if (publisher) {
    conditions.push(db`publisher ILIKE ${`%${escapeLike(publisher)}%`}`);
  }
  if (yearFrom !== undefined && yearTo !== undefined) {
    conditions.push(db`published_year >= ${yearFrom} AND published_year <= ${yearTo}`);
  }
  const where = conditions.length
    ? conditions.reduce((acc, condition) => db`${acc} AND ${condition}`)
    : null;

  // Sort column is a closed union mapped to identifiers via db(); direction is a
  // fixed fragment. Neither path interpolates raw user strings.
  const direction = order === "asc" ? db`ASC` : db`DESC`;

  const rows = await db`
    SELECT id, title, slug, cover_url, description, status, total_chapters, author, artist, publisher, published_year, tags, created_by_user_id, created_at, updated_at
    FROM manga
    ${where ? db`WHERE ${where}` : db``}
    ORDER BY ${db(sort)} ${direction} NULLS LAST
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return rows.map(mapRow);
}

// Increments today's view bucket for a manga (one read = +1). Inserts the day's
// row on first read, then accumulates. Callers treat this as best-effort: it runs
// off the hot reader path and must not break a read if it fails.
export async function recordMangaView(mangaId: UUID): Promise<void> {
  await db`
    INSERT INTO manga_views (manga_id, view_date, views)
    VALUES (${mangaId}, CURRENT_DATE, 1)
    ON CONFLICT (manga_id, view_date)
    DO UPDATE SET views = manga_views.views + 1
  `;
}

// Ranks manga by total reads over a trailing window (inclusive of today). An
// INNER JOIN means only manga with at least one read in the window appear, so an
// empty result is the natural "no data yet" signal for the caller's fallback.
// `created_at DESC` breaks count ties toward newer titles.
//
// `tz` (a validated IANA name) anchors "today" to the client's local date via
// `now() AT TIME ZONE`, so the trailing window edge follows the caller's wall
// clock; without it the anchor stays `CURRENT_DATE` (DB server TZ) — byte-for-byte
// the original query. Note the buckets themselves are stored at server-TZ day
// granularity (see manga_views), so this aligns the window edge, not bucketing.
export async function findPopular(
  windowDays: number,
  limit: number,
  tz?: string
): Promise<Manga[]> {
  const anchor = tz ? db`(now() AT TIME ZONE ${tz})::date` : db`CURRENT_DATE`;
  const rows = await db`
    SELECT m.id, m.title, m.slug, m.cover_url, m.description, m.status, m.total_chapters, m.author, m.artist, m.publisher, m.published_year, m.tags, m.created_by_user_id, m.created_at, m.updated_at
    FROM manga m
    JOIN manga_views v ON v.manga_id = m.id
    WHERE v.view_date >= ${anchor} - (${windowDays}::int - 1)
    GROUP BY m.id
    ORDER BY SUM(v.views) DESC, m.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapRow);
}

// Manga ordered by their latest published chapter, newest first. The INNER JOIN
// means only manga with at least one published (ready) chapter appear, so an
// empty result is the natural "nothing published yet" signal. `published_at` is
// the API-owned publish time and is stable against later chapter edits, so it
// replaces the old `updated_at` proxy (which chapter editing would now skew).
export async function findRecentlyUpdated(limit: number): Promise<Manga[]> {
  const rows = await db`
    SELECT m.id, m.title, m.slug, m.cover_url, m.description, m.status, m.total_chapters, m.author, m.artist, m.publisher, m.published_year, m.tags, m.created_by_user_id, m.created_at, m.updated_at
    FROM manga m
    JOIN chapters c ON c.manga_id = m.id AND c.status = 'ready' AND c.published_at IS NOT NULL
    GROUP BY m.id
    ORDER BY MAX(c.published_at) DESC, m.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapRow);
}

export async function create(
  input: CreateMangaInput,
  tx?: TransactionClient
): Promise<Manga> {
  const client = tx ?? db;

  const rows = await client`
    INSERT INTO manga (title, slug, cover_url, description, status, total_chapters, author, artist, publisher, published_year, tags, created_by_user_id)
    VALUES (
      ${input.title},
      ${input.slug},
      ${input.coverUrl ?? null},
      ${input.description ?? null},
      ${input.status ?? "ongoing"},
      ${input.totalChapters ?? null},
      ${input.author ?? null},
      ${input.artist ?? null},
      ${input.publisher ?? null},
      ${input.publishedYear ?? null},
      ${input.tags ?? []}::text[],
      ${input.createdByUserId ?? null}
    )
    RETURNING id, title, slug, cover_url, description, status, total_chapters, author, artist, publisher, published_year, tags, created_by_user_id, created_at, updated_at
  `;
  return mapRow(rows[0]);
}

export async function update(
  id: UUID,
  input: UpdateMangaInput,
  tx?: TransactionClient
): Promise<Manga | null> {
  const client = tx ?? db;
  // Build the SET list from provided keys only: a key left `undefined` keeps the
  // column unchanged, while an explicit `null` clears it to SQL NULL. This is why
  // it no longer uses COALESCE (which could never write a NULL).
  const fields: Record<string, string | number | string[] | null> = {};
  if (input.title !== undefined) fields.title = input.title;
  if (input.slug !== undefined) fields.slug = input.slug;
  if (input.coverUrl !== undefined) fields.cover_url = input.coverUrl;
  if (input.description !== undefined) fields.description = input.description;
  if (input.status !== undefined) fields.status = input.status;
  if (input.totalChapters !== undefined) fields.total_chapters = input.totalChapters;
  if (input.author !== undefined) fields.author = input.author;
  if (input.artist !== undefined) fields.artist = input.artist;
  if (input.publisher !== undefined) fields.publisher = input.publisher;
  if (input.publishedYear !== undefined) fields.published_year = input.publishedYear;
  // The column is NOT NULL, so the "clear" null maps to the empty array.
  if (input.tags !== undefined) fields.tags = input.tags ?? [];

  // `db(object)` after SET renders `"col" = value` assignments; guard the empty
  // case since postgres.js rejects an empty object helper.
  const rows = Object.keys(fields).length
    ? await client`
        UPDATE manga
        SET ${client(fields)}, updated_at = now()
        WHERE id = ${id}
        RETURNING id, title, slug, cover_url, description, status, total_chapters, author, artist, publisher, published_year, tags, created_by_user_id, created_at, updated_at
      `
    : await client`
        UPDATE manga
        SET updated_at = now()
        WHERE id = ${id}
        RETURNING id, title, slug, cover_url, description, status, total_chapters, author, artist, publisher, published_year, tags, created_by_user_id, created_at, updated_at
      `;

  return rows.length ? mapRow(rows[0]) : null;
}

// Distinct tags across the catalog, alphabetical, for the library filter UI.
// A sequential scan over the tags arrays is fine at current scale.
export async function findAllTags(): Promise<string[]> {
  const rows = await db<{ tag: string }[]>`
    SELECT DISTINCT unnest(tags) AS tag
    FROM manga
    ORDER BY tag
  `;
  return rows.map((row) => row.tag);
}

export async function findStorageKeysById(id: UUID): Promise<string[]> {
  const rows = await db`
    WITH target_manga AS (
      SELECT id, slug
      FROM manga
      WHERE id = ${id}
      LIMIT 1
    )
    SELECT cp.original_key AS storage_key
    FROM chapter_pages cp
    JOIN chapters c ON c.id = cp.chapter_id
    JOIN target_manga m ON m.id = c.manga_id
    WHERE cp.original_key IS NOT NULL

    UNION

    SELECT cp.storage_key AS storage_key
    FROM chapter_pages cp
    JOIN chapters c ON c.id = cp.chapter_id
    JOIN target_manga m ON m.id = c.manga_id
    WHERE cp.storage_key IS NOT NULL

    UNION

    SELECT u.original_key AS storage_key
    FROM uploads u
    JOIN target_manga m ON u.metadata->>'mangaSlug' = m.slug
    WHERE u.original_key IS NOT NULL

    UNION

    SELECT u.processed_key AS storage_key
    FROM uploads u
    JOIN target_manga m ON u.metadata->>'mangaSlug' = m.slug
    WHERE u.processed_key IS NOT NULL
  `;

  return rows
    .map((row) => row.storage_key)
    .filter((key): key is string => typeof key === "string" && key.length > 0);
}

export async function deleteUploadsByMangaSlug(
  slug: string,
  tx?: TransactionClient
): Promise<void> {
  const client = tx ?? db;
  await client`
    DELETE FROM uploads
    WHERE metadata->>'mangaSlug' = ${slug}
  `;
}

// Re-point upload rows recorded under an old manga slug to the new slug. Storage
// cleanup and upload deletion match uploads by the manga's current slug, so after
// a slug rename the previous slug's rows would be missed; this keeps them linked.
export async function relinkUploadsMangaSlug(
  oldSlug: string,
  newSlug: string,
  tx?: TransactionClient
): Promise<void> {
  const client = tx ?? db;
  await client`
    UPDATE uploads
    SET metadata = jsonb_set(metadata, '{mangaSlug}', to_jsonb(${newSlug}::text))
    WHERE metadata->>'mangaSlug' = ${oldSlug}
  `;
}

export async function deleteById(id: UUID, tx?: TransactionClient): Promise<boolean> {
  const client = tx ?? db;
  const result = await client`
    DELETE FROM manga
    WHERE id = ${id}
  `;
  return result.count > 0;
}
