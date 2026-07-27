import { badRequest } from "@/shared/http/error";
import { PROFANITY_ROOTS } from "@/shared/utility/profanity";

const MAX_BODY = 1000;

// ponytail: a hard-coded wordlist is the floor, not real moderation — it is
// trivially bypassed (leetspeak, spacing, new slurs). Swap for an external list
// or a moderation service if this ever needs to actually hold. The list itself
// is the canonical shared one (shared/utility/profanity.ts); masking keeps its
// plain \b matcher because it replaces in the raw text, where the bio matcher's
// normalized classes cannot map back to original positions.
// Word-boundary, case-insensitive: "ass" matches standalone but not "class".
const PROFANITY_RE = new RegExp(`\\b(?:${PROFANITY_ROOTS.join("|")})\\b`, "gi");

export function maskProfanity(text: string): string {
  return text.replace(PROFANITY_RE, (match) => "*".repeat(match.length));
}

// Zero-width chars (ZWSP/ZWNJ/ZWJ/BOM/word-joiner) would otherwise pass the
// non-empty check, so a body made only of them reads as blank content.
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g;

// Trim, reject blank (whitespace/zero-width only), bound to 1..1000 chars, then
// mask before it is stored. The stored value keeps the trimmed original.
export function parseCommentBody(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  // Stripping zero-width can expose interior whitespace, so trim again before
  // the emptiness test.
  const visible = trimmed.replace(ZERO_WIDTH_RE, "").trim();
  if (visible.length < 1 || trimmed.length > MAX_BODY) {
    throw badRequest(`body must be between 1 and ${MAX_BODY} characters`, {
      code: "INVALID_COMMENT_BODY",
      details: { field: "body", min: 1, max: MAX_BODY },
    });
  }
  return maskProfanity(trimmed);
}
