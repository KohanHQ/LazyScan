import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Sql } from "postgres";
import type { UUID } from "@/shared/types/id";

type JsonResponse<T = any> = {
  status: number;
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

type TestContext = {
  app: {
    handle: (request: Request) => Response | Promise<Response>;
  };
  db: Sql<{}>;
  closeDbClient: () => Promise<void>;
  getUploadStatus: (id: any, userId: any) => Promise<unknown>;
};

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let ctx: TestContext;

function assertSafeTestDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error("TEST_DATABASE_URL is required for API integration tests");
  }

  const parsed = new URL(url);
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error("TEST_DATABASE_URL database name must include 'test'");
  }

  return url;
}

function configureTestEnv(databaseUrl: string) {
  process.env.NODE_ENV = "development";
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET =
    "test-secret-change-before-production-1234567890";
  process.env.JWT_EXPIRES_IN = "1d";
  process.env.SUPERUSER_EMAILS = "phase3-superuser@example.test";
  // Owner identity (owner badge + owner-gated avatar upload). No bootstrap
  // password, so no account is auto-created — tests register it explicitly.
  process.env.DEFAULT_SUPERUSER_EMAIL = "phase3-owner@example.test";
  process.env.APP_URL = "http://localhost:3000";
  process.env.HOST = "127.0.0.1";
  process.env.PORT = "3000";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.ENABLE_RATE_LIMIT = "false";
  process.env.ENABLE_CACHE = "false";
  // Tiny storage cap so a single declared page projects over it; exercises the
  // 507 admission gate without seeding gigabytes of ready pages.
  process.env.STORAGE_QUOTA_BYTES = "1000";
  // Hermetic storage: bun test auto-loads api/.env, so a developer's real
  // CLOUDFLARE_*/STORAGE_* credentials would otherwise make storage
  // "configured" and let upload paths reach sharp/real object storage. Tests
  // must always hit the STORAGE_NOT_CONFIGURED guard instead.
  process.env.STORAGE_PROVIDER = "r2";
  process.env.CLOUDFLARE_ACCOUNT_ID = "";
  process.env.CLOUDFLARE_ACCESS_KEY_ID = "";
  process.env.CLOUDFLARE_SECRET_ACCESS_KEY = "";
  process.env.CLOUDFLARE_R2_BUCKET = "";
  process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN = "";
}

async function resetDatabase(db: Sql<{}>) {
  await db`
    DROP TABLE IF EXISTS
      forum_reports,
      forum_posts,
      forum_threads,
      forum_categories,
      manga_comments,
      reading_status,
      chapter_reads,
      reading_progress,
      chapter_pages,
      chapter_imports,
      chapters,
      uploads,
      manga,
      profiles,
      users,
      logs,
      outbox_events,
      chapter_worker_processed_events,
      chapter_worker_failures,
      email_verifications,
      mail_processed_events,
      mail_failures,
      schema_migrations
    CASCADE
  `;

  await db`DROP FUNCTION IF EXISTS update_updated_at_column CASCADE`;
}

// Business routes are mounted under /api/v1; ops endpoints stay at root.
const API_BASE = "/api/v1";
function withBase(path: string): string {
  return path === "/health" || path.startsWith("/metrics")
    ? path
    : API_BASE + path;
}

function requestJson(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Request {
  const headers = new Headers();
  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (cookie) {
    headers.set("cookie", cookie);
  }

  return new Request(`http://localhost${withBase(path)}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function send<T = any>(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<{ response: Response; json: JsonResponse<T> }> {
  const response = await ctx.app.handle(requestJson(method, path, body, cookie));
  const json = await response.json() as JsonResponse<T>;
  return { response, json };
}

function expectSuccess<T>(json: JsonResponse<T>): T {
  expect(json.success).toBe(true);
  expect(json.status).toBe(200);
  expect(json.data).toBeDefined();
  return json.data as T;
}

function sessionCookie(response: Response): string {
  const rawCookie = response.headers.get("set-cookie");
  expect(rawCookie).toBeTruthy();
  return rawCookie!.split(";")[0];
}

async function userIdByEmail(email: string): Promise<string> {
  const rows = await ctx.db`
    SELECT id FROM users WHERE email = ${email} LIMIT 1
  `;

  expect(rows.length).toBe(1);
  return rows[0].id;
}

// Hard verify: the plaintext OTP is read back from the outbox payload (the
// dispatcher does not run under tests), exercising the real transactional-
// outbox write path.
async function latestVerificationEvent(
  email: string,
  eventType = "auth.email.verification_requested",
): Promise<{ code: string; userId: string; expiresAt: string }> {
  const rows = await ctx.db`
    SELECT payload FROM outbox_events
    WHERE event_type = ${eventType}
      AND payload->>'email' = ${email}
    ORDER BY occurred_at DESC, payload->>'expiresAt' DESC
    LIMIT 1
  `;

  expect(rows.length).toBe(1);
  return rows[0].payload;
}

function latestPasswordResetEvent(
  email: string,
): Promise<{ code: string; userId: string; expiresAt: string }> {
  return latestVerificationEvent(email, "auth.email.password_reset_requested");
}

// Register + verify in one step for tests that just need a session cookie;
// register itself never sets one anymore.
async function registerVerified(
  email: string,
  password: string,
): Promise<string> {
  const register = await send("POST", "/auth/register", { email, password });
  expectSuccess(register.json);
  expect(register.response.headers.get("set-cookie")).toBeNull();

  const { code } = await latestVerificationEvent(email);
  const verify = await send("POST", "/auth/verify-email", { email, code });
  expectSuccess(verify.json);
  return sessionCookie(verify.response);
}

// Push the active verification row's created_at past the resend cooldown so
// the next issue is not suppressed.
async function expireCooldown(userId: string) {
  await ctx.db`
    UPDATE email_verifications
    SET created_at = created_at - interval '2 minutes'
    WHERE user_id = ${userId} AND consumed_at IS NULL
  `;
}

async function verifiedFlag(email: string): Promise<boolean> {
  const rows = await ctx.db`
    SELECT verified FROM users WHERE email = ${email} LIMIT 1
  `;
  expect(rows.length).toBe(1);
  return rows[0].verified as boolean;
}

beforeAll(async () => {
  const databaseUrl = assertSafeTestDatabaseUrl(testDatabaseUrl);
  configureTestEnv(databaseUrl);

  const [{ createDbClient, closeDbClient }, { runMigrations }] =
    await Promise.all([
      import("@/shared/database/client"),
      import("@/migrate"),
    ]);

  const db = createDbClient({
    databaseUrl,
    max: 1,
    idleTimeoutSeconds: 1,
    connectTimeoutSeconds: 5,
  });

  await resetDatabase(db);
  await runMigrations(db);

  const [{ createApp }, uploadService] = await Promise.all([
    import("@/app"),
    import("@/modules/upload/upload.service"),
  ]);

  ctx = {
    app: createApp(),
    db,
    closeDbClient,
    getUploadStatus: uploadService.getUploadStatus,
  };
});

afterAll(async () => {
  await ctx?.db.end({ timeout: 5 });
  await ctx?.closeDbClient();
});

describe("API smoke baseline", () => {
  test("runs migrations on a clean database", async () => {
    const rows = await ctx.db`
      SELECT version FROM schema_migrations ORDER BY version ASC
    `;

    expect(rows.map((row) => row.version)).toEqual([
      "001_init.sql",
      "002_user.sql",
      "003_profile.sql",
      "004_manga.sql",
      "005_uploads.sql",
      "006_logs.sql",
      "007_chapter_imports.sql",
      "008_reader_progress.sql",
      "009_chapter_worker_import_page_link.sql",
      "010_manga_rbac.sql",
      "011_profile_avatar_default.sql",
      "012_manga_metadata.sql",
      "013_search_indexes.sql",
      "014_user_library.sql",
      "015_manga_metadata_search.sql",
      "016_manga_views.sql",
      "017_chapter_reads.sql",
      "018_profile_visibility.sql",
      "019_manga_tags.sql",
      "020_chapter_volume.sql",
      "021_uploads_avatar_type.sql",
      "022_chapter_worker_outbox.sql",
      "023_email_verification.sql",
      "024_chapter_published_at.sql",
      "025_reading_status.sql",
      "026_logs_prune.sql",
      "027_chapter_pages_original_pruned.sql",
      "028_jsonb_unwrap_string_scalars.sql",
      "029_manga_comments.sql",
      "030_rename_mail_tables.sql",
      "031_profile_bio.sql",
      "032_password_reset.sql",
      "033_forum.sql",
    ]);
  });

  test("serves health", async () => {
    const { json } = await send("GET", "/health");
    const data = expectSuccess<{ status: string; environment: string }>(json);

    expect(data.status).toBe("healthy");
    expect(data.environment).toBe("development");
  });

  test("supports auth session, profile, manga CRUD, and upload ownership checks", async () => {
    const unique = Date.now();
    const firstEmail = `phase3-user-${unique}@example.test`;
    const secondEmail = `phase3-other-${unique}@example.test`;
    const superuserEmail = "phase3-superuser@example.test";
    const password = "Correct-password-123!";

    const firstCookie = await registerVerified(firstEmail, password);
    const secondCookie = await registerVerified(secondEmail, password);
    const superuserCookie = await registerVerified(superuserEmail, password);

    const login = await send("POST", "/auth/login", {
      email: firstEmail,
      password,
    });
    expectSuccess(login.json);
    const loginCookie = sessionCookie(login.response);

    // Auth hardening: a wrong password and an unknown email both return the same
    // 401 INVALID_CREDENTIALS, so login cannot be used to enumerate accounts.
    const wrongPassword = await send("POST", "/auth/login", {
      email: firstEmail,
      password: `${password}-wrong`,
    });
    expect(wrongPassword.response.status).toBe(401);
    expect(wrongPassword.json.error?.code).toBe("INVALID_CREDENTIALS");

    const unknownEmail = await send("POST", "/auth/login", {
      email: `nobody-${unique}@example.com`,
      password,
    });
    expect(unknownEmail.response.status).toBe(401);
    expect(unknownEmail.json.error?.code).toBe("INVALID_CREDENTIALS");

    const me = await send<{
      id: string;
      userId: string;
      email: string;
      role: string;
      username: string | null;
      avatarUrl: string | null;
    }>("GET", "/auth/me", undefined, loginCookie);
    const meData = expectSuccess(me.json);
    expect(meData.email).toBe(firstEmail);
    expect(meData.role).toBe("user");
    // `userId` is the account UUID used for owner gating (matches manga
    // createdByUserId); `id` is the public display id, so they must differ.
    expect(meData.userId).toBe(await userIdByEmail(firstEmail));
    expect(meData.userId).not.toBe(meData.id);
    // Profile fields are exposed; the default avatar is null (UI derives it).
    expect(typeof meData.username).toBe("string");
    expect(meData.avatarUrl).toBeNull();

    const superuserMe = await send<{ email: string; role: string }>(
      "GET",
      "/auth/me",
      undefined,
      superuserCookie,
    );
    expect(expectSuccess(superuserMe.json)).toMatchObject({
      email: superuserEmail,
      role: "superuser",
    });

    // The config-granted superuser role surfaces the rare "admin" badge
    // (deliberately not named "superuser" in the public payload). The limited
    // tier is reserved for the owner badge.
    const superuserProfile = await send<{
      badges: Array<{ code: string; rarity: string }>;
    }>("GET", "/profile/me", undefined, superuserCookie);
    expect(
      expectSuccess(superuserProfile.json).badges.some(
        (badge) => badge.code === "admin" && badge.rarity === "rare",
      ),
    ).toBe(true);

    // The DEFAULT_SUPERUSER_EMAIL account is the instance owner: it gets the
    // limited "owner" badge, which replaces admin (no double badge).
    const ownerCookie = await registerVerified(
      "phase3-owner@example.test",
      "Correct-password-123!",
    );
    const ownerProfile = await send<{
      badges: Array<{ code: string; rarity: string }>;
    }>("GET", "/profile/me", undefined, ownerCookie);
    const ownerBadges = expectSuccess(ownerProfile.json).badges;
    expect(
      ownerBadges.some(
        (badge) => badge.code === "owner" && badge.rarity === "limited",
      ),
    ).toBe(true);
    expect(ownerBadges.some((badge) => badge.code === "admin")).toBe(false);

    // /admin routes are superuser-only: anonymous 401, regular user 403,
    // superuser sees the imports list and storage estimate.
    const adminAnon = await send("GET", "/admin/imports");
    expect(adminAnon.response.status).toBe(401);

    const adminForbidden = await send(
      "GET",
      "/admin/imports",
      undefined,
      loginCookie,
    );
    expect(adminForbidden.response.status).toBe(403);
    expect(adminForbidden.json.error?.code).toBe("ADMIN_ACCESS_REQUIRED");

    const adminImports = await send<unknown[]>(
      "GET",
      "/admin/imports?status=failed",
      undefined,
      superuserCookie,
    );
    expect(Array.isArray(expectSuccess(adminImports.json))).toBe(true);

    const adminBadStatus = await send(
      "GET",
      "/admin/imports?status=nope",
      undefined,
      superuserCookie,
    );
    expect(adminBadStatus.response.status).toBe(400);
    expect(adminBadStatus.json.error?.code).toBe("INVALID_IMPORT_STATUS");

    const adminStorage = await send<{
      readyPagesBytes: number;
      mangaCount: number;
      failedImportsCount: number;
      byManga: Array<{ mangaId: string; bytes: number }>;
    }>("GET", "/admin/storage", undefined, superuserCookie);
    const storageData = expectSuccess(adminStorage.json);
    expect(typeof storageData.readyPagesBytes).toBe("number");
    expect(typeof storageData.mangaCount).toBe("number");
    expect(typeof storageData.failedImportsCount).toBe("number");
    expect(Array.isArray(storageData.byManga)).toBe(true);

    // Audit log trail: same role gates, level validation, and the
    // entries + whole-table levelCounts response shape.
    const logsAnon = await send("GET", "/admin/logs");
    expect(logsAnon.response.status).toBe(401);

    const logsForbidden = await send(
      "GET",
      "/admin/logs",
      undefined,
      loginCookie,
    );
    expect(logsForbidden.response.status).toBe(403);
    expect(logsForbidden.json.error?.code).toBe("ADMIN_ACCESS_REQUIRED");

    const logsBadLevel = await send(
      "GET",
      "/admin/logs?level=nope",
      undefined,
      superuserCookie,
    );
    expect(logsBadLevel.response.status).toBe(400);
    expect(logsBadLevel.json.error?.code).toBe("INVALID_LOG_LEVEL");

    const adminLogs = await send<{
      entries: Array<{ id: string; level: string; message: string }>;
      levelCounts: Record<"debug" | "info" | "warn" | "error", number>;
    }>("GET", "/admin/logs?level=error&limit=5", undefined, superuserCookie);
    const logsData = expectSuccess(adminLogs.json);
    expect(Array.isArray(logsData.entries)).toBe(true);
    for (const level of ["debug", "info", "warn", "error"] as const) {
      expect(typeof logsData.levelCounts[level]).toBe("number");
    }
    for (const entry of logsData.entries) {
      expect(entry.level).toBe("error");
    }

    // Avatar upload (the implemented generic /upload use case) is owner-gated:
    // a non-owner is rejected outright; the owner passes the gate and then hits
    // the storage-not-configured guard (no storage in tests), proving the gate
    // ordering without needing object storage.
    const avatarUpload = async (cookie: string) => {
      const form = new FormData();
      form.set("type", "avatar");
      form.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "avatar.png", {
          type: "image/png",
        }),
      );
      const response = await ctx.app.handle(
        new Request("http://localhost/api/v1/upload", {
          method: "POST",
          headers: { cookie },
          body: form,
        }),
      );
      return { response, json: (await response.json()) as JsonResponse };
    };

    const nonOwnerAvatar = await avatarUpload(loginCookie);
    expect(nonOwnerAvatar.response.status).toBe(403);
    expect(nonOwnerAvatar.json.error?.code).toBe("AVATAR_UPLOAD_OWNER_ONLY");

    const ownerAvatar = await avatarUpload(ownerCookie);
    expect(ownerAvatar.response.status).toBe(400);
    expect(ownerAvatar.json.error?.code).toBe("STORAGE_NOT_CONFIGURED");

    const profile = await send<{ username: string }>(
      "GET",
      "/profile/me",
      undefined,
      loginCookie,
    );
    const originalUsername = expectSuccess(profile.json).username;

    // Username is immutable: a PATCH that tries to change it is ignored, while
    // displayName updates.
    const updatedProfile = await send(
      "PATCH",
      "/profile/me",
      {
        username: `phase3_${unique}`,
        displayName: "Phase 3 User",
      },
      loginCookie,
    );
    expect(expectSuccess<{ username: string; displayName: string }>(updatedProfile.json))
      .toMatchObject({
        username: originalUsername,
        displayName: "Phase 3 User",
      });

    // The avatarUrl write path was removed (the avatar is derived from the
    // display name and there is no upload flow), so a PATCH that still sends it
    // is rejected rather than silently stored.
    const rejectedAvatar = await send(
      "PATCH",
      "/profile/me",
      { avatarUrl: "https://example.com/a.png" },
      loginCookie,
    );
    expect(rejectedAvatar.response.status).toBe(400);

    // Clearing: "" clears displayName; username stays the immutable original and
    // the derived avatar stays null.
    const clearedProfile = await send(
      "PATCH",
      "/profile/me",
      { displayName: "" },
      loginCookie,
    );
    expect(
      expectSuccess<{ username: string; displayName: string | null; avatarUrl: string | null }>(
        clearedProfile.json,
      ),
    ).toMatchObject({
      username: originalUsername,
      displayName: null,
      avatarUrl: null,
    });

    const bioProfile = await send(
      "PATCH",
      "/profile/me",
      { bio: "Phase 3 reader." },
      loginCookie,
    );
    expect(
      expectSuccess<{ bio: string | null }>(bioProfile.json),
    ).toMatchObject({ bio: "Phase 3 reader." });

    const profaneBio = await send(
      "PATCH",
      "/profile/me",
      { bio: "full of $h!t" },
      loginCookie,
    );
    expect(profaneBio.response.status).toBe(400);
    expect(profaneBio.json.error?.code).toBe("PROFILE_BIO_PROFANITY");

    const clearedBio = await send(
      "PATCH",
      "/profile/me",
      { bio: "" },
      loginCookie,
    );
    expect(
      expectSuccess<{ bio: string | null }>(clearedBio.json),
    ).toMatchObject({ bio: null });

    const mangaSlug = `phase3-manga-${unique}`;
    const createdManga = await send(
      "POST",
      "/manga",
      {
        title: "Phase 3 Manga",
        slug: mangaSlug,
        description: "Created by the API smoke baseline",
        status: "ongoing",
        totalChapters: 3,
        author: "Phase 3 Author",
        artist: "Phase 3 Artist",
        publisher: "Phase 3 Publisher",
        publishedYear: 2018,
        // Mixed case + duplicate + padding: stored normalized and deduped.
        tags: [" Action ", "action", "Sci-Fi"],
      },
      firstCookie,
    );
    const manga = expectSuccess<{
      id: string;
      slug: string;
      author: string | null;
      artist: string | null;
      publisher: string | null;
      publishedYear: number | null;
      tags: string[];
    }>(createdManga.json);
    expect(manga.slug).toBe(mangaSlug);
    expect(manga).toMatchObject({
      author: "Phase 3 Author",
      artist: "Phase 3 Artist",
      publisher: "Phase 3 Publisher",
      publishedYear: 2018,
    });
    expect(manga.tags).toEqual(["action", "sci-fi"]);

    const mangaList = await send<Array<{ id: string }>>("GET", "/manga?limit=10&offset=0");
    expect(expectSuccess(mangaList.json).some((item) => item.id === manga.id)).toBe(true);

    // status filter: the manga is "ongoing", so it shows under status=ongoing and
    // is absent under status=completed; an unknown status value is a 400.
    const ongoingList = await send<Array<{ id: string }>>(
      "GET",
      "/manga?status=ongoing&limit=50",
    );
    expect(expectSuccess(ongoingList.json).some((item) => item.id === manga.id)).toBe(true);

    const completedList = await send<Array<{ id: string }>>(
      "GET",
      "/manga?status=completed&limit=50",
    );
    expect(expectSuccess(completedList.json).some((item) => item.id === manga.id)).toBe(false);

    const invalidStatus = await send("GET", "/manga?status=bogus");
    expect(invalidStatus.response.status).toBe(400);

    // sort/order: a valid combination returns 200; an unknown column is a 400.
    const sortedList = await send("GET", "/manga?sort=title&order=asc&limit=50");
    expect(sortedList.response.status).toBe(200);

    const invalidSort = await send("GET", "/manga?sort=bogus");
    expect(invalidSort.response.status).toBe(400);

    // metadata search now spans title/slug/author/artist/publisher: a term that
    // only matches the author still finds the manga.
    const authorSearch = await send<Array<{ id: string }>>(
      "GET",
      `/manga?search=${encodeURIComponent("Phase 3 Author")}&limit=50`,
    );
    expect(expectSuccess(authorSearch.json).some((item) => item.id === manga.id)).toBe(true);

    // A 4-digit search term also matches published_year (so "2018" finds it).
    const yearSearch = await send<Array<{ id: string }>>(
      "GET",
      "/manga?search=2018&limit=50",
    );
    expect(expectSuccess(yearSearch.json).some((item) => item.id === manga.id)).toBe(true);

    // published_year is a valid sort column.
    const yearSorted = await send("GET", "/manga?sort=published_year&order=desc&limit=50");
    expect(yearSorted.response.status).toBe(200);

    // published_year equality filter: present for the matching year, absent
    // otherwise; an out-of-range/non-numeric value is a 400.
    const yearMatch = await send<Array<{ id: string }>>(
      "GET",
      "/manga?publishedYear=2018&limit=50",
    );
    expect(expectSuccess(yearMatch.json).some((item) => item.id === manga.id)).toBe(true);

    const yearMiss = await send<Array<{ id: string }>>(
      "GET",
      "/manga?publishedYear=1999&limit=50",
    );
    expect(expectSuccess(yearMiss.json).some((item) => item.id === manga.id)).toBe(false);

    const invalidYear = await send("GET", "/manga?publishedYear=abc");
    expect(invalidYear.response.status).toBe(400);

    // tag containment filter: case-insensitive via normalization, absent for an
    // unused tag; whitespace-only is a 400. The distinct-tags route lists the
    // stored normalized tags for the filter UI.
    const tagMatch = await send<Array<{ id: string }>>(
      "GET",
      `/manga?tag=${encodeURIComponent("Sci-Fi")}&limit=50`,
    );
    expect(expectSuccess(tagMatch.json).some((item) => item.id === manga.id)).toBe(true);

    const tagMiss = await send<Array<{ id: string }>>(
      "GET",
      "/manga?tag=romance&limit=50",
    );
    expect(expectSuccess(tagMiss.json).some((item) => item.id === manga.id)).toBe(false);

    const invalidTag = await send("GET", `/manga?tag=${encodeURIComponent("   ")}`);
    expect(invalidTag.response.status).toBe(400);

    const tagCatalog = await send<string[]>("GET", "/manga/tags");
    const tagCatalogData = expectSuccess(tagCatalog.json);
    expect(tagCatalogData).toContain("action");
    expect(tagCatalogData).toContain("sci-fi");

    const mangaById = await send<{
      id: string;
      author: string | null;
      publishedYear: number | null;
    }>("GET", `/manga/${manga.id}`);
    const fetchedManga = expectSuccess(mangaById.json);
    expect(fetchedManga.id).toBe(manga.id);
    expect(fetchedManga).toMatchObject({ author: "Phase 3 Author", publishedYear: 2018 });

    const mangaBySlug = await send<{ id: string }>("GET", `/manga/slug/${mangaSlug}`);
    expect(expectSuccess(mangaBySlug.json).id).toBe(manga.id);

    const updatedManga = await send(
      "PATCH",
      `/manga/${manga.id}`,
      {
        title: "Phase 3 Manga Updated",
        totalChapters: 4,
      },
      firstCookie,
    );
    expect(expectSuccess<{ title: string; totalChapters: number }>(updatedManga.json))
      .toMatchObject({
        title: "Phase 3 Manga Updated",
        totalChapters: 4,
      });

    // PATCH with explicit null clears the field; omitted fields are unchanged.
    // For tags (NOT NULL array column) the clear lands as the empty array.
    const clearedManga = await send<{
      author: string | null;
      publishedYear: number | null;
      artist: string | null;
      publisher: string | null;
      tags: string[];
    }>(
      "PATCH",
      `/manga/${manga.id}`,
      {
        author: null,
        publishedYear: null,
        tags: null,
      },
      firstCookie,
    );
    expect(expectSuccess(clearedManga.json)).toMatchObject({
      author: null,
      publishedYear: null,
      artist: "Phase 3 Artist",
      publisher: "Phase 3 Publisher",
      tags: [],
    });

    // Library: favorite + queue add/list/membership/remove for the owner.
    const addFavorite = await send(
      "POST",
      "/library/favorite",
      { mangaId: manga.id },
      firstCookie,
    );
    expectSuccess(addFavorite.json);

    const favorites = await send<Array<{ manga: { id: string } }>>(
      "GET",
      "/library/favorite",
      undefined,
      firstCookie,
    );
    expect(
      expectSuccess(favorites.json).some((entry) => entry.manga.id === manga.id)
    ).toBe(true);

    const addQueue = await send(
      "POST",
      "/library/queue",
      { mangaId: manga.id },
      firstCookie,
    );
    expectSuccess(addQueue.json);

    const queue = await send<Array<{ manga: { id: string }; position: number | null }>>(
      "GET",
      "/library/queue",
      undefined,
      firstCookie,
    );
    const queueEntry = expectSuccess(queue.json).find(
      (entry) => entry.manga.id === manga.id
    );
    expect(queueEntry?.position).toBe(1);

    const membership = await send<{ favorite: boolean; queue: boolean }>(
      "GET",
      `/library/membership/${manga.id}`,
      undefined,
      firstCookie,
    );
    expect(expectSuccess(membership.json)).toMatchObject({ favorite: true, queue: true });

    // Library requires auth.
    const anonLibrary = await send("GET", "/library/favorite");
    expect(anonLibrary.response.status).toBe(401);

    const invalidList = await send("GET", "/library/bogus", undefined, firstCookie);
    expect(invalidList.response.status).toBe(400);

    const removeFavorite = await send(
      "DELETE",
      `/library/favorite/${manga.id}`,
      undefined,
      firstCookie,
    );
    expectSuccess(removeFavorite.json);

    const membershipAfter = await send<{ favorite: boolean; queue: boolean }>(
      "GET",
      `/library/membership/${manga.id}`,
      undefined,
      firstCookie,
    );
    expect(expectSuccess(membershipAfter.json)).toMatchObject({
      favorite: false,
      queue: true,
    });

    const forbiddenUpdate = await send(
      "PATCH",
      `/manga/${manga.id}`,
      {
        title: "Second User Should Not Update",
      },
      secondCookie,
    );
    expect(forbiddenUpdate.response.status).toBe(403);
    expect(forbiddenUpdate.json.error?.code).toBe("MANGA_MANAGEMENT_FORBIDDEN");

    const forbiddenChapterUpload = await send(
      "POST",
      `/manga/${manga.id}/chapter`,
      {
        title: "Second User Should Not Upload",
        files: [
          {
            filename: "page_1.jpg",
            contentType: "image/jpeg",
            sizeBytes: 1000,
          },
        ],
      },
      secondCookie,
    );
    expect(forbiddenChapterUpload.response.status).toBe(403);
    expect(forbiddenChapterUpload.json.error?.code).toBe("MANGA_MANAGEMENT_FORBIDDEN");

    const superuserUpdate = await send(
      "PATCH",
      `/manga/${manga.id}`,
      {
        title: "Phase 3 Manga Superuser Updated",
      },
      superuserCookie,
    );
    expect(expectSuccess<{ title: string }>(superuserUpdate.json).title)
      .toBe("Phase 3 Manga Superuser Updated");

    const unownedRows = await ctx.db`
      INSERT INTO manga (title, slug, status)
      VALUES ('Unowned Manga', ${`phase3-unowned-${unique}`}, 'ongoing')
      RETURNING id
    `;
    const unownedMangaId = unownedRows[0].id as string;

    const forbiddenUnownedDelete = await send(
      "DELETE",
      `/manga/${unownedMangaId}`,
      undefined,
      firstCookie,
    );
    expect(forbiddenUnownedDelete.response.status).toBe(403);
    expect(forbiddenUnownedDelete.json.error?.code).toBe("MANGA_MANAGEMENT_FORBIDDEN");

    const superuserUnownedDelete = await send(
      "DELETE",
      `/manga/${unownedMangaId}`,
      undefined,
      superuserCookie,
    );
    expectSuccess(superuserUnownedDelete.json);

    const firstUserId = await userIdByEmail(firstEmail);
    const secondUserId = await userIdByEmail(secondEmail);
    const uploadRows = await ctx.db`
      INSERT INTO uploads (user_id, type, status, original_key)
      VALUES (${firstUserId}, 'manga_cover', 'completed', 'test/original.webp')
      RETURNING id
    `;
    const uploadId = uploadRows[0].id as string;

    await expect(ctx.getUploadStatus(uploadId, secondUserId)).rejects.toMatchObject({
      code: "UPLOAD_NOT_FOUND",
      status: 404,
    });

    const reservedUploadRoute = await send("GET", `/upload/${uploadId}`, undefined, secondCookie);
    expect(reservedUploadRoute.response.status).toBe(501);
    expect(reservedUploadRoute.json.error?.code).toBe("GENERIC_UPLOAD_NOT_IMPLEMENTED");

    const deletedManga = await send("DELETE", `/manga/${manga.id}`, undefined, firstCookie);
    expectSuccess(deletedManga.json);

    const missingManga = await send("GET", `/manga/${manga.id}`);
    expect(missingManga.response.status).toBe(404);
    expect(missingManga.json.error?.code).toBe("MANGA_NOT_FOUND");

    const logout = await send("POST", "/auth/logout", undefined, loginCookie);
    expectSuccess(logout.json);
    expect(logout.response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("supports reader chapter reads and idempotent reading progress", async () => {
    const unique = Date.now();
    const email = `phase4-user-${unique}@example.test`;
    const password = "Correct-password-123!";

    const cookie = await registerVerified(email, password);

    const createdManga = await send(
      "POST",
      "/manga",
      {
        title: "Phase 4 Manga",
        slug: `phase4-manga-${unique}`,
        status: "ongoing",
      },
      cookie,
    );
    const manga = expectSuccess<{ id: string }>(createdManga.json);

    const chapterRows = await ctx.db`
      INSERT INTO chapters (manga_id, title, chapter_number, volume, sort_order, status, published_at)
      VALUES
        (${manga.id}, 'Second Ready Chapter', 2, NULL, 20, 'ready', now()),
        (${manga.id}, 'First Ready Chapter', 1, 1, 10, 'ready', now()),
        (${manga.id}, 'Hidden Importing Chapter', 3, NULL, 30, 'importing', NULL)
      RETURNING id, title
    `;
    const secondReadyChapter = chapterRows.find((row) => row.title === "Second Ready Chapter");
    const firstReadyChapter = chapterRows.find((row) => row.title === "First Ready Chapter");
    const hiddenChapter = chapterRows.find((row) => row.title === "Hidden Importing Chapter");

    if (!secondReadyChapter || !firstReadyChapter || !hiddenChapter) {
      throw new Error("Expected seeded chapter rows to exist");
    }

    const userId = await userIdByEmail(email);
    const importRows = await ctx.db`
      INSERT INTO chapter_imports (
        chapter_id,
        user_id,
        status,
        total_files,
        processed_files
      )
      VALUES
        (${firstReadyChapter.id}, ${userId}, 'completed', 2, 2),
        (${secondReadyChapter.id}, ${userId}, 'completed', 1, 1),
        (${hiddenChapter.id}, ${userId}, 'completed', 1, 1)
      RETURNING id, chapter_id
    `;
    const firstReadyImport = importRows.find((row) => row.chapter_id === firstReadyChapter.id);
    const secondReadyImport = importRows.find((row) => row.chapter_id === secondReadyChapter.id);
    const hiddenImport = importRows.find((row) => row.chapter_id === hiddenChapter.id);

    if (!firstReadyImport || !secondReadyImport || !hiddenImport) {
      throw new Error("Expected seeded chapter import rows to exist");
    }

    const pageRows = await ctx.db`
      INSERT INTO chapter_pages (
        import_id,
        chapter_id,
        page_number,
        original_filename,
        original_key,
        storage_key,
        image_url,
        width,
        height,
        size_bytes,
        status
      )
      VALUES
        (${firstReadyImport.id}, ${firstReadyChapter.id}, 2, 'page_2.jpg', 'original/2', 'ready/2.webp', 'https://cdn.example.test/2.webp', 800, 1200, 2000, 'ready'),
        (${firstReadyImport.id}, ${firstReadyChapter.id}, 1, 'page_1.jpg', 'original/1', 'ready/1.webp', 'https://cdn.example.test/1.webp', 800, 1200, 1000, 'ready'),
        (${secondReadyImport.id}, ${secondReadyChapter.id}, 1, 'second_1.jpg', 'original/second-1', 'ready/second-1.webp', 'https://cdn.example.test/second-1.webp', 800, 1200, 1000, 'ready'),
        (${hiddenImport.id}, ${hiddenChapter.id}, 1, 'hidden_1.jpg', 'original/hidden-1', 'ready/hidden-1.webp', 'https://cdn.example.test/hidden-1.webp', 800, 1200, 1000, 'ready')
      RETURNING id, chapter_id, page_number
    `;
    const secondPage = pageRows.find((row) => row.page_number === 2);
    const hiddenPage = pageRows.find((row) => row.chapter_id === hiddenChapter.id);

    if (!secondPage || !hiddenPage) {
      throw new Error("Expected seeded page rows to exist");
    }

    const chapterRepo = await import("@/modules/chapter/chapter.repository");
    const processingPage = await chapterRepo.findPageForProcessing(secondPage.id);
    expect(processingPage).toMatchObject({
      id: secondPage.id,
      importId: firstReadyImport.id,
      mangaId: manga.id,
    });

    const chapterList = await send<
      Array<{ id: string; title: string; volume: number | null }>
    >("GET", `/reader/manga/${manga.id}/chapters`);
    const chapters = expectSuccess(chapterList.json);
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "First Ready Chapter",
      "Second Ready Chapter",
    ]);
    // Volume is additive on the chapter shape: numeric when set, null when not
    // (the detail page groups by it client-side).
    expect(chapters.map((chapter) => chapter.volume)).toEqual([1, null]);

    // "Recently updated" lists manga by latest ready chapter: the seeded manga
    // (two ready chapters) appears, a chapterless manga does not, and the
    // lenient limit clamps instead of rejecting.
    const chapterlessManga = await send(
      "POST",
      "/manga",
      {
        title: "Phase 4 Chapterless",
        slug: `phase4-chapterless-${unique}`,
        status: "ongoing",
      },
      cookie,
    );
    const chapterless = expectSuccess<{ id: string }>(chapterlessManga.json);

    const updates = await send<Array<{ id: string }>>("GET", "/manga/updates");
    const updatesData = expectSuccess(updates.json);
    expect(updatesData.some((item) => item.id === manga.id)).toBe(true);
    expect(updatesData.some((item) => item.id === chapterless.id)).toBe(false);

    const updatesClamped = await send<Array<{ id: string }>>(
      "GET",
      "/manga/updates?limit=999",
    );
    expect(expectSuccess(updatesClamped.json).length).toBeLessThanOrEqual(20);

    const chapterDetail = await send<{
      chapter: { id: string };
      pages: Array<Record<string, unknown>>;
    }>("GET", `/reader/manga/${manga.id}/chapters/${firstReadyChapter.id}`);
    const detail = expectSuccess(chapterDetail.json);
    expect(detail.chapter.id).toBe(firstReadyChapter.id);
    expect(detail.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(detail.pages[0]).not.toHaveProperty("originalKey");
    expect(detail.pages[0]).not.toHaveProperty("storageKey");

    const hiddenDetail = await send("GET", `/reader/manga/${manga.id}/chapters/${hiddenChapter.id}`);
    expect(hiddenDetail.response.status).toBe(404);
    expect(hiddenDetail.json.error?.code).toBe("CHAPTER_NOT_FOUND");

    const emptyProgress = await send("GET", `/reader/manga/${manga.id}/progress`, undefined, cookie);
    expectSuccess(emptyProgress.json);
    expect(emptyProgress.json.data).toBeNull();

    const savedProgress = await send<{ pageId: string; pageNumber: number }>(
      "PUT",
      `/reader/manga/${manga.id}/progress`,
      {
        chapterId: firstReadyChapter.id,
        pageId: secondPage.id,
      },
      cookie,
    );
    expect(expectSuccess(savedProgress.json)).toMatchObject({
      pageId: secondPage.id,
      pageNumber: 2,
    });

    const readProgress = await send<{ chapterId: string; pageId: string; pageNumber: number }>(
      "GET",
      `/reader/manga/${manga.id}/progress`,
      undefined,
      cookie,
    );
    expect(expectSuccess(readProgress.json)).toMatchObject({
      chapterId: firstReadyChapter.id,
      pageId: secondPage.id,
      pageNumber: 2,
    });

    const invalidProgress = await send(
      "PUT",
      `/reader/manga/${manga.id}/progress`,
      {
        chapterId: hiddenChapter.id,
        pageId: hiddenPage.id,
      },
      cookie,
    );
    expect(invalidProgress.response.status).toBe(404);
    expect(invalidProgress.json.error?.code).toBe("CHAPTER_NOT_FOUND");

    // Reading history is paginated: the just-read manga shows on the first page,
    // a far offset is empty, and an out-of-range limit is rejected. Entries carry
    // the pinned chapter's title/number and its ready-page count for the
    // continue-reading UI (page 2 of the 2-page first chapter here).
    const historyPage = await send<
      Array<{
        mangaId: string;
        chapterTitle: string;
        chapterNumber: number | null;
        chapterPageCount: number;
        hasNextChapter: boolean;
        pageNumber: number;
      }>
    >("GET", "/reader/history?limit=10&offset=0", undefined, cookie);
    const historyEntry = expectSuccess(historyPage.json).find(
      (item) => item.mangaId === manga.id,
    );
    expect(historyEntry).toBeDefined();
    // Pinned on chapter 1 while ready chapter 2 exists → a next chapter exists.
    expect(historyEntry).toMatchObject({
      chapterTitle: "First Ready Chapter",
      chapterNumber: 1,
      chapterPageCount: 2,
      hasNextChapter: true,
      pageNumber: 2,
    });

    const historyOffset = await send<Array<{ mangaId: string }>>(
      "GET",
      "/reader/history?limit=10&offset=1000",
      undefined,
      cookie,
    );
    expect(expectSuccess(historyOffset.json).length).toBe(0);

    const historyBadLimit = await send(
      "GET",
      "/reader/history?limit=0",
      undefined,
      cookie,
    );
    expect(historyBadLimit.response.status).toBe(400);

    // Per-chapter read state is explicit and separate from the pinned progress
    // above: a chapter is read only once marked, and marks survive out of order.
    const emptyReads = await send<string[]>(
      "GET",
      `/reader/manga/${manga.id}/reads`,
      undefined,
      cookie,
    );
    expect(expectSuccess(emptyReads.json)).toEqual([]);

    const markRead = await send<{ read: boolean }>(
      "PUT",
      `/reader/manga/${manga.id}/chapters/${firstReadyChapter.id}/read`,
      undefined,
      cookie,
    );
    expect(expectSuccess(markRead.json).read).toBe(true);

    // Marking again is idempotent: the chapter still appears exactly once.
    await send(
      "PUT",
      `/reader/manga/${manga.id}/chapters/${firstReadyChapter.id}/read`,
      undefined,
      cookie,
    );
    const afterMark = await send<string[]>(
      "GET",
      `/reader/manga/${manga.id}/reads`,
      undefined,
      cookie,
    );
    expect(expectSuccess(afterMark.json)).toEqual([firstReadyChapter.id]);

    // Hidden/non-ready chapters cannot be marked read (same guard as progress).
    const markHidden = await send(
      "PUT",
      `/reader/manga/${manga.id}/chapters/${hiddenChapter.id}/read`,
      undefined,
      cookie,
    );
    expect(markHidden.response.status).toBe(404);
    expect(markHidden.json.error?.code).toBe("CHAPTER_NOT_FOUND");

    // Unmarking is idempotent and clears the read.
    const unmarkRead = await send<{ read: boolean }>(
      "DELETE",
      `/reader/manga/${manga.id}/chapters/${firstReadyChapter.id}/read`,
      undefined,
      cookie,
    );
    expect(expectSuccess(unmarkRead.json).read).toBe(false);
    const afterUnmark = await send<string[]>(
      "GET",
      `/reader/manga/${manga.id}/reads`,
      undefined,
      cookie,
    );
    expect(expectSuccess(afterUnmark.json)).toEqual([]);

    // Mark-all-read pins progress to the last ready chapter's last page and
    // records an explicit read for every ready chapter.
    const markAll = await send<{ chapterId: string }>(
      "POST",
      `/reader/manga/${manga.id}/read-all`,
      undefined,
      cookie,
    );
    expect(markAll.response.status).toBe(200);
    expect(expectSuccess(markAll.json).chapterId).toBe(secondReadyChapter.id);

    const readsAfterAll = await send<string[]>(
      "GET",
      `/reader/manga/${manga.id}/reads`,
      undefined,
      cookie,
    );
    const allReads = expectSuccess(readsAfterAll.json);
    expect(allReads).toContain(firstReadyChapter.id);
    expect(allReads).toContain(secondReadyChapter.id);
    expect(allReads).not.toContain(hiddenChapter.id);

    // After read-all the pinned position is the catalog's end (last page of the
    // last ready chapter, nothing after) — continue-reading surfaces hide it.
    const historyAfterAll = await send<
      Array<{
        mangaId: string;
        hasNextChapter: boolean;
        pageNumber: number;
        chapterPageCount: number;
      }>
    >("GET", "/reader/history?limit=10&offset=0", undefined, cookie);
    const pinnedEnd = expectSuccess(historyAfterAll.json).find(
      (item) => item.mangaId === manga.id,
    );
    expect(pinnedEnd).toMatchObject({
      hasNextChapter: false,
      pageNumber: 1,
      chapterPageCount: 1,
    });

    // Clearing progress is idempotent and drops the manga from history.
    const cleared = await send<{ cleared: boolean }>(
      "DELETE",
      `/reader/manga/${manga.id}/progress`,
      undefined,
      cookie,
    );
    expect(expectSuccess(cleared.json).cleared).toBe(true);

    const historyAfterClear = await send<Array<{ mangaId: string }>>(
      "GET",
      "/reader/history?limit=10&offset=0",
      undefined,
      cookie,
    );
    expect(
      expectSuccess(historyAfterClear.json).some((item) => item.mangaId === manga.id),
    ).toBe(false);

    // --- Profile personalization ----------------------------------------
    // Private reading stats reflect the marked reads: both ready chapters are
    // read (mark-all-read above) and their ready pages counted (2 + 1 = 3).
    // Clearing progress does not touch chapter_reads, so the counts hold.
    const stats = await send<{
      titlesRead: number;
      chaptersRead: number;
      pagesRead: number;
      mostReadManga: Array<{ manga: { id: string }; readChapters: number }>;
    }>("GET", "/profile/me/stats", undefined, cookie);
    const statsData = expectSuccess(stats.json);
    expect(statsData.titlesRead).toBe(1);
    expect(statsData.chaptersRead).toBe(2);
    expect(statsData.pagesRead).toBe(3);
    expect(statsData.mostReadManga[0]?.manga.id).toBe(manga.id);
    expect(statsData.mostReadManga[0]?.readChapters).toBe(2);

    // Stats are private: an unauthenticated request is rejected.
    const anonStats = await send("GET", "/profile/me/stats");
    expect(anonStats.response.status).toBe(401);

    const meProfile = await send<{
      username: string;
      profileVisibility: string;
      shelfVisibility: string;
      badges: Array<{ code: string; rarity: string }>;
    }>("GET", "/profile/me", undefined, cookie);
    const meData = expectSuccess(meProfile.json);
    const username = meData.username;
    // Defaults preserve behavior: profile public, shelf private.
    expect(meData.profileVisibility).toBe("public");
    expect(meData.shelfVisibility).toBe("private");
    // Own profile exposes the owner's derived badges (uploader, common rarity);
    // a normal user does not get the config-gated admin badge.
    expect(
      meData.badges.some((badge) => badge.code === "uploader" && badge.rarity === "common"),
    ).toBe(true);
    expect(meData.badges.some((badge) => badge.code === "admin")).toBe(false);

    // Public lookup shows the derived uploader badge (the user has completed
    // chapter imports) but, with the shelf still private, an empty hidden shelf.
    await send("POST", "/library/favorite", { mangaId: manga.id }, cookie);

    // New-chapters feed: ready chapters from saved manga, newest first. A title
    // saved in both lists (favorite + queue) yields each chapter once, hidden
    // non-ready chapters never appear, and the route is auth-only.
    await send("POST", "/library/queue", { mangaId: manga.id }, cookie);
    const feed = await send<
      Array<{ manga: { id: string }; chapter: { id: string }; readyAt: string }>
    >("GET", "/library/feed", undefined, cookie);
    const feedData = expectSuccess(feed.json);
    const feedChapterIds = feedData.map((entry) => entry.chapter.id);
    expect(feedChapterIds).toContain(firstReadyChapter.id);
    expect(feedChapterIds).toContain(secondReadyChapter.id);
    expect(feedChapterIds).not.toContain(hiddenChapter.id);
    expect(new Set(feedChapterIds).size).toBe(feedChapterIds.length);

    const anonFeed = await send("GET", "/library/feed");
    expect(anonFeed.response.status).toBe(401);

    const privateShelf = await send<{
      badges: Array<{ code: string }>;
      shelf: { visible: boolean; favorites: Array<{ id: string }> };
    }>("GET", `/profile/username/${encodeURIComponent(username)}`);
    const privateShelfData = expectSuccess(privateShelf.json);
    expect(privateShelfData.badges.some((badge) => badge.code === "uploader")).toBe(true);
    expect(privateShelfData.shelf.visible).toBe(false);
    expect(privateShelfData.shelf.favorites).toEqual([]);

    // Opting the shelf public surfaces the favorites.
    const shelfPublic = await send(
      "PATCH",
      "/profile/me",
      { shelfVisibility: "public" },
      cookie,
    );
    expect(expectSuccess<{ shelfVisibility: string }>(shelfPublic.json).shelfVisibility)
      .toBe("public");

    const publicShelf = await send<{
      shelf: { visible: boolean; favorites: Array<{ id: string }> };
    }>("GET", `/profile/username/${encodeURIComponent(username)}`);
    const publicShelfData = expectSuccess(publicShelf.json);
    expect(publicShelfData.shelf.visible).toBe(true);
    expect(publicShelfData.shelf.favorites.some((entry) => entry.id === manga.id)).toBe(true);

    // A private profile is hidden from lookup: 404, indistinguishable from a
    // missing user (no enumeration).
    const profilePrivate = await send(
      "PATCH",
      "/profile/me",
      { profileVisibility: "private" },
      cookie,
    );
    expect(expectSuccess<{ profileVisibility: string }>(profilePrivate.json).profileVisibility)
      .toBe("private");

    const hiddenLookup = await send(
      "GET",
      `/profile/username/${encodeURIComponent(username)}`,
    );
    expect(hiddenLookup.response.status).toBe(404);
    expect(hiddenLookup.json.error?.code).toBe("PROFILE_NOT_FOUND");
  });
});

// Hard email verification flow: register issues no session, the OTP rides the
// outbox payload, /verify-email mints the session, login gates unverified
// accounts.
describe("email verification (hard verify)", () => {
  const PASSWORD = "Correct-password-123!";

  test("register issues no session and writes the OTP + outbox event in one tx", async () => {
    const email = `otp-register-${Date.now()}@example.test`;

    const register = await send("POST", "/auth/register", {
      email,
      password: PASSWORD,
    });
    const data = expectSuccess<{ email: string; verificationRequired: boolean }>(
      register.json,
    );
    expect(data.email).toBe(email);
    expect(data.verificationRequired).toBe(true);
    expect(register.response.headers.get("set-cookie")).toBeNull();
    expect(await verifiedFlag(email)).toBe(false);

    const userId = await userIdByEmail(email);
    const event = await latestVerificationEvent(email);
    expect(event.code).toMatch(/^\d{6}$/);
    expect(event.userId).toBe(userId);
    expect(new Date(event.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Code is hashed at rest: the stored hash never equals the plaintext.
    const stored = await ctx.db`
      SELECT code_hash, attempts, consumed_at
      FROM email_verifications WHERE user_id = ${userId}
    `;
    expect(stored.length).toBe(1);
    expect(stored[0].code_hash).not.toBe(event.code);
    expect(stored[0].attempts).toBe(0);
    expect(stored[0].consumed_at).toBeNull();
  });

  test("login is blocked until verified, then succeeds", async () => {
    const email = `otp-login-${Date.now()}@example.test`;

    expectSuccess(
      (await send("POST", "/auth/register", { email, password: PASSWORD })).json,
    );

    const blocked = await send("POST", "/auth/login", {
      email,
      password: PASSWORD,
    });
    expect(blocked.response.status).toBe(403);
    expect(blocked.json.error?.code).toBe("EMAIL_NOT_VERIFIED");

    // Wrong password on an unverified account stays a uniform 401 — the
    // verified gate must not leak past the password check.
    const wrongPassword = await send("POST", "/auth/login", {
      email,
      password: `${PASSWORD}-wrong`,
    });
    expect(wrongPassword.response.status).toBe(401);
    expect(wrongPassword.json.error?.code).toBe("INVALID_CREDENTIALS");

    const { code } = await latestVerificationEvent(email);
    const verify = await send("POST", "/auth/verify-email", { email, code });
    expectSuccess(verify.json);
    const cookie = sessionCookie(verify.response);

    const me = await send<{ email: string }>("GET", "/auth/me", undefined, cookie);
    expect(expectSuccess(me.json).email).toBe(email);

    const login = await send("POST", "/auth/login", {
      email,
      password: PASSWORD,
    });
    expectSuccess(login.json);
    expect(await verifiedFlag(email)).toBe(true);
  });

  test("verify consumes the code: replay fails uniformly", async () => {
    const email = `otp-replay-${Date.now()}@example.test`;

    expectSuccess(
      (await send("POST", "/auth/register", { email, password: PASSWORD })).json,
    );
    const { code } = await latestVerificationEvent(email);

    expectSuccess(
      (await send("POST", "/auth/verify-email", { email, code })).json,
    );

    const replay = await send("POST", "/auth/verify-email", { email, code });
    expect(replay.response.status).toBe(400);
    expect(replay.json.error?.code).toBe("INVALID_CODE");
  });

  test("wrong code increments attempts and caps at 429", async () => {
    const email = `otp-attempts-${Date.now()}@example.test`;

    expectSuccess(
      (await send("POST", "/auth/register", { email, password: PASSWORD })).json,
    );
    const { code } = await latestVerificationEvent(email);
    const wrongCode = code === "000000" ? "000001" : "000000";

    for (let attempt = 1; attempt <= 4; attempt++) {
      const wrong = await send("POST", "/auth/verify-email", {
        email,
        code: wrongCode,
      });
      expect(wrong.response.status).toBe(400);
      expect(wrong.json.error?.code).toBe("INVALID_CODE");
    }

    // Fifth wrong guess hits the cap.
    const capped = await send("POST", "/auth/verify-email", {
      email,
      code: wrongCode,
    });
    expect(capped.response.status).toBe(429);
    expect(capped.json.error?.code).toBe("TOO_MANY_ATTEMPTS");

    // Even the correct code is dead once capped — a resend is required.
    const correctAfterCap = await send("POST", "/auth/verify-email", {
      email,
      code,
    });
    expect(correctAfterCap.response.status).toBe(429);
    expect(correctAfterCap.json.error?.code).toBe("TOO_MANY_ATTEMPTS");
  });

  test("expired code fails; resend rotates and the new code verifies", async () => {
    const email = `otp-expiry-${Date.now()}@example.test`;

    expectSuccess(
      (await send("POST", "/auth/register", { email, password: PASSWORD })).json,
    );
    const userId = await userIdByEmail(email);
    const { code: expiredCode } = await latestVerificationEvent(email);

    await ctx.db`
      UPDATE email_verifications
      SET expires_at = now() - interval '1 second'
      WHERE user_id = ${userId} AND consumed_at IS NULL
    `;

    const expired = await send("POST", "/auth/verify-email", {
      email,
      code: expiredCode,
    });
    expect(expired.response.status).toBe(400);
    expect(expired.json.error?.code).toBe("INVALID_CODE");

    await expireCooldown(userId);
    expectSuccess(
      (await send("POST", "/auth/resend-verification", { email })).json,
    );

    const { code: freshCode } = await latestVerificationEvent(email);
    expect(freshCode).not.toBe(expiredCode);

    const verify = await send("POST", "/auth/verify-email", {
      email,
      code: freshCode,
    });
    expectSuccess(verify.json);
    expect(await verifiedFlag(email)).toBe(true);
  });

  test("resend is uniform for unknown emails and silent inside the cooldown", async () => {
    const unknown = await send("POST", "/auth/resend-verification", {
      email: `otp-nobody-${Date.now()}@example.test`,
    });
    expect(expectSuccess<{ ok: boolean }>(unknown.json).ok).toBe(true);

    const email = `otp-cooldown-${Date.now()}@example.test`;
    expectSuccess(
      (await send("POST", "/auth/register", { email, password: PASSWORD })).json,
    );
    const { code: original } = await latestVerificationEvent(email);

    // Within the 60s cooldown: still a 200, but the code does not rotate.
    expectSuccess(
      (await send("POST", "/auth/resend-verification", { email })).json,
    );
    const { code: afterCooldownHit } = await latestVerificationEvent(email);
    expect(afterCooldownHit).toBe(original);
  });

  test("unverified re-register overwrites the password and rotates the code", async () => {
    const email = `otp-rereg-${Date.now()}@example.test`;
    const attackerPassword = "Attacker-password-123!";
    const victimPassword = "Victim-password-456!";

    // First (attacker) registration parks an unverified account.
    expectSuccess(
      (
        await send("POST", "/auth/register", {
          email,
          password: attackerPassword,
        })
      ).json,
    );
    const userId = await userIdByEmail(email);
    await expireCooldown(userId);

    // Victim re-registers the same email: 200 (not 409), password replaced.
    const reRegister = await send("POST", "/auth/register", {
      email,
      password: victimPassword,
    });
    const data = expectSuccess<{ verificationRequired: boolean }>(
      reRegister.json,
    );
    expect(data.verificationRequired).toBe(true);

    const { code } = await latestVerificationEvent(email);
    expectSuccess(
      (await send("POST", "/auth/verify-email", { email, code })).json,
    );

    // Attacker's password is dead; the verifying registrant's works.
    const attackerLogin = await send("POST", "/auth/login", {
      email,
      password: attackerPassword,
    });
    expect(attackerLogin.response.status).toBe(401);

    const victimLogin = await send("POST", "/auth/login", {
      email,
      password: victimPassword,
    });
    expectSuccess(victimLogin.json);
  });

  test("verified account re-register stays a 409", async () => {
    const email = `otp-conflict-${Date.now()}@example.test`;

    expectSuccess(
      (await send("POST", "/auth/register", { email, password: PASSWORD })).json,
    );
    const { code } = await latestVerificationEvent(email);
    expectSuccess(
      (await send("POST", "/auth/verify-email", { email, code })).json,
    );

    const again = await send("POST", "/auth/register", {
      email,
      password: PASSWORD,
    });
    expect(again.response.status).toBe(409);
    expect(again.json.error?.code).toBe("EMAIL_ALREADY_EXISTS");
  });

  test("verify-email rejects malformed codes at the transport layer", async () => {
    const malformed = await send("POST", "/auth/verify-email", {
      email: "whoever@example.test",
      code: "12345",
    });
    expect(malformed.response.status).toBe(400);
    expect(malformed.json.success).toBe(false);
  });
});

// Password reset rides the same OTP table under purpose='password_reset', and
// login lockout bounds online guessing. Both are exercised end-to-end here:
// the plaintext code is read back from the outbox payload.
describe("password reset + login lockout", () => {
  const PASSWORD = "Correct-password-123!";
  const NEW_PASSWORD = "Brand-new-password-456!";

  test("forgot-password is uniform and writes the reset event in one tx", async () => {
    const email = `reset-request-${Date.now()}@example.test`;
    await registerVerified(email, PASSWORD);

    expectSuccess(
      (await send("POST", "/auth/forgot-password", { email })).json,
    );

    const userId = await userIdByEmail(email);
    const event = await latestPasswordResetEvent(email);
    expect(event.code).toMatch(/^\d{6}$/);
    expect(event.userId).toBe(userId);

    const stored = await ctx.db`
      SELECT purpose, code_hash, attempts, consumed_at
      FROM email_verifications
      WHERE user_id = ${userId} AND purpose = 'password_reset'
    `;
    expect(stored.length).toBe(1);
    expect(stored[0].code_hash).not.toBe(event.code);
    expect(stored[0].consumed_at).toBeNull();

    // The registration code stays its own row: purposes never shadow.
    const verifyRows = await ctx.db`
      SELECT purpose FROM email_verifications
      WHERE user_id = ${userId} AND purpose = 'verify'
    `;
    expect(verifyRows.length).toBe(1);
  });

  test("unknown and unverified emails resolve 200 without issuing a code", async () => {
    const unknown = `reset-unknown-${Date.now()}@example.test`;
    expectSuccess(
      (await send("POST", "/auth/forgot-password", { email: unknown })).json,
    );

    const unverified = `reset-unverified-${Date.now()}@example.test`;
    expectSuccess(
      (await send("POST", "/auth/register", { email: unverified, password: PASSWORD }))
        .json,
    );
    expectSuccess(
      (await send("POST", "/auth/forgot-password", { email: unverified })).json,
    );

    const rows = await ctx.db`
      SELECT 1 FROM outbox_events
      WHERE event_type = 'auth.email.password_reset_requested'
        AND payload->>'email' IN (${unknown}, ${unverified})
    `;
    expect(rows.length).toBe(0);
  });

  test("reset-password swaps the password, mints no session, and consumes the code", async () => {
    const email = `reset-happy-${Date.now()}@example.test`;
    await registerVerified(email, PASSWORD);

    expectSuccess(
      (await send("POST", "/auth/forgot-password", { email })).json,
    );
    const { code } = await latestPasswordResetEvent(email);

    const reset = await send("POST", "/auth/reset-password", {
      email,
      code,
      newPassword: NEW_PASSWORD,
    });
    expectSuccess(reset.json);
    expect(reset.response.headers.get("set-cookie")).toBeNull();

    const stale = await send("POST", "/auth/login", { email, password: PASSWORD });
    expect(stale.response.status).toBe(401);
    expectSuccess(
      (await send("POST", "/auth/login", { email, password: NEW_PASSWORD })).json,
    );

    // Replay of a consumed code is indistinguishable from a wrong one.
    const replay = await send("POST", "/auth/reset-password", {
      email,
      code,
      newPassword: NEW_PASSWORD,
    });
    expect(replay.response.status).toBe(400);
    expect(replay.json.error?.code).toBe("INVALID_CODE");
  });

  test("wrong reset codes are capped at 5 attempts", async () => {
    const email = `reset-attempts-${Date.now()}@example.test`;
    await registerVerified(email, PASSWORD);
    expectSuccess(
      (await send("POST", "/auth/forgot-password", { email })).json,
    );
    const { code } = await latestPasswordResetEvent(email);
    const wrongCode = code === "000000" ? "111111" : "000000";

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const wrong = await send("POST", "/auth/reset-password", {
        email,
        code: wrongCode,
        newPassword: NEW_PASSWORD,
      });
      expect(wrong.response.status).toBe(400);
      expect(wrong.json.error?.code).toBe("INVALID_CODE");
    }

    const capped = await send("POST", "/auth/reset-password", {
      email,
      code: wrongCode,
      newPassword: NEW_PASSWORD,
    });
    expect(capped.response.status).toBe(429);
    expect(capped.json.error?.code).toBe("TOO_MANY_ATTEMPTS");

    // The cap outranks a correct code: the row is spent.
    const correctAfterCap = await send("POST", "/auth/reset-password", {
      email,
      code,
      newPassword: NEW_PASSWORD,
    });
    expect(correctAfterCap.response.status).toBe(429);
  });

  test("reset-password enforces the registration password rules", async () => {
    const email = `reset-weak-${Date.now()}@example.test`;
    await registerVerified(email, PASSWORD);
    expectSuccess(
      (await send("POST", "/auth/forgot-password", { email })).json,
    );
    const { code } = await latestPasswordResetEvent(email);

    const weak = await send("POST", "/auth/reset-password", {
      email,
      code,
      newPassword: "alllowercase1!",
    });
    expect(weak.response.status).toBe(400);
    expect(weak.json.error?.code).toBe("PASSWORD_UPPERCASE_REQUIRED");
  });

  test("three wrong passwords lock the account, and a reset clears the lock", async () => {
    const email = `lockout-${Date.now()}@example.test`;
    await registerVerified(email, PASSWORD);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const wrong = await send("POST", "/auth/login", {
        email,
        password: `${PASSWORD}-wrong`,
      });
      expect(wrong.response.status).toBe(401);
      expect(wrong.json.error?.code).toBe("INVALID_CREDENTIALS");
    }

    // The correct password is refused while the lock holds.
    const locked = await send("POST", "/auth/login", { email, password: PASSWORD });
    expect(locked.response.status).toBe(429);
    expect(locked.json.error?.code).toBe("ACCOUNT_LOCKED");

    expectSuccess(
      (await send("POST", "/auth/forgot-password", { email })).json,
    );
    const { code } = await latestPasswordResetEvent(email);
    expectSuccess(
      (
        await send("POST", "/auth/reset-password", {
          email,
          code,
          newPassword: NEW_PASSWORD,
        })
      ).json,
    );

    expectSuccess(
      (await send("POST", "/auth/login", { email, password: NEW_PASSWORD })).json,
    );

    const rows = await ctx.db`
      SELECT failed_login_attempts, locked_until FROM users WHERE email = ${email}
    `;
    expect(rows[0].failed_login_attempts).toBe(0);
    expect(rows[0].locked_until).toBeNull();
  });

  test("a successful login clears a partial failure streak", async () => {
    const email = `lockout-partial-${Date.now()}@example.test`;
    await registerVerified(email, PASSWORD);

    const wrong = await send("POST", "/auth/login", {
      email,
      password: `${PASSWORD}-wrong`,
    });
    expect(wrong.response.status).toBe(401);

    expectSuccess(
      (await send("POST", "/auth/login", { email, password: PASSWORD })).json,
    );

    const rows = await ctx.db`
      SELECT failed_login_attempts FROM users WHERE email = ${email}
    `;
    expect(rows[0].failed_login_attempts).toBe(0);
  });
});

// Reading status: a single-select tracking state per (user, manga), distinct
// from the favorites/queue lists. Setting a second status switches in place
// (one row), clearing is idempotent, and the list/manga routes are auth-only.
describe("reading status", () => {
  const PASSWORD = "Correct-password-123!";

  test("set, switch, list, and clear a single-select reading status", async () => {
    const unique = Date.now();
    const email = `status-user-${unique}@example.test`;
    const cookie = await registerVerified(email, PASSWORD);

    const createdManga = await send(
      "POST",
      "/manga",
      { title: "Status Manga", slug: `status-manga-${unique}`, status: "ongoing" },
      cookie,
    );
    const manga = expectSuccess<{ id: string }>(createdManga.json);

    // No status initially.
    const initial = await send<{ status: string | null }>(
      "GET",
      `/reading-status/manga/${manga.id}`,
      undefined,
      cookie,
    );
    expect(expectSuccess(initial.json).status).toBeNull();

    // Set "reading", then confirm it surfaces on the per-manga read and the list.
    expectSuccess(
      (await send("PUT", `/reading-status/manga/${manga.id}`, { status: "reading" }, cookie)).json,
    );
    const afterSet = await send<{ status: string | null }>(
      "GET",
      `/reading-status/manga/${manga.id}`,
      undefined,
      cookie,
    );
    expect(expectSuccess(afterSet.json).status).toBe("reading");

    const readingList = await send<Array<{ manga: { id: string } }>>(
      "GET",
      "/reading-status/reading",
      undefined,
      cookie,
    );
    expect(expectSuccess(readingList.json).some((entry) => entry.manga.id === manga.id)).toBe(true);

    // Switch to "completed": single-select replaces in place (no duplicate row).
    expectSuccess(
      (await send("PUT", `/reading-status/manga/${manga.id}`, { status: "completed" }, cookie)).json,
    );
    const afterSwitch = await send<{ status: string | null }>(
      "GET",
      `/reading-status/manga/${manga.id}`,
      undefined,
      cookie,
    );
    expect(expectSuccess(afterSwitch.json).status).toBe("completed");

    const readingAfter = await send<Array<{ manga: { id: string } }>>(
      "GET",
      "/reading-status/reading",
      undefined,
      cookie,
    );
    expect(expectSuccess(readingAfter.json).some((entry) => entry.manga.id === manga.id)).toBe(false);

    const completedList = await send<Array<{ manga: { id: string }; updatedAt: string }>>(
      "GET",
      "/reading-status/completed",
      undefined,
      cookie,
    );
    const completedEntry = expectSuccess(completedList.json).find(
      (entry) => entry.manga.id === manga.id,
    );
    expect(completedEntry).toBeDefined();
    expect(typeof completedEntry?.updatedAt).toBe("string");

    // The single-status invariant: exactly one row for this (user, manga).
    const userId = await userIdByEmail(email);
    const rows = await ctx.db`
      SELECT status FROM reading_status WHERE user_id = ${userId} AND manga_id = ${manga.id}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("completed");

    // Clear is idempotent (no 404 on the second call) and drops the status.
    expectSuccess(
      (await send("DELETE", `/reading-status/manga/${manga.id}`, undefined, cookie)).json,
    );
    expectSuccess(
      (await send("DELETE", `/reading-status/manga/${manga.id}`, undefined, cookie)).json,
    );
    const afterClear = await send<{ status: string | null }>(
      "GET",
      `/reading-status/manga/${manga.id}`,
      undefined,
      cookie,
    );
    expect(expectSuccess(afterClear.json).status).toBeNull();
  });

  test("rejects invalid status and unknown manga, and requires auth", async () => {
    const unique = Date.now();
    const cookie = await registerVerified(`status-guard-${unique}@example.test`, PASSWORD);

    const createdManga = await send(
      "POST",
      "/manga",
      { title: "Status Guard Manga", slug: `status-guard-manga-${unique}`, status: "ongoing" },
      cookie,
    );
    const manga = expectSuccess<{ id: string }>(createdManga.json);

    // Unknown status value is rejected on both the write and the list route.
    const badSet = await send(
      "PUT",
      `/reading-status/manga/${manga.id}`,
      { status: "bogus" },
      cookie,
    );
    expect(badSet.response.status).toBe(400);
    expect(badSet.json.error?.code).toBe("INVALID_READING_STATUS");

    const badList = await send("GET", "/reading-status/bogus", undefined, cookie);
    expect(badList.response.status).toBe(400);
    expect(badList.json.error?.code).toBe("INVALID_READING_STATUS");

    // Setting a status on a well-formed but non-existent manga id is a 404.
    const missing = await send(
      "PUT",
      "/reading-status/manga/11111111-1111-4111-8111-111111111111",
      { status: "reading" },
      cookie,
    );
    expect(missing.response.status).toBe(404);
    expect(missing.json.error?.code).toBe("MANGA_NOT_FOUND");

    // The list and per-manga routes require auth.
    const anonList = await send("GET", "/reading-status/reading");
    expect(anonList.response.status).toBe(401);
  });
});

// Storage hardcap: chapter-import admission rejects with 507 when projected
// usage (ready bytes + declared incoming) exceeds STORAGE_QUOTA_BYTES.
describe("storage quota gate", () => {
  test("rejects an over-cap chapter import with 507 before staging", async () => {
    const unique = Date.now();
    const cookie = await registerVerified(
      `quota-${unique}@example.test`,
      "Correct-password-123!",
    );

    const createdManga = await send(
      "POST",
      "/manga",
      { title: "Quota Manga", slug: `quota-manga-${unique}`, status: "ongoing" },
      cookie,
    );
    const manga = expectSuccess<{ id: string }>(createdManga.json);

    // The test env sets a tiny STORAGE_QUOTA_BYTES, so one declared 10MB page
    // already projects over the cap — admission rejects before any staging.
    const overCap = await send(
      "POST",
      `/manga/${manga.id}/chapter`,
      {
        title: "Over Cap Chapter",
        files: [
          {
            filename: "001.jpg",
            contentType: "image/jpeg",
            sizeBytes: 10 * 1024 * 1024,
          },
        ],
      },
      cookie,
    );
    expect(overCap.response.status).toBe(507);
    expect(overCap.json.error?.code).toBe("STORAGE_QUOTA_EXCEEDED");
  });
});

// Forum: seeded categories -> threads -> flat posts, with a superuser report
// queue. Public read / auth write; reply counts derived, last_post_at stored.
describe("forum", () => {
  const PASSWORD = "Correct-password-123!";

  type Thread = {
    id: string;
    userId: string;
    title: string;
    body: string;
    pinned: boolean;
    locked: boolean;
    replyCount: number;
    lastPostAt: string;
    authorName: string;
  };
  type Post = { id: string; threadId: string; body: string; createdAt: string };

  // The config-granted superuser email is claimed by the smoke baseline, so the
  // forum tests mint their own admin by flipping the stored role (auth resolves
  // the role from the DB per request, so live sessions pick it up).
  async function registerSuperuser(email: string): Promise<string> {
    const cookie = await registerVerified(email, PASSWORD);
    await ctx.db`UPDATE users SET role = 'superuser' WHERE email = ${email}`;
    return cookie;
  }

  async function createThread(
    cookie: string,
    slug: string,
    title: string,
    body = "Thread body.",
  ): Promise<Thread> {
    const created = await send<Thread>(
      "POST",
      `/forum/categories/${slug}/threads`,
      { title, body },
      cookie,
    );
    return expectSuccess(created.json);
  }

  async function reply(
    cookie: string,
    threadId: string,
    body: string,
  ): Promise<Post> {
    const created = await send<Post>(
      "POST",
      `/forum/threads/${threadId}/posts`,
      { body },
      cookie,
    );
    return expectSuccess(created.json);
  }

  test("seeds three categories, readable by guests with derived counts", async () => {
    const categories = await send<
      Array<{ slug: string; name: string; threadCount: number; sortOrder: number }>
    >("GET", "/forum/categories");
    const data = expectSuccess(categories.json);

    expect(data.map((entry) => entry.slug)).toEqual([
      "general",
      "manga-talk",
      "site-feedback",
    ]);
    expect(data.map((entry) => entry.sortOrder)).toEqual([10, 20, 30]);
    for (const entry of data) {
      expect(typeof entry.threadCount).toBe("number");
    }
  });

  test("thread + reply flow: derived counts, oldest-first posts, activity bump", async () => {
    const unique = Date.now();
    const cookie = await registerVerified(`forum-a-${unique}@example.test`, PASSWORD);

    const thread = await createThread(cookie, "general", `Thread ${unique}`);
    expect(thread.replyCount).toBe(0);
    expect(typeof thread.authorName).toBe("string");

    // Thread creation counts as activity: last_post_at is set, not null.
    const createdActivity = Date.parse(thread.lastPostAt);
    expect(Number.isNaN(createdActivity)).toBe(false);

    const first = await reply(cookie, thread.id, "First reply.");
    const second = await reply(cookie, thread.id, "Second reply.");
    expect(first.threadId).toBe(thread.id);

    const posts = await send<{
      posts: Post[];
      total: number;
      nextCursor: string | null;
    }>("GET", `/forum/threads/${thread.id}/posts`);
    const postPage = expectSuccess(posts.json);
    expect(postPage.total).toBe(2);
    expect(postPage.posts.map((entry) => entry.id)).toEqual([first.id, second.id]);
    // Both rows fit the default page, so there is nothing after it.
    expect(postPage.nextCursor).toBeNull();

    // Reply count is a COUNT, never a stored counter; last_post_at moved.
    const detail = await send<Thread>("GET", `/forum/threads/${thread.id}`);
    const detailData = expectSuccess(detail.json);
    expect(detailData.replyCount).toBe(2);
    expect(Date.parse(detailData.lastPostAt)).toBeGreaterThan(createdActivity);

    // Post pagination is keyset over the same oldest-first order: page one hands
    // back the cursor that page two resumes from.
    type PostPage = { posts: Post[]; total: number; nextCursor: string | null };
    const firstPage = await send<PostPage>(
      "GET",
      `/forum/threads/${thread.id}/posts?limit=1`,
    );
    const firstPageData = expectSuccess(firstPage.json);
    expect(firstPageData.total).toBe(2);
    expect(firstPageData.posts.map((entry) => entry.id)).toEqual([first.id]);
    expect(firstPageData.nextCursor).not.toBeNull();

    const paged = await send<PostPage>(
      "GET",
      `/forum/threads/${thread.id}/posts?limit=1&cursor=${encodeURIComponent(firstPageData.nextCursor!)}`,
    );
    const pagedData = expectSuccess(paged.json);
    expect(pagedData.total).toBe(2);
    expect(pagedData.posts.map((entry) => entry.id)).toEqual([second.id]);
    expect(pagedData.nextCursor).toBeNull();

    const listing = await send<{ threads: Thread[]; total: number }>(
      "GET",
      "/forum/categories/general/threads?limit=50",
    );
    const listed = expectSuccess(listing.json).threads.find(
      (entry) => entry.id === thread.id,
    );
    expect(listed?.replyCount).toBe(2);
  });

  test("the reply insert and the activity bump share one transaction", async () => {
    const unique = Date.now();
    const email = `forum-tx-${unique}@example.test`;
    const cookie = await registerVerified(email, PASSWORD);
    const userId = await userIdByEmail(email);
    const thread = await createThread(cookie, "general", `Tx thread ${unique}`);

    const [forumRepo, { withTransaction }] = await Promise.all([
      import("@/modules/forum/forum.repository"),
      import("@/shared/database/transaction"),
    ]);

    const before = await ctx.db`
      SELECT last_post_at FROM forum_threads WHERE id = ${thread.id}
    `;

    // A failure after the insert must roll back the bump with it: the listing
    // sort can never show activity that has no reply behind it.
    await expect(
      withTransaction(async (tx) => {
        await forumRepo.insertPost(thread.id as UUID, userId as UUID, "rolled back", tx);
        await forumRepo.touchThreadLastPost(thread.id as UUID, tx);
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");

    const after = await ctx.db`
      SELECT last_post_at FROM forum_threads WHERE id = ${thread.id}
    `;
    expect(new Date(after[0].last_post_at).getTime()).toBe(
      new Date(before[0].last_post_at).getTime(),
    );
    const orphans = await ctx.db`
      SELECT COUNT(*)::int AS total FROM forum_posts WHERE thread_id = ${thread.id}
    `;
    expect(orphans[0].total).toBe(0);

    // 23503 = foreign_key_violation. A thread deleted between the lock check and
    // the insert cannot leave an orphan reply; the service maps this to the same
    // 404 a missing thread returns.
    const orphanInsert = await forumRepo
      .insertPost(
        "11111111-1111-4111-8111-111111111111" as UUID,
        userId as UUID,
        "orphan",
      )
      .then(
        () => null,
        (error: { code?: string }) => error.code,
      );
    expect(orphanInsert).toBe("23503");
  });

  test("masks profanity in thread title, thread body, and post body", async () => {
    const unique = Date.now();
    const cookie = await registerVerified(`forum-mask-${unique}@example.test`, PASSWORD);

    const thread = await createThread(
      cookie,
      "general",
      "shit title",
      "this is fuck body",
    );
    expect(thread.title).toBe("**** title");
    expect(thread.body).toBe("this is **** body");

    const post = await reply(cookie, thread.id, "what an ass reply");
    expect(post.body).toBe("what an *** reply");

    // Stored masked, not just rendered masked.
    const stored = await ctx.db`
      SELECT title, body FROM forum_threads WHERE id = ${thread.id}
    `;
    expect(stored[0].title).toBe("**** title");
  });

  test("rejects blank bodies, over-long input, and out-of-range pagination", async () => {
    const unique = Date.now();
    const cookie = await registerVerified(`forum-valid-${unique}@example.test`, PASSWORD);
    const thread = await createThread(cookie, "general", `Guard ${unique}`);

    const blankTitle = await send(
      "POST",
      "/forum/categories/general/threads",
      { title: "   \u200B ", body: "ok" },
      cookie,
    );
    expect(blankTitle.response.status).toBe(400);
    expect(blankTitle.json.error?.code).toBe("INVALID_FORUM_THREAD_TITLE");

    const longBody = await send(
      "POST",
      "/forum/categories/general/threads",
      { title: "ok", body: "a".repeat(5001) },
      cookie,
    );
    expect(longBody.response.status).toBe(400);
    expect(longBody.json.error?.code).toBe("INVALID_FORUM_THREAD_BODY");

    const longPost = await send(
      "POST",
      `/forum/threads/${thread.id}/posts`,
      { body: "a".repeat(1001) },
      cookie,
    );
    expect(longPost.response.status).toBe(400);
    expect(longPost.json.error?.code).toBe("INVALID_FORUM_POST_BODY");

    for (const query of ["limit=0", "limit=51", "limit=abc"]) {
      const bad = await send("GET", `/forum/categories/general/threads?${query}`);
      expect(bad.response.status).toBe(400);
      expect(bad.json.error?.code).toBe("INVALID_PAGINATION");
    }

    const missingCategory = await send("GET", "/forum/categories/nope/threads");
    expect(missingCategory.response.status).toBe(404);
    expect(missingCategory.json.error?.code).toBe("FORUM_CATEGORY_NOT_FOUND");

    const missingThread = await send(
      "GET",
      "/forum/threads/11111111-1111-4111-8111-111111111111",
    );
    expect(missingThread.response.status).toBe(404);
    expect(missingThread.json.error?.code).toBe("FORUM_THREAD_NOT_FOUND");

    const anonPost = await send(
      "POST",
      `/forum/threads/${thread.id}/posts`,
      { body: "guest" },
    );
    expect(anonPost.response.status).toBe(401);
  });

  test("a locked thread blocks replies and edits; a superuser owner is exempt", async () => {
    const unique = Date.now();
    const ownerCookie = await registerVerified(`forum-lock-${unique}@example.test`, PASSWORD);
    const adminCookie = await registerSuperuser(`forum-lockadmin-${unique}@example.test`);

    const thread = await createThread(ownerCookie, "general", `Locked ${unique}`);
    const post = await reply(ownerCookie, thread.id, "Before the lock.");

    const locked = await send<Thread>(
      "POST",
      `/admin/forum/threads/${thread.id}/lock`,
      undefined,
      adminCookie,
    );
    expect(expectSuccess(locked.json).locked).toBe(true);

    const blockedReply = await send(
      "POST",
      `/forum/threads/${thread.id}/posts`,
      { body: "After the lock." },
      ownerCookie,
    );
    expect(blockedReply.response.status).toBe(403);
    expect(blockedReply.json.error?.code).toBe("FORUM_THREAD_LOCKED");

    const blockedThreadEdit = await send(
      "PUT",
      `/forum/threads/${thread.id}`,
      { title: "Edited", body: "Edited body." },
      ownerCookie,
    );
    expect(blockedThreadEdit.response.status).toBe(403);
    expect(blockedThreadEdit.json.error?.code).toBe("FORUM_THREAD_LOCKED");

    const blockedPostEdit = await send(
      "PUT",
      `/forum/posts/${post.id}`,
      { body: "Edited reply." },
      ownerCookie,
    );
    expect(blockedPostEdit.response.status).toBe(403);
    expect(blockedPostEdit.json.error?.code).toBe("FORUM_THREAD_LOCKED");

    // The lock does not hold against a superuser editing their OWN content.
    const adminThread = await createThread(adminCookie, "general", `Admin locked ${unique}`);
    const adminPost = await reply(adminCookie, adminThread.id, "Admin reply.");
    expectSuccess(
      (
        await send(
          "POST",
          `/admin/forum/threads/${adminThread.id}/lock`,
          undefined,
          adminCookie,
        )
      ).json,
    );
    const adminEdit = await send<Thread>(
      "PUT",
      `/forum/threads/${adminThread.id}`,
      { title: "Admin edited", body: "Admin edited body." },
      adminCookie,
    );
    expect(expectSuccess(adminEdit.json).title).toBe("Admin edited");
    const adminPostEdit = await send<Post>(
      "PUT",
      `/forum/posts/${adminPost.id}`,
      { body: "Admin edited reply." },
      adminCookie,
    );
    expect(expectSuccess(adminPostEdit.json).body).toBe("Admin edited reply.");

    // Unlocking restores ordinary posting.
    const unlocked = await send<Thread>(
      "POST",
      `/admin/forum/threads/${thread.id}/unlock`,
      undefined,
      adminCookie,
    );
    expect(expectSuccess(unlocked.json).locked).toBe(false);
    expectSuccess(
      (
        await send(
          "POST",
          `/forum/threads/${thread.id}/posts`,
          { body: "After the unlock." },
          ownerCookie,
        )
      ).json,
    );
  });

  test("edits are owner-only; deletes are owner-or-superuser", async () => {
    const unique = Date.now();
    const ownerCookie = await registerVerified(`forum-own-${unique}@example.test`, PASSWORD);
    const otherCookie = await registerVerified(`forum-other-${unique}@example.test`, PASSWORD);
    const adminCookie = await registerSuperuser(`forum-owner-admin-${unique}@example.test`);

    const thread = await createThread(ownerCookie, "general", `Owned ${unique}`);
    const post = await reply(ownerCookie, thread.id, "Owner reply.");

    const foreignThreadEdit = await send(
      "PUT",
      `/forum/threads/${thread.id}`,
      { title: "Hijacked", body: "Hijacked body." },
      otherCookie,
    );
    expect(foreignThreadEdit.response.status).toBe(403);
    expect(foreignThreadEdit.json.error?.code).toBe("FORUM_THREAD_EDIT_FORBIDDEN");

    const foreignPostEdit = await send(
      "PUT",
      `/forum/posts/${post.id}`,
      { body: "Hijacked reply." },
      otherCookie,
    );
    expect(foreignPostEdit.response.status).toBe(403);
    expect(foreignPostEdit.json.error?.code).toBe("FORUM_POST_EDIT_FORBIDDEN");

    // A superuser may not edit someone else's content either — only delete it.
    const adminEdit = await send(
      "PUT",
      `/forum/threads/${thread.id}`,
      { title: "Admin hijack", body: "Admin hijack body." },
      adminCookie,
    );
    expect(adminEdit.response.status).toBe(403);
    expect(adminEdit.json.error?.code).toBe("FORUM_THREAD_EDIT_FORBIDDEN");

    const foreignDelete = await send(
      "DELETE",
      `/forum/posts/${post.id}`,
      undefined,
      otherCookie,
    );
    expect(foreignDelete.response.status).toBe(403);
    expect(foreignDelete.json.error?.code).toBe("FORUM_POST_DELETE_FORBIDDEN");

    const ownerEdit = await send<Thread>(
      "PUT",
      `/forum/threads/${thread.id}`,
      { title: "Owner edited", body: "Owner edited body." },
      ownerCookie,
    );
    expect(expectSuccess(ownerEdit.json).title).toBe("Owner edited");

    expectSuccess(
      (await send("DELETE", `/forum/posts/${post.id}`, undefined, adminCookie)).json,
    );
    expectSuccess(
      (await send("DELETE", `/forum/threads/${thread.id}`, undefined, adminCookie)).json,
    );

    const gone = await send("GET", `/forum/threads/${thread.id}`);
    expect(gone.response.status).toBe(404);
  });

  test("pinned threads sort above the activity order", async () => {
    const unique = Date.now();
    const cookie = await registerVerified(`forum-pin-${unique}@example.test`, PASSWORD);
    const adminCookie = await registerSuperuser(`forum-pinadmin-${unique}@example.test`);

    const older = await createThread(cookie, "site-feedback", `Older ${unique}`);
    const newer = await createThread(cookie, "site-feedback", `Newer ${unique}`);

    const beforePin = await send<{ threads: Thread[] }>(
      "GET",
      "/forum/categories/site-feedback/threads?limit=50",
    );
    expect(expectSuccess(beforePin.json).threads[0]?.id).toBe(newer.id);

    const pinned = await send<Thread>(
      "POST",
      `/admin/forum/threads/${older.id}/pin`,
      undefined,
      adminCookie,
    );
    expect(expectSuccess(pinned.json).pinned).toBe(true);

    const afterPin = await send<{ threads: Thread[] }>(
      "GET",
      "/forum/categories/site-feedback/threads?limit=50",
    );
    expect(expectSuccess(afterPin.json).threads[0]?.id).toBe(older.id);

    const unpinned = await send<Thread>(
      "POST",
      `/admin/forum/threads/${older.id}/unpin`,
      undefined,
      adminCookie,
    );
    expect(expectSuccess(unpinned.json).pinned).toBe(false);

    const afterUnpin = await send<{ threads: Thread[] }>(
      "GET",
      "/forum/categories/site-feedback/threads?limit=50",
    );
    expect(expectSuccess(afterUnpin.json).threads[0]?.id).toBe(newer.id);
  });

  test("one open report per reporter per target; duplicates are a 409", async () => {
    const unique = Date.now();
    const authorCookie = await registerVerified(`forum-rep-a-${unique}@example.test`, PASSWORD);
    const reporterCookie = await registerVerified(`forum-rep-b-${unique}@example.test`, PASSWORD);
    const otherReporter = await registerVerified(`forum-rep-c-${unique}@example.test`, PASSWORD);
    const adminCookie = await registerSuperuser(`forum-repadmin-${unique}@example.test`);

    const thread = await createThread(authorCookie, "manga-talk", `Reported ${unique}`);
    const post = await reply(authorCookie, thread.id, "Reported reply.");

    expectSuccess(
      (
        await send(
          "POST",
          `/forum/threads/${thread.id}/report`,
          { reason: "spam", note: "Repeated ad." },
          reporterCookie,
        )
      ).json,
    );

    const duplicate = await send(
      "POST",
      `/forum/threads/${thread.id}/report`,
      { reason: "abuse" },
      reporterCookie,
    );
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.json.error?.code).toBe("FORUM_REPORT_DUPLICATE");

    // A different reporter, and the same reporter on a different target, both pass.
    expectSuccess(
      (
        await send(
          "POST",
          `/forum/threads/${thread.id}/report`,
          { reason: "nsfw" },
          otherReporter,
        )
      ).json,
    );
    expectSuccess(
      (
        await send(
          "POST",
          `/forum/posts/${post.id}/report`,
          { reason: "other", note: null },
          reporterCookie,
        )
      ).json,
    );

    const badReason = await send(
      "POST",
      `/forum/posts/${post.id}/report`,
      { reason: "vibes" },
      otherReporter,
    );
    expect(badReason.response.status).toBe(400);
    expect(badReason.json.error?.code).toBe("INVALID_FORUM_REPORT_REASON");

    const longNote = await send(
      "POST",
      `/forum/posts/${post.id}/report`,
      { reason: "spam", note: "a".repeat(501) },
      otherReporter,
    );
    expect(longNote.response.status).toBe(400);
    expect(longNote.json.error?.code).toBe("INVALID_FORUM_REPORT_NOTE");

    const missingTarget = await send(
      "POST",
      "/forum/threads/11111111-1111-4111-8111-111111111111/report",
      { reason: "spam" },
      otherReporter,
    );
    expect(missingTarget.response.status).toBe(404);

    // Dismissing frees the slot: the same reporter may report the target again.
    const queue = await send<{
      reports: Array<{
        id: string;
        targetType: string;
        targetId: string;
        targetSnippet: string;
        targetAuthorName: string;
        reporterName: string;
        reason: string;
        note: string | null;
      }>;
      total: number;
    }>("GET", "/admin/forum/reports?status=open&limit=50", undefined, adminCookie);
    const open = expectSuccess(queue.json).reports;
    const threadReport = open.find(
      (entry) => entry.targetId === thread.id && entry.reason === "spam",
    );
    expect(threadReport).toBeDefined();
    expect(threadReport?.targetType).toBe("thread");
    expect(threadReport?.note).toBe("Repeated ad.");
    expect(threadReport?.targetSnippet).toContain(`Reported ${unique}`);
    expect(typeof threadReport?.targetAuthorName).toBe("string");
    expect(typeof threadReport?.reporterName).toBe("string");
    expect(open.some((entry) => entry.targetId === post.id)).toBe(true);

    expectSuccess(
      (
        await send(
          "POST",
          `/admin/forum/reports/${threadReport!.id}/dismiss`,
          undefined,
          adminCookie,
        )
      ).json,
    );

    const dismissed = await send<{ reports: Array<{ id: string }> }>(
      "GET",
      "/admin/forum/reports?status=dismissed&limit=50",
      undefined,
      adminCookie,
    );
    expect(
      expectSuccess(dismissed.json).reports.some(
        (entry) => entry.id === threadReport!.id,
      ),
    ).toBe(true);

    // Dismissing twice is a no-op, not an error.
    expectSuccess(
      (
        await send(
          "POST",
          `/admin/forum/reports/${threadReport!.id}/dismiss`,
          undefined,
          adminCookie,
        )
      ).json,
    );

    expectSuccess(
      (
        await send(
          "POST",
          `/forum/threads/${thread.id}/report`,
          { reason: "abuse" },
          reporterCookie,
        )
      ).json,
    );

    // Reports cascade with their target: deleting the thread clears its queue
    // entries (including the post's, via the thread -> post cascade).
    expectSuccess(
      (await send("DELETE", `/forum/threads/${thread.id}`, undefined, adminCookie)).json,
    );
    const remaining = await ctx.db`
      SELECT COUNT(*)::int AS total FROM forum_reports
      WHERE thread_id = ${thread.id} OR post_id = ${post.id}
    `;
    expect(remaining[0].total).toBe(0);
  });

  test("concurrent duplicate reports resolve to exactly one 200 and one 409", async () => {
    const unique = Date.now();
    const authorCookie = await registerVerified(`forum-race-a-${unique}@example.test`, PASSWORD);
    const reporterCookie = await registerVerified(`forum-race-b-${unique}@example.test`, PASSWORD);
    const thread = await createThread(authorCookie, "general", `Race ${unique}`);

    // The partial unique index, not a read-then-write check, is what makes this
    // deterministic: both requests see no existing report before either inserts.
    const results = await Promise.all([
      send("POST", `/forum/threads/${thread.id}/report`, { reason: "spam" }, reporterCookie),
      send("POST", `/forum/threads/${thread.id}/report`, { reason: "spam" }, reporterCookie),
    ]);
    expect(results.map((result) => result.response.status).sort()).toEqual([200, 409]);

    const stored = await ctx.db`
      SELECT COUNT(*)::int AS total FROM forum_reports
      WHERE thread_id = ${thread.id} AND status = 'open'
    `;
    expect(stored[0].total).toBe(1);
  });

  test("a report row must reference exactly one target", async () => {
    const unique = Date.now();
    const email = `forum-target-${unique}@example.test`;
    const cookie = await registerVerified(email, PASSWORD);
    const reporterId = await userIdByEmail(email);
    const thread = await createThread(cookie, "general", `Target ${unique}`);
    const post = await reply(cookie, thread.id, "Target reply.");

    // 23514 = check_violation. Both targets set, and neither set, are DB-level
    // violations — the API can never write one, and no backfill can either.
    async function insertRejectionCode(
      threadId: string | null,
      postId: string | null,
    ): Promise<string> {
      try {
        await ctx.db`
          INSERT INTO forum_reports (reporter_id, thread_id, post_id, reason)
          VALUES (${reporterId}, ${threadId}, ${postId}, 'spam')
        `;
      } catch (error) {
        return String((error as { code?: string }).code);
      }
      throw new Error("expected the forum_reports_one_target CHECK to reject");
    }

    expect(await insertRejectionCode(thread.id, post.id)).toBe("23514");
    expect(await insertRejectionCode(null, null)).toBe("23514");
  });

  test("the moderation surface is superuser-only", async () => {
    const unique = Date.now();
    const userCookie = await registerVerified(`forum-gate-${unique}@example.test`, PASSWORD);
    const adminCookie = await registerSuperuser(`forum-gateadmin-${unique}@example.test`);
    const thread = await createThread(userCookie, "general", `Gate ${unique}`);

    const anonQueue = await send("GET", "/admin/forum/reports");
    expect(anonQueue.response.status).toBe(401);

    const userQueue = await send("GET", "/admin/forum/reports", undefined, userCookie);
    expect(userQueue.response.status).toBe(403);
    expect(userQueue.json.error?.code).toBe("ADMIN_ACCESS_REQUIRED");

    const userLock = await send(
      "POST",
      `/admin/forum/threads/${thread.id}/lock`,
      undefined,
      userCookie,
    );
    expect(userLock.response.status).toBe(403);
    expect(userLock.json.error?.code).toBe("ADMIN_ACCESS_REQUIRED");

    const badStatus = await send(
      "GET",
      "/admin/forum/reports?status=nope",
      undefined,
      adminCookie,
    );
    expect(badStatus.response.status).toBe(400);
    expect(badStatus.json.error?.code).toBe("INVALID_FORUM_REPORT_STATUS");

    const missingReport = await send(
      "POST",
      "/admin/forum/reports/11111111-1111-4111-8111-111111111111/dismiss",
      undefined,
      adminCookie,
    );
    expect(missingReport.response.status).toBe(404);
    expect(missingReport.json.error?.code).toBe("FORUM_REPORT_NOT_FOUND");
  });
});

// Keyset pagination over the four community listings. The properties under test
// are the ones offsets could not hold: a walk visits every row exactly once, a
// row arriving mid-walk cannot duplicate or hide another, and a microsecond
// timestamp survives the cursor round trip.
describe("keyset cursor pagination", () => {
  const PASSWORD = "Correct-password-123!";

  type Row = { id: string };
  type Page = { total: number; nextCursor: string | null } & Record<string, any>;

  function pageUrl(path: string, query: string): string {
    return `${path}${path.includes("?") ? "&" : "?"}${query}`;
  }

  function cursorQuery(limit: number, cursor: string | null): string {
    return cursor === null
      ? `limit=${limit}`
      : `limit=${limit}&cursor=${encodeURIComponent(cursor)}`;
  }

  async function fetchPage(
    path: string,
    limit: number,
    cursor: string | null,
    cookie?: string,
  ): Promise<Page> {
    const response = await send<Page>(
      "GET",
      pageUrl(path, cursorQuery(limit, cursor)),
      undefined,
      cookie,
    );
    return expectSuccess(response.json);
  }

  // Walks to the end, i.e. until a page reports nextCursor === null. The guard
  // turns a cursor that fails to advance into a failed test, not a hung suite.
  async function walk(
    path: string,
    key: string,
    limit: number,
    cookie?: string,
  ): Promise<{ ids: string[]; pages: number; total: number }> {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let total = 0;
    for (let guard = 0; guard < 200; guard += 1) {
      const page = await fetchPage(path, limit, cursor, cookie);
      ids.push(...(page[key] as Row[]).map((row) => row.id));
      pages += 1;
      total = page.total;
      cursor = page.nextCursor;
      if (cursor === null) {
        return { ids, pages, total };
      }
    }
    throw new Error(`cursor walk of ${path} never reached a null nextCursor`);
  }

  async function createThread(
    cookie: string,
    slug: string,
    title: string,
  ): Promise<Row> {
    const created = await send<Row>(
      "POST",
      `/forum/categories/${slug}/threads`,
      { title, body: "Cursor thread body." },
      cookie,
    );
    return expectSuccess(created.json);
  }

  async function reply(cookie: string, threadId: string, body: string): Promise<Row> {
    const created = await send<Row>(
      "POST",
      `/forum/threads/${threadId}/posts`,
      { body },
      cookie,
    );
    return expectSuccess(created.json);
  }

  async function createManga(unique: number): Promise<string> {
    const rows = await ctx.db`
      INSERT INTO manga (title, slug, status)
      VALUES ('Cursor Manga', ${`cursor-manga-${unique}`}, 'ongoing')
      RETURNING id
    `;
    return rows[0].id as string;
  }

  async function comment(cookie: string, mangaId: string, body: string): Promise<Row> {
    const created = await send<Row>(
      "POST",
      `/manga/${mangaId}/comments`,
      { body },
      cookie,
    );
    return expectSuccess(created.json);
  }

  function decodedCursor(cursor: string): unknown[] {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  }

  test("walks thread posts ascending over three pages with no gap or repeat", async () => {
    const unique = Date.now();
    const cookie = await registerVerified(`cursor-posts-${unique}@example.test`, PASSWORD);
    const thread = await createThread(cookie, "general", `Cursor posts ${unique}`);

    const created: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      created.push((await reply(cookie, thread.id, `Reply ${index}.`)).id);
    }

    const path = `/forum/threads/${thread.id}/posts`;
    const walked = await walk(path, "posts", 2);

    expect(walked.pages).toBe(3);
    expect(walked.total).toBe(5);
    expect(walked.ids).toEqual(created);
    expect(new Set(walked.ids).size).toBe(walked.ids.length);

    // The same rows the unpaged read returns, in the same order.
    const whole = await fetchPage(path, 50, null);
    expect(whole.nextCursor).toBeNull();
    expect((whole.posts as Row[]).map((row) => row.id)).toEqual(created);
  });

  test("walks category threads with the pinned key in the cursor", async () => {
    const unique = Date.now();
    const cookie = await registerVerified(`cursor-threads-${unique}@example.test`, PASSWORD);
    const adminEmail = `cursor-threadadmin-${unique}@example.test`;
    const adminCookie = await registerVerified(adminEmail, PASSWORD);
    await ctx.db`UPDATE users SET role = 'superuser' WHERE email = ${adminEmail}`;

    for (let index = 0; index < 4; index += 1) {
      await createThread(cookie, "site-feedback", `Cursor thread ${unique}-${index}`);
    }
    const pinned = await createThread(cookie, "site-feedback", `Cursor pinned ${unique}`);
    expectSuccess(
      (
        await send(
          "POST",
          `/admin/forum/threads/${pinned.id}/pin`,
          undefined,
          adminCookie,
        )
      ).json,
    );

    const path = "/forum/categories/site-feedback/threads";
    const whole = await fetchPage(path, 50, null);
    const expected = (whole.threads as Row[]).map((row) => row.id);
    // Pinned sorts above the activity order, so the boolean key leads the cursor.
    expect(expected[0]).toBe(pinned.id);

    const walked = await walk(path, "threads", 2);
    expect(walked.ids).toEqual(expected);
    expect(walked.ids.length).toBe(walked.total);
    expect(new Set(walked.ids).size).toBe(walked.ids.length);
  });

  test("walks the report queue per status and ends with a null cursor", async () => {
    const unique = Date.now();
    const authorCookie = await registerVerified(`cursor-rep-a-${unique}@example.test`, PASSWORD);
    const reporterCookie = await registerVerified(`cursor-rep-b-${unique}@example.test`, PASSWORD);
    const adminEmail = `cursor-repadmin-${unique}@example.test`;
    const adminCookie = await registerVerified(adminEmail, PASSWORD);
    await ctx.db`UPDATE users SET role = 'superuser' WHERE email = ${adminEmail}`;

    const thread = await createThread(authorCookie, "general", `Cursor reports ${unique}`);
    for (let index = 0; index < 3; index += 1) {
      const post = await reply(authorCookie, thread.id, `Reportable ${index}.`);
      expectSuccess(
        (
          await send(
            "POST",
            `/forum/posts/${post.id}/report`,
            { reason: "spam" },
            reporterCookie,
          )
        ).json,
      );
    }

    const path = "/admin/forum/reports?status=open";
    const whole = await fetchPage(path, 50, null, adminCookie);
    const expected = (whole.reports as Row[]).map((row) => row.id);
    expect(expected.length).toBeGreaterThanOrEqual(3);

    const walked = await walk(path, "reports", 1, adminCookie);
    expect(walked.pages).toBe(expected.length);
    expect(walked.ids).toEqual(expected);
    expect(walked.ids.length).toBe(walked.total);
  });

  test("a comment inserted mid-walk cannot repeat or hide a descending row", async () => {
    const unique = Date.now();
    const email = `cursor-drift-desc-${unique}@example.test`;
    const cookie = await registerVerified(email, PASSWORD);
    const mangaId = await createManga(unique);

    const created: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      created.push((await comment(cookie, mangaId, `Comment ${index}.`)).id);
    }
    const path = `/manga/${mangaId}/comments`;
    const baseline = (await fetchPage(path, 50, null)).comments as Row[];
    const baselineIds = baseline.map((row) => row.id);
    expect(baselineIds).toEqual([...created].reverse());

    const first = await fetchPage(path, 2, null);
    const firstIds = (first.comments as Row[]).map((row) => row.id);
    expect(firstIds).toEqual(baselineIds.slice(0, 2));

    // The drift: a newer comment lands ahead of the whole list between fetches.
    const drifted = await comment(cookie, mangaId, "Arrived between pages.");

    const second = await fetchPage(path, 2, first.nextCursor);
    const secondIds = (second.comments as Row[]).map((row) => row.id);

    // Resumes exactly where page one stopped: nothing repeated, nothing skipped.
    expect(secondIds).toEqual(baselineIds.slice(2, 4));
    expect(secondIds).not.toContain(drifted.id);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);

    // The bug this replaces: the same drift makes OFFSET 2 re-serve row two.
    const offsetPage = await ctx.db`
      SELECT id FROM manga_comments
      WHERE manga_id = ${mangaId}
      ORDER BY created_at DESC, id DESC
      LIMIT 2 OFFSET 2
    `;
    expect(offsetPage.map((row) => row.id)).toEqual([
      baselineIds[1],
      baselineIds[2],
    ]);
  });

  test("a post inserted mid-walk cannot repeat or hide an ascending row", async () => {
    const unique = Date.now();
    const cookie = await registerVerified(`cursor-drift-asc-${unique}@example.test`, PASSWORD);
    const thread = await createThread(cookie, "general", `Cursor drift ${unique}`);

    const created: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      created.push((await reply(cookie, thread.id, `Ascending ${index}.`)).id);
    }
    const path = `/forum/threads/${thread.id}/posts`;

    const first = await fetchPage(path, 2, null);
    const firstIds = (first.posts as Row[]).map((row) => row.id);
    expect(firstIds).toEqual(created.slice(0, 2));

    // Backdated on purpose: an ascending list only drifts when a row appears
    // *before* the window, which a plain append never does.
    await ctx.db`
      INSERT INTO forum_posts (thread_id, user_id, body, created_at)
      SELECT thread_id, user_id, 'Arrived before the window.',
             created_at - interval '1 second'
      FROM forum_posts WHERE id = ${created[0]}
    `;

    const second = await fetchPage(path, 2, first.nextCursor);
    const secondIds = (second.posts as Row[]).map((row) => row.id);

    expect(secondIds).toEqual(created.slice(2, 4));
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);

    // The bug this replaces: the same drift makes OFFSET 2 re-serve row two.
    const offsetPage = await ctx.db`
      SELECT id FROM forum_posts
      WHERE thread_id = ${thread.id}
      ORDER BY created_at ASC, id ASC
      LIMIT 2 OFFSET 2
    `;
    expect(offsetPage.map((row) => row.id)).toEqual([created[1], created[2]]);
  });

  test("rows one microsecond apart inside the same millisecond paginate cleanly", async () => {
    const unique = Date.now();
    const email = `cursor-micro-${unique}@example.test`;
    await registerVerified(email, PASSWORD);
    const userId = await userIdByEmail(email);
    const mangaId = await createManga(unique + 1);

    // Same millisecond, different microseconds. The response bodies both render
    // as ...123Z (Date-backed), so only a text-exact cursor can separate them.
    const seeded = await ctx.db`
      INSERT INTO manga_comments (manga_id, user_id, body, created_at)
      VALUES
        (${mangaId}, ${userId}, 'Microsecond older.', '2026-01-01 00:00:00.123456+00'),
        (${mangaId}, ${userId}, 'Microsecond newer.', '2026-01-01 00:00:00.123999+00')
      RETURNING id, created_at::text AS created_at_text
    `;
    const older = seeded.find((row) => row.created_at_text.endsWith(".123456+00"))!;
    const newer = seeded.find((row) => row.created_at_text.endsWith(".123999+00"))!;

    const path = `/manga/${mangaId}/comments`;
    const first = await fetchPage(path, 1, null);
    expect((first.comments as Row[]).map((row) => row.id)).toEqual([newer.id]);
    expect(first.nextCursor).not.toBeNull();
    // The cursor carries the microseconds; a JS Date would have cut it to .123.
    expect(decodedCursor(first.nextCursor!)[0]).toBe("2026-01-01 00:00:00.123999+00");

    const second = await fetchPage(path, 1, first.nextCursor);
    expect((second.comments as Row[]).map((row) => row.id)).toEqual([older.id]);
    expect(second.nextCursor).toBeNull();

    const walked = await walk(path, "comments", 1);
    expect(walked.ids).toEqual([newer.id, older.id]);
  });

  test("a malformed or foreign-shaped cursor is a 400 INVALID_CURSOR", async () => {
    const unique = Date.now();
    const cookie = await registerVerified(`cursor-bad-${unique}@example.test`, PASSWORD);
    const adminEmail = `cursor-badadmin-${unique}@example.test`;
    const adminCookie = await registerVerified(adminEmail, PASSWORD);
    await ctx.db`UPDATE users SET role = 'superuser' WHERE email = ${adminEmail}`;
    const thread = await createThread(cookie, "general", `Cursor bad ${unique}`);
    const mangaId = await createManga(unique + 2);

    const routes: Array<[string, string | undefined]> = [
      ["/forum/categories/general/threads", undefined],
      [`/forum/threads/${thread.id}/posts`, undefined],
      [`/manga/${mangaId}/comments`, undefined],
      ["/admin/forum/reports?status=open", adminCookie],
    ];

    // Junk, valid base64url of a non-tuple, and a tuple whose id is not a UUID.
    const malformed = [
      "not-a-cursor",
      Buffer.from('{"offset":20}').toString("base64url"),
      Buffer.from('["2026-01-01 00:00:00+00","nope"]').toString("base64url"),
    ];

    for (const [path, routeCookie] of routes) {
      for (const cursor of malformed) {
        const bad = await send(
          "GET",
          pageUrl(path, `cursor=${encodeURIComponent(cursor)}`),
          undefined,
          routeCookie,
        );
        expect(bad.response.status).toBe(400);
        expect(bad.json.error?.code).toBe("INVALID_CURSOR");
      }
    }

    // A well-formed cursor from another listing is still the wrong shape: the
    // two-key post cursor cannot stand in for the three-key thread cursor.
    await reply(cookie, thread.id, "Shape check one.");
    await reply(cookie, thread.id, "Shape check two.");
    const postPage = await fetchPage(`/forum/threads/${thread.id}/posts`, 1, null);
    const foreign = await send(
      "GET",
      `/forum/categories/general/threads?cursor=${encodeURIComponent(postPage.nextCursor!)}`,
    );
    expect(foreign.response.status).toBe(400);
    expect(foreign.json.error?.code).toBe("INVALID_CURSOR");
  });
});
