import { expect, test, type Page } from "@playwright/test";
import { FIXTURE, FIXTURE_USER } from "./fixture";
import type { ReaderDirection } from "./fixture";

const M = FIXTURE.mangaWithChapters;
const C = FIXTURE.chapter;

// reducedMotion covers the JS-gated motion (hero rotator, carousel autoplay,
// rail reveal, boot scramble, route fade) because each of those reads the media
// query itself. These are the CSS-only leftovers it does not reach.
const KILL_MOTION = `
  .boot-splash,
  .hero-slide,
  .hero-bg,
  .rail-reveal,
  .rail-carousel-track,
  .state-loading,
  .skeleton-grid,
  .state-loading-dots span,
  .skeleton-block::after,
  img.cover-fade {
    animation: none !important;
    transition: none !important;
  }
  /* Both start at opacity 0 and are revealed by a class/animation whose timing
     is a race against the screenshot; pin them to their settled state. */
  img.cover-fade { opacity: 1 !important; }
  .rail-reveal { opacity: 1 !important; transform: none !important; }
`;

test.beforeEach(async ({ page }) => {
  // Screenshots are read-only by definition, but the reader autosaves progress
  // and marks chapters read. Writes are answered with a generic success envelope
  // rather than aborted: the fixture stays untouched for the shots that follow,
  // and the reader does not paint its "Save failed" chip.
  await page.route("**/api/v1/**", (route) => {
    if (route.request().method() === "GET") {
      return route.continue();
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, status: 200, data: null }),
    });
  });
});

async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: KILL_MOTION });
  // The boot splash unmounts once session bootstrap resolves; its absence is the
  // cleanest "shell is live" signal.
  await page.locator(".boot-splash").waitFor({ state: "detached" });
  await expect(page.locator(".state-loading, .skeleton-grid")).toHaveCount(0);
  // Below-the-fold covers are loading=lazy and never enter the viewport, yet a
  // full-page screenshot renders them. Flipping to eager starts the fetch.
  await page.evaluate(() => {
    for (const img of document.querySelectorAll<HTMLImageElement>(
      'img[loading="lazy"]'
    )) {
      img.loading = "eager";
    }
  });
  await page.waitForFunction(() => {
    if (document.fonts.status !== "loaded") return false;
    return [...document.images].every((img) => img.complete);
  });
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function shot(
  page: Page,
  path: string,
  name: string,
  options: { fullPage?: boolean } = {}
): Promise<void> {
  await page.goto(path);
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: options.fullPage ?? true,
  });
}

test("home", async ({ page }) => {
  await shot(page, "/", "home");
});

test("feed", async ({ page }) => {
  await shot(page, "/feed", "feed");
});

test("status", async ({ page }) => {
  await shot(page, "/status", "status");
});

test("favorites", async ({ page }) => {
  await shot(page, "/favorites", "favorites");
});

test("history", async ({ page }) => {
  await shot(page, "/history", "history");
});

test("user lookup", async ({ page }) => {
  await shot(page, "/user", "user-lookup");
});

test("user profile", async ({ page }) => {
  await shot(page, `/user/${FIXTURE_USER.username}`, "user-profile");
});

test("profile", async ({ page }) => {
  await shot(page, "/profile", "profile");
});

test("profile edit", async ({ page }) => {
  await shot(page, "/profile/edit", "profile-edit");
});

// Also covers forum-reports-panel, which renders inside the settings stack.
test("settings", async ({ page }) => {
  await shot(page, "/settings", "settings");
});

test("manga detail", async ({ page }) => {
  await shot(page, `/manga/${M}`, "manga");
});

test("manage hub", async ({ page }) => {
  await shot(page, "/manage", "manage");
});

test("manage manga create", async ({ page }) => {
  await shot(page, "/manage/manga/new", "manage-manga-create");
});

// Also covers manage-chapters-panel, which renders below the edit form.
test("manage manga edit", async ({ page }) => {
  await shot(page, `/manage/manga/${M}`, "manage-manga-edit");
});

test("manage chapter upload", async ({ page }) => {
  await shot(page, `/manage/manga/${M}/chapter`, "manage-chapter");
});

test("forum", async ({ page }) => {
  await shot(page, "/forum", "forum");
});

test("forum category", async ({ page }) => {
  await shot(page, `/forum/${FIXTURE.forumCategory}`, "forum-category");
});

test("forum thread", async ({ page }) => {
  await shot(page, `/forum/thread/${FIXTURE.forumThread}`, "forum-thread");
});

// The reader is viewport-sized chrome over its own scroll container; a full-page
// shot of vertical mode would stack every page image instead.
const DIRECTIONS: ReaderDirection[] = ["ltr", "rtl", "vertical"];

for (const direction of DIRECTIONS) {
  test(`reader ${direction}`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem("lazyscan:reader:direction", value);
    }, direction);
    await shot(page, `/manga/${M}/chapter/${C}`, `reader-${direction}`, {
      fullPage: false,
    });
  });
}

// Auth screens render logged out; the shared storageState would redirect past
// them or paint the signed-in chrome.
test.describe("unauthenticated", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("login", async ({ page }) => {
    await shot(page, "/login", "login");
  });

  test("register", async ({ page }) => {
    await shot(page, "/register", "register");
  });
});
