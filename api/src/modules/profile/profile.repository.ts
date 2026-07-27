import { getDbClient } from "@/shared/database/client";
import type { TransactionClient } from "@/shared/database/transaction";
import { Profile, CreateProfileInput, UpdateProfileInput } from "@/modules/profile/profile.model";
import { mapRow as mapMangaRow } from "@/modules/manga/manga.repository";
import type { Manga } from "@/modules/manga/manga.model";
import type { UserRole } from "@/modules/auth/auth.model";
import { UUID } from "@/shared/types/id";

const db = getDbClient();

const PROFILE_COLUMNS = `user_id, username, display_name, bio, avatar_url, profile_visibility, shelf_visibility, created_at, updated_at`;

function mapRow(row: any): Profile {
  return {
    userId: row.user_id as UUID,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    profileVisibility: row.profile_visibility,
    shelfVisibility: row.shelf_visibility,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function findByUserId(userId: UUID): Promise<Profile | null> {
  const rows = await db`
    SELECT user_id, username, display_name, bio, avatar_url, profile_visibility, shelf_visibility, created_at, updated_at
    FROM profiles
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

export async function findByUsername(username: string): Promise<Profile | null> {
  const rows = await db`
    SELECT user_id, username, display_name, bio, avatar_url, profile_visibility, shelf_visibility, created_at, updated_at
    FROM profiles
    WHERE username = ${username}
    LIMIT 1
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

export async function create(
  input: CreateProfileInput,
  tx?: TransactionClient
): Promise<Profile> {
  const client = tx ?? db;

  // Visibility columns are left to their schema defaults (profile public, shelf
  // private — see migration 018) at creation time.
  const rows = await client`
    INSERT INTO profiles (user_id, username, display_name, avatar_url)
    VALUES (
      ${input.userId},
      ${input.username ?? null},
      ${input.displayName ?? null},
      ${input.avatarUrl ?? null}
    )
    RETURNING user_id, username, display_name, bio, avatar_url, profile_visibility, shelf_visibility, created_at, updated_at
  `;
  return mapRow(rows[0]);
}

export async function update(userId: UUID, input: UpdateProfileInput): Promise<Profile | null> {
  // Build SET assignments only for provided keys so an explicit null clears a
  // field while an omitted key leaves it unchanged (username is set-only;
  // avatar_url is no longer writable here — see profile.validation).
  const assignments = [];
  if (input.username !== undefined && input.username !== null) {
    assignments.push(db`username = ${input.username}`);
  }
  if (input.displayName !== undefined) {
    assignments.push(db`display_name = ${input.displayName}`);
  }
  if (input.bio !== undefined) {
    assignments.push(db`bio = ${input.bio}`);
  }
  if (input.profileVisibility !== undefined) {
    assignments.push(db`profile_visibility = ${input.profileVisibility}`);
  }
  if (input.shelfVisibility !== undefined) {
    assignments.push(db`shelf_visibility = ${input.shelfVisibility}`);
  }

  if (assignments.length === 0) {
    return findByUserId(userId);
  }

  assignments.push(db`updated_at = now()`);
  const setClause = assignments.reduce((acc, frag) => db`${acc}, ${frag}`);

  const rows = await db`
    UPDATE profiles
    SET ${setClause}
    WHERE user_id = ${userId}
    RETURNING user_id, username, display_name, bio, avatar_url, profile_visibility, shelf_visibility, created_at, updated_at
  `;

  return rows.length ? mapRow(rows[0]) : null;
}

// Owner avatar write path. Deliberately separate from update(): PATCH
// /profile/me keeps rejecting avatarUrl — only the owner-gated avatar upload
// flow (upload.service.createAvatarUpload) lands here.
export async function setAvatarUrl(
  userId: UUID,
  avatarUrl: string
): Promise<void> {
  await db`
    UPDATE profiles
    SET avatar_url = ${avatarUrl}, updated_at = now()
    WHERE user_id = ${userId}
  `;
}

export async function deleteByUserId(userId: UUID): Promise<boolean> {
  const result = await db`
    DELETE FROM profiles
    WHERE user_id = ${userId}
  `;
  return result.count > 0;
}

// --- Read-only reporting --------------------------------------------------
//
// Reading stats and the uploader badge are derived per request from existing
// reader/chapter tables (no dedicated stats or badge storage). These aggregate
// reads stay in the profile module the same way the reader module reaches into
// chapter-owned tables for its own read-side work.

// Distinct manga the user has read at least one chapter of.
export async function countReadTitles(userId: UUID): Promise<number> {
  const rows = await db<{ count: number }[]>`
    SELECT count(DISTINCT manga_id)::int AS count
    FROM chapter_reads
    WHERE user_id = ${userId}
  `;
  return rows[0]?.count ?? 0;
}

export async function countReadChapters(userId: UUID): Promise<number> {
  const rows = await db<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM chapter_reads
    WHERE user_id = ${userId}
  `;
  return rows[0]?.count ?? 0;
}

// "Pages read" approximates from the ready pages of the chapters the user has
// marked read — there is no per-page read tracking, so this counts the pages of
// read chapters rather than individually-viewed pages.
export async function countReadPages(userId: UUID): Promise<number> {
  const rows = await db<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM chapter_pages cp
    JOIN chapter_reads cr ON cr.chapter_id = cp.chapter_id
    WHERE cr.user_id = ${userId} AND cp.status = 'ready'
  `;
  return rows[0]?.count ?? 0;
}

// Ranks the user's manga by how many of its chapters they have read. Reuses the
// canonical manga mapper so new manga fields flow through automatically.
export async function findMostReadManga(
  userId: UUID,
  limit: number
): Promise<{ manga: Manga; readChapters: number }[]> {
  const rows = await db`
    SELECT m.*, count(*)::int AS read_chapters
    FROM chapter_reads cr
    JOIN manga m ON m.id = cr.manga_id
    WHERE cr.user_id = ${userId}
    GROUP BY m.id
    ORDER BY read_chapters DESC, m.title ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    manga: mapMangaRow(row),
    readChapters: row.read_chapters,
  }));
}

// Role + email for the config-gated badges: role drives the admin badge, email
// identifies the instance owner (compared against DEFAULT_SUPERUSER_EMAIL).
// Defaults to "user"/null if the row is missing (treated as no special role).
export async function getUserAuthInfo(
  userId: UUID
): Promise<{ role: UserRole; email: string | null }> {
  const rows = await db<{ role: UserRole; email: string }[]>`
    SELECT role, email FROM users WHERE id = ${userId} LIMIT 1
  `;
  return {
    role: rows[0]?.role ?? "user",
    email: rows[0]?.email ?? null,
  };
}

// Uploader badge signal: the user has at least one completed chapter import. An
// import reaches 'completed' only once its chapter is ready, so this means the
// user has published at least one readable chapter.
export async function hasCompletedImport(userId: UUID): Promise<boolean> {
  const rows = await db<{ uploader: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM chapter_imports
      WHERE user_id = ${userId} AND status = 'completed'
    ) AS uploader
  `;
  return Boolean(rows[0]?.uploader);
}
