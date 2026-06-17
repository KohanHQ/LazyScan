import { getLibraryFeed } from "@/api/library";
import type { LibraryFeedEntry } from "@/api/library";
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

// Server clamps to staticConfig.libraryFeed.maxLimit; request the max so the
// page shows the full window (no pagination — the feed is a capped surface).
const FEED_LIMIT = 30;

function heading(meta = ""): string {
  return `
    <section class="page-heading">
      <div>
        <h1>Feed</h1>
      </div>
      ${meta}
    </section>
  `;
}

export function renderFeedPage(container: HTMLElement): void {
  requireSessionForPage(container, "/feed", {
    loading: "Loading feed",
    loginMessage:
      "The feed shows new chapters from your favorited and queued manga. Log in to see yours.",
    onReady: () => void loadFeed(container),
  });
}

async function loadFeed(container: HTMLElement): Promise<void> {
  let entries: LibraryFeedEntry[];
  try {
    entries = await getLibraryFeed(FEED_LIMIT);
  } catch (error) {
    if (window.location.pathname !== "/feed") {
      return;
    }
    container.innerHTML = `
      ${heading()}
      ${renderError(error instanceof Error ? error.message : "Unable to load the feed.")}
    `;
    animateIn(container);
    return;
  }

  if (window.location.pathname !== "/feed") {
    return;
  }

  if (entries.length === 0) {
    container.innerHTML = `
      ${heading()}
      ${renderEmpty(
        "Nothing new yet",
        "New ready chapters from your favorited and queued manga will appear here.",
        icons.inbox()
      )}
    `;
    animateIn(container);
    return;
  }

  container.innerHTML = `
    ${heading(`<p class="heading-meta">${entries.length} new chapter${entries.length === 1 ? "" : "s"}</p>`)}
    <ol class="history-list">
      ${entries.map(renderFeedRow).join("")}
    </ol>
  `;
  animateIn(container);

  wireCoverFallbacks(container);
  wireClickableRows(container, "[data-action='open-chapter']", (row) => {
    const mangaId = row.dataset.mangaId;
    const chapterId = row.dataset.chapterId;
    return mangaId && chapterId
      ? `/manga/${encodeURIComponent(mangaId)}/chapter/${encodeURIComponent(chapterId)}`
      : null;
  });
}

// Rows reuse the history list styling: cover, manga title, chapter line, date.
function renderFeedRow(entry: LibraryFeedEntry): string {
  const cover = renderCover({
    url: entry.manga.coverUrl,
    seed: entry.manga.title,
    placeholderClass: "history-cover-placeholder",
    imgAttrs: 'loading="lazy"',
  });
  const chapterLabel =
    entry.chapter.chapterNumber !== null
      ? `Ch. ${entry.chapter.chapterNumber} · ${entry.chapter.title}`
      : entry.chapter.title;

  return `
    <li class="history-row" data-action="open-chapter" data-manga-id="${escapeHtml(entry.manga.id)}" data-chapter-id="${escapeHtml(entry.chapter.id)}" tabindex="0" role="button" aria-label="Read ${escapeHtml(entry.manga.title)} — ${escapeHtml(chapterLabel)}">
      <div class="history-row-cover">${cover}</div>
      <div class="history-row-body">
        <h3>${escapeHtml(entry.manga.title)}</h3>
        <p class="history-row-chapter">${escapeHtml(chapterLabel)}</p>
        <p>${escapeHtml(formatDate(entry.readyAt))}</p>
      </div>
      <span class="history-resume" aria-hidden="true">Read</span>
    </li>
  `;
}
