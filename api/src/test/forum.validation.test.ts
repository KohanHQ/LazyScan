import { describe, expect, test } from "bun:test";
import {
  parsePostBody,
  parseReportNote,
  parseReportReason,
  parseReportStatus,
  parseThreadBody,
  parseThreadTitle,
} from "@/modules/forum/forum.validation";

describe("forum text validation", () => {
  test("trims and masks profanity in titles and bodies", () => {
    expect(parseThreadTitle("  shit happens  ")).toBe("**** happens");
    expect(parseThreadBody("a fuck of a day")).toBe("a **** of a day");
    expect(parsePostBody("what an ass")).toBe("what an ***");
  });

  test("leaves clean text and word-boundary near-misses untouched", () => {
    expect(parseThreadTitle("a class assignment")).toBe("a class assignment");
  });

  test("rejects blank, whitespace-only, and non-string values", () => {
    expect(() => parseThreadTitle("   ")).toThrow();
    expect(() => parseThreadBody("")).toThrow();
    expect(() => parsePostBody(undefined)).toThrow();
    expect(() => parsePostBody(123)).toThrow();
  });

  test("rejects values made only of zero-width characters", () => {
    expect(() => parseThreadTitle("\u200B\u200C\u200D\u2060\uFEFF")).toThrow();
    expect(() => parsePostBody("  \u200B \u200B  ")).toThrow();
  });

  test("enforces the per-field ceilings", () => {
    expect(parseThreadTitle("a".repeat(200)).length).toBe(200);
    expect(() => parseThreadTitle("a".repeat(201))).toThrow();
    expect(parseThreadBody("a".repeat(5000)).length).toBe(5000);
    expect(() => parseThreadBody("a".repeat(5001))).toThrow();
    expect(parsePostBody("a".repeat(1000)).length).toBe(1000);
    expect(() => parsePostBody("a".repeat(1001))).toThrow();
  });
});

describe("forum report validation", () => {
  test("accepts the four reasons and rejects anything else", () => {
    for (const reason of ["spam", "abuse", "nsfw", "other"] as const) {
      expect(parseReportReason(reason)).toBe(reason);
    }
    expect(() => parseReportReason("vibes")).toThrow();
    expect(() => parseReportReason("SPAM")).toThrow();
    expect(() => parseReportReason(undefined)).toThrow();
  });

  test("notes are optional, trimmed, capped, and stored verbatim", () => {
    expect(parseReportNote(undefined)).toBeNull();
    expect(parseReportNote(null)).toBeNull();
    expect(parseReportNote("   ")).toBeNull();
    expect(parseReportNote("\u200B")).toBeNull();
    // Never masked: the moderator must see exactly what was reported.
    expect(parseReportNote("  this is shit  ")).toBe("this is shit");
    expect(parseReportNote("a".repeat(500))?.length).toBe(500);
    expect(() => parseReportNote("a".repeat(501))).toThrow();
    expect(() => parseReportNote(42)).toThrow();
  });

  test("report status defaults to open and rejects unknown values", () => {
    expect(parseReportStatus(undefined)).toBe("open");
    expect(parseReportStatus("")).toBe("open");
    expect(parseReportStatus("dismissed")).toBe("dismissed");
    expect(() => parseReportStatus("resolved")).toThrow();
  });
});
