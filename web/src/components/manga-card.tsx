import type { ReactElement } from "react";
import type { Manga, MangaStatus } from "@/api/manga";
import { Cover } from "@/components/cover";
import { clickable } from "@/lib/clickable";

export function statusLabel(status: MangaStatus): string {
  return status.replace(/^\w/, (letter) => letter.toUpperCase());
}

// Pill background only. The per-status foreground colours components.css declared were
// always dead — a broader muted-span rule outranked them — so the text stays muted.
const STATUS_BG: Record<MangaStatus, string> = {
  ongoing: "bg-status-ok-bg",
  completed: "bg-status-info-bg",
  hiatus: "bg-status-warn-bg",
  cancelled: "bg-status-warn-bg",
};

// Library cards open the public detail page; manage cards open the edit page
// with a management aria-label.
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
      <div className="p-3.5">
        <h2 className="line-clamp-2 min-h-[calc(1.35rem*1.3*2)] leading-[1.3]">
          {manga.title}
        </h2>
        <span
          className={`mb-2.5 inline-block rounded-full px-2.5 py-[3px] text-[0.72rem] font-extrabold tracking-[0.02em] text-text-muted uppercase ${STATUS_BG[manga.status]}`}
        >
          {statusLabel(manga.status)}
        </span>
        {meta.length > 0 ? (
          <p className="mb-2 overflow-hidden text-[0.8rem] text-ellipsis whitespace-nowrap text-text-secondary">
            {meta.join(" · ")}
          </p>
        ) : null}
        <p className="mb-2 line-clamp-2 min-h-[calc(0.9rem*1.45*2)] text-[0.9rem] leading-[1.45] text-text-secondary">
          {manga.description?.trim() || "No description yet."}
        </p>
      </div>
    </article>
  );
}
