import assert from "node:assert";
import { badRequest } from "@/shared/http/error";

// Opaque keyset cursor: base64url of a JSON tuple holding the sort keys plus the
// tie-breaking id, in ORDER BY order. Opaque so the encoding stays ours to
// change; the shape is re-validated on every decode.
//
// Timestamp keys must be selected as `column::text` and bound back as
// `${value}::text::timestamptz`. A bare `${value}::timestamptz` makes postgres.js
// resolve the parameter to its Date serializer, which routes the string through
// `new Date()` and silently truncates the microseconds a keyset depends on.
export type CursorField = "bool" | "timestamp" | "uuid";
export type CursorShape = readonly CursorField[];

type FieldValue<F extends CursorField> = F extends "bool" ? boolean : string;

// Mapped over the shape tuple, so a 3-field shape yields a 3-element tuple type.
export type CursorValues<S extends CursorShape> = {
  -readonly [K in keyof S]: FieldValue<S[K] & CursorField>;
};

// A cursor is one row's keys; anything larger is not one of ours.
const MAX_CURSOR_LENGTH = 512;

// Postgres timestamptz::text under the default ISO DateStyle. The offset can
// carry minutes (+05:30) and, for pre-standard-zone dates, seconds (-07:52:58).
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2}(:\d{2})?)?$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function matchesField(field: CursorField, value: unknown): boolean {
  if (field === "bool") return typeof value === "boolean";
  if (typeof value !== "string") return false;
  return field === "timestamp"
    ? TIMESTAMP_PATTERN.test(value)
    : UUID_PATTERN.test(value);
}

function invalidCursor() {
  return badRequest("cursor is not a valid pagination cursor", {
    code: "INVALID_CURSOR",
    details: { field: "cursor" },
  });
}

// Timestamps must arrive as the exact Postgres text representation: routing one
// through a JS Date truncates microseconds and breaks keyset comparisons.
export function encodeCursor<S extends CursorShape>(
  shape: S,
  values: CursorValues<S>,
): string {
  shape.forEach((field, index) => {
    if (!matchesField(field, values[index])) {
      throw new Error(
        `cursor field ${index} does not match shape ${field}: ${String(values[index])}`,
      );
    }
  });
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

export function decodeCursor<S extends CursorShape>(
  shape: S,
  raw: string,
): CursorValues<S> {
  if (raw.length > MAX_CURSOR_LENGTH) {
    throw invalidCursor();
  }

  let parsed: unknown;
  try {
    // base64url decoding never throws on junk, so JSON.parse is the real gate.
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }

  if (!Array.isArray(parsed) || parsed.length !== shape.length) {
    throw invalidCursor();
  }
  if (shape.some((field, index) => !matchesField(field, parsed[index]))) {
    throw invalidCursor();
  }

  return parsed as CursorValues<S>;
}

// Keyset queries fetch limit + 1 rows: the extra row is what proves another page
// exists, and it is dropped from the response.
export function takePage<S extends CursorShape, R>(
  rows: R[],
  limit: number,
  shape: S,
  cursorOf: (row: R) => CursorValues<S>,
): { page: R[]; nextCursor: string | null } {
  if (rows.length <= limit) {
    return { page: rows, nextCursor: null };
  }
  const page = rows.slice(0, limit);
  return {
    page,
    nextCursor: encodeCursor(shape, cursorOf(page[page.length - 1])),
  };
}

// Load-time self-check: a broken codec must fail loudly at boot, not silently
// start skipping or duplicating rows.
const SELF_CHECK_SHAPE = ["bool", "timestamp", "uuid"] as const;
const SELF_CHECK_VALUES: CursorValues<typeof SELF_CHECK_SHAPE> = [
  true,
  "2026-07-28 15:07:21.408074+00",
  "d1dd94af-4d58-48af-8b64-c35b43ec0442",
];

function decodeRejects(shape: CursorShape, raw: string): boolean {
  try {
    decodeCursor(shape, raw);
    return false;
  } catch {
    return true;
  }
}

assert.deepStrictEqual(
  decodeCursor(SELF_CHECK_SHAPE, encodeCursor(SELF_CHECK_SHAPE, SELF_CHECK_VALUES)),
  SELF_CHECK_VALUES,
  "cursor codec does not round-trip",
);
for (const stamp of [
  "2026-07-28 15:07:21+00",
  "2026-07-28 20:37:21.4+05:30",
  "1883-11-18 12:00:00-07:52:58",
]) {
  assert(
    matchesField("timestamp", stamp),
    `cursor timestamp matcher rejects Postgres output ${stamp}`,
  );
}
assert(decodeRejects(SELF_CHECK_SHAPE, "not-a-cursor"), "cursor decode accepts junk");
assert(
  decodeRejects(SELF_CHECK_SHAPE, Buffer.from('"nope"').toString("base64url")),
  "cursor decode accepts a non-tuple",
);
assert(
  decodeRejects(["timestamp", "uuid"], encodeCursor(SELF_CHECK_SHAPE, SELF_CHECK_VALUES)),
  "cursor decode accepts a foreign shape",
);
assert(
  decodeRejects(
    ["timestamp", "uuid"],
    Buffer.from('["2026-07-28T15:07:21.408Z","d1dd94af-4d58-48af-8b64-c35b43ec0442"]')
      .toString("base64url"),
  ),
  "cursor decode accepts a JS-Date timestamp",
);
