import {
  getAdminStorageStats,
  listAdminImports,
  listAdminLogs,
} from "@/api/admin";
import type {
  AdminImportEntry,
  AdminLogEntry,
  AdminLogLevel,
  AdminLogsResult,
  AdminStorageStats,
} from "@/api/admin";
import { retryChapterUpload } from "@/api/chapter";
import { icons } from "@/components/icons";
import { renderPageHeading } from "@/components/page-heading";
import { renderEmpty, renderError, renderLoading } from "@/components/states";
import { requireSessionForPage } from "@/components/page-session";
import { escapeHtml, formatDate } from "@/utils/dom";

const PATH = "/settings";
const IMPORTS_LIMIT = 50;
const LOGS_LIMIT = 50;
const LOG_LEVELS: AdminLogLevel[] = ["debug", "info", "warn", "error"];

// Owner/superuser operations page: chapter import health (with retry) and a
// storage usage estimate. The sidebar hides the entry for everyone else, but
// the API is the real gate (the /admin routes 403 non-superusers).
export function renderSettingsPage(container: HTMLElement): void {
  requireSessionForPage(container, PATH, {
    loading: "Loading settings",
    loginMessage: "Log in to view settings.",
    onReady: (user) => {
      if (user.role !== "superuser") {
        container.innerHTML = `
          ${renderPageHeading({ eyebrow: "Operations", title: "Settings" })}
          ${renderEmpty(
            "Admins only",
            "This page is only available to the site owner and admins.",
            icons.gear()
          )}
        `;
        return;
      }
      void load(container);
    },
  });
}

async function load(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    ${renderPageHeading({ eyebrow: "Operations", title: "Settings" })}
    ${renderLoading("Loading worker and storage status")}
  `;

  let storage: AdminStorageStats;
  let failed: AdminImportEntry[];
  let processing: AdminImportEntry[];
  let logs: AdminLogsResult;
  try {
    [storage, failed, processing, logs] = await Promise.all([
      getAdminStorageStats(),
      listAdminImports("failed", IMPORTS_LIMIT),
      listAdminImports("processing", IMPORTS_LIMIT),
      listAdminLogs(undefined, LOGS_LIMIT),
    ]);
  } catch (error) {
    if (window.location.pathname !== PATH) {
      return;
    }
    container.innerHTML = `
      ${renderPageHeading({ eyebrow: "Operations", title: "Settings" })}
      ${renderError(error instanceof Error ? error.message : "Unable to load settings.")}
    `;
    return;
  }

  if (window.location.pathname !== PATH) {
    return;
  }

  const attention = [...failed, ...processing];

  container.innerHTML = `
    ${renderPageHeading({ eyebrow: "Operations", title: "Settings" })}
    <div class="page-stack">
      <section class="manage-panel settings-panel">
        <h2 class="settings-heading">Storage usage</h2>
        <div class="settings-storage-row">
          <div>
            <p class="settings-storage-value">${escapeHtml(formatBytes(storage.readyPagesBytes))}</p>
            <p class="settings-storage-sub">${storage.readyPagesCount} ready ${storage.readyPagesCount === 1 ? "page" : "pages"} · ${storage.totalPagesCount} total</p>
            <p class="settings-note">Estimate from processed page sizes — staged originals and covers are counted but not sized.</p>
          </div>
          ${renderStoragePie(storage)}
        </div>
      </section>
      <section class="manage-panel settings-panel">
        <h2 class="settings-heading">Catalog</h2>
        <dl class="settings-stats">
          <div><dt>Manga</dt><dd>${storage.mangaCount}</dd></div>
          <div><dt>Chapters</dt><dd>${storage.chapterCount}</dd></div>
          <div><dt>Covers</dt><dd>${storage.coverUploadsCount}</dd></div>
        </dl>
      </section>
      <section class="manage-panel settings-panel">
        <div class="settings-heading-row">
          <h2 class="settings-heading">Chapter import health</h2>
          <p class="settings-health-chips">
            <span class="settings-health-chip${storage.failedImportsCount ? " is-bad" : ""}">${storage.failedImportsCount} failed</span>
            <span class="settings-health-chip">${storage.processingImportsCount} processing</span>
          </p>
        </div>
        ${
          attention.length === 0
            ? `<p class="settings-note">No failed or in-flight imports. All clear.</p>`
            : `<ol class="settings-imports">${attention.map(renderImportRow).join("")}</ol>`
        }
      </section>
      <section class="manage-panel settings-panel" data-panel="audit-logs"></section>
    </div>
  `;

  wireRetries(container);
  const logsPanel = container.querySelector<HTMLElement>(
    "[data-panel='audit-logs']"
  );
  if (logsPanel) {
    wireAuditLogs(logsPanel, logs);
  }
}

// Distinct hues for the per-title slices; the trailing gray is reserved for
// the derived "Other" remainder.
const PIE_COLORS = [
  "#2f9e8f",
  "#6366f1",
  "#e8a13c",
  "#d4618c",
  "#4bb8fa",
  "#8fbc52",
  "#9a6dd7",
  "#e07b54",
];
const PIE_OTHER_COLOR = "#9aa3ad";

// Storage-by-title pie: pure CSS conic-gradient (vanilla-first, no chart
// dependency). The API returns the top titles by ready-page bytes; anything
// beyond them folds into "Other". Hidden entirely when nothing is sized or
// only one slice would render (a single-color disc says nothing).
function renderStoragePie(storage: AdminStorageStats): string {
  const total = storage.readyPagesBytes;
  if (total <= 0) {
    return "";
  }

  const slices = storage.byManga
    .filter((entry) => entry.bytes > 0)
    .map((entry, index) => ({
      label: entry.title,
      bytes: entry.bytes,
      color: PIE_COLORS[index % PIE_COLORS.length],
    }));
  const otherBytes = total - slices.reduce((sum, slice) => sum + slice.bytes, 0);
  if (otherBytes > 0) {
    slices.push({ label: "Other", bytes: otherBytes, color: PIE_OTHER_COLOR });
  }
  if (slices.length < 2) {
    return "";
  }

  let angle = 0;
  const stops = slices.map((slice) => {
    const start = angle;
    angle += (slice.bytes / total) * 360;
    return `${slice.color} ${start.toFixed(2)}deg ${angle.toFixed(2)}deg`;
  });

  const legend = slices
    .map(
      (slice) => `
      <li>
        <span class="settings-pie-dot" style="background:${slice.color}" aria-hidden="true"></span>
        <span class="settings-pie-label">${escapeHtml(slice.label)}</span>
        <span class="settings-pie-share">${escapeHtml(formatBytes(slice.bytes))} · ${Math.round((slice.bytes / total) * 100)}%</span>
      </li>`
    )
    .join("");

  return `
    <figure class="settings-pie-figure">
      <div class="settings-pie" style="background:conic-gradient(${stops.join(", ")})" role="img" aria-label="Storage by title"></div>
      <figcaption>
        <ul class="settings-pie-legend">${legend}</ul>
      </figcaption>
    </figure>
  `;
}

function renderImportRow(entry: AdminImportEntry): string {
  const failedPages = entry.failedPages
    .map(
      (page) => `
        <li>
          <span class="settings-page-name">${escapeHtml(`${page.pageNumber.toString().padStart(3, "0")} · ${page.originalFilename}`)}</span>
          ${page.errorMessage ? `<span class="settings-page-error">${escapeHtml(page.errorMessage)}</span>` : ""}
        </li>`
    )
    .join("");

  return `
    <li class="settings-import-row" data-import-id="${escapeHtml(entry.importId)}" data-manga-id="${escapeHtml(entry.mangaId)}">
      <div class="settings-import-body">
        <h3>${escapeHtml(entry.mangaTitle)} — ${escapeHtml(entry.chapterTitle)}</h3>
        <p class="settings-import-meta">
          <span class="upload-status upload-status-${entry.status === "failed" ? "failed" : "uploading"}">${escapeHtml(entry.status)}</span>
          ${escapeHtml(`${entry.processedFiles}/${entry.totalFiles} processed${entry.failedFiles ? ` · ${entry.failedFiles} failed` : ""}`)}
          · ${escapeHtml(formatDate(entry.updatedAt))}
        </p>
        ${entry.errorMessage ? `<p class="settings-import-error">${escapeHtml(entry.errorMessage)}</p>` : ""}
        ${failedPages ? `<ul class="settings-failed-pages">${failedPages}</ul>` : ""}
      </div>
      <button class="secondary-button" type="button" data-action="retry-import">Retry</button>
    </li>
  `;
}

// Retry re-enqueues every non-ready page of the import (existing manga-scoped
// route; idempotent server-side). Reload the page data on success so statuses
// reflect the requeue.
function wireRetries(container: HTMLElement): void {
  container
    .querySelectorAll<HTMLButtonElement>("[data-action='retry-import']")
    .forEach((button) => {
      button.addEventListener("click", async () => {
        const row = button.closest<HTMLElement>(".settings-import-row");
        const mangaId = row?.dataset.mangaId;
        const importId = row?.dataset.importId;
        if (!mangaId || !importId) {
          return;
        }
        button.disabled = true;
        button.textContent = "Retrying";
        try {
          await retryChapterUpload(mangaId, importId);
        } catch (error) {
          button.disabled = false;
          button.textContent = "Retry";
          const errorLine = document.createElement("p");
          errorLine.className = "settings-import-error";
          errorLine.textContent =
            error instanceof Error ? error.message : "Retry failed.";
          row?.querySelector(".settings-import-body")?.appendChild(errorLine);
          return;
        }
        if (window.location.pathname === PATH) {
          void load(container);
        }
      });
    });
}

// Audit trail panel: newest-first rows from the API logs table with a level
// filter (the catalog-style popup menu) and offset-based Prev/Next paging. The
// panel owns its own state and re-renders only itself, so filter/paging never
// reloads the rest of the page.
function wireAuditLogs(panel: HTMLElement, initial: AdminLogsResult): void {
  let level: AdminLogLevel | undefined;
  let entries = initial.entries;
  let counts = initial.levelCounts;
  let offset = 0;
  // No total in the response (deliberate); a full page means a next page may exist.
  let hasNext = initial.entries.length === LOGS_LIMIT;
  let errorMessage: string | null = null;
  // Single in-flight fetch guard: blocks overlapping page/filter requests so a
  // slower earlier response can't land after a newer one.
  let loading = false;
  // Teardown for an open filter popup's document listeners; render() calls it
  // before rebuilding the panel so a re-render can never leak them.
  let closeFilter: (() => void) | undefined;

  function render(): void {
    closeFilter?.();
    const page = Math.floor(offset / LOGS_LIMIT) + 1;
    const filterOptions = [
      `<button class="library-filter-option${level === undefined ? " is-active" : ""}" type="button" role="menuitemradio" data-level="">All levels</button>`,
      ...LOG_LEVELS.map(
        (value) =>
          `<button class="library-filter-option${value === level ? " is-active" : ""}" type="button" role="menuitemradio" data-level="${value}">${value}</button>`
      ),
    ].join("");
    const showPager = offset > 0 || hasNext;

    panel.innerHTML = `
      <div class="settings-heading-row">
        <h2 class="settings-heading">Audit trail</h2>
        <div class="settings-heading-aside">
          <p class="settings-health-chips">
            <span class="settings-health-chip${counts.error ? " is-bad" : ""}">${counts.error} ${counts.error === 1 ? "error" : "errors"}</span>
            <span class="settings-health-chip">${counts.warn} ${counts.warn === 1 ? "warn" : "warns"}</span>
          </p>
          <div class="settings-logs-filter">
            <button class="library-filter${level !== undefined ? " is-active" : ""}" type="button" aria-label="Filter by level" aria-haspopup="true" aria-expanded="false">${icons.filter()}</button>
            <div class="library-filter-pop" role="menu" hidden>
              ${filterOptions}
            </div>
          </div>
        </div>
      </div>
      ${errorMessage ? `<p class="settings-import-error">${escapeHtml(errorMessage)}</p>` : ""}
      ${
        entries.length === 0
          ? `<p class="settings-note">No log entries${level ? ` at level ${level}` : ""}.</p>`
          : `<ol class="settings-logs">${entries.map(renderLogRow).join("")}</ol>`
      }
      ${
        showPager
          ? `
        <nav class="chapter-pager" aria-label="Audit trail pages">
          <button class="secondary-button" type="button" data-action="logs-prev" ${offset === 0 ? "disabled" : ""}>Previous</button>
          <span class="chapter-pager-status">Page ${page}</span>
          <button class="secondary-button" type="button" data-action="logs-next" ${hasNext ? "" : "disabled"}>Next</button>
        </nav>`
          : ""
      }
    `;

    wireFilter();

    panel
      .querySelector<HTMLButtonElement>("[data-action='logs-prev']")
      ?.addEventListener("click", () => {
        if (offset > 0) {
          void goTo(Math.max(0, offset - LOGS_LIMIT));
        }
      });
    panel
      .querySelector<HTMLButtonElement>("[data-action='logs-next']")
      ?.addEventListener("click", () => {
        if (hasNext) {
          void goTo(offset + LOGS_LIMIT);
        }
      });
  }

  // Catalog-style popup filter (mirrors the home library filter): the funnel
  // button toggles a menu, click-outside / Escape close it, and choosing a level
  // resets to the first page. Re-wired each render; the close handler removes its
  // own document listeners so a re-render never leaks them.
  function wireFilter(): void {
    const button = panel.querySelector<HTMLButtonElement>(
      ".settings-logs-filter .library-filter"
    );
    const pop = panel.querySelector<HTMLElement>(
      ".settings-logs-filter .library-filter-pop"
    );
    if (!button || !pop) {
      return;
    }

    const open = (): void => {
      pop.hidden = false;
      button.setAttribute("aria-expanded", "true");
      const onDocClick = (event: Event): void => {
        if (!pop.contains(event.target as Node) && !button.contains(event.target as Node)) {
          closeFilter?.();
        }
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
          closeFilter?.();
        }
      };
      closeFilter = (): void => {
        pop.hidden = true;
        button.setAttribute("aria-expanded", "false");
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onKey);
        closeFilter = undefined;
      };
      setTimeout(() => {
        document.addEventListener("click", onDocClick);
        document.addEventListener("keydown", onKey);
      }, 0);
    };

    button.addEventListener("click", () => {
      if (closeFilter) {
        closeFilter();
      } else {
        open();
      }
    });

    pop
      .querySelectorAll<HTMLButtonElement>(".library-filter-option")
      .forEach((option) => {
        option.addEventListener("click", () => {
          const value = option.dataset.level ?? "";
          const next = value === "" ? undefined : (value as AdminLogLevel);
          closeFilter?.();
          if (next === level) {
            return;
          }
          void goTo(0, next);
        });
      });
  }

  // Offset paging: each page replaces (not appends) the rows. `hasNext` is true
  // only when the page came back full, so Next can't run off the end. `offset`
  // and `level` are committed only on a successful fetch (so a failed filter
  // change doesn't show the new level over stale rows), and the loading guard
  // serializes requests.
  async function goTo(
    nextOffset: number,
    nextLevel: AdminLogLevel | undefined = level
  ): Promise<void> {
    if (loading) {
      return;
    }
    loading = true;
    try {
      const result = await listAdminLogs(nextLevel, LOGS_LIMIT, nextOffset);
      entries = result.entries;
      counts = result.levelCounts;
      offset = nextOffset;
      level = nextLevel;
      hasNext = result.entries.length === LOGS_LIMIT;
      errorMessage = null;
    } catch (error) {
      errorMessage =
        error instanceof Error ? error.message : "Unable to load logs.";
    } finally {
      loading = false;
    }
    render();
  }

  render();
}

function renderLogRow(entry: AdminLogEntry): string {
  const detailParts: string[] = [];
  if (entry.context) {
    detailParts.push(
      `<pre class="settings-log-pre">${escapeHtml(JSON.stringify(entry.context, null, 2))}</pre>`
    );
  }
  if (entry.errorName || entry.errorMessage) {
    detailParts.push(
      `<p class="settings-log-error">${escapeHtml([entry.errorName, entry.errorMessage].filter(Boolean).join(": "))}</p>`
    );
  }
  if (entry.errorStack) {
    detailParts.push(
      `<pre class="settings-log-pre">${escapeHtml(entry.errorStack)}</pre>`
    );
  }

  return `
    <li class="settings-log-row">
      <p class="settings-log-meta">
        <span class="settings-log-level is-${entry.level}">${entry.level}</span>
        <span>${escapeHtml(formatLogTimestamp(entry.createdAt))}</span>
        · <span>${escapeHtml(entry.service)}</span>
      </p>
      <p class="settings-log-message">${escapeHtml(entry.message)}</p>
      ${
        detailParts.length > 0
          ? `<details class="settings-log-details"><summary>Details</summary>${detailParts.join("")}</details>`
          : ""
      }
    </li>
  `;
}

// Logs need time-of-day, unlike the date-only formatDate shared helper.
function formatLogTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) {
      break;
    }
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}
