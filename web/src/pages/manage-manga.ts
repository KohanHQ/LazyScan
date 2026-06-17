import {
  createManga,
  deleteManga,
  getManga,
  updateManga,
  uploadMangaCover,
  MANGA_STATUSES,
} from "@/api/manga";
import type { Manga, MangaInput, MangaStatus } from "@/api/manga";
import { renderError, renderLoading } from "@/components/states";
import { confirmDialog } from "@/components/dialog";
import { navigateTo } from "@/router";
import { requireSessionForPage } from "@/components/page-session";
import { renderPageHeading } from "@/components/page-heading";
import { clearFormError, setFormError, setSubmitBusy } from "@/utils/form";
import { escapeHtml, renderCover, wireCoverFallbacks } from "@/utils/dom";
import { renderChaptersPanel } from "@/pages/manage-chapters-panel";

type Mode = "create" | "edit";

export function renderMangaCreatePage(container: HTMLElement): void {
  requireSessionForPage(container, "/manage/manga/new", {
    loginMessage: "Log in to manage manga.",
    onReady: () => renderForm(container, "create", null),
  });
}

export function renderMangaEditPage(container: HTMLElement, id: string): void {
  const path = `/manage/manga/${id}`;
  requireSessionForPage(container, path, {
    loginMessage: "Log in to manage manga.",
    onReady: async () => {
      container.innerHTML = renderLoading("Loading title");
      try {
        const manga = await getManga(id);
        if (window.location.pathname !== path) {
          return;
        }
        renderForm(container, "edit", manga);
      } catch (error) {
        container.innerHTML = renderError(
          error instanceof Error ? error.message : "Unable to load manga."
        );
      }
    },
  });
}

function statusOptions(selected: MangaStatus): string {
  return MANGA_STATUSES.map(
    (status) =>
      `<option value="${status}"${status === selected ? " selected" : ""}>${status.replace(/^\w/, (c) => c.toUpperCase())}</option>`
  ).join("");
}

function renderForm(
  container: HTMLElement,
  mode: Mode,
  manga: Manga | null
): void {
  const heading = mode === "create" ? "New manga" : "Edit manga";
  const submitLabel = mode === "create" ? "Create manga" : "Save changes";
  const status = manga?.status ?? "ongoing";
  const maxYear = new Date().getFullYear() + 1;

  container.innerHTML = `
    ${renderPageHeading({ title: heading })}
    <section class="manage-panel">
      <form class="manage-form manage-form--cols" novalidate>
        <label class="field-wide">
          <span>Title</span>
          <input name="title" type="text" required maxlength="500" value="${escapeHtml(manga?.title ?? "")}" />
        </label>
        <label class="field-wide">
          <span>Slug</span>
          <input name="slug" type="text" required maxlength="200" value="${escapeHtml(manga?.slug ?? "")}" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" />
          <small>Lowercase letters, numbers, and single hyphens.</small>
        </label>
        <label class="field-wide">
          <span>Description</span>
          <textarea name="description" maxlength="5000" rows="4">${escapeHtml(manga?.description ?? "")}</textarea>
        </label>
        <label>
          <span>Author</span>
          <input name="author" type="text" maxlength="200" value="${escapeHtml(manga?.author ?? "")}" />
        </label>
        <label>
          <span>Artist</span>
          <input name="artist" type="text" maxlength="200" value="${escapeHtml(manga?.artist ?? "")}" />
        </label>
        <label>
          <span>Publisher</span>
          <input name="publisher" type="text" maxlength="200" value="${escapeHtml(manga?.publisher ?? "")}" />
        </label>
        <label>
          <span>Published year</span>
          <input name="publishedYear" type="number" min="1900" max="${maxYear}" step="1" value="${manga?.publishedYear ?? ""}" />
        </label>
        <label class="field-wide">
          <span>Tags</span>
          <input name="tags" type="text" value="${escapeHtml(manga?.tags?.join(", ") ?? "")}" placeholder="action, isekai, slice of life" />
          <small>Comma-separated, up to 10. Lowercased automatically.</small>
        </label>
        <label>
          <span>Status</span>
          <select name="status">${statusOptions(status)}</select>
        </label>
        <label>
          <span>Total chapters</span>
          <input name="totalChapters" type="number" min="1" step="1" value="${manga?.totalChapters ?? ""}" />
        </label>
        ${
          mode === "create"
            ? `<label class="field-wide">
          <span>Cover image (optional)</span>
          <input name="cover" type="file" accept="image/png,image/jpeg,image/webp" />
          <small>PNG, JPEG, or WebP. Requires storage to be configured.</small>
        </label>`
            : ""
        }
        <p class="form-error" hidden></p>
        <div class="manage-actions">
          <button class="primary-button" type="submit">${escapeHtml(submitLabel)}</button>
          ${mode === "edit" ? `<button class="secondary-button" type="button" data-action="replace-cover">Replace cover</button>` : ""}
          ${mode === "edit" ? `<button class="secondary-button" type="button" data-action="upload-chapter">Upload chapter</button>` : ""}
          ${mode === "edit" ? `<button class="danger-button" type="button" data-action="delete">Delete</button>` : ""}
        </div>
      </form>
    </section>
  `;

  wireCoverFallbacks(container);

  const form = container.querySelector<HTMLFormElement>(".manage-form");
  if (!form) {
    return;
  }

  if (mode === "create") {
    wireSlugSuggestion(form);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleSubmit(form, mode, manga);
  });

  if (mode === "edit" && manga) {
    container
      .querySelector<HTMLElement>("[data-action='replace-cover']")
      ?.addEventListener("click", () => {
        void openCoverDialog(manga).then((updated) => {
          // Refresh the cached cover so a reopened dialog shows the new image,
          // without re-rendering the form (which would drop unsaved field edits).
          if (updated) {
            manga.coverUrl = updated.coverUrl;
          }
        });
      });
    container
      .querySelector<HTMLElement>("[data-action='upload-chapter']")
      ?.addEventListener("click", () =>
        navigateTo(`/manage/manga/${encodeURIComponent(manga.id)}/chapter`)
      );
    container
      .querySelector<HTMLElement>("[data-action='delete']")
      ?.addEventListener("click", () => void handleDelete(form, manga));

    // Chapter management list lives below the metadata form (edit only).
    renderChaptersPanel(container, manga);
  }
}

// Cover replace runs in its own modal so the main edit form stays focused on text
// fields (Save/Delete operate on those). This does not touch the form's save flow;
// it calls the cover endpoint directly and resolves with the updated manga, or
// null if cancelled.
function openCoverDialog(manga: Manga): Promise<Manga | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Replace cover">
        <h2 class="dialog-title">Replace cover</h2>
        <div class="manage-form cover-dialog-body">
          ${renderCover({
            url: manga.coverUrl ?? null,
            seed: manga.title,
            placeholderClass: "manage-cover-thumb",
            imgAttrs: 'class="manage-cover-preview"',
          })}
          <label class="field-wide">
            <span>New cover</span>
            <input name="cover" type="file" accept="image/png,image/jpeg,image/webp" required />
            <small>PNG, JPEG, or WebP. Requires storage to be configured.</small>
          </label>
        </div>
        <p class="form-error" hidden></p>
        <div class="dialog-actions">
          <button class="secondary-button" type="button" data-dialog="cancel">Cancel</button>
          <button class="primary-button" type="button" data-dialog="upload">Upload cover</button>
        </div>
      </div>
    `;

    const settle = (result: Manga | null): void => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(result);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        settle(null);
      }
    };

    const input = overlay.querySelector<HTMLInputElement>("input[name='cover']");
    const errorEl = overlay.querySelector<HTMLElement>(".form-error");
    const uploadButton = overlay.querySelector<HTMLButtonElement>(
      "[data-dialog='upload']"
    );

    const showError = (message: string): void => {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = message;
      }
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        settle(null);
      }
    });
    overlay
      .querySelector<HTMLElement>("[data-dialog='cancel']")
      ?.addEventListener("click", () => settle(null));

    uploadButton?.addEventListener("click", async () => {
      const file = input?.files?.[0] ?? null;
      if (!file) {
        showError("Choose an image to upload.");
        return;
      }
      uploadButton.disabled = true;
      uploadButton.textContent = "Uploading";
      try {
        const updated = await uploadMangaCover(manga.id, file);
        settle(updated);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Unable to upload cover."
        );
        uploadButton.disabled = false;
        uploadButton.textContent = "Upload cover";
      }
    });

    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    wireCoverFallbacks(overlay);
    input?.focus();
  });
}

// On create, keep slug in sync with the title until the user edits slug by hand.
function wireSlugSuggestion(form: HTMLFormElement): void {
  const title = form.querySelector<HTMLInputElement>("[name='title']");
  const slug = form.querySelector<HTMLInputElement>("[name='slug']");
  if (!title || !slug) {
    return;
  }

  let slugTouched = false;
  slug.addEventListener("input", () => {
    slugTouched = true;
  });
  title.addEventListener("input", () => {
    if (!slugTouched) {
      slug.value = slugify(title.value);
    }
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readInput(
  form: HTMLFormElement,
  mode: Mode
): {
  input: MangaInput;
  cover: File | null;
} {
  const data = new FormData(form);
  const title = String(data.get("title") || "").trim();
  const slug = String(data.get("slug") || "").trim();
  const description = String(data.get("description") || "").trim();
  const status = String(data.get("status") || "ongoing") as MangaStatus;
  const totalChaptersRaw = String(data.get("totalChapters") || "").trim();
  const author = String(data.get("author") || "").trim();
  const artist = String(data.get("artist") || "").trim();
  const publisher = String(data.get("publisher") || "").trim();
  const publishedYearRaw = String(data.get("publishedYear") || "").trim();
  const tagsRaw = String(data.get("tags") || "").trim();
  const coverEntry = data.get("cover");
  const cover = coverEntry instanceof File && coverEntry.size > 0 ? coverEntry : null;

  const input: MangaInput = { title, slug, status };

  // On edit, an emptied optional field is sent as null so the API clears it; on
  // create the field is simply omitted.
  const text = (value: string): string | null | undefined =>
    value ? value : mode === "edit" ? null : undefined;
  const num = (value: string): number | null | undefined =>
    value ? Number(value) : mode === "edit" ? null : undefined;

  const description_ = text(description);
  if (description_ !== undefined) {
    input.description = description_;
  }
  const totalChapters_ = num(totalChaptersRaw);
  if (totalChapters_ !== undefined) {
    input.totalChapters = totalChapters_;
  }
  const author_ = text(author);
  if (author_ !== undefined) {
    input.author = author_;
  }
  const artist_ = text(artist);
  if (artist_ !== undefined) {
    input.artist = artist_;
  }
  const publisher_ = text(publisher);
  if (publisher_ !== undefined) {
    input.publisher = publisher_;
  }
  const publishedYear_ = num(publishedYearRaw);
  if (publishedYear_ !== undefined) {
    input.publishedYear = publishedYear_;
  }
  // Comma-separated tags; the API normalizes (lowercase/trim/dedupe). Same
  // create-omit / edit-clear semantics as the other optional fields.
  const tags = tagsRaw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  if (tags.length > 0) {
    input.tags = tags;
  } else if (mode === "edit") {
    input.tags = null;
  }

  return { input, cover };
}

async function handleSubmit(
  form: HTMLFormElement,
  mode: Mode,
  manga: Manga | null
): Promise<void> {
  const { input, cover } = readInput(form, mode);

  if (!input.title || !input.slug) {
    setFormError(form, "Title and slug are required.");
    return;
  }

  clearFormError(form);
  setSubmitBusy(form, true, "Saving");

  try {
    let saved: Manga;
    if (mode === "create") {
      saved = await createManga(input, cover ?? undefined);
    } else {
      saved = await updateManga(manga!.id, input);
      if (cover) {
        saved = await uploadMangaCover(saved.id, cover);
      }
    }
    navigateTo(`/manga/${encodeURIComponent(saved.id)}`);
  } catch (saveError) {
    setFormError(
      form,
      saveError instanceof Error ? saveError.message : "Unable to save manga."
    );
    setSubmitBusy(form, false, "Saving", mode === "create" ? "Create manga" : "Save changes");
  }
}

async function handleDelete(
  form: HTMLFormElement,
  manga: Manga
): Promise<void> {
  const confirmed = await confirmDialog({
    title: "Delete manga",
    message: `Delete "${manga.title}"? This cannot be undone.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  const deleteButton = form.querySelector<HTMLButtonElement>(
    "[data-action='delete']"
  );
  if (deleteButton) {
    deleteButton.disabled = true;
    deleteButton.textContent = "Deleting";
  }

  try {
    await deleteManga(manga.id);
    navigateTo("/");
  } catch (deleteError) {
    setFormError(
      form,
      deleteError instanceof Error ? deleteError.message : "Unable to delete manga."
    );
    if (deleteButton) {
      deleteButton.disabled = false;
      deleteButton.textContent = "Delete";
    }
  }
}
