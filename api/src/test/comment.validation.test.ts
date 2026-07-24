import { describe, expect, test } from "bun:test";
import {
  maskProfanity,
  parseCommentBody,
} from "@/modules/comment/comment.validation";

describe("comment profanity masking", () => {
  test("masks a matched word with same-length asterisks", () => {
    expect(maskProfanity("you are a shit")).toBe("you are a ****");
  });

  test("is case-insensitive", () => {
    expect(maskProfanity("SHIT and Fuck")).toBe("**** and ****");
  });

  test("respects word boundaries: 'class' is not masked", () => {
    expect(maskProfanity("a class assignment")).toBe("a class assignment");
  });

  test("masks a standalone boundary word but not the substring form", () => {
    // "ass" standalone is masked; embedded in "class"/"grass" it is not.
    expect(maskProfanity("what an ass, grassy class")).toBe(
      "what an ***, grassy class"
    );
  });

  test("leaves clean text untouched", () => {
    expect(maskProfanity("a perfectly clean sentence")).toBe(
      "a perfectly clean sentence"
    );
  });
});

describe("comment body validation", () => {
  test("trims and returns a valid body (masked)", () => {
    expect(parseCommentBody("  hello world  ")).toBe("hello world");
  });

  test("rejects empty / whitespace-only bodies", () => {
    expect(() => parseCommentBody("   ")).toThrow();
    expect(() => parseCommentBody("")).toThrow();
    expect(() => parseCommentBody(undefined)).toThrow();
    expect(() => parseCommentBody(123)).toThrow();
  });

  test("rejects a body of only zero-width characters", () => {
    // ZWSP, ZWNJ, ZWJ, word-joiner, BOM — all read as blank content.
    expect(() => parseCommentBody("\u200B\u200C\u200D\u2060\uFEFF")).toThrow();
    // Mixed with whitespace is still blank.
    expect(() => parseCommentBody("  \u200B \u200B  ")).toThrow();
  });

  test("accepts a body at the 1000-char ceiling", () => {
    const body = "a".repeat(1000);
    expect(parseCommentBody(body)).toBe(body);
  });

  test("rejects a body over 1000 chars", () => {
    expect(() => parseCommentBody("a".repeat(1001))).toThrow();
  });
});
