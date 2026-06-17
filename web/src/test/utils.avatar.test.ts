import { describe, expect, test } from "bun:test";
import { defaultAvatar, resolveAvatar } from "@/utils/avatar";

describe("defaultAvatar", () => {
  test("uses only the first word of the seed", () => {
    expect(defaultAvatar("John Doe")).toBe(
      "https://eu.ui-avatars.com/api/?name=John",
    );
  });

  test("url-encodes the first word", () => {
    expect(defaultAvatar("Renée Smith")).toBe(
      "https://eu.ui-avatars.com/api/?name=Ren%C3%A9e",
    );
  });

  test("falls back to User for empty/nullish seeds", () => {
    const expected = "https://eu.ui-avatars.com/api/?name=User";
    expect(defaultAvatar("")).toBe(expected);
    expect(defaultAvatar("   ")).toBe(expected);
    expect(defaultAvatar(null)).toBe(expected);
    expect(defaultAvatar(undefined)).toBe(expected);
  });
});

describe("resolveAvatar", () => {
  test("prefers a non-empty custom url", () => {
    expect(resolveAvatar("https://cdn.example/a.png", "John")).toBe(
      "https://cdn.example/a.png",
    );
  });

  test("falls back to derived avatar when url is blank/nullish", () => {
    const derived = "https://eu.ui-avatars.com/api/?name=John";
    expect(resolveAvatar("", "John")).toBe(derived);
    expect(resolveAvatar("   ", "John")).toBe(derived);
    expect(resolveAvatar(null, "John")).toBe(derived);
    expect(resolveAvatar(undefined, "John")).toBe(derived);
  });
});
