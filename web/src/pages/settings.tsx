import { useEffect, useRef, useState, type ReactElement } from "react";
import { ChevronLeft, ChevronRight, Funnel, Settings } from "lucide-react";
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
import { PageHeading } from "@/components/page-heading";
import { Empty, ErrorState, Loading } from "@/components/states";
import { RequireSession } from "@/components/require-session";
import { useToast } from "@/components/ui/toast";
import { ForumReportsPanel } from "@/pages/forum-reports-panel";
import { usePopupDismiss } from "@/lib/use-popup-dismiss";
import { formatDate } from "@/utils/format";

const IMPORTS_LIMIT = 50;
const LOGS_LIMIT = 10;
const LOG_LEVELS: AdminLogLevel[] = ["debug", "info", "warn", "error"];

// Owner/superuser operations page: chapter import health (with retry) and a
// storage usage estimate. The sidebar hides the entry for everyone else, but
// the API is the real gate (the /admin routes 403 non-superusers).
export function SettingsPage(): ReactElement {
  return (
    <RequireSession loginMessage="Log in to view settings.">
      {(user) =>
        user.role === "superuser" ? <SettingsContent /> : <AdminsOnly />
      }
    </RequireSession>
  );
}

function AdminsOnly(): ReactElement {
  return (
    <>
      <PageHeading eyebrow="Operations" title="Settings" />
      <Empty
        title="Admins only"
        message="This page is only available to the site owner and admins."
        icon={<Settings className="icon" size={20} />}
      />
    </>
  );
}

type SettingsData = {
  storage: AdminStorageStats;
  attention: AdminImportEntry[];
  logs: AdminLogsResult;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: SettingsData };

function SettingsContent(): ReactElement {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    setState({ kind: "loading" });
    void (async () => {
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
        if (!ignore) {
          setState({
            kind: "error",
            message:
              error instanceof Error ? error.message : "Unable to load settings.",
          });
        }
        return;
      }
      if (ignore) {
        return;
      }
      setState({
        kind: "ready",
        data: { storage, attention: [...failed, ...processing], logs },
      });
    })();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  if (state.kind === "loading") {
    return (
      <>
        <PageHeading eyebrow="Operations" title="Settings" />
        <Loading message="Loading worker and storage status" />
      </>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        <PageHeading eyebrow="Operations" title="Settings" />
        <ErrorState message={state.message} />
      </>
    );
  }

  const { storage, attention, logs } = state.data;
  const reload = (): void => setReloadKey((key) => key + 1);

  return (
    <>
      <PageHeading eyebrow="Operations" title="Settings" />
      <div className="page-stack">
        <StoragePanel storage={storage} />
        <CatalogPanel storage={storage} />
        <ImportHealthPanel storage={storage} attention={attention} onRetry={reload} />
        <ForumReportsPanel />
        <AuditTrailPanel initial={logs} />
      </div>
    </>
  );
}

function StoragePanel({ storage }: { storage: AdminStorageStats }): ReactElement {
  return (
    <section className="manage-panel text-left">
      <h2 className="settings-heading">Storage usage</h2>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-[560px] min-w-[260px] flex-[1_1_320px]">
          <p className="m-0 text-[1.8rem] leading-[1.2] font-extrabold">{formatBytes(storage.readyPagesBytes)}</p>
          <p className="settings-storage-sub">
            {storage.readyPagesCount} ready {storage.readyPagesCount === 1 ? "page" : "pages"} · {storage.totalPagesCount} total
          </p>
          <p className="mb-3.5 text-[0.85rem] text-text-muted">Estimate from processed page sizes — staged originals and covers are counted but not sized.</p>
        </div>
        <StoragePie storage={storage} />
      </div>
    </section>
  );
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
function StoragePie({ storage }: { storage: AdminStorageStats }): ReactElement | null {
  const total = storage.readyPagesBytes;
  if (total <= 0) {
    return null;
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
    return null;
  }

  let angle = 0;
  const stops = slices.map((slice) => {
    const start = angle;
    angle += (slice.bytes / total) * 360;
    return `${slice.color} ${start.toFixed(2)}deg ${angle.toFixed(2)}deg`;
  });

  return (
    <figure className="m-0 ml-auto flex items-center gap-4">
      <div
        className="size-30 shrink-0 rounded-[50%] border border-border"
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
        role="img"
        aria-label="Storage by title"
      />
      <figcaption>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[0.78rem]">
          {slices.map((slice, index) => (
            <li
              key={`${slice.label}-${index}`}
              className="flex items-center gap-[7px]"
            >
              <span className="size-[9px] shrink-0 rounded-[50%]" style={{ background: slice.color }} aria-hidden="true" />
              <span className="max-w-[180px] overflow-hidden font-semibold text-ellipsis whitespace-nowrap">{slice.label}</span>
              <span className="text-text-muted">{formatBytes(slice.bytes)} · {Math.round((slice.bytes / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

function CatalogPanel({ storage }: { storage: AdminStorageStats }): ReactElement {
  return (
    <section className="manage-panel text-left">
      <h2 className="settings-heading">Catalog</h2>
      <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        <div>
            <dt className="text-[0.75rem] font-bold tracking-[0.04em] text-text-muted uppercase">Manga</dt>
            <dd className="m-0 mt-0.5 font-bold">{storage.mangaCount}</dd>
          </div>
        <div>
            <dt className="text-[0.75rem] font-bold tracking-[0.04em] text-text-muted uppercase">Chapters</dt>
            <dd className="m-0 mt-0.5 font-bold">{storage.chapterCount}</dd>
          </div>
        <div>
            <dt className="text-[0.75rem] font-bold tracking-[0.04em] text-text-muted uppercase">Covers</dt>
            <dd className="m-0 mt-0.5 font-bold">{storage.coverUploadsCount}</dd>
          </div>
      </dl>
    </section>
  );
}

function ImportHealthPanel({
  storage,
  attention,
  onRetry,
}: {
  storage: AdminStorageStats;
  attention: AdminImportEntry[];
  onRetry: () => void;
}): ReactElement {
  return (
    <section className="manage-panel text-left">
      <div className="settings-heading-row">
        <h2 className="settings-heading">Chapter import health</h2>
        <p className="m-0 flex gap-1.5">
          <span className={`settings-health-chip${storage.failedImportsCount ? " is-bad" : ""}`}>{storage.failedImportsCount} failed</span>
          <span className="settings-health-chip">{storage.processingImportsCount} processing</span>
        </p>
      </div>
      {attention.length === 0 ? (
        <p className="mb-3.5 text-[0.85rem] text-text-muted">No failed or in-flight imports. All clear.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {attention.map((entry) => (
            <ImportRow key={entry.importId} entry={entry} onRetry={onRetry} />
          ))}
        </ol>
      )}
    </section>
  );
}

// Retry re-enqueues every non-ready page of the import (existing manga-scoped
// route; idempotent server-side). Reload the page data on success so statuses
// reflect the requeue.
function ImportRow({
  entry,
  onRetry,
}: {
  entry: AdminImportEntry;
  onRetry: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const retry = async (): Promise<void> => {
    setBusy(true);
    try {
      await retryChapterUpload(entry.mangaId, entry.importId);
    } catch (retryError) {
      setBusy(false);
      toast.error(retryError instanceof Error ? retryError.message : "Retry failed.");
      return;
    }
    onRetry();
  };

  return (
    <li className="flex items-start justify-between gap-4 rounded-[10px] border border-border px-3.5 py-3">
      <div className="settings-import-body">
        <h3>{entry.mangaTitle} — {entry.chapterTitle}</h3>
        <p className="m-0 flex flex-wrap items-center gap-2 text-[0.8rem] text-text-muted">
          <span className={`upload-status upload-status-${entry.status === "failed" ? "failed" : "uploading"}`}>{entry.status}</span>
          {" "}
          {`${entry.processedFiles}/${entry.totalFiles} processed${entry.failedFiles ? ` · ${entry.failedFiles} failed` : ""}`}
          {" · "}
          {formatDate(entry.updatedAt)}
        </p>
        {entry.errorMessage ? <p className="settings-import-error">{entry.errorMessage}</p> : null}
        {entry.failedPages.length > 0 ? (
          <ul className="m-0 mt-2 list-none rounded-lg bg-surface-raised px-2.5 py-2 text-[0.78rem]">
            {entry.failedPages.map((page, index) => (
              <li key={index} className="flex flex-wrap gap-2 py-0.5">
                <span className="font-semibold">{`${page.pageNumber.toString().padStart(3, "0")} · ${page.originalFilename}`}</span>
                {page.errorMessage ? <span className="text-danger-fg">{page.errorMessage}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <button className="secondary-button" type="button" onClick={() => void retry()} disabled={busy}>
        {busy ? "Retrying" : "Retry"}
      </button>
    </li>
  );
}

// Audit trail panel: newest-first rows from the API logs table with a level
// filter (the catalog-style popup menu) and offset-based Prev/Next paging. The
// panel owns its own state and re-renders only itself.
function AuditTrailPanel({ initial }: { initial: AdminLogsResult }): ReactElement {
  const [level, setLevel] = useState<AdminLogLevel | undefined>(undefined);
  const [entries, setEntries] = useState(initial.entries);
  const [counts, setCounts] = useState(initial.levelCounts);
  const [offset, setOffset] = useState(0);
  // No total in the response (deliberate); a full page means a next page may exist.
  const [hasNext, setHasNext] = useState(initial.entries.length === LOGS_LIMIT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [popOpen, setPopOpen] = useState(false);
  // Renders the in-flight guard: disables the filter/pager and marks the list
  // aria-busy while a page/filter fetch is running.
  const [loading, setLoading] = useState(false);

  // Single in-flight fetch guard: blocks overlapping page/filter requests so a
  // slower earlier response can't land after a newer one.
  const loadingRef = useRef(false);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const filterPopRef = useRef<HTMLDivElement>(null);

  // Catalog-style popup filter (mirrors the home library filter).
  usePopupDismiss(popOpen, [filterPopRef, filterBtnRef], () => setPopOpen(false));

  // Offset paging: each page replaces (not appends) the rows. `offset` and
  // `level` are committed only on a successful fetch (so a failed filter change
  // doesn't show the new level over stale rows), and the loading guard
  // serializes requests.
  const goTo = async (
    nextOffset: number,
    nextLevel: AdminLogLevel | undefined = level
  ): Promise<void> => {
    if (loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    try {
      const result = await listAdminLogs(nextLevel, LOGS_LIMIT, nextOffset);
      setEntries(result.entries);
      setCounts(result.levelCounts);
      setOffset(nextOffset);
      setLevel(nextLevel);
      setHasNext(result.entries.length === LOGS_LIMIT);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load logs.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const chooseLevel = (next: AdminLogLevel | undefined): void => {
    setPopOpen(false);
    if (next === level) {
      return;
    }
    void goTo(0, next);
  };

  const page = Math.floor(offset / LOGS_LIMIT) + 1;
  const showPager = offset > 0 || hasNext;

  return (
    <section className="manage-panel text-left">
      <div className="settings-heading-row">
        <h2 className="settings-heading">Audit trail</h2>
        <div className="inline-flex items-center gap-2.5">
          <p className="m-0 flex gap-1.5">
            <span className={`settings-health-chip${counts.error ? " is-bad" : ""}`}>{counts.error} {counts.error === 1 ? "error" : "errors"}</span>
            <span className="settings-health-chip">{counts.warn} {counts.warn === 1 ? "warn" : "warns"}</span>
          </p>
          <div className="settings-logs-filter">
            <button
              ref={filterBtnRef}
              className={`library-filter${level !== undefined ? " is-active" : ""}`}
              type="button"
              aria-label="Filter by level"
              aria-haspopup="true"
              aria-expanded={popOpen}
              disabled={loading}
              onClick={() => setPopOpen((open) => !open)}
            >
              <Funnel className="icon" size={20} aria-hidden="true" />
            </button>
            <div ref={filterPopRef} className={`library-filter-pop${popOpen ? " is-open" : ""}`} role="menu">
              <button
                className={`library-filter-option${level === undefined ? " is-active" : ""}`}
                type="button"
                role="menuitemradio"
                aria-checked={level === undefined}
                onClick={() => chooseLevel(undefined)}
              >
                All levels
              </button>
              {LOG_LEVELS.map((value) => (
                <button
                  key={value}
                  className={`library-filter-option${value === level ? " is-active" : ""}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === level}
                  onClick={() => chooseLevel(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {errorMessage ? <p className="settings-import-error">{errorMessage}</p> : null}
      <div aria-busy={loading} style={loading ? { opacity: 0.6 } : undefined}>
        {entries.length === 0 ? (
          <p className="mb-3.5 text-[0.85rem] text-text-muted">
            No log entries{level ? ` at level ${level}` : ""}.
          </p>
        ) : (
          <ol className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
            {entries.map((entry) => (
              <LogRow key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </div>
      {showPager ? (
        <nav className="chapter-pager" aria-label="Audit trail pages">
          <button
            className="secondary-button"
            type="button"
            aria-label="Previous page"
            disabled={offset === 0 || loading}
            onClick={() => {
              if (offset > 0) {
                void goTo(Math.max(0, offset - LOGS_LIMIT));
              }
            }}
          >
            <ChevronLeft className="icon" size={16} aria-hidden="true" />
          </button>
          <span className="chapter-pager-status">Page {page}</span>
          <button
            className="secondary-button"
            type="button"
            aria-label="Next page"
            disabled={!hasNext || loading}
            onClick={() => {
              if (hasNext) {
                void goTo(offset + LOGS_LIMIT);
              }
            }}
          >
            <ChevronRight className="icon" size={16} aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function LogRow({ entry }: { entry: AdminLogEntry }): ReactElement {
  const details: ReactElement[] = [];
  if (entry.context) {
    details.push(
      <pre key="context" className="m-0 mt-1.5 overflow-x-auto rounded-lg bg-surface-raised px-2.5 py-2 text-[0.72rem] wrap-anywhere whitespace-pre-wrap">{JSON.stringify(entry.context, null, 2)}</pre>
    );
  }
  if (entry.errorName || entry.errorMessage) {
    details.push(
      <p key="error" className="settings-log-error">{[entry.errorName, entry.errorMessage].filter(Boolean).join(": ")}</p>
    );
  }
  if (entry.errorStack) {
    details.push(
      <pre key="stack" className="m-0 mt-1.5 overflow-x-auto rounded-lg bg-surface-raised px-2.5 py-2 text-[0.72rem] wrap-anywhere whitespace-pre-wrap">{entry.errorStack}</pre>
    );
  }

  return (
    <li className="rounded-[10px] border border-border px-3 py-2">
      <p className="m-0 flex flex-wrap items-center gap-2 text-[0.75rem] text-text-muted">
        <span className={`settings-log-level is-${entry.level}`}>{entry.level}</span>
        {" "}
        <span>{formatLogTimestamp(entry.createdAt)}</span>
        {" · "}
        <span>{entry.service}</span>
      </p>
      <p className="settings-log-message">{entry.message}</p>
      {details.length > 0 ? (
        <details className="mt-1.5 text-[0.78rem]">
          <summary className="cursor-pointer font-semibold text-text-muted">
            Details
          </summary>
          {details}
        </details>
      ) : null}
    </li>
  );
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
