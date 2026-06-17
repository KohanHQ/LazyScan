import { listReadyChapters } from "@/api/chapter";
import type { ReaderChapter } from "@/api/chapter";
import { getManga } from "@/api/manga";
import type { Manga } from "@/api/manga";
import {
  getReadChapters,
  getReadingProgress,
  markChapterRead,
  markMangaRead,
  unmarkChapterRead,
} from "@/api/reader";
import {
  addToLibrary,
  getLibraryMembership,
  removeFromLibrary,
} from "@/api/library";
import type { LibraryList } from "@/api/library";
import {
  clearReadingStatus,
  getReadingStatus,
  setReadingStatus,
} from "@/api/reading-status";
import type { ReadingStatus } from "@/api/reading-status";
import { icons } from "@/components/icons";
import { renderEmpty, renderError, renderLoading } from "@/components/states";
import { invalidateChapterCache } from "@/pages/reader";
import { getSession } from "@/state/session";
import {
  escapeHtml,
  formatDate,
  renderCover,
  wireClickableRows,
  wireCoverFallbacks,
} from "@/utils/dom";

export async function renderMangaPage(
  container: HTMLElement,
  mangaId: string
): Promise<void> {
  invalidateChapterCache(mangaId);
  container.innerHTML = renderLoading("Loading title");

  try {
    const loggedIn = Boolean(getSession().user);
    const [manga, chapters, progress, readIds] = await Promise.all([
      getManga(mangaId),
      listReadyChapters(mangaId),
      loggedIn ? getReadingProgress(mangaId) : Promise.resolve(null),
      // Explicit per-chapter read state. Best-effort: a failure renders all
      // chapters unread rather than blocking the page.
      loggedIn ? getReadChapters(mangaId).catch(() => []) : Promise.resolve([]),
    ]);
    const readSet = new Set(readIds);

    container.innerHTML = `
      ${renderMangaHeader(manga)}
      <section class="section-heading">
        <div>
          <p class="eyebrow">Ready chapters</p>
          <h2>Available to read</h2>
        </div>
        <div class="heading-aside">
          ${
            chapters.length && loggedIn
              ? `<button class="secondary-button" type="button" data-action="mark-all-read">Mark all read</button>`
              : ""
          }
          <p class="heading-meta">${chapters.length} chapters</p>
        </div>
      </section>
      ${
        chapters.length
          ? `<div data-role="chapter-list-region"></div>`
          : renderEmpty(
              "No chapters to read yet",
              "Nothing is ready here — uploads stay hidden until processing finishes.",
              icons.inbox()
            )
      }
      ${
        loggedIn
          ? `
      <section class="section-heading">
        <div>
          <p class="eyebrow">Community</p>
          <h2>Comments</h2>
        </div>
      </section>
      ${renderEmpty(
        "Comments coming soon",
        "Discussion on titles is not open yet. Check back later.",
        icons.forum()
      )}`
          : ""
      }
    `;

    const listRegion = container.querySelector<HTMLElement>(
      "[data-role='chapter-list-region']"
    );
    if (listRegion) {
      renderChapterListRegion(
        listRegion,
        mangaId,
        chapters,
        progress,
        readSet,
        loggedIn,
        1
      );
    }

    wireCoverFallbacks(container);
    void wireLibraryActions(container, mangaId);
    void wireReadingStatus(container, mangaId);

    // "Mark all read" pins progress to the end; re-render so the chapter rows
    // reflect the new read state.
    const markAllButton = container.querySelector<HTMLButtonElement>(
      "[data-action='mark-all-read']"
    );
    markAllButton?.addEventListener("click", () => {
      markAllButton.disabled = true;
      markAllButton.textContent = "Marking";
      void markMangaRead(mangaId)
        .then(() => renderMangaPage(container, mangaId))
        .catch(() => {
          markAllButton.disabled = false;
          markAllButton.textContent = "Mark all read";
        });
    });
  } catch (error) {
    container.innerHTML = renderError(
      error instanceof Error ? error.message : "Unable to load manga."
    );
  }
}

// Favorite / queue toggles, shown only to authenticated users. Membership is
// fetched once; failures fail silently (the buttons stay hidden) since they are
// an enhancement, not core to reading.
async function wireLibraryActions(
  container: HTMLElement,
  mangaId: string
): Promise<void> {
  if (!getSession().user) {
    return;
  }
  const slot = container.querySelector<HTMLElement>("[data-role='library-actions']");
  if (!slot) {
    return;
  }

  let membership: { favorite: boolean; queue: boolean };
  try {
    membership = await getLibraryMembership(mangaId);
  } catch {
    return;
  }

  // Show a spinner on the clicked button while the toggle is in flight; on
  // success render() rebuilds the slot, on failure the button is restored.
  const spinner = `<span class="button-spinner" aria-hidden="true"></span>`;
  const toggle = async (
    list: LibraryList,
    button: HTMLButtonElement
  ): Promise<void> => {
    const wasActive = membership[list];
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `${spinner}<span>${wasActive ? "Removing" : "Adding"}</span>`;
    try {
      const request = wasActive
        ? removeFromLibrary(list, mangaId)
        : addToLibrary(list, mangaId);
      // Hold the spinner briefly even when the request returns instantly, so the
      // feedback (and the heart fill on re-render) registers instead of flickering.
      const minVisible = new Promise((resolve) => window.setTimeout(resolve, 400));
      await Promise.all([request, minVisible]);
      membership[list] = !wasActive;
      render();
    } catch {
      // Leave the current state on failure; restore the button.
      button.disabled = false;
      button.innerHTML = original;
    }
  };

  const render = (): void => {
    slot.innerHTML = `
      <button class="detail-action${membership.favorite ? " is-active" : ""}" type="button" data-action="toggle-favorite" aria-pressed="${membership.favorite}">
        ${membership.favorite ? icons.heartFilled() : icons.heart()}<span>${membership.favorite ? "Favorited" : "Favorite"}</span>
      </button>
      <button class="detail-action${membership.queue ? " is-active" : ""}" type="button" data-action="toggle-queue" aria-pressed="${membership.queue}">
        ${membership.queue ? icons.bookmarkFilled() : icons.bookmark()}<span>${membership.queue ? "In queue" : "Add to queue"}</span>
      </button>
    `;
    slot
      .querySelector<HTMLButtonElement>("[data-action='toggle-favorite']")
      ?.addEventListener("click", (event) =>
        void toggle("favorite", event.currentTarget as HTMLButtonElement)
      );
    slot
      .querySelector<HTMLButtonElement>("[data-action='toggle-queue']")
      ?.addEventListener("click", (event) =>
        void toggle("queue", event.currentTarget as HTMLButtonElement)
      );
  };

  render();
}

// Reading status selector, shown only to authenticated users. Independent of the
// favorite/queue toggles above: a manga carries at most one status, set/switched
// via a custom button + popup menu (mirrors the catalog / audit-trail filter
// rather than a native <select>, whose option list can't be themed). Failures
// fail silently (the control stays hidden) since it is an enhancement, not core
// to reading.
const READING_STATUS_OPTIONS: { value: ReadingStatus; label: string }[] = [
  { value: "reading", label: "Reading" },
  { value: "completed", label: "Completed" },
  { value: "plan_to_read", label: "Plan to read" },
  { value: "on_hold", label: "On hold" },
  { value: "dropped", label: "Dropped" },
];

async function wireReadingStatus(
  container: HTMLElement,
  mangaId: string
): Promise<void> {
  if (!getSession().user) {
    return;
  }
  const slot = container.querySelector<HTMLElement>("[data-role='reading-status']");
  if (!slot) {
    return;
  }

  let current: ReadingStatus | null;
  try {
    ({ status: current } = await getReadingStatus(mangaId));
  } catch {
    return;
  }

  const labelFor = (value: ReadingStatus | ""): string =>
    value === ""
      ? "No status"
      : READING_STATUS_OPTIONS.find((option) => option.value === value)?.label ??
        "No status";

  const optionButtons = [{ value: "" as ReadingStatus | "", label: "No status" }, ...READING_STATUS_OPTIONS]
    .map(
      (option) =>
        `<button class="library-filter-option${
          (option.value === "" ? current === null : option.value === current)
            ? " is-active"
            : ""
        }" type="button" role="menuitemradio" data-status="${option.value}">${option.label}</button>`
    )
    .join("");

  slot.innerHTML = `
    <div class="detail-status-control">
      <button class="detail-status-select" type="button" data-action="toggle-status" aria-label="Reading status" aria-haspopup="true" aria-expanded="false">
        <span data-role="status-current">${labelFor(current ?? "")}</span>
      </button>
      <div class="library-filter-pop" role="menu" hidden>
        ${optionButtons}
      </div>
    </div>
  `;

  const button = slot.querySelector<HTMLButtonElement>("[data-action='toggle-status']");
  const pop = slot.querySelector<HTMLElement>(".library-filter-pop");
  const currentEl = slot.querySelector<HTMLElement>("[data-role='status-current']");
  if (!button || !pop || !currentEl) {
    return;
  }

  // Popup interaction mirrors the catalog / audit-trail filter: toggle the menu,
  // close on click-outside or Escape, and tear down the document listeners on
  // close so nothing leaks.
  let closeMenu: (() => void) | undefined;
  const open = (): void => {
    pop.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const onDocClick = (event: Event): void => {
      if (!pop.contains(event.target as Node) && !button.contains(event.target as Node)) {
        closeMenu?.();
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeMenu?.();
      }
    };
    closeMenu = (): void => {
      pop.hidden = true;
      button.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
      closeMenu = undefined;
    };
    setTimeout(() => {
      document.addEventListener("click", onDocClick);
      document.addEventListener("keydown", onKey);
    }, 0);
  };

  button.addEventListener("click", () => {
    if (closeMenu) {
      closeMenu();
    } else {
      open();
    }
  });

  pop.querySelectorAll<HTMLButtonElement>(".library-filter-option").forEach((option) => {
    option.addEventListener("click", () => {
      const value = (option.dataset.status ?? "") as ReadingStatus | "";
      const next = value === "" ? null : value;
      closeMenu?.();
      if (next === current) {
        return;
      }
      const previous = current;
      button.disabled = true;
      const request = value === "" ? clearReadingStatus(mangaId) : setReadingStatus(mangaId, value);
      void request
        .then(() => {
          current = next;
          currentEl.textContent = labelFor(value);
          pop
            .querySelectorAll<HTMLButtonElement>(".library-filter-option")
            .forEach((other) => {
              other.classList.toggle("is-active", (other.dataset.status ?? "") === value);
            });
        })
        .catch(() => {
          // Keep the previous status on failure.
          current = previous;
        })
        .finally(() => {
          button.disabled = false;
        });
    });
  });
}

function renderMangaHeader(manga: Manga): string {
  const cover = renderCover({
    url: manga.coverUrl,
    seed: manga.title,
    placeholderClass: "cover-placeholder cover-placeholder-large",
  });

  return `
    <section class="manga-detail">
      <div class="manga-detail-cover">${cover}</div>
      <div class="manga-detail-body">
        <p class="eyebrow">${escapeHtml(statusLabel(manga.status))}</p>
        <h1>${escapeHtml(manga.title)}</h1>
        <div class="detail-actions-row">
          <div class="detail-actions" data-role="library-actions"></div>
          <div class="detail-status" data-role="reading-status"></div>
        </div>
        <dl class="detail-facts">
          <div>
            <dt>Total chapters</dt>
            <dd>${manga.totalChapters ?? "Unknown"}</dd>
          </div>
          ${manga.author ? `<div><dt>Author</dt><dd>${escapeHtml(manga.author)}</dd></div>` : ""}
          ${manga.artist ? `<div><dt>Artist</dt><dd>${escapeHtml(manga.artist)}</dd></div>` : ""}
          ${manga.publisher ? `<div><dt>Publisher</dt><dd>${escapeHtml(manga.publisher)}</dd></div>` : ""}
          ${manga.publishedYear ? `<div><dt>Published</dt><dd>${manga.publishedYear}</dd></div>` : ""}
          <div>
            <dt>Updated</dt>
            <dd>${escapeHtml(formatDate(manga.updatedAt))}</dd>
          </div>
        </dl>
        ${
          manga.tags.length
            ? `<div class="detail-tags" aria-label="Tags">${manga.tags
                .map((tag) => `<span class="detail-tag">${escapeHtml(tag)}</span>`)
                .join("")}</div>`
            : ""
        }
        <p class="description">${escapeHtml(manga.description || "No description available.")}</p>
      </div>
    </section>
  `;
}

// Chapters per page on the detail list. The full (already-fetched) array stays
// in memory; pagination is purely client-side so the reader's chapter ordering
// and rollover are untouched.
const CHAPTERS_PER_PAGE = 10;

// Renders the paged chapter list plus its pager into the region, (re)wiring the
// row navigation, read toggles, and pager buttons each time. Volume group
// headers (MangaDex-style) appear only when at least one chapter has a volume;
// the first row of every page repeats its volume header for context.
function renderChapterListRegion(
  region: HTMLElement,
  mangaId: string,
  chapters: ReaderChapter[],
  progress: { chapterId: string; pageNumber: number } | null,
  readSet: Set<string>,
  loggedIn: boolean,
  page: number
): void {
  const totalPages = Math.max(1, Math.ceil(chapters.length / CHAPTERS_PER_PAGE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * CHAPTERS_PER_PAGE;
  const slice = chapters.slice(start, start + CHAPTERS_PER_PAGE);
  const hasVolumes = chapters.some((chapter) => chapter.volume !== null);

  const rows = slice
    .map((chapter, index) => {
      const previous = index > 0 ? slice[index - 1] : null;
      const header =
        hasVolumes && (previous === null || previous.volume !== chapter.volume)
          ? `<li class="chapter-volume-header" aria-hidden="true">${escapeHtml(volumeLabel(chapter.volume))}</li>`
          : "";
      return `${header}${renderChapterRow(chapter, progress, readSet, loggedIn)}`;
    })
    .join("");

  const pager =
    totalPages > 1
      ? `
      <nav class="chapter-pager" aria-label="Chapter pages">
        <button class="secondary-button" type="button" data-action="chapter-page-prev" ${currentPage === 1 ? "disabled" : ""}>Previous</button>
        <span class="chapter-pager-status">Page ${currentPage}/${totalPages}</span>
        <button class="secondary-button" type="button" data-action="chapter-page-next" ${currentPage === totalPages ? "disabled" : ""}>Next</button>
      </nav>`
      : "";

  region.innerHTML = `
    <ol class="chapter-list">${rows}</ol>
    ${pager}
  `;

  wireClickableRows(region, "[data-action='read-chapter']", (element) => {
    const chapterId = element.dataset.chapterId;
    return chapterId
      ? `/manga/${encodeURIComponent(mangaId)}/chapter/${encodeURIComponent(chapterId)}`
      : null;
  });
  if (loggedIn) {
    wireReadToggles(region, mangaId, readSet);
  }

  const rerender = (nextPage: number) => {
    renderChapterListRegion(
      region,
      mangaId,
      chapters,
      progress,
      readSet,
      loggedIn,
      nextPage
    );
    region.scrollIntoView({ block: "nearest" });
  };
  region
    .querySelector<HTMLButtonElement>("[data-action='chapter-page-prev']")
    ?.addEventListener("click", () => rerender(currentPage - 1));
  region
    .querySelector<HTMLButtonElement>("[data-action='chapter-page-next']")
    ?.addEventListener("click", () => rerender(currentPage + 1));
}

// "Volume 4" / "Volume 1.5" / "No Volume" (only shown when the title has at
// least one volumed chapter).
function volumeLabel(volume: number | null): string {
  return volume === null ? "No Volume" : `Volume ${volume}`;
}

// Read state is explicit per chapter (`readSet`), not derived positionally from
// progress. A chapter is "read" when in the set; "current" only when it is the
// pinned progress chapter and not yet read; otherwise "unread".
function renderChapterRow(
  chapter: ReaderChapter,
  progress: { chapterId: string; pageNumber: number } | null,
  readSet: Set<string>,
  loggedIn: boolean
): string {
  const chapterNumber =
    chapter.chapterNumber === null ? "" : `Chapter ${chapter.chapterNumber}`;
  const isRead = readSet.has(chapter.id);
  const isCurrent = !isRead && progress?.chapterId === chapter.id;
  const progressLabel = isCurrent ? `Page ${progress!.pageNumber}` : "";

  const statusIcon = isRead
    ? `<span class="chapter-read-badge" aria-label="Read">&#10003;</span>`
    : isCurrent
      ? `<span class="chapter-current-badge" aria-label="In progress">&#9654;</span>`
      : "";

  const readToggle = loggedIn
    ? `<button class="chapter-read-toggle${isRead ? " is-read" : ""}" type="button" data-action="toggle-read" data-chapter-id="${escapeHtml(chapter.id)}" aria-pressed="${isRead}" aria-label="${isRead ? "Mark" : "Mark"} ${escapeHtml(chapter.title)} as ${isRead ? "unread" : "read"}">${isRead ? "Read" : "Mark read"}</button>`
    : "";

  return `
    <li class="chapter-row${isCurrent ? " chapter-row-current" : ""}${isRead ? " chapter-row-read" : ""}" data-action="read-chapter" data-chapter-id="${escapeHtml(chapter.id)}" tabindex="0" role="button" aria-label="Read ${escapeHtml(chapter.title)}">
      <div>
        <h3>${escapeHtml(chapter.title)}${statusIcon}</h3>
        <p>${escapeHtml(chapterNumber || `Sort ${chapter.sortOrder}`)}${progressLabel ? ` &middot; ${escapeHtml(progressLabel)}` : ""}</p>
      </div>
      <div class="chapter-row-aside">
        <span>${escapeHtml(formatDate(chapter.updatedAt))}</span>
        ${readToggle}
      </div>
    </li>
  `;
}

// Per-row read/unread toggle (signed-in only). The row itself is the clickable
// nav target, so the button stops click/keys from bubbling to it. Updates the row
// in place on success and reverts on failure. `readSet` is kept in sync so
// re-rendering the paged list (Previous/Next) reflects toggles made meanwhile.
function wireReadToggles(
  container: HTMLElement,
  mangaId: string,
  readSet: Set<string>
): void {
  container
    .querySelectorAll<HTMLButtonElement>("[data-action='toggle-read']")
    .forEach((button) => {
      button.addEventListener("keydown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const chapterId = button.dataset.chapterId;
        if (!chapterId) {
          return;
        }
        const wasRead = button.getAttribute("aria-pressed") === "true";
        const row = button.closest<HTMLElement>(".chapter-row");
        button.disabled = true;
        const request = wasRead
          ? unmarkChapterRead(mangaId, chapterId)
          : markChapterRead(mangaId, chapterId);
        void request
          .then(() => {
            if (wasRead) {
              readSet.delete(chapterId);
            } else {
              readSet.add(chapterId);
            }
            applyReadState(row, button, !wasRead);
          })
          .catch(() => {
            // Leave the existing state on failure.
          })
          .finally(() => {
            button.disabled = false;
          });
      });
    });
}

// Reflects a chapter's read/unread state on its row without a full re-render:
// toggles the row class, the title badge, and the button label/pressed state. An
// "in progress" badge is dropped once read (read supersedes current).
function applyReadState(
  row: HTMLElement | null,
  button: HTMLButtonElement,
  read: boolean
): void {
  button.setAttribute("aria-pressed", String(read));
  button.classList.toggle("is-read", read);
  button.textContent = read ? "Read" : "Mark read";

  if (!row) {
    return;
  }
  row.classList.toggle("chapter-row-read", read);
  if (read) {
    row.classList.remove("chapter-row-current");
  }

  const heading = row.querySelector("h3");
  if (heading) {
    heading.querySelector(".chapter-read-badge, .chapter-current-badge")?.remove();
    if (read) {
      heading.insertAdjacentHTML(
        "beforeend",
        `<span class="chapter-read-badge" aria-label="Read">&#10003;</span>`
      );
    }
  }
}

function statusLabel(status: Manga["status"]): string {
  return status.replace(/^\w/, (letter) => letter.toUpperCase());
}
