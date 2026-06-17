import { badRequest } from "@/shared/http/error";
import type { ReadingStatus } from "@/modules/reading-status/reading-status.model";

const READING_STATUSES = [
  "reading",
  "completed",
  "plan_to_read",
  "on_hold",
  "dropped",
] as const;

export function parseReadingStatus(value: unknown): ReadingStatus {
  if (
    typeof value === "string" &&
    (READING_STATUSES as readonly string[]).includes(value)
  ) {
    return value as ReadingStatus;
  }
  throw badRequest(`status must be one of: ${READING_STATUSES.join(", ")}`, {
    code: "INVALID_READING_STATUS",
    details: { field: "status" },
  });
}
