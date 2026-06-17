import { badRequest } from "@/shared/http/error";
import type { LibraryList } from "@/modules/library/library.model";
import type { LibrarySort } from "@/modules/library/library.repository";

const LIBRARY_LISTS = ["favorite", "queue"] as const;
const LIBRARY_SORTS = ["newest", "title", "year"] as const;

export function parseLibraryList(value: unknown): LibraryList {
  if (
    typeof value === "string" &&
    (LIBRARY_LISTS as readonly string[]).includes(value)
  ) {
    return value as LibraryList;
  }
  throw badRequest(`list must be one of: ${LIBRARY_LISTS.join(", ")}`, {
    code: "INVALID_LIBRARY_LIST",
    details: { field: "list" },
  });
}

// Optional sort for GET /library/:list. Absent/empty defaults to "newest"; an
// unknown value is rejected rather than silently falling back, so a typo'd sort
// surfaces as a 400 instead of quietly ignoring the caller's intent.
export function parseLibrarySort(value: unknown): LibrarySort {
  if (value === undefined || value === "") {
    return "newest";
  }
  if (
    typeof value === "string" &&
    (LIBRARY_SORTS as readonly string[]).includes(value)
  ) {
    return value as LibrarySort;
  }
  throw badRequest(`sort must be one of: ${LIBRARY_SORTS.join(", ")}`, {
    code: "INVALID_LIBRARY_SORT",
    details: { field: "sort" },
  });
}
