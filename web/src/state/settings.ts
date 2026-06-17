const DIRECTION_KEY = "lazyscan:reader:direction";
const DIRECTION_BY_MANGA_KEY = "lazyscan:reader:directionByManga";
const FIT_MODE_KEY = "lazyscan:reader:fit";
const PRELOAD_KEY = "lazyscan:reader:preload";

export type ReaderDirection = "ltr" | "rtl" | "vertical";
export type ReaderFitMode = "width" | "height" | "original";
// How many upcoming pages the paged reader prefetches. 2 preserves the
// behavior from before this was configurable.
export type ReaderPreloadCount = 1 | 2 | 3 | 5;

const PRELOAD_ORDER: ReaderPreloadCount[] = [1, 2, 3, 5];

function isDirection(value: unknown): value is ReaderDirection {
  return value === "ltr" || value === "rtl" || value === "vertical";
}

// Per-manga direction overrides: one localStorage JSON map keyed by manga id.
// A malformed map is treated as empty rather than breaking the reader.
function readDirectionOverrides(): Record<string, ReaderDirection> {
  try {
    const raw = localStorage.getItem(DIRECTION_BY_MANGA_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const overrides: Record<string, ReaderDirection> = {};
    for (const [mangaId, direction] of Object.entries(parsed)) {
      if (isDirection(direction)) {
        overrides[mangaId] = direction;
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

// The per-manga override wins; the global preference is the fallback for
// titles never adjusted. Cycling inside the reader writes the override only
// (the global default no longer flips while reading one title).
export function getReaderDirection(mangaId?: string): ReaderDirection {
  if (mangaId) {
    const override = readDirectionOverrides()[mangaId];
    if (override) return override;
  }
  const stored = localStorage.getItem(DIRECTION_KEY);
  if (isDirection(stored)) return stored;
  return "ltr";
}

export function setReaderDirection(direction: ReaderDirection): void {
  localStorage.setItem(DIRECTION_KEY, direction);
}

export function setReaderDirectionForManga(
  mangaId: string,
  direction: ReaderDirection
): void {
  const overrides = readDirectionOverrides();
  overrides[mangaId] = direction;
  localStorage.setItem(DIRECTION_BY_MANGA_KEY, JSON.stringify(overrides));
}

export function cycleReaderDirection(mangaId?: string): ReaderDirection {
  const order: ReaderDirection[] = ["ltr", "rtl", "vertical"];
  const current = getReaderDirection(mangaId);
  const idx = order.indexOf(current);
  const next = order[(idx + 1) % order.length];
  if (mangaId) {
    setReaderDirectionForManga(mangaId, next);
  } else {
    setReaderDirection(next);
  }
  return next;
}

export function getReaderFitMode(): ReaderFitMode {
  const stored = localStorage.getItem(FIT_MODE_KEY);
  if (stored === "width" || stored === "height" || stored === "original") return stored;
  return "width";
}

export function setReaderFitMode(mode: ReaderFitMode): void {
  localStorage.setItem(FIT_MODE_KEY, mode);
}

export function cycleReaderFitMode(): ReaderFitMode {
  const order: ReaderFitMode[] = ["width", "height", "original"];
  const current = getReaderFitMode();
  const idx = order.indexOf(current);
  const next = order[(idx + 1) % order.length];
  setReaderFitMode(next);
  return next;
}

export function getReaderPreloadCount(): ReaderPreloadCount {
  const stored = Number(localStorage.getItem(PRELOAD_KEY));
  const match = PRELOAD_ORDER.find((count) => count === stored);
  return match ?? 2;
}

export function setReaderPreloadCount(count: ReaderPreloadCount): void {
  localStorage.setItem(PRELOAD_KEY, String(count));
}

export function cycleReaderPreloadCount(): ReaderPreloadCount {
  const current = getReaderPreloadCount();
  const idx = PRELOAD_ORDER.indexOf(current);
  const next = PRELOAD_ORDER[(idx + 1) % PRELOAD_ORDER.length];
  setReaderPreloadCount(next);
  return next;
}
