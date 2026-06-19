import {
  completeChapterUpload,
  createChapterUpload,
  getChapterUpload,
  putToPresignedUrl,
  retryChapterUpload,
} from "@/api/chapter";
import type {
  ChapterImportDetail,
  ChapterPage,
  ChapterUploadTarget,
  CreateChapterUploadResponse,
} from "@/api/chapter";
import { getManga } from "@/api/manga";
import { renderError } from "@/components/states";
import { navigateTo } from "@/router";
import { requireSessionForPage } from "@/components/page-session";
import { renderPageHeading } from "@/components/page-heading";
import { clearFormError, setFormError, setSubmitBusy } from "@/utils/form";
import { escapeHtml } from "@/utils/dom";
import { cbzSupported, extractCbz, isArchiveFile } from "@/utils/cbz";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 300;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_FAILURES = 3;

export function renderChapterUploadPage(
  container: HTMLElement,
  mangaId: string
): void {
  const path = `/manage/manga/${mangaId}/chapter`;
  requireSessionForPage(container, path, {
    loginMessage: "Log in to upload chapters.",
    onReady: () => void start(container, mangaId, path),
  });
}

async function start(
  container: HTMLElement,
  mangaId: string,
  path: string
): Promise<void> {
  let title = "";
  try {
    title = (await getManga(mangaId)).title;
  } catch {
    // Title is decorative; the upload routes still work without it.
  }
  if (window.location.pathname !== path) {
    return;
  }
  renderForm(container, mangaId, path, title);
}

function renderForm(
  container: HTMLElement,
  mangaId: string,
  path: string,
  title: string
): void {
  // CBZ/ZIP is desktop-only (in-memory unzip); accept + hint adapt to the device.
  const archiveOk = cbzSupported();
  const accept = archiveOk
    ? "image/png,image/jpeg,image/webp,.cbz,.zip"
    : "image/png,image/jpeg,image/webp";
  const hint = archiveOk
    ? `PNG, JPEG, or WebP — or a CBZ/ZIP archive. Up to ${MAX_FILES} pages, 10MB each. Pages are ordered by filename.`
    : `PNG, JPEG, or WebP. Up to ${MAX_FILES} pages, 10MB each. Pages are ordered by filename.`;
  container.innerHTML = `
    ${renderPageHeading({ eyebrow: "Chapter upload", title: title || "Upload chapter" })}
    <section class="manage-panel">
      <form class="manage-form" novalidate>
        <label>
          <span>Chapter title</span>
          <input name="title" type="text" required maxlength="500" />
        </label>
        <label>
          <span>Chapter number (optional)</span>
          <input name="chapterNumber" type="number" min="0" step="any" />
        </label>
        <label>
          <span>Volume (optional)</span>
          <input name="volume" type="number" min="0" step="any" />
        </label>
        <label>
          <span>Sort order (optional)</span>
          <input name="sortOrder" type="number" step="1" />
        </label>
        <label>
          <span>Page images</span>
          <div class="dropzone" data-role="dropzone">
            <input class="dropzone-input" name="files" type="file" accept="${accept}" multiple required />
            <div class="dropzone-prompt">
              <strong>Drag &amp; drop pages here</strong>
              <span>or click to browse</span>
              <span class="dropzone-count" data-role="count" hidden></span>
            </div>
          </div>
          <small>${escapeHtml(hint)}</small>
        </label>
        <label class="manage-checkbox">
          <input name="holdAsDraft" type="checkbox" />
          <span>Save as draft — review and reorder pages before publishing (readers won't see it until you publish)</span>
        </label>
        <p class="form-error" hidden></p>
        <div class="manage-actions">
          <button class="primary-button" type="submit">Start upload</button>
          <button class="secondary-button" type="button" data-action="cancel">Back</button>
        </div>
      </form>
    </section>
  `;

  const form = container.querySelector<HTMLFormElement>(".manage-form");
  container
    .querySelector<HTMLElement>("[data-action='cancel']")
    ?.addEventListener("click", () =>
      navigateTo(`/manage/manga/${encodeURIComponent(mangaId)}`)
    );

  // Resolved at pick time: loose images directly, or the image entries unzipped
  // from a dropped CBZ/ZIP. Read at submit instead of the raw input FileList.
  const selection: SelectedPages = { files: [] };
  const dropzone = container.querySelector<HTMLElement>("[data-role='dropzone']");

  if (form) {
    if (dropzone) {
      wireDropzone(dropzone, form, selection);
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void handleCreate(container, mangaId, path, form, selection.files);
    });
  }
}

interface SelectedPages {
  files: File[];
}

// The file <input> overlays the dropzone (opacity 0), so native click-to-browse
// and native file drops both target it directly. The change handler resolves the
// picked files into `selection` (unzipping a CBZ/ZIP first); submit validates and
// uploads from `selection`, so the per-page upload contract is unchanged.
function wireDropzone(
  dropzone: HTMLElement,
  form: HTMLFormElement,
  selection: SelectedPages
): void {
  const input = dropzone.querySelector<HTMLInputElement>(".dropzone-input");
  const count = dropzone.querySelector<HTMLElement>("[data-role='count']");
  if (!input || !count) {
    return;
  }

  const showCount = (label: string): void => {
    count.hidden = label === "";
    count.textContent = label;
  };

  input.addEventListener("change", () => {
    void resolveSelection(form, selection, input.files, showCount);
  });

  for (const eventName of ["dragenter", "dragover"]) {
    dropzone.addEventListener(eventName, () =>
      dropzone.classList.add("is-dragover")
    );
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropzone.addEventListener(eventName, () =>
      dropzone.classList.remove("is-dragover")
    );
  }
}

// A single dropped CBZ/ZIP is unzipped into its image pages; anything else is
// taken as loose image files. Archive errors and unsupported devices clear the
// selection and surface a message rather than silently failing at submit.
async function resolveSelection(
  form: HTMLFormElement,
  selection: SelectedPages,
  fileList: FileList | null,
  showCount: (label: string) => void
): Promise<void> {
  clearFormError(form);
  const picked = fileList ? Array.from(fileList) : [];
  const archive = picked.find(isArchiveFile);

  if (!archive) {
    selection.files = picked;
    showCount(pageCountLabel(picked.length));
    return;
  }

  if (picked.length > 1) {
    selection.files = [];
    showCount("");
    setFormError(form, "Upload one CBZ/ZIP archive on its own, not mixed with other files.");
    return;
  }
  if (!cbzSupported()) {
    selection.files = [];
    showCount("");
    setFormError(form, "CBZ/ZIP import is desktop-only. Use individual page images here.");
    return;
  }

  showCount("Reading archive…");
  try {
    const pages = await extractCbz(archive);
    selection.files = pages;
    showCount(`CBZ · ${pageCountLabel(pages.length)}`);
  } catch (error) {
    selection.files = [];
    showCount("");
    setFormError(form, error instanceof Error ? error.message : "Could not read the archive.");
  }
}

function pageCountLabel(count: number): string {
  if (count === 0) {
    return "";
  }
  return count === 1 ? "1 file selected" : `${count} files selected`;
}

async function handleCreate(
  container: HTMLElement,
  mangaId: string,
  path: string,
  form: HTMLFormElement,
  files: File[]
): Promise<void> {
  const data = new FormData(form);
  const title = String(data.get("title") || "").trim();
  const chapterNumberRaw = String(data.get("chapterNumber") || "").trim();
  const volumeRaw = String(data.get("volume") || "").trim();
  const sortOrderRaw = String(data.get("sortOrder") || "").trim();
  const holdAsDraft = data.get("holdAsDraft") === "on";

  const validationError = validateSelection(title, files);
  if (validationError) {
    setFormError(form, validationError);
    return;
  }

  setSubmitBusy(form, true, "Creating");

  let created: CreateChapterUploadResponse;
  try {
    created = await createChapterUpload(mangaId, {
      title,
      ...(chapterNumberRaw ? { chapterNumber: Number(chapterNumberRaw) } : {}),
      ...(volumeRaw ? { volume: Number(volumeRaw) } : {}),
      ...(sortOrderRaw ? { sortOrder: Number(sortOrderRaw) } : {}),
      files: files.map((file) => ({
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      })),
    });
  } catch (error) {
    setFormError(form, error instanceof Error ? error.message : "Unable to create chapter.");
    setSubmitBusy(form, false, "Creating", "Start upload");
    return;
  }

  if (window.location.pathname !== path) {
    return;
  }

  await runUploads(container, mangaId, path, created, files, holdAsDraft);
}

function validateSelection(title: string, files: File[]): string | null {
  if (!title) {
    return "Chapter title is required.";
  }
  if (files.length === 0) {
    return "Select at least one page image.";
  }
  if (files.length > MAX_FILES) {
    return `Too many pages. Maximum is ${MAX_FILES}.`;
  }
  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `Unsupported file type for "${file.name}". Use PNG, JPEG, or WebP.`;
    }
    if (file.size > MAX_BYTES) {
      return `"${file.name}" exceeds the 10MB per-page limit.`;
    }
  }
  return null;
}

// Maps the upload targets returned by the API back to the picked files by
// filename (the API natural-sorts and assigns page numbers). Duplicate
// filenames are consumed in selection order.
function buildFilePicker(files: File[]): (filename: string) => File | undefined {
  const byName = new Map<string, File[]>();
  for (const file of files) {
    const bucket = byName.get(file.name) ?? [];
    bucket.push(file);
    byName.set(file.name, bucket);
  }
  return (filename: string) => byName.get(filename)?.shift();
}

async function runUploads(
  container: HTMLElement,
  mangaId: string,
  path: string,
  created: CreateChapterUploadResponse,
  files: File[],
  holdAsDraft: boolean
): Promise<void> {
  const uploadId = created.import.id;
  const targets = [...created.uploads].sort((a, b) => a.pageNumber - b.pageNumber);
  renderUploadProgress(container, mangaId, targets);

  const pick = buildFilePicker(files);
  const failed: ChapterUploadTarget[] = [];

  for (const target of targets) {
    if (window.location.pathname !== path) {
      return;
    }
    setPageStatus(container, target.pageId, "uploading", "Uploading");
    const file = pick(target.filename);
    if (!file) {
      setPageStatus(container, target.pageId, "failed", "Missing file");
      failed.push(target);
      continue;
    }
    try {
      await putToPresignedUrl(target.uploadUrl, file);
      setPageStatus(container, target.pageId, "ready", "Uploaded");
    } catch (error) {
      setPageStatus(
        container,
        target.pageId,
        "failed",
        error instanceof Error ? error.message : "Upload failed"
      );
      failed.push(target);
    }
  }

  if (window.location.pathname !== path) {
    return;
  }

  if (failed.length > 0) {
    renderUploadFailed(container, mangaId, path, created, files, failed, holdAsDraft);
    return;
  }

  await finishUpload(container, mangaId, path, uploadId, holdAsDraft);
}

async function finishUpload(
  container: HTMLElement,
  mangaId: string,
  path: string,
  uploadId: string,
  holdAsDraft: boolean
): Promise<void> {
  try {
    await completeChapterUpload(mangaId, uploadId, { holdAsDraft });
  } catch (error) {
    if (window.location.pathname !== path) {
      return;
    }
    container.innerHTML = renderError(
      error instanceof Error ? error.message : "Unable to start processing."
    );
    return;
  }
  if (window.location.pathname !== path) {
    return;
  }
  startPolling(container, mangaId, path, uploadId);
}

// The active status-poll interval. Retry can be clicked while a poll is still
// running (a processing import with failed pages), and its handler restarts
// polling — clearing the previous interval first prevents two pollers ticking
// against the same view.
let activePollIntervalId: number | null = null;

function startPolling(
  container: HTMLElement,
  mangaId: string,
  path: string,
  uploadId: string
): void {
  if (activePollIntervalId !== null) {
    window.clearInterval(activePollIntervalId);
    activePollIntervalId = null;
  }
  renderProcessing(container, mangaId, path, uploadId, null);

  let consecutiveFailures = 0;
  const tick = async (): Promise<void> => {
    if (window.location.pathname !== path) {
      window.clearInterval(intervalId);
      return;
    }
    let detail: ChapterImportDetail;
    try {
      detail = await getChapterUpload(mangaId, uploadId);
      consecutiveFailures = 0;
    } catch {
      // A single read failure is treated as transient. Persistent failures
      // (deleted import, expired auth, sustained 404) would otherwise poll
      // forever, so stop after a few and surface an error instead.
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_POLL_FAILURES) {
        window.clearInterval(intervalId);
        if (window.location.pathname === path) {
          container.innerHTML = renderError(
            "Lost contact with the server while processing. Refresh to check status."
          );
        }
      }
      return;
    }
    if (window.location.pathname !== path) {
      window.clearInterval(intervalId);
      return;
    }
    renderProcessing(container, mangaId, path, uploadId, detail);
    if (detail.import.status === "completed" || detail.import.status === "failed") {
      window.clearInterval(intervalId);
    }
  };

  const intervalId = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
  activePollIntervalId = intervalId;
  void tick();
}

function renderUploadProgress(
  container: HTMLElement,
  mangaId: string,
  targets: ChapterUploadTarget[]
): void {
  container.innerHTML = `
    <section class="page-heading">
      <div>
        <p class="eyebrow">Chapter upload</p>
        <h1>Uploading pages</h1>
      </div>
    </section>
    <section class="manage-panel">
      <p class="upload-hint">Uploading ${targets.length} pages to storage. Keep this tab open.</p>
      <ol class="upload-list">
        ${targets
          .map(
            (target) => `
          <li class="upload-row" data-page-id="${escapeHtml(target.pageId)}">
            <span class="upload-name">${escapeHtml(target.pageNumber.toString().padStart(3, "0"))} &middot; ${escapeHtml(target.filename)}</span>
            <span class="upload-status upload-status-pending" data-role="status">Pending</span>
          </li>`
          )
          .join("")}
      </ol>
      <div class="manage-actions">
        <button class="secondary-button" type="button" data-action="back">Back to manga</button>
      </div>
    </section>
  `;
  container
    .querySelector<HTMLElement>("[data-action='back']")
    ?.addEventListener("click", () =>
      navigateTo(`/manage/manga/${encodeURIComponent(mangaId)}`)
    );
}

function setPageStatus(
  container: HTMLElement,
  pageId: string,
  state: "uploading" | "ready" | "failed",
  label: string
): void {
  const row = container.querySelector<HTMLElement>(
    `[data-page-id="${cssEscape(pageId)}"] [data-role="status"]`
  );
  if (!row) {
    return;
  }
  row.className = `upload-status upload-status-${state}`;
  row.textContent = label;
}

function renderUploadFailed(
  container: HTMLElement,
  mangaId: string,
  path: string,
  created: CreateChapterUploadResponse,
  files: File[],
  failed: ChapterUploadTarget[],
  holdAsDraft: boolean
): void {
  const panel = document.createElement("section");
  panel.className = "manage-panel upload-retry";
  panel.innerHTML = `
    <p class="form-error">${escapeHtml(`${failed.length} page(s) failed to upload.`)}</p>
    <div class="manage-actions">
      <button class="primary-button" type="button" data-action="retry-failed">Retry failed uploads</button>
      <button class="secondary-button" type="button" data-action="back">Back to manga</button>
    </div>
  `;
  container.appendChild(panel);

  panel
    .querySelector<HTMLElement>("[data-action='back']")
    ?.addEventListener("click", () =>
      navigateTo(`/manage/manga/${encodeURIComponent(mangaId)}`)
    );

  panel
    .querySelector<HTMLButtonElement>("[data-action='retry-failed']")
    ?.addEventListener("click", () => {
      panel.remove();
      // Re-resolve only the failed pages from the original selection; the
      // presigned URLs stay valid for their expiry window (~15 min).
      const retryCreated: CreateChapterUploadResponse = {
        ...created,
        uploads: failed,
      };
      void runUploads(container, mangaId, path, retryCreated, files, holdAsDraft);
    });
}

function renderProcessing(
  container: HTMLElement,
  mangaId: string,
  path: string,
  uploadId: string,
  detail: ChapterImportDetail | null
): void {
  const status = detail?.import.status ?? "processing";
  const total = detail?.import.totalFiles ?? 0;
  const processed = detail?.import.processedFiles ?? 0;
  const failed = detail?.import.failedFiles ?? 0;
  const pages = detail?.pages ?? [];
  // Retry is offered as soon as at least one page failed, not only when the
  // whole import is terminal `failed` (an import stays `processing` until every
  // page settles). The retry route is idempotent: ready pages are skipped.
  const canRetry = status === "failed" || failed > 0;

  const heading =
    status === "completed"
      ? "Chapter ready"
      : status === "failed"
        ? "Processing failed"
        : "Processing pages";

  const pageList = pages.length
    ? `<ol class="upload-list">
        ${pages
          .map(
            (page) => `
          <li class="upload-row">
            <span class="upload-name">${escapeHtml(page.pageNumber.toString().padStart(3, "0"))} &middot; ${escapeHtml(page.originalFilename)}</span>
            <span class="upload-status upload-status-${pageStatusClass(page)}">${escapeHtml(pageStatusLabel(page))}</span>
          </li>`
          )
          .join("")}
      </ol>`
    : "";

  container.innerHTML = `
    <section class="page-heading">
      <div>
        <p class="eyebrow">Chapter upload</p>
        <h1>${escapeHtml(heading)}</h1>
      </div>
    </section>
    <section class="manage-panel">
      <p class="upload-hint">${escapeHtml(`Processed ${processed}/${total}${failed ? ` · ${failed} failed` : ""}`)}</p>
      ${detail?.import.errorMessage ? `<p class="form-error">${escapeHtml(detail.import.errorMessage)}</p>` : ""}
      ${pageList}
      <div class="manage-actions">
        ${status === "completed" ? `<button class="primary-button" type="button" data-action="view">View manga</button>` : ""}
        ${canRetry ? `<button class="primary-button" type="button" data-action="retry">Retry processing</button>` : ""}
        <button class="secondary-button" type="button" data-action="back">Back to manga</button>
      </div>
    </section>
  `;

  const goManga = () =>
    navigateTo(`/manga/${encodeURIComponent(mangaId)}`);

  container
    .querySelector<HTMLElement>("[data-action='view']")
    ?.addEventListener("click", goManga);
  container
    .querySelector<HTMLElement>("[data-action='back']")
    ?.addEventListener("click", () =>
      navigateTo(`/manage/manga/${encodeURIComponent(mangaId)}`)
    );
  container
    .querySelector<HTMLButtonElement>("[data-action='retry']")
    ?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = "Retrying";
      try {
        await retryChapterUpload(mangaId, uploadId);
      } catch (error) {
        showOnPanel(
          container,
          error instanceof Error ? error.message : "Retry failed."
        );
        button.disabled = false;
        button.textContent = "Retry processing";
        return;
      }
      if (window.location.pathname !== path) {
        return;
      }
      startPolling(container, mangaId, path, uploadId);
    });
}

function pageStatusClass(page: ChapterPage): string {
  switch (page.status) {
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    case "processing":
      return "uploading";
    default:
      return "pending";
  }
}

function pageStatusLabel(page: ChapterPage): string {
  switch (page.status) {
    case "ready":
      return "Ready";
    case "failed":
      return page.errorMessage ? `Failed: ${page.errorMessage}` : "Failed";
    case "processing":
      return "Processing";
    default:
      return "Waiting";
  }
}

function showOnPanel(container: HTMLElement, message: string): void {
  const panel = container.querySelector<HTMLElement>(".manage-panel");
  if (!panel) {
    return;
  }
  let error = panel.querySelector<HTMLElement>(".form-error");
  if (!error) {
    error = document.createElement("p");
    error.className = "form-error";
    panel.prepend(error);
  }
  error.textContent = message;
}

// Minimal attribute-selector escape for UUID page ids (avoids relying on the
// not-universally-available CSS.escape in older runtimes).
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
