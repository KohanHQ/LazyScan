import { clearReadingProgress, getReadingHistory } from "@/api/reader";
import type { MangaHistoryEntry } from "@/api/reader";
import { renderEmpty, renderError } from "@/components/states";
import { icons } from "@/components/icons";
import { requireSessionForPage } from "@/components/page-session";
import {
  animateIn,
  escapeHtml,
  formatDate,
  renderCover,
  wireClickableRows,
  wireCoverFallbacks,
} from "@/utils/dom";

function heading(meta = ""): string {
  return `
    <section class="page-heading">
      <div>
        <h1>History</h1>
      </div>
      ${meta}
    </section>
  `;
}

const PAGE_SIZE = 20;

export function renderHistoryPage(container: HTMLElement): void {
  // Auth-gated like favorites/manage: wait for session bootstrap before deciding
  // login-vs-content, so a hard load doesn't flash a "sign in" state then re-render
  // (the double render read as a harsh double fade).
  requireSessionForPage(container, "/history", {
    loading: "Loading history",
    loginMessage:
      "Reading history is saved to your account. Log in to see what you were reading.",
    onReady: () => void loadHistory(container),
  });
}

async function loadHistory(container: HTMLElement): Promise<void> {
  // First page decides between the empty state and the paged history shell.
  let firstPage: MangaHistoryEntry[];
  try {
    firstPage = await getReadingHistory({ limit: PAGE_SIZE, offset: 0 });
  } catch (error) {
    if (window.location.pathname !== "/history") {
      return;
    }
    container.innerHTML = `
      ${heading()}
      ${renderError(error instanceof Error ? error.message : "Unable to load history.")}
    `;
    animateIn(container);
    return;
  }

  if (window.location.pathname !== "/history") {
    return;
  }

  if (firstPage.length === 0) {
    container.innerHTML = `
      ${heading()}
      ${renderEmpty("No history yet", "Chapters you read will appear here.", icons.inbox())}
    `;
    animateIn(container);
    return;
  }

  container.innerHTML = `
    ${heading(`<p class="heading-meta" data-role="count"></p>`)}
    <ol class="history-list" data-role="list"></ol>
    <div class="library-sentinel" data-role="sentinel" aria-hidden="true"></div>
    <button class="secondary-button library-more" type="button" data-role="more" hidden>Load more</button>
  `;
  animateIn(container);

  const listEl = container.querySelector<HTMLElement>("[data-role='list']")!;
  const count = container.querySelector<HTMLElement>("[data-role='count']");
  const sentinel = container.querySelector<HTMLElement>("[data-role='sentinel']");
  const moreButton = container.querySelector<HTMLButtonElement>("[data-role='more']");

  // Server-side paging over GET /reader/history via limit/offset.
  let offset = 0;
  let loading = false;
  let done = false;

  // The button is only a fallback when IntersectionObserver is unavailable; with
  // it, the sentinel drives infinite scroll and the button stays hidden.
  const hasObserver = "IntersectionObserver" in window;
  const toggleMore = (): void => {
    if (moreButton) {
      moreButton.hidden = hasObserver || done || loading;
    }
  };
  const updateCount = (): void => {
    if (count) {
      const n = listEl.querySelectorAll("[data-manga-id]").length;
      count.textContent = `${n} title${n === 1 ? "" : "s"}`;
    }
  };

  const wireRows = (scope: HTMLElement): void => {
    wireClickableRows(scope, "[data-action='continue-read']", (row) => {
      const mangaId = row.dataset.mangaId;
      const chapterId = row.dataset.chapterId;
      return mangaId && chapterId
        ? `/manga/${encodeURIComponent(mangaId)}/chapter/${encodeURIComponent(chapterId)}`
        : null;
    });
  };

  // Per-row "Remove" clears that manga's progress and drops the row. The row is
  // the clickable nav target, so stop the button's click/keys from bubbling to it.
  const wireRemoves = (scope: HTMLElement): void => {
    scope
      .querySelectorAll<HTMLButtonElement>("[data-action='remove-history']")
      .forEach((button) => {
        button.addEventListener("keydown", (event) => event.stopPropagation());
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const row = button.closest<HTMLElement>(".history-row");
          const mangaId = row?.dataset.mangaId;
          if (!mangaId) {
            return;
          }
          button.disabled = true;
          void clearReadingProgress(mangaId)
            .then(() => {
              row?.remove();
              updateCount();
              if (listEl.querySelectorAll("[data-manga-id]").length === 0) {
                container.innerHTML = `
                  ${heading()}
                  ${renderEmpty("No history yet", "Chapters you read will appear here.", icons.inbox())}
                `;
                animateIn(container);
              }
            })
            .catch(() => {
              button.disabled = false;
            });
        });
      });
  };

  // Wire new rows in a detached node so listeners are not duplicated on already
  // rendered rows, then move them into the live list.
  const appendRows = (entries: MangaHistoryEntry[]): void => {
    const batch = document.createElement("div");
    batch.innerHTML = entries.map(renderHistoryRow).join("");
    wireCoverFallbacks(batch);
    wireRows(batch);
    wireRemoves(batch);
    while (batch.firstChild) {
      listEl.appendChild(batch.firstChild);
    }
    updateCount();
  };

  const loadMore = async (): Promise<void> => {
    if (loading || done) {
      return;
    }
    loading = true;
    toggleMore();
    try {
      const page = await getReadingHistory({ limit: PAGE_SIZE, offset });
      appendRows(page);
      offset += page.length;
      done = page.length < PAGE_SIZE;
    } catch {
      // Stop auto-loading on error.
      done = true;
    } finally {
      loading = false;
      toggleMore();
    }
  };

  // Seed with the already-fetched first page (avoids a duplicate request).
  appendRows(firstPage);
  offset = firstPage.length;
  done = firstPage.length < PAGE_SIZE;
  toggleMore();

  if (sentinel && hasObserver) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
  }

  moreButton?.addEventListener("click", () => void loadMore());
}

// Chapter-level progress percent for a history entry. The page count can be 0
// for a chapter whose pages were since removed; render no percent then.
export function historyProgressPercent(entry: MangaHistoryEntry): number | null {
  if (entry.chapterPageCount <= 0) {
    return null;
  }
  const ratio = entry.pageNumber / entry.chapterPageCount;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

export function historyChapterLabel(entry: MangaHistoryEntry): string {
  return entry.chapterNumber !== null
    ? `Ch. ${entry.chapterNumber} · ${entry.chapterTitle}`
    : entry.chapterTitle;
}

function renderHistoryRow(entry: MangaHistoryEntry): string {
  const cover = renderCover({
    url: entry.coverUrl,
    seed: entry.title,
    placeholderClass: "history-cover-placeholder",
    imgAttrs: 'loading="lazy"',
  });
  const percent = historyProgressPercent(entry);
  const pages =
    entry.chapterPageCount > 0
      ? `Page ${entry.pageNumber}/${entry.chapterPageCount}`
      : `Page ${entry.pageNumber}`;
  const progress = percent !== null ? `${pages} · ${percent}%` : pages;

  return `
    <li class="history-row" data-action="continue-read" data-manga-id="${escapeHtml(entry.mangaId)}" data-chapter-id="${escapeHtml(entry.chapterId)}" tabindex="0" role="button" aria-label="Continue reading ${escapeHtml(entry.title)}">
      <div class="history-row-cover">${cover}</div>
      <div class="history-row-body">
        <h3>${escapeHtml(entry.title)}</h3>
        <p class="history-row-chapter">${escapeHtml(historyChapterLabel(entry))}</p>
        <p>${escapeHtml(progress)} &middot; ${escapeHtml(formatDate(entry.updatedAt))}</p>
      </div>
      <span class="history-resume" aria-hidden="true">Resume</span>
      <button class="history-remove" type="button" data-action="remove-history" aria-label="Remove ${escapeHtml(entry.title)} from history">Remove</button>
    </li>
  `;
}
