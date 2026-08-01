import { defineConfig, devices } from "@playwright/test";

// Written by auth.setup.ts, read by both shot projects. Gitignored: it holds a
// live session cookie.
export const STORAGE_STATE = ".auth/state.json";

const baseURL = process.env.VISUAL_BASE_URL ?? "http://web";

// Screenshots are only ever generated inside the harness image, so the snapshot
// path carries no platform suffix — a macOS baseline is never valid anyway.
export default defineConfig({
  testDir: ".",
  outputDir: "./.results",
  snapshotPathTemplate: "__screenshots__/{projectName}/{arg}{ext}",
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    reducedMotion: "reduce",
    colorScheme: "dark",
    // Dates render through Intl with the ambient locale/zone; both are pinned so
    // the fixture's fixed timestamps format identically on every run.
    locale: "en-US",
    timezoneId: "UTC",
    deviceScaleFactor: 1,
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // Absolute, not a ratio: 0.001 of a full-page shot is ~1.3k pixels, enough
      // to hide a whole text label. Renders in-container are pixel-stable, so
      // this only absorbs antialiasing jitter.
      maxDiffPixels: 60,
    },
  },
  projects: [
    // Specs are `.pw.ts`, not `.spec.ts`: bare `bun test` in web/ globs
    // `*.spec.ts` and would try to run them with the wrong runner.
    { name: "auth", testMatch: /auth\.setup\.ts$/ },
    {
      name: "desktop",
      dependencies: ["auth"],
      testMatch: /shots\.pw\.ts$/,
      // Desktop Chrome at both sizes: the app has no hover/pointer media
      // queries, so viewport width alone reproduces the mobile layout without
      // Playwright's touch emulation as an extra variable.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        storageState: STORAGE_STATE,
      },
    },
    {
      name: "mobile",
      dependencies: ["auth"],
      testMatch: /shots\.pw\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        storageState: STORAGE_STATE,
      },
    },
  ],
});
