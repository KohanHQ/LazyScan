import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Sql } from "postgres";

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
): Promise<{ code: string; userId: string; expiresAt: string }> {
  const rows = await ctx.db`
    SELECT payload FROM outbox_events
    WHERE event_type = 'auth.email.verification_requested'
      AND payload->>'email' = ${email}
    ORDER BY occurred_at DESC, payload->>'expiresAt' DESC
    LIMIT 1
  `;

  expect(rows.length).toBe(1);
  return rows[0].payload;
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
