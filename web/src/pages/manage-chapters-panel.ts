import {
  deleteChapter,
  listMangaChapters,
  previewChapter,
  publishChapter,
  reorderChapterPages,
  unpublishChapter,
  updateChapter,
} from "@/api/chapter";
import type { ChapterPage, ReaderChapter } from "@/api/chapter";
import type { Manga } from "@/api/manga";
import { confirmDialog } from "@/components/dialog";
import { renderError, renderLoading } from "@/components/states";
import { escapeHtml } from "@/utils/dom";

// Chapter management surface for the manga edit page: list every chapter (any
// status/publish state) and act on it — publish/unpublish, edit metadata, delete,
// and a combined preview + page-reorder dialog. Rendered only in edit mode.
export function renderChaptersPanel(host: HTMLElement, manga: Manga): void {
  const section = document.createElement("section");
  section.className = "manage-panel manage-chapters";
  section.innerHTML = `<h2 class="manage-subheading">Chapters</h2><div data-role="chapters-body">${renderLoading("Loading chapters")}</div>`;
  host.appendChild(section);

  const body = section.querySelector<HTMLElement>("[data-role='chapters-body']");
  if (body) {
    void loadChapters(manga, body);
  }
}

async function loadChapters(manga: Manga, body: HTMLElement): Promise<void> {
  let chapters: ReaderChapter[];
  try {
    chapters = await listMangaChapters(manga.id);
  } catch (error) {
    body.innerHTML = renderError(
      error instanceof Error ? error.message : "Unable to load chapters."
    );
    return;
  }
  renderList(manga, body, chapters);
}

function visibilityLabel(chapter: ReaderChapter): string {
  if (chapter.status === "ready") {
    return chapter.publishedAt ? "Published" : "Draft";
  }
  if (chapter.status === "failed") {
    return "Failed";
  }
  return "Processing";
}

function visibilityClass(chapter: ReaderChapter): string {
  if (chapter.status === "ready") {
    return chapter.publishedAt ? "is-published" : "is-draft";
  }
  if (chapter.status === "failed") {
    return "is-failed";
  }
  return "is-processing";
}

function chapterLabel(chapter: ReaderChapter): string {
  const number =
    chapter.chapterNumber === null ? "" : `Ch. ${chapter.chapterNumber} · `;
  return `${number}${chapter.title}`;
}

function renderList(
  manga: Manga,
  body: HTMLElement,
  chapters: ReaderChapter[]
): void {
  if (chapters.length === 0) {
    body.innerHTML = `<p class="muted">No chapters yet. Use "Upload chapter" above to add one.</p>`;
    return;
  }

  body.innerHTML = `
    <ul class="chapter-admin-list">
      ${chapters
        .map(
          (chapter) => `
        <li class="chapter-admin-row" data-chapter-id="${escapeHtml(chapter.id)}">
          <div class="chapter-admin-main">
            <span class="chapter-admin-title">${escapeHtml(chapterLabel(chapter))}</span>
            <span class="chapter-admin-badge ${visibilityClass(chapter)}">${escapeHtml(visibilityLabel(chapter))}</span>
          </div>
          <div class="chapter-admin-actions">
            <button class="ghost-button" type="button" data-act="pages">Pages</button>
            <button class="ghost-button" type="button" data-act="edit">Edit</button>
            ${
              chapter.publishedAt
                ? `<button class="ghost-button" type="button" data-act="unpublish">Unpublish</button>`
                : `<button class="ghost-button" type="button" data-act="publish">Publish</button>`
            }
            <button class="ghost-button danger" type="button" data-act="delete">Delete</button>
          </div>
        </li>`
        )
        .join("")}
    </ul>
    <p class="form-error" hidden></p>
  `;

  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const refresh = (): Promise<void> => loadChapters(manga, body);
  const showError = (message: string): void => {
    const el = body.querySelector<HTMLElement>(".form-error");
    if (el) {
      el.hidden = false;
      el.textContent = message;
    }
  };

  body.querySelectorAll<HTMLElement>(".chapter-admin-row").forEach((row) => {
    const chapterId = row.dataset.chapterId ?? "";
    const chapter = byId.get(chapterId);
    if (!chapter) {
      return;
    }

    row
      .querySelector<HTMLButtonElement>("[data-act='pages']")
      ?.addEventListener("click", () => void openPagesDialog(manga, chapter, refresh));
    row
      .querySelector<HTMLButtonElement>("[data-act='edit']")
      ?.addEventListener("click", () => void openEditDialog(manga, chapter, refresh));
    row
      .querySelector<HTMLButtonElement>("[data-act='publish']")
      ?.addEventListener("click", () =>
        runAction(() => publishChapter(manga.id, chapter.id), refresh, showError)
      );
    row
      .querySelector<HTMLButtonElement>("[data-act='unpublish']")
      ?.addEventListener("click", () =>
        runAction(() => unpublishChapter(manga.id, chapter.id), refresh, showError)
      );
    row
      .querySelector<HTMLButtonElement>("[data-act='delete']")
      ?.addEventListener("click", () =>
        void handleDelete(manga, chapter, refresh, showError)
      );
  });
}

async function runAction(
  action: () => Promise<unknown>,
  refresh: () => Promise<void>,
  showError: (message: string) => void
): Promise<void> {
  try {
    await action();
    await refresh();
  } catch (error) {
    showError(error instanceof Error ? error.message : "Action failed.");
  }
}

async function handleDelete(
  manga: Manga,
  chapter: ReaderChapter,
  refresh: () => Promise<void>,
  showError: (message: string) => void
): Promise<void> {
  const confirmed = await confirmDialog({
    title: "Delete chapter",
    message: `Delete "${chapterLabel(chapter)}"? This removes its pages and cannot be undone.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) {
    return;
  }
  await runAction(() => deleteChapter(manga.id, chapter.id), refresh, showError);
}

// --- Edit dialog (title / number / volume / sort order) ---

function openEditDialog(
  manga: Manga,
  chapter: ReaderChapter,
  refresh: () => Promise<void>
): void {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.innerHTML = `
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Edit chapter">
      <h2 class="dialog-title">Edit chapter</h2>
      <div class="manage-form">
        <label><span>Title</span><input name="title" type="text" maxlength="500" value="${escapeHtml(chapter.title)}" /></label>
        <label><span>Chapter number</span><input name="chapterNumber" type="number" min="0" step="any" value="${chapter.chapterNumber ?? ""}" /></label>
        <label><span>Volume</span><input name="volume" type="number" min="0" step="any" value="${chapter.volume ?? ""}" /></label>
        <label><span>Sort order</span><input name="sortOrder" type="number" step="1" value="${chapter.sortOrder}" /></label>
      </div>
      <p class="form-error" hidden></p>
      <div class="dialog-actions">
        <button class="secondary-button" type="button" data-dialog="cancel">Cancel</button>
        <button class="primary-button" type="button" data-dialog="save">Save</button>
      </div>
    </div>
  `;

  const close = mountOverlay(overlay);
  const errorEl = overlay.querySelector<HTMLElement>(".form-error");
  const saveButton = overlay.querySelector<HTMLButtonElement>("[data-dialog='save']");

  const showError = (message: string): void => {
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = message;
    }
  };

  overlay
    .querySelector<HTMLElement>("[data-dialog='cancel']")
    ?.addEventListener("click", () => close());

  saveButton?.addEventListener("click", async () => {
    const get = (name: string): string =>
      overlay.querySelector<HTMLInputElement>(`[name='${name}']`)?.value.trim() ?? "";
    const title = get("title");
    if (!title) {
      showError("Title is required.");
      return;
    }
    const numberRaw = get("chapterNumber");
    const volumeRaw = get("volume");
    const sortRaw = get("sortOrder");

    saveButton.disabled = true;
    saveButton.textContent = "Saving";
    try {
      // Empty optional fields are sent as null so the API clears them.
      await updateChapter(manga.id, chapter.id, {
        title,
        chapterNumber: numberRaw ? Number(numberRaw) : null,
        volume: volumeRaw ? Number(volumeRaw) : null,
        ...(sortRaw ? { sortOrder: Number(sortRaw) } : {}),
      });
      close();
      await refresh();
    } catch (error) {
      showError(error instanceof Error ? error.message : "Unable to save chapter.");
      saveButton.disabled = false;
      saveButton.textContent = "Save";
    }
  });
}

// --- Pages dialog (preview + reorder) ---

async function openPagesDialog(
  manga: Manga,
  chapter: ReaderChapter,
  refresh: () => Promise<void>
): Promise<void> {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.innerHTML = `
    <div class="dialog dialog--wide" role="dialog" aria-modal="true" aria-label="Chapter pages">
      <h2 class="dialog-title">${escapeHtml(chapterLabel(chapter))} — pages</h2>
      <div data-role="pages-body">${renderLoading("Loading pages")}</div>
    </div>
  `;
  const close = mountOverlay(overlay);
  const dialogBody = overlay.querySelector<HTMLElement>("[data-role='pages-body']");
  if (!dialogBody) {
    return;
  }

  let pages: ChapterPage[];
  try {
    const preview = await previewChapter(manga.id, chapter.id);
    pages = [...preview.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  } catch (error) {
    dialogBody.innerHTML = renderError(
      error instanceof Error ? error.message : "Unable to load pages."
    );
    return;
  }

  // Working copy reordered in memory; persisted only on Save.
  let order = pages.map((page) => page.id);
  renderPages(dialogBody, pages, order, {
    onMove: (next) => {
      order = next;
      renderPagesList(dialogBody, pages, order);
    },
    onSave: async (saveButton) => {
      saveButton.disabled = true;
      saveButton.textContent = "Saving";
      try {
        await reorderChapterPages(manga.id, chapter.id, order);
        close();
        await refresh();
      } catch (error) {
        const errorEl = dialogBody.querySelector<HTMLElement>(".form-error");
        if (errorEl) {
          errorEl.hidden = false;
          errorEl.textContent =
            error instanceof Error ? error.message : "Unable to save order.";
        }
        saveButton.disabled = false;
        saveButton.textContent = "Save order";
      }
    },
    onClose: close,
  });
}

function renderPages(
  dialogBody: HTMLElement,
  pages: ChapterPage[],
  order: string[],
  handlers: {
    onMove: (next: string[]) => void;
    onSave: (saveButton: HTMLButtonElement) => void | Promise<void>;
    onClose: () => void;
  }
): void {
  dialogBody.innerHTML = `
    <p class="muted">Use the arrows to reorder, then save. Page numbers renumber 1..N in this order.</p>
    <ol class="page-reorder-list" data-role="list"></ol>
    <p class="form-error" hidden></p>
    <div class="dialog-actions">
      <button class="secondary-button" type="button" data-dialog="cancel">Close</button>
      <button class="primary-button" type="button" data-dialog="save">Save order</button>
    </div>
  `;
  renderPagesList(dialogBody, pages, order);

  // The list re-renders on every move, so move handlers are (re)bound there;
  // the dialog-level buttons are bound once here via event delegation on the body.
  dialogBody.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const move = target.closest<HTMLElement>("[data-move]");
    if (move) {
      const id = move.dataset.id ?? "";
      const direction = move.dataset.move === "up" ? -1 : 1;
      const current = readOrder(dialogBody);
      const index = current.indexOf(id);
      const swap = index + direction;
      if (index >= 0 && swap >= 0 && swap < current.length) {
        [current[index], current[swap]] = [current[swap], current[index]];
        handlers.onMove(current);
      }
      return;
    }
    if (target.closest("[data-dialog='cancel']")) {
      handlers.onClose();
      return;
    }
    const save = target.closest<HTMLButtonElement>("[data-dialog='save']");
    if (save) {
      void handlers.onSave(save);
    }
  });
}

// The DOM is the source of truth for the live order between renders.
function readOrder(dialogBody: HTMLElement): string[] {
  return Array.from(
    dialogBody.querySelectorAll<HTMLElement>(".page-reorder-row")
  ).map((row) => row.dataset.id ?? "");
}

function renderPagesList(
  dialogBody: HTMLElement,
  pages: ChapterPage[],
  order: string[]
): void {
  const list = dialogBody.querySelector<HTMLElement>("[data-role='list']");
  if (!list) {
    return;
  }
  const byId = new Map(pages.map((page) => [page.id, page]));
  list.innerHTML = order
    .map((id, index) => {
      const page = byId.get(id);
      if (!page) {
        return "";
      }
      const thumb = page.imageUrl
        ? `<img class="page-reorder-thumb" src="${escapeHtml(page.imageUrl)}" alt="" loading="lazy" />`
        : `<span class="page-reorder-thumb is-empty">${escapeHtml(page.status)}</span>`;
      return `
        <li class="page-reorder-row" data-id="${escapeHtml(page.id)}">
          <span class="page-reorder-index">${index + 1}</span>
          ${thumb}
          <span class="page-reorder-name">${escapeHtml(page.originalFilename)}</span>
          <span class="page-reorder-move">
            <button class="ghost-button" type="button" data-move="up" data-id="${escapeHtml(page.id)}" ${index === 0 ? "disabled" : ""} aria-label="Move up">▲</button>
            <button class="ghost-button" type="button" data-move="down" data-id="${escapeHtml(page.id)}" ${index === order.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button>
          </span>
        </li>`;
    })
    .join("");
}

// Mounts a modal overlay with backdrop-click + Escape close; returns a closer.
function mountOverlay(overlay: HTMLElement): () => void {
  const close = (): void => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      close();
    }
  };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  return close;
}
