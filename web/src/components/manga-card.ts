import type { Manga, MangaStatus } from "@/api/manga";
import { escapeHtml, renderCover } from "@/utils/dom";

// Library cards open the public detail page (`data-manga-id`); management cards
// open the edit page and get a management aria-label (`data-manage-id`).
export type MangaCardVariant = "library" | "manage";

export function statusLabel(status: MangaStatus): string {
  return status.replace(/^\w/, (letter) => letter.toUpperCase());
}

// Compact author/year line; rendered only when at least one is present so older
// rows without metadata stay clean.
function mangaCardMeta(manga: Manga): string {
  const parts: string[] = [];
  if (manga.author) {
    parts.push(`by ${manga.author}`);
  }
  if (manga.publishedYear) {
    parts.push(String(manga.publishedYear));
  }
  if (parts.length === 0) {
    return "";
  }
  return `<p class="manga-card-meta">${escapeHtml(parts.join(" · "))}</p>`;
}

export function renderMangaCard(manga: Manga, variant: MangaCardVariant): string {
  const cover = renderCover({
    url: manga.coverUrl,
    seed: manga.title,
    placeholderClass: "cover-placeholder",
    imgAttrs: 'loading="lazy"',
  });

  const idAttrs =
    variant === "manage"
      ? `data-manage-id="${escapeHtml(manga.id)}" aria-label="Manage ${escapeHtml(manga.title)}"`
      : `data-manga-id="${escapeHtml(manga.id)}"`;

  return `
    <article class="manga-card" ${idAttrs} tabindex="0" role="button">
      <div class="manga-cover">${cover}</div>
      <div class="manga-card-body">
        <h2>${escapeHtml(manga.title)}</h2>
        <span class="status-badge status-badge-${manga.status}">${escapeHtml(statusLabel(manga.status))}</span>
        ${mangaCardMeta(manga)}
        <p class="manga-card-desc">${escapeHtml(manga.description?.trim() || "No description yet.")}</p>
      </div>
    </article>
  `;
}
