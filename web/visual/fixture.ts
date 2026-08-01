// Mirrors seed.sql. Both files must change together.
export const FIXTURE_USER = {
  email: "visual@harness.test",
  password: "visual-harness-pw",
  username: "harness",
} as const;

export type ReaderDirection = "ltr" | "rtl" | "vertical";

export const FIXTURE = {
  mangaWithChapters: "20000000-0000-4000-8000-000000000001",
  chapter: "30000000-0000-4000-8000-000000000001",
  forumCategory: "general",
  forumThread: "90000000-0000-4000-8000-000000000001",
} as const;
