import { getLibrary, removeFromLibrary } from "@/api/library";
import type { LibraryEntry, LibraryList } from "@/api/library";
import { renderEmpty, renderError, renderLoading } from "@/components/states";
import { icons } from "@/components/icons";
import { renderMangaCard } from "@/components/manga-card";
import { renderPageHeading } from "@/components/page-heading";
import { requireSessionForPage } from "@/components/page-session";
import { animateIn, escapeHtml, wireClickableRows, wireCoverFallbacks } from "@/utils/dom";

const TABS: { key: LibraryList; label: string }[] = [
  { key: "favorite", label: "Favorites" },
  { key: "queue", label: "Queue" },
];

export function renderFavoritesPage(container: HTMLElement): void {
  requireSessionForPage(container, "/favorites", {
    loginMessage: "Log in to see your favorites.",
    onReady: () => renderShell(container),
  });
}

function renderShell(container: HTMLElement): void {
  const params = new URLSearchParams(window.location.search);
  const initialSort = params.get("sort") || "newest";
  const initialYear = params.get("year") || "";

  container.innerHTML = `
    ${renderPageHeading({ title: "Favorites" })}
    <div class="library-tabs" role="tablist">
      ${TABS.map(
        (tab) =>
          `<button class="library-tab${tab.key === "favorite" ? " is-active" : ""}" type="button" role="tab" data-tab="${tab.key}">${tab.label}</button>`
      ).join("")}
    </div>
    <div class="library-filters" data-role="filters">
      <div class="library-filter-group">
        <label class="library-filter-label" for="library-sort">Sort</label>
        <select class="library-filter-select" id="library-sort" data-action="sort">
          <option value="newest"${initialSort === "newest" ? " selected" : ""}>Newest</option>
          <option value="title"${initialSort === "title" ? " selected" : ""}>Title (A-Z)</option>
          <option value="year"${initialSort === "year" ? " selected" : ""}>Year</option>
        </select>
      </div>
      <div class="library-filter-group">
        <label class="library-filter-label" for="library-year">Year</label>
        <input
          type="text"
          class="library-filter-input"
          id="library-year"
          data-action="year"
          placeholder="e.g. 2020 or 2020-2024"
          value="${escapeHtml(initialYear)}"
        />
      </div>
      <button class="library-filter-clear" type="button" data-action="clear-filters">Clear</button>
    </div>
    <div class="library-content" data-role="content">${renderLoading("Loading")}</div>
  `;

  const content = container.querySelector<HTMLElement>("[data-role='content']");
  if (!content) {
    return;
  }

  const sortEl = container.querySelector<HTMLSelectElement>("[data-action='sort']");
  const yearEl = container.querySelector<HTMLInputElement>("[data-action='year']");
  const clearBtn = container.querySelector<HTMLButtonElement>("[data-action='clear-filters']");

  let currentSort = initialSort;
  let currentYear = initialYear;
  let currentTab: LibraryList = "favorite";

  function updateUrl() {
    const url = new URL(window.location.href);
    if (currentSort && currentSort !== "newest") {
      url.searchParams.set("sort", currentSort);
    } else {
      url.searchParams.delete("sort");
    }
    if (currentYear) {
      url.searchParams.set("year", currentYear);
    } else {
      url.searchParams.delete("year");
    }
    window.history.replaceState({}, "", url.toString());
  }

  function loadCurrentList() {
    void loadList(content!, currentTab, currentSort, currentYear);
  }

  container.querySelectorAll<HTMLElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab as LibraryList | undefined;
      if (!tab) {
        return;
      }
      currentTab = tab;
      container.querySelectorAll<HTMLElement>(".library-tab").forEach((other) => {
        other.classList.toggle("is-active", other.dataset.tab === tab);
      });
      loadCurrentList();
    });
  });

  sortEl?.addEventListener("change", () => {
    currentSort = sortEl.value || "newest";
    updateUrl();
    loadCurrentList();
  });

  yearEl?.addEventListener("input", () => {
    currentYear = yearEl.value.trim();
    updateUrl();
  });

  yearEl?.addEventListener("change", () => {
    currentYear = yearEl.value.trim();
    loadCurrentList();
  });

  clearBtn?.addEventListener("click", () => {
    currentSort = "newest";
    currentYear = "";
    if (sortEl) sortEl.value = "newest";
    if (yearEl) yearEl.value = "";
    updateUrl();
    loadCurrentList();
  });

  void loadList(content, "favorite", currentSort, currentYear);
}

async function loadList(
  content: HTMLElement,
  list: LibraryList,
  sort: string = "newest",
  year: string = ""
): Promise<void> {
  content.innerHTML = renderLoading("Loading");

  let entries: LibraryEntry[];
  try {
    entries = await getLibrary(list, sort, year || undefined);
  } catch (error) {
    content.innerHTML = renderError(
      error instanceof Error ? error.message : "Unable to load your list."
    );
    return;
  }

  if (entries.length === 0) {
    content.innerHTML =
      list === "favorite"
        ? renderEmpty("No favorites yet", "Tap the heart on a title to save it here.", icons.heart())
        : renderEmpty("Queue is empty", "Add titles to your queue from their detail page.", icons.bookmark());
    animateIn(content);
    return;
  }

  content.innerHTML = `
    <section class="manga-grid" aria-label="${list === "favorite" ? "Favorites" : "Queue"}">
      ${entries.map((entry) => renderEntryCard(entry)).join("")}
    </section>
  `;
  animateIn(content);

  wireCoverFallbacks(content);
  wireClickableRows(
    content,
    "[data-manga-id]",
    (card) => {
      const id = card.dataset.mangaId;
      return id ? `/manga/${encodeURIComponent(id)}` : null;
    },
    { keyboard: true }
  );

  // Remove buttons sit beside the card (not inside it), so their click does not
  // reach the card's navigation handler.
  content.querySelectorAll<HTMLElement>("[data-action='remove']").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.removeId;
      if (!id) {
        return;
      }
      button.setAttribute("disabled", "true");
      void removeFromLibrary(list, id)
        .then(() => loadList(content, list, sort, year))
        .catch(() => button.removeAttribute("disabled"));
    });
  });
}

function renderEntryCard(entry: LibraryEntry): string {
  return `
    <div class="library-card">
      ${renderMangaCard(entry.manga, "library")}
      <button class="library-remove" type="button" data-action="remove" data-remove-id="${escapeHtml(entry.manga.id)}">Remove</button>
    </div>
  `;
}
