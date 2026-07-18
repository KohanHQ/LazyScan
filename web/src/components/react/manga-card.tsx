import type { ReactElement } from "react";
import type { Manga } from "@/api/manga";
import { statusLabel } from "@/components/manga-card";
import { Cover } from "@/components/react/cover";
import { clickable } from "@/lib/clickable";

// React counterpart of components/manga-card.ts. Library cards open the public
// detail page; manage cards open the edit page with a management aria-label.
export function MangaCard({
  manga,
  variant = "library",
}: {
  manga: Manga;
  variant?: "library" | "manage";
}): ReactElement {
  const meta: string[] = [];
  if (manga.author) {
    meta.push(`by ${manga.author}`);
  }
  if (manga.publishedYear) {
    meta.push(String(manga.publishedYear));
  }
  const idAttrs =
    variant === "manage"
      ? { "data-manage-id": manga.id, "aria-label": `Manage ${manga.title}` }
      : { "data-manga-id": manga.id };
  const target =
    variant === "manage"
      ? `/manage/manga/${encodeURIComponent(manga.id)}`
      : `/manga/${encodeURIComponent(manga.id)}`;
  return (
    <article className="manga-card" {...idAttrs} {...clickable(target)}>
      <div className="manga-cover">
        <Cover
          url={manga.coverUrl}
          seed={manga.title}
          placeholderClass="cover-placeholder"
        />
      </div>
      <div className="manga-card-body">
        <h2>{manga.title}</h2>
        <span className={`status-badge status-badge-${manga.status}`}>
          {statusLabel(manga.status)}
        </span>
        {meta.length > 0 ? (
          <p className="manga-card-meta">{meta.join(" · ")}</p>
        ) : null}
        <p className="manga-card-desc">
          {manga.description?.trim() || "No description yet."}
        </p>
      </div>
    </article>
  );
}
