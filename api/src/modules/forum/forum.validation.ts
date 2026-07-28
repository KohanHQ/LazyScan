import { badRequest } from "@/shared/http/error";
import { maskProfanity } from "@/shared/utility/profanity";
import type {
  ForumReportReason,
  ForumReportStatus,
} from "@/modules/forum/forum.model";

const MAX_TITLE = 200;
const MAX_THREAD_BODY = 5000;
const MAX_POST_BODY = 1000;
const MAX_NOTE = 500;

const REPORT_REASONS: ForumReportReason[] = ["spam", "abuse", "nsfw", "other"];
const REPORT_STATUSES: ForumReportStatus[] = ["open", "dismissed"];

// Zero-width chars (ZWSP/ZWNJ/ZWJ/BOM/word-joiner) would otherwise pass the
// non-empty check, so a value made only of them reads as blank content.
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g;

// Trim, reject blank (whitespace/zero-width only), bound to 1..max, then mask
// before storage. The stored value keeps the trimmed original.
function parseMaskedText(
  value: unknown,
  field: string,
  max: number,
  code: string
): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  // Stripping zero-width can expose interior whitespace, so trim again before
  // the emptiness test.
  const visible = trimmed.replace(ZERO_WIDTH_RE, "").trim();
  if (visible.length < 1 || trimmed.length > max) {
    throw badRequest(`${field} must be between 1 and ${max} characters`, {
      code,
      details: { field, min: 1, max },
    });
  }
  return maskProfanity(trimmed);
}

export function parseThreadTitle(value: unknown): string {
  return parseMaskedText(
    value,
    "title",
    MAX_TITLE,
    "INVALID_FORUM_THREAD_TITLE"
  );
}

export function parseThreadBody(value: unknown): string {
  return parseMaskedText(
    value,
    "body",
    MAX_THREAD_BODY,
    "INVALID_FORUM_THREAD_BODY"
  );
}

export function parsePostBody(value: unknown): string {
  return parseMaskedText(value, "body", MAX_POST_BODY, "INVALID_FORUM_POST_BODY");
}

export function parseReportReason(value: unknown): ForumReportReason {
  if (
    typeof value !== "string" ||
    !REPORT_REASONS.includes(value as ForumReportReason)
  ) {
    throw badRequest("Invalid report reason", {
      code: "INVALID_FORUM_REPORT_REASON",
      details: { field: "reason", allowed: REPORT_REASONS },
    });
  }
  return value as ForumReportReason;
}

// Stored verbatim (never masked): the queue must show the moderator exactly
// what the reporter wrote. Blank/absent collapses to null.
export function parseReportNote(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (typeof value !== "string" || trimmed.length > MAX_NOTE) {
    throw badRequest(`note must be at most ${MAX_NOTE} characters`, {
      code: "INVALID_FORUM_REPORT_NOTE",
      details: { field: "note", max: MAX_NOTE },
    });
  }
  return trimmed.replace(ZERO_WIDTH_RE, "").trim().length < 1 ? null : trimmed;
}

export function parseReportStatus(value: unknown): ForumReportStatus {
  if (value === undefined || value === "") {
    return "open";
  }
  if (
    typeof value !== "string" ||
    !REPORT_STATUSES.includes(value as ForumReportStatus)
  ) {
    throw badRequest("Invalid report status", {
      code: "INVALID_FORUM_REPORT_STATUS",
      details: { field: "status", allowed: REPORT_STATUSES },
    });
  }
  return value as ForumReportStatus;
}
