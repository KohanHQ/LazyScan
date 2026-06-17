import {
  listManga,
  listMangaTags,
  listPopularManga,
  listRecentlyUpdatedManga,
  MANGA_STATUSES,
} from "@/api/manga";
import type { Manga, MangaStatus } from "@/api/manga";
import { getReadingHistory } from "@/api/reader";
import type { MangaHistoryEntry } from "@/api/reader";
import { renderEmpty, renderError, renderLoading } from "@/components/states";
import { icons } from "@/components/icons";
import {
  historyChapterLabel,
  historyProgressPercent,
} from "@/pages/history";
import { getSession } from "@/state/session";
import {
  escapeHtml,
  renderCover,
  wireClickableRows,
  wireCoverFallbacks,
} from "@/utils/dom";
import { renderMangaCard, statusLabel } from "@/components/manga-card";

const PAGE_SIZE = 50;
const HERO_SIZE = 10;
const HERO_INTERVAL_MS = 6000;
const RAIL_SIZE = 10;

// "/" focuses the library search (unless typing in a field). Wired once at the
// document level; the handler resolves the live input, so it's a no-op off-home
// and never duplicates across navigations.
let searchShortcutWired = false;
function wireSearchShortcut(): void {
  if (searchShortcutWired) {
    return;
  }
  searchShortcutWired = true;
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.defaultPrevented) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      target?.isContentEditable
    ) {
      return;
    }
    const search = document.querySelector<HTMLInputElement>(".library-search");
    if (search) {
      event.preventDefault();
      search.focus();
    }
  });
}

export async function renderHomePage(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <section class="page-heading">
      <div>
        <h1>Library</h1>
      </div>
    </section>
    ${renderLoading("Loading manga")}
  `;

  // Fetch the hero's popularity ranking alongside the first catalog page. A
  // failure here must not break the page, so it resolves to [] and the hero falls
  // back to newest titles.
  const popularPromise = listPopularManga(HERO_SIZE).catch(() => [] as Manga[]);

  // "Recently updated" rail: manga ordered by latest ready chapter (global, not
  // user-tied). Same failure posture as the hero — resolve to [] and the rail
  // simply does not render.
  const updatesPromise = listRecentlyUpdatedManga(RAIL_SIZE).catch(
    () => [] as Manga[]
  );

  // "Continue reading" rail: the signed-in user's most recent history. Anonymous
  // (or pre-session-bootstrap) loads resolve empty; app.ts re-renders the route
  // once the session lands, so the rail appears on hard loads too. Fetch double
  // the rail size because fully-finished entries are filtered out below.
  const continuePromise: Promise<MangaHistoryEntry[]> = getSession().user
    ? getReadingHistory({ limit: RAIL_SIZE * 2, offset: 0 }).catch(
        () => [] as MangaHistoryEntry[]
      )
    : Promise.resolve([] as MangaHistoryEntry[]);

  // First page decides between the empty state and the paged library shell.
  let firstPage: Manga[];
  try {
    firstPage = await listManga({ limit: PAGE_SIZE, offset: 0 });
  } catch (error) {
    container.innerHTML = renderError(
      error instanceof Error ? error.message : "Unable to load manga."
    );
    return;
  }

  if (firstPage.length === 0) {
    container.innerHTML = `
      <section class="page-heading">
        <div>
          <h1>Library</h1>
        </div>
      </section>
      ${renderEmpty("No manga yet", "Create manga through the API or management tooling to populate the catalog.")}
    `;
    return;
  }

  // Real popularity when there are reads in the window; otherwise fall back to the
  // newest titles (already fetched) so a cold catalog still gets a hero. The hero
  // is deliberately the popularity surface: with few ranked titles it shows few
  // slides (a single ranked title renders one static slide — nav and rotation
  // need more than one). Padding with unranked titles was tried and reverted
  // (2026-06-04): the ranking must not be diluted.
  const popular = await popularPromise;
  const heroItems = (popular.length > 0 ? popular : firstPage).slice(0, HERO_SIZE);
  const heroKind: "popular" | "new" = popular.length > 0 ? "popular" : "new";
  const updates = await updatesPromise;
  // Only resumable entries: hide a title whose pinned position is the last page
  // of its chapter with nothing ready after it (fully caught up / marked read).
  // Entries with an unknown page count (0, pages since removed) stay visible.
  const continueEntries = (await continuePromise)
    .filter(
      (entry) =>
        entry.hasNextChapter ||
        entry.chapterPageCount === 0 ||
        entry.pageNumber < entry.chapterPageCount
    )
    .slice(0, RAIL_SIZE);

  // Drive the immersive home chrome (transparent topbar + full-bleed hero). Only
  // home sets this, and only when a hero actually mounts; app.ts resets it to
  // "false" on every navigation, so it never leaks to other routes.
  container.closest(".app-shell")?.setAttribute("data-hero", "true");

  // Hero leads (full-bleed under the transparent topbar), then the personal
  // "Continue reading" rail, the global "Recently updated" rail, and the
  // library header + grid (MangaDex-style ordering).
  container.innerHTML = `
    ${renderHero(heroItems, heroKind)}
    ${renderRail({
      role: "continue-rail",
      eyebrow: "Continue reading",
      title: "Pick up where you left off",
      cards: continueEntries.map(renderResumeCard),
    })}
    ${renderRail({
      role: "recent-rail",
      eyebrow: "Recently updated",
      title: "Fresh chapters",
      cards: updates.map((manga) => renderRailCard(manga)),
    })}
    <section class="page-heading">
      <div>
        <h1>Library</h1>
        <p class="heading-meta" data-role="count"></p>
      </div>
      <div class="heading-aside">
        <div class="library-search-wrap">
          <input class="library-search" type="search" placeholder="Search" aria-label="Search manga" autocomplete="off" />
          <kbd class="search-kbd" aria-hidden="true">/</kbd>
          <button class="library-filter" type="button" aria-label="Filter by status" aria-haspopup="true" aria-expanded="false">${icons.filter()}</button>
          <div class="library-filter-pop" role="menu" hidden>
            <button class="library-filter-option is-active" type="button" role="menuitemradio" data-status="">All status</button>
            ${MANGA_STATUSES.map((s) => `<button class="library-filter-option" type="button" role="menuitemradio" data-status="${s}">${statusLabel(s)}</button>`).join("")}
            <div class="library-filter-tags" data-role="tag-options" hidden>
              <p class="library-filter-label">Tags</p>
              <div class="library-filter-tag-list" data-role="tag-list"></div>
            </div>
          </div>
          <button class="library-advanced-btn" type="button" aria-label="Advanced search" aria-expanded="false">Advanced</button>
        </div>
        <div class="library-advanced-panel" hidden>
          <div class="library-advanced-grid">
            <div class="library-advanced-field">
              <label for="adv-author">Author</label>
              <input id="adv-author" class="library-advanced-input" type="text" placeholder="Any author" data-field="author" />
            </div>
            <div class="library-advanced-field">
              <label for="adv-artist">Artist</label>
              <input id="adv-artist" class="library-advanced-input" type="text" placeholder="Any artist" data-field="artist" />
            </div>
            <div class="library-advanced-field">
              <label for="adv-publisher">Publisher</label>
              <input id="adv-publisher" class="library-advanced-input" type="text" placeholder="Any publisher" data-field="publisher" />
            </div>
            <div class="library-advanced-field">
              <label for="adv-year">Year</label>
              <input id="adv-year" class="library-advanced-input" type="text" placeholder="2020 or 2020-2024" data-field="year" />
            </div>
            <div class="library-advanced-field">
              <label for="adv-sort">Sort</label>
              <select id="adv-sort" class="library-advanced-select" data-field="sort">
                <option value="created_at">Newest</option>
                <option value="updated_at">Updated</option>
                <option value="title">Title</option>
                <option value="published_year">Year</option>
              </select>
            </div>
            <div class="library-advanced-field">
              <label for="adv-order">Order</label>
              <select id="adv-order" class="library-advanced-select" data-field="order">
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </div>
          </div>
          <div class="library-advanced-actions">
            <button class="library-advanced-clear" type="button">Clear</button>
            <button class="library-advanced-submit" type="button">Search</button>
          </div>
        </div>
      </div>
    </section>
    <section class="manga-grid" aria-label="Manga list" data-role="grid"></section>
    <div class="library-sentinel" data-role="sentinel" aria-hidden="true"></div>
    <button class="secondary-button library-more" type="button" data-role="more" hidden>Load more</button>
  `;

  const grid = container.querySelector<HTMLElement>("[data-role='grid']")!;
  const count = container.querySelector<HTMLElement>("[data-role='count']");
  const search = container.querySelector<HTMLInputElement>(".library-search");
  const filterBtn = container.querySelector<HTMLButtonElement>(".library-filter");
  const filterPop = container.querySelector<HTMLElement>(".library-filter-pop");
  const filterOptions = filterPop
    ? Array.from(filterPop.querySelectorAll<HTMLButtonElement>(".library-filter-option"))
    : [];
  const sentinel = container.querySelector<HTMLElement>("[data-role='sentinel']");
  const moreButton = container.querySelector<HTMLButtonElement>("[data-role='more']");

  const hero = container.querySelector<HTMLElement>("[data-role='hero']");
  if (hero) {
    wireHero(hero);
  }

  const recentRail = container.querySelector<HTMLElement>(
    "[data-role='recent-rail']"
  );
  if (recentRail) {
    wireRail(recentRail);
  }

  const continueRail = container.querySelector<HTMLElement>(
    "[data-role='continue-rail']"
  );
  if (continueRail) {
    wireContinueRail(continueRail);
  }

  // Server-side paging over GET /manga via limit/offset. `seq` guards search vs
  // scroll races so a newer query's results never mix with an older one's.
  let term = "";
  let statusFilter: MangaStatus | "" = "";
  let tagFilter = "";
  let offset = 0;
  let loading = false;
  let done = false;
  let seq = 0;

  const advancedFields = {
    author: "",
    artist: "",
    publisher: "",
    year: "",
    sort: "created_at",
    order: "desc",
  };

  const updateCount = (): void => {
    if (count) {
      const n = grid.querySelectorAll("[data-manga-id]").length;
      count.textContent = `${n} title${n === 1 ? "" : "s"}`;
    }
  };

  // The button is only a fallback when IntersectionObserver is unavailable;
  // with it, the sentinel drives infinite scroll and the button stays hidden.
  const hasObserver = "IntersectionObserver" in window;

  const toggleMore = (): void => {
    if (moreButton) {
      moreButton.hidden = hasObserver || done || loading;
    }
  };

  // Wire the new cards inside a detached node so listeners are not duplicated on
  // already-rendered cards, then move them into the live grid.
  const appendCards = (list: Manga[]): void => {
    const batch = document.createElement("div");
    batch.innerHTML = list.map((manga) => renderMangaCard(manga, "library")).join("");
    wireCoverFallbacks(batch);
    wireCards(batch);
    while (batch.firstChild) {
      grid.appendChild(batch.firstChild);
    }
    updateCount();
  };

  const showMessage = (message: string): void => {
    grid.innerHTML = `<p class="library-empty">${escapeHtml(message)}</p>`;
    if (count) {
      count.textContent = "";
    }
  };

  const params = (): {
    search?: string;
    status?: MangaStatus;
    tag?: string;
    author?: string;
    artist?: string;
    publisher?: string;
    year?: string;
    sort?: string;
    order?: string;
    limit: number;
    offset: number;
  } => ({
    limit: PAGE_SIZE,
    offset,
    ...(term ? { search: term } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(tagFilter ? { tag: tagFilter } : {}),
    ...(advancedFields.author ? { author: advancedFields.author } : {}),
    ...(advancedFields.artist ? { artist: advancedFields.artist } : {}),
    ...(advancedFields.publisher ? { publisher: advancedFields.publisher } : {}),
    ...(advancedFields.year ? { year: advancedFields.year } : {}),
    ...(advancedFields.sort ? { sort: advancedFields.sort } : {}),
    ...(advancedFields.order ? { order: advancedFields.order } : {}),
  });

  const loadFirst = async (nextTerm: string): Promise<void> => {
    const mySeq = ++seq;
    term = nextTerm;
    offset = 0;
    done = false;
    loading = true;
    toggleMore();
    try {
      const list = await listManga(params());
      if (mySeq !== seq) {
        return;
      }
      if (list.length === 0) {
        showMessage("No titles match your filters.");
        done = true;
        return;
      }
      grid.innerHTML = "";
      appendCards(list);
      offset = list.length;
      done = list.length < PAGE_SIZE;
    } catch (queryError) {
      if (mySeq !== seq) {
        return;
      }
      showMessage(queryError instanceof Error ? queryError.message : "Search failed.");
      done = true;
    } finally {
      if (mySeq === seq) {
        loading = false;
        toggleMore();
      }
    }
  };

  const loadMore = async (): Promise<void> => {
    if (loading || done) {
      return;
    }
    const mySeq = seq;
    loading = true;
    toggleMore();
    try {
      const list = await listManga(params());
      if (mySeq !== seq) {
        return;
      }
      appendCards(list);
      offset += list.length;
      done = list.length < PAGE_SIZE;
    } catch {
      // Stop auto-loading on error; the search box can reset the state.
      done = true;
    } finally {
      if (mySeq === seq) {
        loading = false;
        toggleMore();
      }
    }
  };

  // Seed with the already-fetched first page (avoids a duplicate request).
  appendCards(firstPage);
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

  wireSearchShortcut();

  let debounceTimer: number | undefined;
  search?.addEventListener("input", () => {
    const next = search.value.trim();
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => void loadFirst(next), 300);
  });

  // Status filter popup anchored to the search bar's filter icon. Mirrors the
  // topbar dropdown: toggle, close on outside click (added next tick) or ESC.
  let closeFilterPop: (() => void) | undefined;

  // Tag chips are fetched once per page view, on the popup's first open (the
  // catalog rarely changes tags mid-session). Failure hides the section quietly.
  let tagsLoaded = false;
  const loadTagOptions = (): void => {
    if (tagsLoaded || !filterPop) {
      return;
    }
    tagsLoaded = true;
    const section = filterPop.querySelector<HTMLElement>("[data-role='tag-options']");
    const list = filterPop.querySelector<HTMLElement>("[data-role='tag-list']");
    if (!section || !list) {
      return;
    }
    void listMangaTags()
      .then((tags) => {
        if (tags.length === 0) {
          return;
        }
        section.hidden = false;
        list.innerHTML = [
          `<button class="library-filter-tag is-active" type="button" data-tag="">All</button>`,
          ...tags.map(
            (tag) =>
              `<button class="library-filter-tag" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
          ),
        ].join("");
        const chips = Array.from(
          list.querySelectorAll<HTMLButtonElement>(".library-filter-tag")
        );
        chips.forEach((chip) => {
          chip.addEventListener("click", () => {
            const next = chip.dataset.tag ?? "";
            closeFilterPop?.();
            if (next === tagFilter) {
              return;
            }
            tagFilter = next;
            chips.forEach((c) => c.classList.toggle("is-active", c === chip));
            updateFilterTint();
            void loadFirst(term);
          });
        });
      })
      .catch(() => {
        // Allow a retry on the next open if the fetch failed.
        tagsLoaded = false;
      });
  };

  // The funnel tints whenever any filter (status or tag) is active.
  const updateFilterTint = (): void => {
    filterBtn?.classList.toggle(
      "is-active",
      statusFilter !== "" || tagFilter !== ""
    );
  };

  const openFilterPop = (): void => {
    if (!filterPop || !filterBtn) {
      return;
    }
    loadTagOptions();
    filterPop.hidden = false;
    filterBtn.setAttribute("aria-expanded", "true");
    const onDocClick = (e: Event): void => {
      if (!filterPop.contains(e.target as Node) && !filterBtn.contains(e.target as Node)) {
        closeFilterPop?.();
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        closeFilterPop?.();
      }
    };
    closeFilterPop = (): void => {
      filterPop.hidden = true;
      filterBtn.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
      closeFilterPop = undefined;
    };
    setTimeout(() => {
      document.addEventListener("click", onDocClick);
      document.addEventListener("keydown", onKey);
    }, 0);
  };

  filterBtn?.addEventListener("click", () => {
    if (closeFilterPop) {
      closeFilterPop();
    } else {
      openFilterPop();
    }
  });

  filterOptions.forEach((option) => {
    option.addEventListener("click", () => {
      const next = (option.dataset.status ?? "") as MangaStatus | "";
      closeFilterPop?.();
      if (next === statusFilter) {
        return;
      }
      statusFilter = next;
      filterOptions.forEach((o) => o.classList.toggle("is-active", o === option));
      updateFilterTint();
      void loadFirst(term);
    });
  });

  // Advanced search panel toggle and wiring
  const advancedBtn = container.querySelector<HTMLButtonElement>(".library-advanced-btn");
  const advancedPanel = container.querySelector<HTMLElement>(".library-advanced-panel");
  const advancedClear = container.querySelector<HTMLButtonElement>(".library-advanced-clear");
  const advancedSubmit = container.querySelector<HTMLButtonElement>(".library-advanced-submit");

  let advancedOpen = false;

  const toggleAdvanced = (): void => {
    advancedOpen = !advancedOpen;
    if (advancedPanel) {
      advancedPanel.hidden = !advancedOpen;
    }
    advancedBtn?.setAttribute("aria-expanded", String(advancedOpen));
    advancedBtn?.classList.toggle("is-active", advancedOpen);
  };

  const readAdvancedFields = (): void => {
    container.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      ".library-advanced-input, .library-advanced-select"
    ).forEach((el) => {
      const field = el.dataset.field as keyof typeof advancedFields;
      if (field) {
        advancedFields[field] = el.value.trim();
      }
    });
  };

  const clearAdvancedFields = (): void => {
    container.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      ".library-advanced-input, .library-advanced-select"
    ).forEach((el) => {
      const field = el.dataset.field as keyof typeof advancedFields;
      if (field) {
        const defaultValue = el.tagName === "SELECT" ? el.querySelector("option")?.value ?? "" : "";
        el.value = defaultValue;
        advancedFields[field] = defaultValue;
      }
    });
  };

  const applyAdvancedSearch = (): void => {
    readAdvancedFields();
    void loadFirst(term);
  };

  advancedBtn?.addEventListener("click", () => {
    toggleAdvanced();
  });

  advancedClear?.addEventListener("click", () => {
    clearAdvancedFields();
    void loadFirst(term);
  });

  advancedSubmit?.addEventListener("click", () => {
    applyAdvancedSearch();
  });

  // Close advanced panel when clicking outside
  document.addEventListener("click", (e) => {
    if (!advancedOpen) return;
    const target = e.target as Node;
    if (
      advancedPanel &&
      !advancedPanel.contains(target) &&
      advancedBtn &&
      !advancedBtn.contains(target)
    ) {
      toggleAdvanced();
    }
  });
}

// Horizontal card rail (e.g. "Recently updated"). Renders nothing when there are
// no cards, so an empty feed leaves no gap between the hero and the library.
function renderRail(options: {
  role: string;
  eyebrow: string;
  title: string;
  cards: string[];
}): string {
  if (options.cards.length === 0) {
    return "";
  }
  return `
    <section class="manga-rail" aria-label="${escapeHtml(options.eyebrow)}" data-role="${escapeHtml(options.role)}">
      <div class="rail-heading">
        <p class="eyebrow">${escapeHtml(options.eyebrow)}</p>
        <h2>${escapeHtml(options.title)}</h2>
      </div>
      <div class="rail-track">${options.cards.join("")}</div>
    </section>
  `;
}

// Compact rail card: cover + clamped title (+ optional sub line). The optional
// `sub` is pre-built HTML from the caller (it may mix highlighted parts), so the
// caller is responsible for escaping its dynamic content.
function renderRailCard(manga: Manga, subHtml = ""): string {
  const cover = renderCover({
    url: manga.coverUrl,
    seed: manga.title,
    placeholderClass: "cover-placeholder",
    imgAttrs: 'loading="lazy"',
  });
  return `
    <article class="rail-card" data-manga-id="${escapeHtml(manga.id)}" tabindex="0" role="button" aria-label="${escapeHtml(manga.title)}">
      <div class="rail-cover">${cover}</div>
      <h3 class="rail-title">${escapeHtml(manga.title)}</h3>
      ${subHtml}
    </article>
  `;
}

// Resume card: cover + title + chapter/percent line. Carries the chapter id so
// the click resumes inside the reader (progress restore picks the exact page).
function renderResumeCard(entry: MangaHistoryEntry): string {
  const cover = renderCover({
    url: entry.coverUrl,
    seed: entry.title,
    placeholderClass: "cover-placeholder",
    imgAttrs: 'loading="lazy"',
  });
  const percent = historyProgressPercent(entry);
  const sub =
    percent !== null
      ? `${historyChapterLabel(entry)} · ${percent}%`
      : historyChapterLabel(entry);
  return `
    <article class="rail-card" data-resume-manga="${escapeHtml(entry.mangaId)}" data-resume-chapter="${escapeHtml(entry.chapterId)}" tabindex="0" role="button" aria-label="Continue reading ${escapeHtml(entry.title)}">
      <div class="rail-cover">${cover}</div>
      <h3 class="rail-title">${escapeHtml(entry.title)}</h3>
      <p class="rail-sub">${escapeHtml(sub)}</p>
    </article>
  `;
}

// Resume cards open the reader at the pinned chapter (progress restores the page).
function wireContinueRail(rail: HTMLElement): void {
  wireCoverFallbacks(rail);
  wireClickableRows(
    rail,
    ".rail-card[data-resume-manga]",
    (card) => {
      const mangaId = card.dataset.resumeManga;
      const chapterId = card.dataset.resumeChapter;
      return mangaId && chapterId
        ? `/manga/${encodeURIComponent(mangaId)}/chapter/${encodeURIComponent(chapterId)}`
        : null;
    },
    { keyboard: true }
  );
}

// Cards navigate to the manga detail page, same as the grid cards.
function wireRail(rail: HTMLElement): void {
  wireCoverFallbacks(rail);
  wireClickableRows(
    rail,
    ".rail-card[data-manga-id]",
    (card) => {
      const id = card.dataset.mangaId;
      return id ? `/manga/${encodeURIComponent(id)}` : null;
    },
    { keyboard: true }
  );
}

// Featured hero rotator. Shows one title at a time over a blurred, gradient-faded
// cover; `‹ ›` step through the set. `kind` is "popular" when backed by real
// read-count ranking and "new" when it has fallen back to the newest titles, so
// the eyebrow never claims a ranking it does not have.
function renderHero(list: Manga[], kind: "popular" | "new"): string {
  if (list.length === 0) {
    return "";
  }
  const eyebrow = kind === "popular" ? "Popular this week" : "New titles";
  const slides = list
    .map((manga, index) => renderHeroSlide(manga, eyebrow, index === 0))
    .join("");
  const multi = list.length > 1;
  return `
    <section class="hero" aria-label="${escapeHtml(eyebrow)}" data-role="hero">
      <div class="hero-stage" data-role="hero-stage">
        ${slides}
      </div>
      ${
        multi
          ? `<div class="hero-nav">
        <span class="hero-index" data-role="hero-index">NO. 1</span>
        <button class="hero-arrow" type="button" data-role="hero-prev" aria-label="Previous title">${chevron("left")}</button>
        <button class="hero-arrow" type="button" data-role="hero-next" aria-label="Next title">${chevron("right")}</button>
      </div>`
          : ""
      }
    </section>
  `;
}

function renderHeroSlide(
  manga: Manga,
  eyebrow: string,
  active: boolean
): string {
  const cover = renderCover({
    url: manga.coverUrl,
    seed: manga.title,
    placeholderClass: "cover-placeholder",
    imgAttrs: 'loading="lazy"',
  });
  // No genre data in the model; surface author/artist instead.
  const credits = [manga.author, manga.artist].filter(Boolean).join(", ");
  const bgStyle = manga.coverUrl
    ? ` style="background-image:url('${escapeHtml(manga.coverUrl)}')"`
    : "";
  return `
    <article class="hero-slide${active ? " is-active" : ""}" data-manga-id="${escapeHtml(manga.id)}" tabindex="0" role="button" aria-label="${escapeHtml(manga.title)}"${active ? "" : ' aria-hidden="true"'}>
      <div class="hero-bg"${bgStyle} aria-hidden="true"></div>
      <div class="hero-fade" aria-hidden="true"></div>
      <div class="hero-content">
        <div class="hero-cover">${cover}</div>
        <div class="hero-text">
          <p class="hero-eyebrow">${escapeHtml(eyebrow)}</p>
          <h2 class="hero-title">${escapeHtml(manga.title)}</h2>
          <div class="hero-chips"><span class="hero-chip">${escapeHtml(statusLabel(manga.status))}</span></div>
          ${credits ? `<p class="hero-credits">${escapeHtml(credits)}</p>` : ""}
          ${manga.description ? `<p class="hero-desc">${escapeHtml(manga.description)}</p>` : ""}
        </div>
      </div>
    </article>
  `;
}

function chevron(direction: "left" | "right"): string {
  const path = direction === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6";
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

function wireHero(section: HTMLElement): void {
  wireCoverFallbacks(section);
  // Click/Enter on the active slide opens that manga (same nav as the cards).
  wireClickableRows(
    section,
    ".hero-slide[data-manga-id]",
    (slide) => {
      const id = slide.dataset.mangaId;
      return id ? `/manga/${encodeURIComponent(id)}` : null;
    },
    { keyboard: true }
  );

  const slides = Array.from(
    section.querySelectorAll<HTMLElement>(".hero-slide")
  );
  if (slides.length <= 1) {
    return;
  }

  const indexLabel = section.querySelector<HTMLElement>("[data-role='hero-index']");
  const prev = section.querySelector<HTMLButtonElement>("[data-role='hero-prev']");
  const next = section.querySelector<HTMLButtonElement>("[data-role='hero-next']");
  let current = 0;

  // Slides are stacked absolutely. Rather than crossfading both (which dips below
  // full opacity mid-transition and flashes the backdrop through — theme-dependent
  // flicker), fade the incoming slide in ON TOP of the still-opaque outgoing one.
  // The two arts cross-dissolve with no gap, so nothing shows through in any theme.
  // z-index is bounded to 0/1/2 so it never climbs above the nav (which sits higher
  // and must not be covered by a slide's bottom blend).
  const show = (index: number): void => {
    const nextIndex = (index + slides.length) % slides.length;
    if (nextIndex === current) {
      return;
    }
    const outgoing = slides[current];
    const incoming = slides[nextIndex];
    current = nextIndex;

    slides.forEach((slide) => {
      slide.style.zIndex = "0";
    });
    outgoing.style.zIndex = "1";
    incoming.style.zIndex = "2";
    incoming.classList.add("is-active");
    incoming.removeAttribute("aria-hidden");
    if (indexLabel) {
      indexLabel.textContent = `NO. ${current + 1}`;
    }

    // Drop the outgoing slide once the incoming has fully covered it (no visible
    // change), unless the user has since stepped back to it.
    window.setTimeout(() => {
      if (outgoing !== slides[current]) {
        outgoing.classList.remove("is-active");
        outgoing.setAttribute("aria-hidden", "true");
      }
    }, 650);
  };

  // Auto-advance unless the user prefers reduced motion. Paused on hover/focus so
  // it doesn't move out from under a reader, and reset after a manual step so a
  // click isn't immediately followed by an auto-advance. The interval self-clears
  // once the section leaves the DOM (route changes replace <main>'s contents).
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  let paused = false;
  let timer = 0;

  const stop = (): void => {
    if (timer) {
      window.clearInterval(timer);
      timer = 0;
    }
  };
  const start = (): void => {
    if (reduceMotion || timer) {
      return;
    }
    timer = window.setInterval(() => {
      if (!section.isConnected) {
        stop();
        return;
      }
      if (!paused) {
        show(current + 1);
      }
    }, HERO_INTERVAL_MS);
  };

  const step = (delta: number): void => {
    show(current + delta);
    // Restart the timer so the full interval elapses after a manual step.
    stop();
    start();
  };

  prev?.addEventListener("click", () => step(-1));
  next?.addEventListener("click", () => step(1));
  section.addEventListener("mouseenter", () => {
    paused = true;
  });
  section.addEventListener("mouseleave", () => {
    paused = false;
  });
  section.addEventListener("focusin", () => {
    paused = true;
  });
  section.addEventListener("focusout", () => {
    paused = false;
  });

  start();
}

function wireCards(scope: HTMLElement): void {
  wireClickableRows(
    scope,
    "[data-manga-id]",
    (card) => {
      const id = card.dataset.mangaId;
      return id ? `/manga/${encodeURIComponent(id)}` : null;
    },
    { keyboard: true }
  );
}
