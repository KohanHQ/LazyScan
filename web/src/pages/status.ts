import {
  getReadingStatusList,
  clearReadingStatus,
} from "@/api/reading-status";
import type {
  ReadingStatus,
  ReadingStatusEntry,
} from "@/api/reading-status";
import { renderEmpty, renderError, renderLoading } from "@/components/states";
import { icons } from "@/components/icons";
import { renderMangaCard } from "@/components/manga-card";
import { renderPageHeading } from "@/components/page-heading";
import { requireSessionForPage } from "@/components/page-session";
import { animateIn, escapeHtml, wireClickableRows, wireCoverFallbacks } from "@/utils/dom";

const TABS: { key: ReadingStatus; label: string }[] = [
  { key: "reading", label: "Reading" },
  { key: "completed", label: "Completed" },
  { key: "plan_to_read", label: "Plan to read" },
  { key: "on_hold", label: "On hold" },
  { key: "dropped", label: "Dropped" },
];

const DEFAULT_TAB: ReadingStatus = "reading";

export function renderStatusPage(container: HTMLElement): void {
  requireSessionForPage(container, "/status", {
    loginMessage: "Log in to track your reading status.",
    onReady: () => renderShell(container),
  });
}

function renderShell(container: HTMLElement): void {
  container.innerHTML = `
    ${renderPageHeading({ title: "Tracking" })}
    <div class="library-tabs" role="tablist">
      ${TABS.map(
        (tab) =>
          `<button class="library-tab${tab.key === DEFAULT_TAB ? " is-active" : ""}" type="button" role="tab" data-tab="${tab.key}">${tab.label}</button>`
      ).join("")}
    </div>
    <div class="library-content" data-role="content">${renderLoading("Loading")}</div>
  `;

  const content = container.querySelector<HTMLElement>("[data-role='content']");
  if (!content) {
    return;
  }

  container.querySelectorAll<HTMLElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab as ReadingStatus | undefined;
      if (!tab) {
        return;
      }
      container.querySelectorAll<HTMLElement>(".library-tab").forEach((other) => {
        other.classList.toggle("is-active", other.dataset.tab === tab);
      });
      void loadList(content, tab);
    });
  });

  void loadList(content, DEFAULT_TAB);
}

async function loadList(content: HTMLElement, status: ReadingStatus): Promise<void> {
  content.innerHTML = renderLoading("Loading");

  let entries: ReadingStatusEntry[];
  try {
    entries = await getReadingStatusList(status);
  } catch (error) {
    content.innerHTML = renderError(
      error instanceof Error ? error.message : "Unable to load your list."
    );
    return;
  }

  const label = TABS.find((tab) => tab.key === status)?.label ?? status;

  if (entries.length === 0) {
    content.innerHTML = renderEmpty(
      `Nothing marked "${label}"`,
      "Set a status from a title's detail page to track it here.",
      icons.inbox()
    );
    animateIn(content);
    return;
  }

  content.innerHTML = `
    <section class="manga-grid" aria-label="${escapeHtml(label)}">
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
      void clearReadingStatus(id)
        .then(() => loadList(content, status))
        .catch(() => button.removeAttribute("disabled"));
    });
  });
}

function renderEntryCard(entry: ReadingStatusEntry): string {
  return `
    <div class="library-card">
      ${renderMangaCard(entry.manga, "library")}
      <button class="library-remove" type="button" data-action="remove" data-remove-id="${escapeHtml(entry.manga.id)}">Remove</button>
    </div>
  `;
}
