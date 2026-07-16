import type { ReactElement } from "react";
import type { Manga } from "@/api/manga";
import { statusLabel } from "@/components/manga-card";
import { Cover } from "@/components/react/cover";
import { clickable } from "@/lib/clickable";

// React counterpart of components/manga-card.ts, library variant only — the
// manage variant converts with its first React consumer.
export function MangaCard({ manga }: { manga: Manga }): ReactElement {
  const meta: string[] = [];
  if (manga.author) {
    meta.push(`by ${manga.author}`);
  }
  if (manga.publishedYear) {
    meta.push(String(manga.publishedYear));
  }
  return (
    <article
      className="manga-card"
      data-manga-id={manga.id}
      {...clickable(`/manga/${encodeURIComponent(manga.id)}`)}
    >
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
