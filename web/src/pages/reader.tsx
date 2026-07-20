import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { listReadyChapters } from "@/api/chapter";
import type { ReaderChapter } from "@/api/chapter";
import {
  getChapterWithPages,
  getReadingProgress,
  markChapterRead,
  saveReadingProgress,
} from "@/api/reader";
import type { ReaderChapterDetail, ReaderChapterPage } from "@/api/reader";
import { ErrorState, Loading } from "@/components/states";
import { navigateTo } from "@/router";
import {
  getReaderState,
  goToPage,
  isFirstPage,
  isLastPage,
  loadReaderDetail,
  nextPage,
  previousPage,
} from "@/state/reader";
import { useReaderState, useSession } from "@/state/hooks";
import { getSession } from "@/state/session";
import {
  cycleReaderDirection,
  cycleReaderFitMode,
  cycleReaderPreloadCount,
  getReaderDirection,
  getReaderFitMode,
  getReaderPreloadCount,
  getReaderTapZonesEnabled,
  toggleReaderTapZones,
} from "@/state/settings";
import type { ReaderFitMode } from "@/state/settings";

// Chapter list cached per manga at module scope so findAdjacentChapter (rollover)
// and the chapter overlay share one fetch across mounts. invalidateChapterCache
// is imported by pages/manga.tsx to drop the stale list on that page's load.
const chapterListCache = new Map<string, ReaderChapter[]>();

export function invalidateChapterCache(mangaId: string): void {
  chapterListCache.delete(mangaId);
}

async function loadChapterList(mangaId: string): Promise<ReaderChapter[]> {
  const cached = chapterListCache.get(mangaId);
  if (cached) return cached;
  const chapters = await listReadyChapters(mangaId);
  chapterListCache.set(mangaId, chapters);
  return chapters;
}

async function findAdjacentChapter(
  mangaId: string,
  current: ReaderChapter,
  direction: "prev" | "next"
): Promise<ReaderChapter | null> {
  try {
    const chapters = await loadChapterList(mangaId);
    const currentIndex = chapters.findIndex((c) => c.id === current.id);
    if (currentIndex < 0) return null;
    const targetIndex =
      direction === "prev" ? currentIndex - 1 : currentIndex + 1;
    return chapters[targetIndex] ?? null;
  } catch {
    return null;
  }
}

const mangaPath = (mangaId: string): string =>
  `/manga/${encodeURIComponent(mangaId)}`;
const chapterPath = (mangaId: string, chapterId: string): string =>
  `/manga/${encodeURIComponent(mangaId)}/chapter/${encodeURIComponent(chapterId)}`;

function isFullscreen(): boolean {
  return !!(
    document.fullscreenElement ||
    (document as unknown as { webkitFullscreenElement?: Element })
      .webkitFullscreenElement
  );
}

function toggleFullscreen(): void {
  if (isFullscreen()) {
    if (document.exitFullscreen) {
      void document.exitFullscreen();
    } else {
      (
        document as unknown as { webkitExitFullscreen?: () => void }
      ).webkitExitFullscreen?.();
    }
  } else {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      void el.requestFullscreen();
    } else {
      (
        el as unknown as { webkitRequestFullscreen?: () => void }
      ).webkitRequestFullscreen?.();
    }
  }
}

// Prefetch <link> tags for the next N pages (Preload setting). Paged mode only;
// vertical renders every page with native lazy loading. Deduped by href.
function preloadAdjacentImages(
  pages: ReaderChapterPage[],
  currentIndex: number
): void {
  const count = getReaderPreloadCount();
  for (let offset = 1; offset <= count; offset++) {
    const i = currentIndex + offset;
    if (i >= pages.length) break;
    const href = pages[i].imageUrl;
    if (document.querySelector(`link[href="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "image";
    link.href = href;
    document.head.appendChild(link);
  }
}

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; detail: ReaderChapterDetail };

export function ReaderPage({
  mangaId,
  chapterId,
}: {
  mangaId: string;
  chapterId: string;
}): ReactElement {
  const loggedIn = Boolean(useSession().user);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let ignore = false;
    setPhase({ kind: "loading" });
    void (async () => {
      // Live session read: on a hard load the reader mounts while bootstrap is
      // pending (no user), and the app remounts it once a user resolves.
      const signedIn = Boolean(getSession().user);
      try {
        const [detail, progress] = await Promise.all([
          getChapterWithPages(mangaId, chapterId),
          signedIn ? getReadingProgress(mangaId) : Promise.resolve(null),
        ]);
        if (ignore) return;
        let startIndex = 0;
        if (progress && progress.chapterId === chapterId) {
          const pageIndex = detail.pages.findIndex(
            (p) => p.id === progress.pageId
          );
          if (pageIndex >= 0) startIndex = pageIndex;
        }
        loadReaderDetail(mangaId, detail, startIndex);
        setPhase({ kind: "ready", detail });
      } catch (error) {
        if (ignore) return;
        setPhase({
          kind: "error",
          message:
            error instanceof Error ? error.message : "Unable to load chapter.",
        });
      }
    })();
    return () => {
      ignore = true;
    };
  }, [mangaId, chapterId]);

  if (phase.kind === "loading") {
    return <Loading message="Loading chapter" />;
  }
  if (phase.kind === "error") {
    return <ErrorState message={phase.message} />;
  }
  // key on chapterId so every chapter open remounts with fresh state (end card,
  // overlay, settings pop, marked-read set, last-saved page) — the router already
  // remounts per navigation, this makes the reset explicit.
  return (
    <ReaderView
      key={chapterId}
      mangaId={mangaId}
      detail={phase.detail}
      loggedIn={loggedIn}
    />
  );
}

function ReaderView({
  mangaId,
  detail,
  loggedIn,
}: {
  mangaId: string;
  detail: ReaderChapterDetail;
  loggedIn: boolean;
}): ReactElement | null {
  const state = useReaderState();
  // Settings (direction/fit/preload) are non-observable localStorage; bump a
  // counter after each cycle so the render re-reads them.
  const [, setSettingsTick] = useState(0);
  const bumpSettings = (): void => setSettingsTick((t) => t + 1);
  const [onEndCard, setOnEndCard] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const mountedRef = useRef(true);
  // Last successfully saved page, so rebuilds that keep the position (settings
  // toggles) do not re-PUT. Left unset on failure so the next event retries.
  const lastSavedPageIdRef = useRef<string | null>(null);
  // One mark-read per chapter open; a failed mark un-guards for retry.
  const markedReadRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The debounced save's target, so an unmount before the timer fires can flush
  // it instead of dropping it. Cleared when the timer fires.
  const pendingSaveRef = useRef<{ chapterId: string; pageId: string } | null>(
    null
  );
  const gearRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const jumpFrameRef = useRef<number | null>(null);

  const chapter = detail.chapter;
  const pages = detail.pages;
  const currentIndex = state.currentPageIndex;
  const page = pages[currentIndex];

  const direction = getReaderDirection(mangaId);
  const fitMode = getReaderFitMode();
  const preloadCount = getReaderPreloadCount();
  const tapZonesEnabled = getReaderTapZonesEnabled();

  // Progress save status chip. Successful saves are silent (a per-page "Saved"
  // flash reads as noise — user feedback); only "Save failed" surfaces, and the
  // next successful save clears it. Signed-in only.
  const saveProgress = useCallback(
    (p: ReaderChapterPage): void => {
      // Live session read (matches vanilla): stays stable across the bootstrap
      // session flip so it never schedules a stray save for the pre-resume page.
      if (!getSession().user) return;
      // Reaching the last page marks the chapter read (any direction maps to the
      // last index). Best-effort, one request per chapter open.
      if (isLastPage() && !markedReadRef.current.has(p.chapterId)) {
        markedReadRef.current.add(p.chapterId);
        void markChapterRead(mangaId, p.chapterId).catch(() => {
          markedReadRef.current.delete(p.chapterId);
        });
      }
      // Position unchanged since the last successful save: nothing to persist.
      if (p.id === lastSavedPageIdRef.current) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // Record the pending target so the unmount cleanup can flush it.
      pendingSaveRef.current = { chapterId: p.chapterId, pageId: p.id };
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        pendingSaveRef.current = null;
        void saveReadingProgress(mangaId, p.chapterId, p.id)
          .then(() => {
            lastSavedPageIdRef.current = p.id;
            if (mountedRef.current) setSaveFailed(false);
          })
          .catch(() => {
            if (mountedRef.current) setSaveFailed(true);
          });
      }, 500);
    },
    [mangaId]
  );

  // Flush the pending debounce and flag stale async on unmount (route change).
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (jumpFrameRef.current !== null) {
        cancelAnimationFrame(jumpFrameRef.current);
      }
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        // Fire the pending save immediately instead of dropping it on a fast
        // route change. Fire-and-forget: mountedRef is already false, so
        // the handlers won't touch state after unmount.
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        if (pending) {
          void saveReadingProgress(
            mangaId,
            pending.chapterId,
            pending.pageId
          ).catch(() => {});
        }
      }
    };
  }, []);

  // Persist progress on the resume page (mount) and on every page change. The
  // end card never saves; the index only changes off the end card, so this fires
  // only for real pages.
  useEffect(() => {
    if (onEndCard) return;
    const p = pages[currentIndex];
    if (p) saveProgress(p);
  }, [currentIndex, saveProgress]);

  // Prefetch pages ahead (paged mode only). Re-runs when the page, preload count,
  // or direction changes; the end card guard covers cycling settings off the end.
  useEffect(() => {
    if (onEndCard || direction === "vertical") return;
    preloadAdjacentImages(pages, currentIndex);
  }, [currentIndex, preloadCount, direction]);

  const openOverlay = useCallback(() => setOverlayOpen(true), []);
  const closeOverlay = useCallback(() => setOverlayOpen(false), []);

  // Semantic page step shared by tap zones, control-bar ‹›, and keyboard.
  // Forward at the last page goes to the next chapter when one exists, else the
  // "you're caught up" end card; backward exits the end card first, then steps
  // pages, then rolls over to the previous chapter.
  const handleStep = useCallback(
    async (dir: "prev" | "next"): Promise<void> => {
      if (onEndCard) {
        if (dir === "prev") setOnEndCard(false);
        return;
      }
      if (dir === "next") {
        if (!isLastPage()) {
          nextPage();
          return;
        }
        const adjacent = await findAdjacentChapter(mangaId, chapter, "next");
        if (!mountedRef.current) return;
        if (adjacent) navigateTo(chapterPath(mangaId, adjacent.id));
        else setOnEndCard(true);
        return;
      }
      if (!isFirstPage()) {
        previousPage();
        return;
      }
      const adjacent = await findAdjacentChapter(mangaId, chapter, "prev");
      if (!mountedRef.current) return;
      if (adjacent) navigateTo(chapterPath(mangaId, adjacent.id));
    },
    [onEndCard, mangaId, chapter]
  );

  // « rewinds to page 1 first, then (already there) jumps to the previous
  // chapter — like a player's ⏮, and never a silent no-op mid-chapter.
  // » jumps to the next chapter; with no next it shows the end card.
  const goToAdjacentChapter = useCallback(
    async (dir: "prev" | "next"): Promise<void> => {
      if (dir === "prev") {
        if (onEndCard) {
          setOnEndCard(false);
          return;
        }
        if (!isFirstPage()) {
          goToPage(0);
          return;
        }
      }
      const adjacent = await findAdjacentChapter(mangaId, chapter, dir);
      if (!mountedRef.current) return;
      if (adjacent) navigateTo(chapterPath(mangaId, adjacent.id));
      else if (dir === "next" && !onEndCard) setOnEndCard(true);
    },
    [mangaId, chapter, onEndCard]
  );

  // Tap zones map to semantic steps; RTL flips left/right.
  const tapStep = (physical: "prev" | "next"): void => {
    const isRtl = getReaderDirection(mangaId) === "rtl";
    const semantic =
      physical === "next"
        ? isRtl
          ? "prev"
          : "next"
        : isRtl
          ? "next"
          : "prev";
    void handleStep(semantic);
  };

  // Direct jump from the page-number select. Vertical mode also scrolls, since
  // its position is the scroll offset, not the store index.
  const jumpToPage = (idx: number): void => {
    setOnEndCard(false);
    goToPage(idx);
    if (getReaderDirection(mangaId) === "vertical") {
      if (jumpFrameRef.current !== null) {
        cancelAnimationFrame(jumpFrameRef.current);
      }
      jumpFrameRef.current = requestAnimationFrame(() => {
        jumpFrameRef.current = null;
        document
          .querySelector(`[data-page-index="${idx}"]`)
          ?.scrollIntoView({ block: "start" });
      });
    }
  };

  // IntersectionObserver in vertical mode reports the visible page; the save
  // effect above persists it after the store index updates.
  const onVisiblePage = useCallback((idx: number): void => {
    if (idx === getReaderState().currentPageIndex) return;
    goToPage(idx);
  }, []);

  // Document-level shortcuts. Re-attached when the flags it branches on change so
  // the closure never goes stale.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // A focused control keeps its keys (Space activates, arrows move within a
      // select) — except Escape, which no control consumes, so the reader's
      // close/exit priority below still applies with a button focused.
      const el = e.target as HTMLElement | null;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        (el?.isContentEditable || el?.closest("button, a, select, [role=menuitem]")) &&
        e.key !== "Escape"
      ) {
        return;
      }
      if (overlayOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeOverlay();
        }
        return;
      }
      // ESC closes the settings popup before exiting the reader; page turns keep
      // working with the popup open.
      if (settingsOpen && e.key === "Escape") {
        e.preventDefault();
        setSettingsOpen(false);
        return;
      }
      if (isFullscreen() && e.key === "Escape") return;
      // "J" opens the chapter overlay + focuses its search (see ChapterOverlay).
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        openOverlay();
        return;
      }
      const isRtl = getReaderDirection(mangaId) === "rtl";
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        void handleStep(isRtl ? "prev" : "next");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        void handleStep(isRtl ? "next" : "prev");
      } else if (e.key === "Escape") {
        e.preventDefault();
        navigateTo(mangaPath(mangaId));
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [overlayOpen, settingsOpen, mangaId, handleStep, openOverlay, closeOverlay]);

  // Settings popup: close on a click outside the popup and off the gear. Escape
  // is handled by the keydown handler above to keep its priority order.
  useEffect(() => {
    if (!settingsOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (
        !popRef.current?.contains(target) &&
        !gearRef.current?.contains(target)
      ) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [settingsOpen]);

  if (!page) return null;

  const chapterLabel =
    chapter.chapterNumber !== null
      ? `Chapter ${chapter.chapterNumber}`
      : `Sort ${chapter.sortOrder}`;
  const directionIcon =
    direction === "ltr" ? "→" : direction === "rtl" ? "←" : "↓";
  const directionLabel =
    direction === "ltr" ? "LTR" : direction === "rtl" ? "RTL" : "Vertical";
  const fitIcon =
    fitMode === "width"
      ? "↔"
      : fitMode === "height"
        ? "↕"
        : "⤢";
  const fitLabel =
    fitMode === "width"
      ? "Fit width"
      : fitMode === "height"
        ? "Fit height"
        : "Original";

  const tapZones = (
    <>
      {tapZonesEnabled ? (
        <div
          className="reader-tap-zone reader-tap-left"
          onClick={() => tapStep("prev")}
        />
      ) : null}
      <div
        className="reader-tap-zone reader-tap-center"
        onClick={openOverlay}
      />
      {tapZonesEnabled ? (
        <div
          className="reader-tap-zone reader-tap-right"
          onClick={() => tapStep("next")}
        />
      ) : null}
    </>
  );

  return (
    <div
      className={`reader-shell${direction === "vertical" ? " reader-shell-vertical" : ""}`}
    >
      <header className="reader-header">
        <button
          className="reader-back"
          type="button"
          onClick={() => navigateTo(mangaPath(mangaId))}
        >
          <span aria-hidden="true">{"←"}</span> Back
        </button>
        <div className="reader-header-info">
          <span className="reader-chapter-title">{chapter.title}</span>
          <span className="reader-chapter-number">{chapterLabel}</span>
        </div>
        <button
          className="reader-fullscreen-btn"
          type="button"
          onClick={toggleFullscreen}
          title="Fullscreen"
          aria-label="Toggle fullscreen"
        >
          {"⛶"}
        </button>
      </header>

      {onEndCard ? (
        <div className="reader-viewport">
          <div className="reader-endcard">
            <p className="reader-endcard-eyebrow">End of {chapterLabel}</p>
            <h2 className="reader-endcard-title">{"You're caught up"}</h2>
            <p className="reader-endcard-sub">
              {"No more chapters yet — check back later."}
            </p>
            <button
              className="reader-endcard-back"
              type="button"
              onClick={() => navigateTo(mangaPath(mangaId))}
            >
              Back to title page
            </button>
          </div>
          {tapZones}
        </div>
      ) : direction === "vertical" ? (
        <VerticalReader
          detail={detail}
          fitMode={fitMode}
          onVisiblePage={onVisiblePage}
        />
      ) : (
        <div className="reader-viewport">
          <PagedImage
            key={page.id}
            page={page}
            fitMode={fitMode}
            index={currentIndex}
          />
          {tapZones}
        </div>
      )}

      <footer className="reader-footer">
        <div className="reader-controlbar">
          <button
            className="reader-ctrl"
            type="button"
            onClick={() => void goToAdjacentChapter("prev")}
            title="First page / previous chapter"
            aria-label="First page, or previous chapter when on first page"
          >
            {"«"}
          </button>
          <button
            className="reader-ctrl"
            type="button"
            onClick={() => void handleStep("prev")}
            title="Previous page"
            aria-label="Previous page"
          >
            {"‹"}
          </button>
          <span className="reader-page-counter">
            <select
              className="reader-page-select"
              value={currentIndex}
              onChange={(e) => jumpToPage(Number(e.target.value))}
              aria-label="Jump to page"
            >
              {pages.map((p, i) => (
                <option key={p.id} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
            {" / "}
            {pages.length}
          </span>
          <button
            className="reader-ctrl"
            type="button"
            onClick={() => void handleStep("next")}
            title="Next page"
            aria-label="Next page"
          >
            {"›"}
          </button>
          <button
            className="reader-ctrl"
            type="button"
            onClick={() => void goToAdjacentChapter("next")}
            title="Next chapter"
            aria-label="Next chapter"
          >
            {"»"}
          </button>
          <span className="reader-ctrl-divider" aria-hidden="true" />
          <button
            className="reader-ctrl"
            type="button"
            onClick={openOverlay}
            title="Chapter list"
            aria-label="Chapter list"
          >
            {"☰"}
          </button>
          <button
            ref={gearRef}
            className={`reader-ctrl${settingsOpen ? " is-active" : ""}`}
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            title="Reader settings"
            aria-label="Reader settings"
            aria-expanded={settingsOpen}
          >
            {"⚙"}
          </button>
          {loggedIn ? (
            <span
              className="reader-save-status"
              data-state={saveFailed ? "failed" : ""}
              role="status"
              aria-live="polite"
            >
              {saveFailed ? "Save failed" : ""}
            </span>
          ) : null}
        </div>
        <div
          ref={popRef}
          className={`reader-settings-pop${settingsOpen ? " is-open" : ""}`}
          role="menu"
          aria-label="Reader settings"
        >
          <button
            className="reader-settings-row"
            type="button"
            role="menuitem"
            title="Reading direction"
            // Writes the per-manga override only; other titles keep their own.
            onClick={() => {
              cycleReaderDirection(mangaId);
              bumpSettings();
            }}
          >
            <span className="reader-settings-name">Direction</span>
            <span className="reader-settings-value">
              <span aria-hidden="true">{directionIcon}</span> {directionLabel}
            </span>
          </button>
          <button
            className="reader-settings-row"
            type="button"
            role="menuitem"
            title="Page fit"
            onClick={() => {
              cycleReaderFitMode();
              bumpSettings();
            }}
          >
            <span className="reader-settings-name">Page fit</span>
            <span className="reader-settings-value">
              <span aria-hidden="true">{fitIcon}</span> {fitLabel}
            </span>
          </button>
          <button
            className="reader-settings-row"
            type="button"
            role="menuitem"
            title="Pages preloaded ahead"
            onClick={() => {
              cycleReaderPreloadCount();
              bumpSettings();
            }}
          >
            <span className="reader-settings-name">Preload</span>
            <span className="reader-settings-value">
              {preloadCount} page{preloadCount === 1 ? "" : "s"}
            </span>
          </button>
          <button
            className="reader-settings-row"
            type="button"
            role="menuitem"
            title="Tap left/right edges to turn pages"
            onClick={() => {
              toggleReaderTapZones();
              bumpSettings();
            }}
          >
            <span className="reader-settings-name">Tap zones</span>
            <span className="reader-settings-value">
              {tapZonesEnabled ? "On" : "Off"}
            </span>
          </button>
        </div>
      </footer>

      <ChapterOverlay
        open={overlayOpen}
        mangaId={mangaId}
        currentChapter={chapter}
        onClose={closeOverlay}
      />
    </div>
  );
}

// Single paged image. Spinner overlay until load, error card on failure. Keyed
// by page in the parent so a page change remounts with a fresh loading state.
function PagedImage({
  page,
  fitMode,
  index,
}: {
  page: ReaderChapterPage;
  fitMode: ReaderFitMode;
  index: number;
}): ReactElement {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // A cached image can already be complete before onLoad binds; check before paint.
  useLayoutEffect(() => {
    if (ref.current?.complete) setLoaded(true);
  }, []);

  return (
    <>
      {!loaded && !errored ? (
        <div className="reader-image-loader">
          <div className="reader-spinner" />
        </div>
      ) : null}
      {errored ? (
        <div className="reader-image-loader">
          <div className="reader-image-error">Unable to load page</div>
        </div>
      ) : null}
      <img
        ref={ref}
        className={`reader-page-image reader-fit-${fitMode}`}
        src={page.imageUrl}
        alt={`Page ${index + 1}`}
        loading="eager"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
      />
    </>
  );
}

// Vertical mode: every page rendered (first 3 eager, rest lazy). Restores scroll
// to the resume page on mount; an IntersectionObserver drives the current page.
function VerticalReader({
  detail,
  fitMode,
  onVisiblePage,
}: {
  detail: ReaderChapterDetail;
  fitMode: ReaderFitMode;
  onVisiblePage: (idx: number) => void;
}): ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pages = detail.pages;

  // Restore to the resume page, captured once before the observer can move it.
  useEffect(() => {
    const restore = getReaderState().currentPageIndex;
    const raf = requestAnimationFrame(() => {
      const target = viewportRef.current?.querySelector<HTMLImageElement>(
        `[data-page-index="${restore}"]`
      );
      target?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.pageIndex);
            if (!Number.isNaN(idx)) onVisiblePage(idx);
          }
        }
      },
      { root, threshold: 0.5 }
    );
    root.querySelectorAll("img").forEach((img) => observer.observe(img));
    return () => observer.disconnect();
  }, [onVisiblePage]);

  return (
    <div ref={viewportRef} className="reader-viewport reader-viewport-scroll">
      {pages.map((p, i) => (
        <img
          key={p.id}
          className={`reader-page-image reader-fit-${fitMode}`}
          src={p.imageUrl}
          alt={`Page ${i + 1}`}
          data-page-index={i}
          loading={i < 3 ? "eager" : "lazy"}
        />
      ))}
      <div className="reader-vertical-hint">Scroll to read</div>
    </div>
  );
}

// Chapter list overlay with live search (title / chapter number / sort order,
// partial, case-insensitive). Fresh open clears the query + focuses the input.
function ChapterOverlay({
  open,
  mangaId,
  currentChapter,
  onClose,
}: {
  open: boolean;
  mangaId: string;
  currentChapter: ReaderChapter;
  onClose: () => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [listState, setListState] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [chapters, setChapters] = useState<ReaderChapter[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    let ignore = false;
    const cached = chapterListCache.get(mangaId);
    if (cached) {
      setChapters(cached);
      setListState("ready");
    } else {
      setListState("loading");
      loadChapterList(mangaId)
        .then((chs) => {
          if (!ignore) {
            setChapters(chs);
            setListState("ready");
          }
        })
        .catch(() => {
          if (!ignore) setListState("error");
        });
    }
    // Focus so "J" lands the caret.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      ignore = true;
      cancelAnimationFrame(raf);
    };
  }, [open, mangaId]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? chapters.filter((c) => {
        const numStr = c.chapterNumber !== null ? String(c.chapterNumber) : "";
        return (
          c.title.toLowerCase().includes(q) ||
          numStr.includes(q) ||
          String(c.sortOrder).includes(q)
        );
      })
    : chapters;

  return (
    <div
      className={`reader-chapter-overlay${open ? " reader-chapter-overlay-open" : ""}`}
    >
      <div className="reader-chapter-overlay-backdrop" onClick={onClose} />
      <div className="reader-chapter-overlay-panel">
        <div className="reader-chapter-overlay-header">
          <h3>Chapters</h3>
          <button
            className="reader-close-overlay"
            type="button"
            onClick={onClose}
          >
            {"×"}
          </button>
        </div>
        <div className="reader-chapter-overlay-search">
          <input
            ref={inputRef}
            type="text"
            className="reader-chapter-overlay-search-input"
            placeholder="Search chapters..."
            aria-label="Search chapters"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // The global keydown handler early-returns on input targets, so close
            // the overlay from here.
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.currentTarget.blur();
                onClose();
              }
            }}
          />
        </div>
        <div className="reader-chapter-overlay-list">
          {listState === "loading" ? (
            <div className="reader-spinner" />
          ) : listState === "error" ? (
            <div className="reader-image-error">Unable to load chapters</div>
          ) : filtered.length === 0 ? (
            <div className="reader-overlay-empty">No chapters found</div>
          ) : (
            filtered.map((c) => {
              const isCurrent = c.id === currentChapter.id;
              const num =
                c.chapterNumber !== null
                  ? `Ch. ${c.chapterNumber}`
                  : `Sort ${c.sortOrder}`;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`reader-overlay-chapter-row${isCurrent ? " reader-overlay-chapter-current" : ""}`}
                  onClick={() => {
                    onClose();
                    navigateTo(chapterPath(mangaId, c.id));
                  }}
                >
                  <span className="reader-overlay-chapter-num">{num}</span>
                  <span className="reader-overlay-chapter-title">{c.title}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
