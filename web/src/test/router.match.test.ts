import { describe, expect, test } from "bun:test";
import { matchRoute } from "@/router/match";

describe("matchRoute static routes", () => {
  const cases: Array<[string, string]> = [
    ["/login", "login"],
    ["/register", "register"],
    ["/favorites", "favorites"],
    ["/status", "status"],
    ["/feed", "feed"],
    ["/forum", "forum"],
    ["/settings", "settings"],
    ["/history", "history"],
    ["/profile/edit", "profile-edit"],
    ["/profile", "profile"],
    ["/user", "user-lookup"],
    ["/manage", "manage"],
    ["/manage/manga/new", "manga-create"],
  ];

  for (const [path, name] of cases) {
    test(`${path} -> ${name}`, () => {
      expect(matchRoute(path)).toEqual({ name } as any);
    });
  }
});

describe("matchRoute dynamic routes", () => {
  test("user profile captures username", () => {
    expect(matchRoute("/user/alice")).toEqual({
      name: "user-profile",
      username: "alice",
    });
  });

  test("user profile decodes the username", () => {
    expect(matchRoute("/user/john%20doe")).toEqual({
      name: "user-profile",
      username: "john doe",
    });
  });

  test("manga detail captures id", () => {
    expect(matchRoute("/manga/abc123")).toEqual({
      name: "manga",
      id: "abc123",
    });
  });

  test("manga edit captures id", () => {
    expect(matchRoute("/manage/manga/abc123")).toEqual({
      name: "manga-edit",
      id: "abc123",
    });
  });

  test("chapter upload captures id", () => {
    expect(matchRoute("/manage/manga/abc123/chapter")).toEqual({
      name: "manga-chapter-upload",
      id: "abc123",
    });
  });

  test("forum category captures slug", () => {
    expect(matchRoute("/forum/manga-talk")).toEqual({
      name: "forum-category",
      slug: "manga-talk",
    });
  });

  test("forum category decodes the slug", () => {
    expect(matchRoute("/forum/site%20feedback")).toEqual({
      name: "forum-category",
      slug: "site feedback",
    });
  });

  test("forum thread captures id", () => {
    expect(matchRoute("/forum/thread/abc123")).toEqual({
      name: "forum-thread",
      id: "abc123",
    });
  });

  test("reader captures both ids", () => {
    expect(matchRoute("/manga/m1/chapter/c2")).toEqual({
      name: "reader",
      mangaId: "m1",
      chapterId: "c2",
    });
  });
});

describe("matchRoute precedence and fallback", () => {
  test("manga-create wins over manga-edit for /manage/manga/new", () => {
    expect(matchRoute("/manage/manga/new")).toEqual({ name: "manga-create" });
  });

  test("reader wins over manga detail for the chapter path", () => {
    expect(matchRoute("/manga/m1/chapter/c2")).toEqual({
      name: "reader",
      mangaId: "m1",
      chapterId: "c2",
    });
  });

  test("forum thread wins over the category slug", () => {
    expect(matchRoute("/forum/thread/abc123")).toEqual({
      name: "forum-thread",
      id: "abc123",
    });
  });

  test("/forum stays the index, not a category", () => {
    expect(matchRoute("/forum")).toEqual({ name: "forum" });
  });

  test("/profile/edit wins over /profile", () => {
    expect(matchRoute("/profile/edit")).toEqual({ name: "profile-edit" });
  });

  test("unknown path falls back to home", () => {
    expect(matchRoute("/nope/whatever")).toEqual({ name: "home" });
  });

  test("root falls back to home", () => {
    expect(matchRoute("/")).toEqual({ name: "home" });
  });

  test("trailing slash is not the static route", () => {
    // /manga/ has an empty id segment, so it is not the manga detail route.
    expect(matchRoute("/manga/")).toEqual({ name: "home" });
  });
});
