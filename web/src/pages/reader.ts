import { listReadyChapters } from "@/api/chapter";
import type { ReaderChapter } from "@/api/chapter";
import {
  getChapterWithPages,
  getReadingProgress,
  markChapterRead,
  saveReadingProgress,
} from "@/api/reader";
import type { ReaderChapterPage } from "@/api/reader";
import { renderError, renderLoading } from "@/components/states";
import { navigateTo } from "@/router";
import {
  getCurrentPage,
  getReaderState,
  isLastPage,
  isFirstPage,
  loadReaderDetail,
  nextPage,
  previousPage,
  goToPage,
  resetReaderState,
  subscribeReader,
  getTotalPages,
} from "@/state/reader";
import {
  getReaderDirection,
  getReaderFitMode,
  getReaderPreloadCount,
  cycleReaderDirection,
  cycleReaderFitMode,
  cycleReaderPreloadCount,
} from "@/state/settings";
import { getSession } from "@/state/session";
import { escapeHtml } from "@/utils/dom";

let saveProgressTimer: ReturnType<typeof setTimeout> | null = null;
let chapterListCache: Map<string, ReaderChapter[]> = new Map();
let chapterOverlayOpen = false;
// Live filter query for the chapter overlay search box. Module-level so the
// input handler and the row renderer share it; reset whenever the overlay opens
// fresh and on a new chapter load.
let chapterSearchQuery = "";
// Settings popup (direction/fit/preload) anchored to the control bar's gear.
// Module flag so cycling a setting (which rebuilds the view) keeps it open.
let settingsPopOpen = false;
// Synthetic end card past the last page, shown only when stepping forward at
// the chapter's end with no next chapter ("you're caught up"). With a next
// chapter the step navigates straight to it, as before. Page counter is
// untouched (real page totals only).
let onEndCard = false;
let teardownView: (() => void) | null = null;
// Chapters auto-marked read this view, so reaching the last page fires one mark
// per chapter open instead of on every re-render. Cleared when a chapter loads.
let markedReadChapters: Set<string> = new Set();
// Last successfully saved page, so view rebuilds that do not change the
// position (settings toggles, popup opens) do not re-PUT. Cleared when a
// chapter loads; left unset on failure so the next event retries.
let lastSavedPageId: string | null = null;

export async function renderReaderPage(
  container: HTMLElement,
  mangaId: string,
  chapterId: string
): Promise<void> {
  resetReaderState();
  chapterOverlayOpen = false;
  chapterSearchQuery = "";
  settingsPopOpen = false;
  onEndCard = false;
  markedReadChapters = new Set();
  lastSavedPageId = null;
  container.innerHTML = renderLoading("Loading chapter");

  try {
    const [detail, progress] = await Promise.all([
      getChapterWithPages(mangaId, chapterId),
      getSession().user ? getReadingProgress(mangaId) : Promise.resolve(null),
    ]);

    let startIndex = 0;
    if (progress && progress.chapterId === chapterId) {
      const pageIndex = detail.pages.findIndex(
        (p) => p.id === progress.pageId
      );
      if (pageIndex >= 0) {
        startIndex = pageIndex;
      }
    }

    loadReaderDetail(mangaId, detail, startIndex);
    renderReaderView(container, mangaId);
  } catch (error) {
    container.innerHTML = renderError(
      error instanceof Error ? error.message : "Unable to load chapter."
    );
  }
}

function renderReaderView(container: HTMLElement, mangaId: string): void {
  teardownView?.();
  teardownView = null;

  const state = getReaderState();
  if (!state.detail) return;

  const page = getCurrentPage();
  if (!page) return;

  const chapter = state.detail.chapter;
  const chapterLabel =
    chapter.chapterNumber !== null
      ? `Chapter ${chapter.chapterNumber}`
      : `Sort ${chapter.sortOrder}`;
  // Direction resolves per manga (override map, global fallback); fit and
  // preload stay global preferences.
  const direction = getReaderDirection(mangaId);
  const fitMode = getReaderFitMode();
  const preloadCount = getReaderPreloadCount();

  const directionIcon = direction === "ltr" ? "\u2192" : direction === "rtl" ? "\u2190" : "\u2193";
  const directionLabel = direction === "ltr" ? "LTR" : direction === "rtl" ? "RTL" : "Vertical";
  const fitIcon = fitMode === "width" ? "\u2194" : fitMode === "height" ? "\u2195" : "\u2922";
  const fitLabel = fitMode === "width" ? "Fit width" : fitMode === "height" ? "Fit height" : "Original";

  container.innerHTML = `
    <div class="reader-shell${direction === "vertical" ? " reader-shell-vertical" : ""}">
      <header class="reader-header">
        <button class="reader-back" type="button" data-action="back">
          <span aria-hidden="true">&larr;</span> Back
        </button>
        <div class="reader-header-info">
          <span class="reader-chapter-title">${escapeHtml(chapter.title)}</span>
          <span class="reader-chapter-number">${escapeHtml(chapterLabel)}</span>
        </div>
        <button class="reader-fullscreen-btn" type="button" data-action="fullscreen" title="Fullscreen" aria-label="Toggle fullscreen">
          &#x26F6;
        </button>
      </header>
      <div class="reader-viewport" data-action="viewport">
        ${
          onEndCard
            ? `
        <div class="reader-endcard">
          <p class="reader-endcard-eyebrow">End of ${escapeHtml(chapterLabel)}</p>
          <h2 class="reader-endcard-title">You're caught up</h2>
          <p class="reader-endcard-sub">No more chapters yet — check back later.</p>
          <button class="reader-endcard-back" type="button" data-action="endcard-back">Back to title page</button>
        </div>
        <div class="reader-tap-zone reader-tap-left" data-action="prev"></div>
        <div class="reader-tap-zone reader-tap-center" data-action="menu"></div>
        <div class="reader-tap-zone reader-tap-right" data-action="next"></div>
        `
            : `
        <div class="reader-image-loader" data-action="loader">
          <div class="reader-spinner"></div>
        </div>
        <img
          class="reader-page-image reader-fit-${fitMode}"
          src="${escapeHtml(page.imageUrl)}"
          alt="Page ${state.currentPageIndex + 1}"
          loading="eager"
          data-page-index="${state.currentPageIndex}"
        />
        ${direction !== "vertical" ? `
        <div class="reader-tap-zone reader-tap-left" data-action="prev"></div>
        <div class="reader-tap-zone reader-tap-center" data-action="menu"></div>
        <div class="reader-tap-zone reader-tap-right" data-action="next"></div>
        ` : `
        <div class="reader-vertical-hint">Scroll to read</div>
        `}
        `
        }
      </div>
      <footer class="reader-footer">
        <div class="reader-controlbar">
          <button class="reader-ctrl" type="button" data-action="prev-chapter" title="Previous chapter" aria-label="Previous chapter">&laquo;</button>
          <button class="reader-ctrl" type="button" data-action="prev-page" title="Previous page" aria-label="Previous page">&lsaquo;</button>
          <span class="reader-page-counter">${state.currentPageIndex + 1} / ${getTotalPages()}</span>
          <button class="reader-ctrl" type="button" data-action="next-page" title="Next page" aria-label="Next page">&rsaquo;</button>
          <button class="reader-ctrl" type="button" data-action="next-chapter" title="Next chapter" aria-label="Next chapter">&raquo;</button>
          <span class="reader-ctrl-divider" aria-hidden="true"></span>
          <button class="reader-ctrl" type="button" data-action="chapters" title="Chapter list" aria-label="Chapter list">&#9776;</button>
          <button class="reader-ctrl${settingsPopOpen ? " is-active" : ""}" type="button" data-action="settings" title="Reader settings" aria-label="Reader settings" aria-expanded="${settingsPopOpen}">&#9881;</button>
          ${getSession().user ? `<span class="reader-save-status" data-role="save-status" role="status" aria-live="polite"></span>` : ""}
        </div>
        <div class="reader-settings-pop${settingsPopOpen ? " is-open" : ""}" data-action="settings-pop" role="menu" aria-label="Reader settings">
          <button class="reader-settings-row" type="button" data-action="direction" role="menuitem" title="Reading direction">
            <span class="reader-settings-name">Direction</span>
            <span class="reader-settings-value"><span aria-hidden="true">${directionIcon}</span> ${directionLabel}</span>
          </button>
          <button class="reader-settings-row" type="button" data-action="fit" role="menuitem" title="Page fit">
            <span class="reader-settings-name">Page fit</span>
            <span class="reader-settings-value"><span aria-hidden="true">${fitIcon}</span> ${fitLabel}</span>
          </button>
          <button class="reader-settings-row" type="button" data-action="preload" role="menuitem" title="Pages preloaded ahead">
            <span class="reader-settings-name">Preload</span>
            <span class="reader-settings-value">${preloadCount} page${preloadCount === 1 ? "" : "s"}</span>
          </button>
        </div>
      </footer>
    </div>
    <div class="reader-chapter-overlay${chapterOverlayOpen ? " reader-chapter-overlay-open" : ""}" data-action="overlay">
      <div class="reader-chapter-overlay-backdrop" data-action="close-overlay"></div>
      <div class="reader-chapter-overlay-panel">
        <div class="reader-chapter-overlay-header">
          <h3>Chapters</h3>
          <button class="reader-close-overlay" type="button" data-action="close-overlay">&times;</button>
        </div>
        <div class="reader-chapter-overlay-search">
          <input
            type="text"
            class="reader-chapter-overlay-search-input"
            data-action="overlay-search"
            placeholder="Search chapters..."
            aria-label="Search chapters"
            autocomplete="off"
          />
        </div>
        <div class="reader-chapter-overlay-list" data-action="overlay-list">
          <div class="reader-spinner"></div>
        </div>
      </div>
    </div>
  `;

  const disposers: Array<() => void> = [];

  wireReaderEvents(container, mangaId, chapter, disposers);
  wireKeyboardShortcuts(container, mangaId, chapter, disposers);

  if (onEndCard) {
    // End card: no progress save (the position stays the last page), no
    // preload, no vertical rebuild — just the card and its back action.
    container
      .querySelector<HTMLElement>("[data-action='endcard-back']")
      ?.addEventListener("click", () => {
        navigateTo(`/manga/${encodeURIComponent(mangaId)}`);
      });
  } else {
    saveProgressDebounced(mangaId, page);
    preloadAdjacentImages(state.detail.pages, state.currentPageIndex);

    if (direction === "vertical") {
      wireVerticalScroll(container, mangaId, disposers);
    }
  }

  disposers.push(() => {
    if (saveProgressTimer) {
      clearTimeout(saveProgressTimer);
      saveProgressTimer = null;
    }
  });

  const shell = container.querySelector<HTMLElement>(".reader-shell");
  let disposed = false;
  const teardown = () => {
    if (disposed) return;
    disposed = true;
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // ignore teardown errors
      }
    }
  };
  teardownView = teardown;

  // Tear down listeners when this view leaves the document (route change).
  // `#app-main` persists across routes, so detect removal of the shell itself.
  const lifecycleObserver = new MutationObserver(() => {
    if (!shell || !document.contains(shell)) {
      teardown();
      lifecycleObserver.disconnect();
    }
  });
  lifecycleObserver.observe(document.body, { childList: true, subtree: true });
  disposers.push(() => lifecycleObserver.disconnect());
}

// Semantic page step shared by tap zones, control-bar ‹›, and keyboard.
// Forward at the last page goes to the next chapter when one exists, otherwise
// shows the "you're caught up" end card; backward exits the end card first,
// then steps pages, then rolls over to the previous chapter.
async function handleStep(
  container: HTMLElement,
  mangaId: string,
  chapter: ReaderChapter,
  dir: "prev" | "next"
): Promise<void> {
  if (onEndCard) {
    if (dir === "prev") {
      onEndCard = false;
      renderReaderView(container, mangaId);
    }
    return;
  }

  if (dir === "next") {
    if (!isLastPage()) {
      nextPage();
      rerender(container, mangaId);
      return;
    }
    const adjacent = await findAdjacentChapter(mangaId, chapter, "next");
    if (adjacent) {
      navigateTo(
        `/manga/${encodeURIComponent(mangaId)}/chapter/${encodeURIComponent(adjacent.id)}`
      );
    } else {
      onEndCard = true;
      renderReaderView(container, mangaId);
    }
    return;
  }

  if (!isFirstPage()) {
    previousPage();
    rerender(container, mangaId);
    return;
  }
  const adjacent = await findAdjacentChapter(mangaId, chapter, "prev");
  if (adjacent) {
    navigateTo(
      `/manga/${encodeURIComponent(mangaId)}/chapter/${encodeURIComponent(adjacent.id)}`
    );
  }
}

function wireReaderEvents(
  container: HTMLElement,
  mangaId: string,
  chapter: ReaderChapter,
  disposers: Array<() => void>
): void {
  const backBtn = container.querySelector<HTMLElement>("[data-action='back']");
  backBtn?.addEventListener("click", () => {
    navigateTo(`/manga/${encodeURIComponent(mangaId)}`);
  });

  container
    .querySelector<HTMLElement>("[data-action='direction']")
    ?.addEventListener("click", () => {
      // Writes the per-manga override only; other titles keep their own (or the
      // global default).
      cycleReaderDirection(mangaId);
      renderReaderView(container, mangaId);
    });

  container
    .querySelector<HTMLElement>("[data-action='fit']")
    ?.addEventListener("click", () => {
      cycleReaderFitMode();
      renderReaderView(container, mangaId);
    });

  container
    .querySelector<HTMLElement>("[data-action='preload']")
    ?.addEventListener("click", () => {
      cycleReaderPreloadCount();
      renderReaderView(container, mangaId);
    });

  // Gear toggles the settings popup; cycling a setting re-renders the view and
  // the module flag keeps the popup open across that rebuild. While open, a
  // click outside the popup (and off the gear) closes it.
  const settingsBtn = container.querySelector<HTMLElement>("[data-action='settings']");
  const settingsPop = container.querySelector<HTMLElement>("[data-action='settings-pop']");
  settingsBtn?.addEventListener("click", () => {
    settingsPopOpen = !settingsPopOpen;
    renderReaderView(container, mangaId);
  });
  if (settingsPopOpen && settingsPop && settingsBtn) {
    const onDocClick = (e: Event): void => {
      const target = e.target as Node;
      if (!settingsPop.contains(target) && !settingsBtn.contains(target)) {
        settingsPopOpen = false;
        renderReaderView(container, mangaId);
      }
    };
    // Register on the next tick so the opening click does not immediately close it.
    const timer = setTimeout(() => document.addEventListener("click", onDocClick), 0);
    disposers.push(() => {
      clearTimeout(timer);
      document.removeEventListener("click", onDocClick);
    });
  }

  container
    .querySelector<HTMLElement>("[data-action='fullscreen']")
    ?.addEventListener("click", () => {
      toggleFullscreen();
    });

  const viewport = container.querySelector<HTMLElement>(
    "[data-action='viewport']"
  );
  // Tap zones map to semantic steps (RTL flips left/right) and share the edge
  // behavior of the arrows/buttons: chapter rollover forward, end card at the
  // catalog's end, previous-chapter rollover backward.
  viewport?.addEventListener("click", (e: Event) => {
    const target = e.target as HTMLElement;
    const action = target.dataset.action;

    if (action === "menu") {
      openChapterOverlay(container, mangaId, chapter);
      return;
    }
    if (action !== "prev" && action !== "next") {
      return;
    }

    const isRtl = getReaderDirection(mangaId) === "rtl";
    const semantic =
      action === "next" ? (isRtl ? "prev" : "next") : isRtl ? "next" : "prev";
    void handleStep(container, mangaId, chapter, semantic);
  });

  container
    .querySelectorAll<HTMLElement>("[data-action='close-overlay']")
    .forEach((el) => {
      el.addEventListener("click", () => {
        closeChapterOverlay(container);
      });
    });

  // Live chapter filter. Re-renders rows on each keystroke from the cached list.
  const searchInput = container.querySelector<HTMLInputElement>("[data-action='overlay-search']");
  searchInput?.addEventListener("input", () => {
    chapterSearchQuery = searchInput.value;
    renderOverlayChapterRows(container, mangaId, chapter);
  });
  // Escape from the focused search box closes the overlay. The global keydown
  // handler early-returns on input targets, so close it here instead.
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      searchInput.blur();
      closeChapterOverlay(container);
    }
  });

  const img = container.querySelector<HTMLImageElement>(".reader-page-image");
  const loader = container.querySelector<HTMLElement>("[data-action='loader']");
  if (img && loader) {
    if (img.complete) {
      loader.remove();
    } else {
      img.addEventListener("load", () => loader.remove());
      img.addEventListener("error", () => {
        loader.innerHTML = `<div class="reader-image-error">Unable to load page</div>`;
      });
    }
  }

  // Control bar. ‹/› step one page semantically via handleStep (chapter
  // rollover at the edges, end card past the last chapter). «/» jump straight
  // to the adjacent chapter; » with no next chapter shows the end card instead
  // of silently doing nothing, « with no previous chapter stays a no-op.
  const goToAdjacentChapter = (dir: "prev" | "next"): void => {
    void findAdjacentChapter(mangaId, chapter, dir).then((adjacent) => {
      if (adjacent) {
        navigateTo(
          `/manga/${encodeURIComponent(mangaId)}/chapter/${encodeURIComponent(adjacent.id)}`
        );
      } else if (dir === "next" && !onEndCard) {
        onEndCard = true;
        renderReaderView(container, mangaId);
      }
    });
  };

  container
    .querySelector<HTMLElement>("[data-action='prev-chapter']")
    ?.addEventListener("click", () => goToAdjacentChapter("prev"));
  container
    .querySelector<HTMLElement>("[data-action='next-chapter']")
    ?.addEventListener("click", () => goToAdjacentChapter("next"));
  container
    .querySelector<HTMLElement>("[data-action='prev-page']")
    ?.addEventListener("click", () => void handleStep(container, mangaId, chapter, "prev"));
  container
    .querySelector<HTMLElement>("[data-action='next-page']")
    ?.addEventListener("click", () => void handleStep(container, mangaId, chapter, "next"));
  container
    .querySelector<HTMLElement>("[data-action='chapters']")
    ?.addEventListener("click", () => {
      openChapterOverlay(container, mangaId, chapter);
    });

  const unsubscribe = subscribeReader(() => {
    rerender(container, mangaId);
  });
  disposers.push(unsubscribe);
}

function wireKeyboardShortcuts(
  container: HTMLElement,
  mangaId: string,
  chapter: ReaderChapter,
  disposers: Array<() => void>
): void {
  const keydownHandler = (e: KeyboardEvent) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    if (chapterOverlayOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeChapterOverlay(container);
      }
      return;
    }

    // ESC closes the settings popup before it exits the reader; other keys
    // (page turns) keep working with the popup open.
    if (settingsPopOpen && e.key === "Escape") {
      e.preventDefault();
      settingsPopOpen = false;
      renderReaderView(container, mangaId);
      return;
    }

    if (isFullscreen()) {
      if (e.key === "Escape") {
        return;
      }
    }

    // "J" opens the chapter overlay and focuses its search box. A focused input
    // is handled by the early return at the top; an already-open overlay by the
    // chapterOverlayOpen branch above — so this only fires from the reader proper.
    if (e.key === "j" || e.key === "J") {
      e.preventDefault();
      void openChapterOverlay(container, mangaId, chapter);
      return;
    }

    const isRtl = getReaderDirection(mangaId) === "rtl";

    // Arrows map to semantic steps (RTL flips them) and share handleStep's
    // edge behavior: chapter rollover, end card at the catalog's end.
    if (e.key === "ArrowRight" || e.key === " ") {
      e.preventDefault();
      void handleStep(container, mangaId, chapter, isRtl ? "prev" : "next");
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      void handleStep(container, mangaId, chapter, isRtl ? "next" : "prev");
    } else if (e.key === "Escape") {
      e.preventDefault();
      navigateTo(`/manga/${encodeURIComponent(mangaId)}`);
    }
  };

  document.addEventListener("keydown", keydownHandler);
  disposers.push(() => document.removeEventListener("keydown", keydownHandler));
}

function rerender(container: HTMLElement, mangaId: string): void {
  const page = getCurrentPage();
  if (!page) return;

  const counter = container.querySelector<HTMLElement>(".reader-page-counter");
  if (counter) {
    counter.textContent = `${getReaderState().currentPageIndex + 1} / ${getTotalPages()}`;
  }

  const loader = container.querySelector<HTMLElement>("[data-action='loader']");
  if (loader) {
    loader.innerHTML = `<div class="reader-spinner"></div>`;
  }

  const img = container.querySelector<HTMLImageElement>(".reader-page-image");
  if (img) {
    img.src = page.imageUrl;
    img.alt = `Page ${getReaderState().currentPageIndex + 1}`;
    img.dataset.pageIndex = String(getReaderState().currentPageIndex);
    if (img.complete) {
      loader?.remove();
    } else {
      img.addEventListener("load", () => loader?.remove());
      img.addEventListener("error", () => {
        if (loader) {
          loader.innerHTML = `<div class="reader-image-error">Unable to load page</div>`;
        }
      });
    }
  }

  const tapLeft = container.querySelector<HTMLElement>(".reader-tap-left");
  if (tapLeft) tapLeft.dataset.action = "prev";
  const tapRight = container.querySelector<HTMLElement>(".reader-tap-right");
  if (tapRight) tapRight.dataset.action = "next";

  saveProgressDebounced(mangaId, page);
  const state = getReaderState();
  if (state.detail) {
    preloadAdjacentImages(state.detail.pages, state.currentPageIndex);
  }
}

// Progress save status chip in the control bar. Successful saves are silent
// (a "Saved" flash on every page turn read as noise — user feedback); the chip
// only surfaces "Save failed", and the next successful save clears it. The
// element only exists for signed-in users; lookups are per-call because
// settings toggles rebuild the reader DOM.
function setSaveStatus(state: "ok" | "failed"): void {
  const el = document.querySelector<HTMLElement>("[data-role='save-status']");
  if (!el) return;
  if (state === "failed") {
    el.dataset.state = "failed";
    el.textContent = "Save failed";
  } else {
    el.dataset.state = "";
    el.textContent = "";
  }
}

function saveProgressDebounced(
  mangaId: string,
  page: ReaderChapterPage
): void {
  if (!getSession().user) return;
  maybeMarkChapterRead(mangaId, page);
  // Position unchanged since the last successful save (e.g. a settings toggle
  // rebuilt the view): nothing to persist.
  if (page.id === lastSavedPageId) return;
  if (saveProgressTimer) {
    clearTimeout(saveProgressTimer);
  }
  saveProgressTimer = setTimeout(async () => {
    try {
      await saveReadingProgress(mangaId, page.chapterId, page.id);
      lastSavedPageId = page.id;
      // Silent on success; clears a lingering "Save failed" chip.
      setSaveStatus("ok");
    } catch {
      setSaveStatus("failed");
    }
    saveProgressTimer = null;
  }, 500);
}

// Reaching a chapter's last page marks it read (any reading direction maps to the
// last page index). Best-effort and guarded to one request per chapter open; a
// failed mark is un-guarded so the next page event can retry.
function maybeMarkChapterRead(
  mangaId: string,
  page: ReaderChapterPage
): void {
  if (!isLastPage()) return;
  if (markedReadChapters.has(page.chapterId)) return;
  markedReadChapters.add(page.chapterId);
  void markChapterRead(mangaId, page.chapterId).catch(() => {
    markedReadChapters.delete(page.chapterId);
  });
}

function preloadAdjacentImages(
  pages: ReaderChapterPage[],
  currentIndex: number
): void {
  // User-configurable lookahead (Preload button in the header); paged mode
  // only — vertical mode renders every page with native lazy loading.
  const count = getReaderPreloadCount();
  const toPreload = Array.from({ length: count }, (_, i) => currentIndex + 1 + i).filter(
    (i) => i < pages.length
  );
  for (const i of toPreload) {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "image";
    link.href = pages[i].imageUrl;
    if (!document.querySelector(`link[href="${pages[i].imageUrl}"]`)) {
      document.head.appendChild(link);
    }
  }
}

async function findAdjacentChapter(
  mangaId: string,
  current: ReaderChapter,
  direction: "prev" | "next"
): Promise<ReaderChapter | null> {
  try {
    let chapters = chapterListCache.get(mangaId);
    if (!chapters) {
      chapters = await listReadyChapters(mangaId);
      chapterListCache.set(mangaId, chapters);
    }
    const currentIndex = chapters.findIndex((c) => c.id === current.id);
    if (currentIndex < 0) return null;

    const targetIndex =
      direction === "prev" ? currentIndex - 1 : currentIndex + 1;
    return chapters[targetIndex] ?? null;
  } catch {
    return null;
  }
}

export function invalidateChapterCache(mangaId: string): void {
  chapterListCache.delete(mangaId);
}

async function openChapterOverlay(
  container: HTMLElement,
  mangaId: string,
  currentChapter: ReaderChapter
): Promise<void> {
  chapterOverlayOpen = true;
  chapterSearchQuery = "";
  const overlay = container.querySelector<HTMLElement>("[data-action='overlay']");
  const listEl = container.querySelector<HTMLElement>("[data-action='overlay-list']");
  const searchInput = container.querySelector<HTMLInputElement>("[data-action='overlay-search']");
  if (!overlay || !listEl) return;

  overlay.classList.add("reader-chapter-overlay-open");

  // Fresh open: clear any stale query and focus the box so "J" lands the caret.
  if (searchInput) {
    searchInput.value = "";
    requestAnimationFrame(() => searchInput.focus());
  }

  try {
    let chapters = chapterListCache.get(mangaId);
    if (!chapters) {
      chapters = await listReadyChapters(mangaId);
      chapterListCache.set(mangaId, chapters);
    }
    renderOverlayChapterRows(container, mangaId, currentChapter);
  } catch {
    listEl.innerHTML = `<div class="reader-image-error">Unable to load chapters</div>`;
  }
}

// Renders (and re-renders) the overlay chapter rows from the cached list,
// applying the live search query. Called once on open and on every keystroke in
// the search box. Filters by title, chapter number, or sort order (partial,
// case-insensitive); shows "No chapters found" when nothing matches. Current
// chapter keeps its highlight via reader-overlay-chapter-current.
function renderOverlayChapterRows(
  container: HTMLElement,
  mangaId: string,
  currentChapter: ReaderChapter
): void {
  const listEl = container.querySelector<HTMLElement>("[data-action='overlay-list']");
  if (!listEl) return;

  const chapters = chapterListCache.get(mangaId) ?? [];
  const q = chapterSearchQuery.trim().toLowerCase();
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

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="reader-overlay-empty">No chapters found</div>`;
    return;
  }

  listEl.innerHTML = filtered
    .map((c) => {
      const isCurrent = c.id === currentChapter.id;
      const num = c.chapterNumber !== null ? `Ch. ${c.chapterNumber}` : `Sort ${c.sortOrder}`;
      return `
        <div class="reader-overlay-chapter-row${isCurrent ? " reader-overlay-chapter-current" : ""}" data-action="overlay-chapter" data-chapter-id="${escapeHtml(c.id)}">
          <span class="reader-overlay-chapter-num">${escapeHtml(num)}</span>
          <span class="reader-overlay-chapter-title">${escapeHtml(c.title)}</span>
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll<HTMLElement>("[data-action='overlay-chapter']").forEach((row) => {
    row.addEventListener("click", () => {
      const chapterId = row.dataset.chapterId;
      if (chapterId) {
        chapterOverlayOpen = false;
        navigateTo(
          `/manga/${encodeURIComponent(mangaId)}/chapter/${encodeURIComponent(chapterId)}`
        );
      }
    });
  });
}

function closeChapterOverlay(container: HTMLElement): void {
  chapterOverlayOpen = false;
  const overlay = container.querySelector<HTMLElement>("[data-action='overlay']");
  overlay?.classList.remove("reader-chapter-overlay-open");
}

function isFullscreen(): boolean {
  return !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
}

function toggleFullscreen(): void {
  if (isFullscreen()) {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen();
    }
  } else {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen();
    } else if ((el as any).webkitRequestFullscreen) {
      (el as any).webkitRequestFullscreen();
    }
  }
}

function wireVerticalScroll(
  container: HTMLElement,
  mangaId: string,
  disposers: Array<() => void>
): void {
  const state = getReaderState();
  if (!state.detail) return;

  const viewport = container.querySelector<HTMLElement>("[data-action='viewport']");
  if (!viewport) return;

  const pages = state.detail.pages;
  viewport.innerHTML = "";
  viewport.classList.add("reader-viewport-scroll");

  for (let i = 0; i < pages.length; i++) {
    const img = document.createElement("img");
    img.src = pages[i].imageUrl;
    img.alt = `Page ${i + 1}`;
    img.className = "reader-page-image reader-fit-" + getReaderFitMode();
    img.dataset.pageIndex = String(i);
    img.loading = i < 3 ? "eager" : "lazy";
    viewport.appendChild(img);
  }

  const restorePage = state.currentPageIndex;
  requestAnimationFrame(() => {
    const target = viewport.querySelector<HTMLImageElement>(`[data-page-index="${restorePage}"]`);
    if (target) {
      target.scrollIntoView({ block: "start" });
    }
  });

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const idx = Number((entry.target as HTMLElement).dataset.pageIndex);
          if (!isNaN(idx) && idx !== state.currentPageIndex) {
            goToPage(idx);
            const page = pages[idx];
            if (page) {
              saveProgressDebounced(mangaId, page);
            }
          }
        }
      }
    },
    { root: viewport, threshold: 0.5 }
  );

  viewport.querySelectorAll("img").forEach((img) => observer.observe(img));

  disposers.push(() => observer.disconnect());
}
