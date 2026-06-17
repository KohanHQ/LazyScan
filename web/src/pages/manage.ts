import { canManageManga, listManga } from "@/api/manga";
import type { Manga } from "@/api/manga";
import { renderError, renderLoading } from "@/components/states";
import { navigateTo } from "@/router";
import type { CurrentUser } from "@/api/auth";
import { wireClickableRows, wireCoverFallbacks } from "@/utils/dom";
import { renderMangaCard } from "@/components/manga-card";
import { requireSessionForPage } from "@/components/page-session";
import { renderPageHeading } from "@/components/page-heading";

const PAGE_LIMIT = 100;

// Management hub: the single entry point for create/edit/delete, reached from the
// sidebar. The public library and detail pages stay read-only; everything that
// mutates manga lives behind this auth gate. The API remains the real authority.
export function renderManagePage(container: HTMLElement): void {
  requireSessionForPage(container, "/manage", {
    loginMessage: "Log in to manage manga.",
    onReady: (user) => void loadHub(container, user),
  });
}

async function loadHub(container: HTMLElement, user: CurrentUser): Promise<void> {
  container.innerHTML = renderLoading("Loading manga");
  let list: Manga[] = [];
  try {
    // The hub filters by manageability client-side, so it needs every title,
    // not just the first page — page through until a short page is returned.
    for (let offset = 0; ; offset += PAGE_LIMIT) {
      const page = await listManga({ limit: PAGE_LIMIT, offset });
      list = list.concat(page);
      if (page.length < PAGE_LIMIT) {
        break;
      }
    }
  } catch (error) {
    container.innerHTML = renderError(
      error instanceof Error ? error.message : "Unable to load manga."
    );
    return;
  }
  if (window.location.pathname !== "/manage") {
    return;
  }

  // Owners see their own titles; superusers see everything (mirrors the API).
  const manageable = list.filter((manga) => canManageManga(manga, user));

  // The "New manga" affordance lives as a dashed add-card at the front of the
  // grid instead of a separate header button, so creating reads as part of the list.
  const addCard = `
    <button class="manga-card manga-card-add" type="button" data-action="new-manga" aria-label="New manga">
      <span class="manga-card-add-plus" aria-hidden="true">+</span>
      <span class="manga-card-add-label">New manga</span>
    </button>`;

  container.innerHTML = `
    ${renderPageHeading({
      title: "Manage",
      meta: `<p class="heading-meta">${manageable.length} title${manageable.length === 1 ? "" : "s"}</p>`,
    })}
    <section class="manga-grid" aria-label="Manageable manga">
      ${addCard}
      ${manageable.map((manga) => renderMangaCard(manga, "manage")).join("")}
    </section>
  `;

  container
    .querySelector<HTMLElement>("[data-action='new-manga']")
    ?.addEventListener("click", () => navigateTo("/manage/manga/new"));

  wireCoverFallbacks(container);
  wireClickableRows(
    container,
    "[data-manage-id]",
    (card) => {
      const id = card.dataset.manageId;
      return id ? `/manage/manga/${encodeURIComponent(id)}` : null;
    },
    { keyboard: true }
  );
}
