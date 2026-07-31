import { useEffect, useRef, useState, type ReactElement } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  dismissForumReport,
  listForumReports,
  removeForumPost,
  removeForumThread,
  type ForumReport,
  type ForumReportStatus,
} from "@/api/forum";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { navigateTo } from "@/router";
import { formatDate } from "@/utils/format";

const REPORTS_LIMIT = 20;

// Forum moderation queue on the operations page. Rows are triaged from the
// snippet; the two outcomes are dismiss (keeps the row) and delete the target
// (cascades the report away). Every action refetches the page so totals and
// paging never drift from the server.
// Unlike the audit-trail panel it loads its own first page instead of taking it
// from the settings fetch, so a forum-side failure can't fail the whole page.
// Cursors are opaque, so pages are walked rather than indexed: the trail holds
// the cursor of every page reached so far, starting at null for page one. Its
// depth is the page number, and Prev is a pop.
const FIRST_PAGE: ReadonlyArray<string | null> = Object.freeze([null]);

export function ForumReportsPanel(): ReactElement {
  const [status, setStatus] = useState<ForumReportStatus>("open");
  const [reports, setReports] = useState<ForumReport[]>([]);
  const [totals, setTotals] = useState({ open: 0, dismissed: 0 });
  const [trail, setTrail] = useState<ReadonlyArray<string | null>>(FIRST_PAGE);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Single in-flight guard (audit-trail idiom): blocks overlapping filter/page
  // requests so a slower earlier response can't land after a newer one.
  const loadingRef = useRef(false);

  const goTo = async (
    nextTrail: ReadonlyArray<string | null>,
    nextStatus: ForumReportStatus = status
  ): Promise<void> => {
    if (loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    try {
      const otherStatus: ForumReportStatus =
        nextStatus === "open" ? "dismissed" : "open";
      let target = nextTrail;
      let [result, other] = await Promise.all([
        listForumReports(nextStatus, target[target.length - 1], REPORTS_LIMIT),
        listForumReports(otherStatus, null, 1),
      ]);
      // Clearing the last row of a page empties it; step back one page so the
      // queue never renders blank with rows still behind it.
      if (result.reports.length === 0 && target.length > 1) {
        target = target.slice(0, -1);
        result = await listForumReports(
          nextStatus,
          target[target.length - 1],
          REPORTS_LIMIT
        );
      }
      setReports(result.reports);
      setTotals(
        nextStatus === "open"
          ? { open: result.total, dismissed: other.total }
          : { open: other.total, dismissed: result.total }
      );
      setNextCursor(result.nextCursor);
      setTrail(target);
      setStatus(nextStatus);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load reports."
      );
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setReady(true);
    }
  };

  useEffect(() => {
    // Mount-only first page; every later fetch is user- or action-driven.
    void goTo(FIRST_PAGE);
  }, []);

  const page = trail.length;
  const hasPrevious = trail.length > 1;
  const hasNext = nextCursor !== null;
  const showPager = hasPrevious || hasNext;

  return (
    <section className="manage-panel text-left">
      <div className="settings-heading-row">
        <h2 className="settings-heading">Forum reports</h2>
        <p className="m-0 flex gap-1.5">
          <button
            type="button"
            className={`settings-health-chip settings-health-chip-button${status === "open" ? " is-active" : ""}${totals.open > 0 ? " is-bad" : ""}`}
            aria-pressed={status === "open"}
            disabled={loading}
            onClick={() => {
              if (status !== "open") {
                void goTo(FIRST_PAGE, "open");
              }
            }}
          >
            {totals.open} open
          </button>
          <button
            type="button"
            className={`settings-health-chip settings-health-chip-button${status === "dismissed" ? " is-active" : ""}`}
            aria-pressed={status === "dismissed"}
            disabled={loading}
            onClick={() => {
              if (status !== "dismissed") {
                void goTo(FIRST_PAGE, "dismissed");
              }
            }}
          >
            {totals.dismissed} dismissed
          </button>
        </p>
      </div>

      {error !== null ? <p className="settings-import-error">{error}</p> : null}

      <div aria-busy={loading} style={loading ? { opacity: 0.6 } : undefined}>
        {!ready ? (
          <p className="mb-3.5 text-[0.85rem] text-text-muted">Loading reports…</p>
        ) : reports.length === 0 ? (
          <p className="mb-3.5 text-[0.85rem] text-text-muted">
            {status === "open"
              ? "No open reports. The queue is clear."
              : "No dismissed reports."}
          </p>
        ) : (
          <ol className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
            {reports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                busyPanel={loading}
                onDone={() => void goTo(trail)}
              />
            ))}
          </ol>
        )}
      </div>

      {showPager ? (
        <nav className="chapter-pager" aria-label="Report queue pages">
          <button
            className="secondary-button"
            type="button"
            aria-label="Previous page"
            disabled={!hasPrevious || loading}
            onClick={() => void goTo(trail.slice(0, -1))}
          >
            <ChevronLeft className="icon" size={16} aria-hidden="true" />
          </button>
          <span className="chapter-pager-status">Page {page}</span>
          <button
            className="secondary-button"
            type="button"
            aria-label="Next page"
            disabled={!hasNext || loading}
            onClick={() => void goTo([...trail, nextCursor])}
          >
            <ChevronRight className="icon" size={16} aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function ReportRow({
  report,
  busyPanel,
  onDone,
}: {
  report: ForumReport;
  busyPanel: boolean;
  onDone: () => void;
}): ReactElement {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Takes a thunk, not a promise: an eager argument would already have fired the
  // request before the busy guard could refuse a double-click.
  const run = (action: () => Promise<unknown>, failure: string): void => {
    if (busy) {
      return;
    }
    setBusy(true);
    action()
      .then(() => {
        setBusy(false);
        onDone();
      })
      .catch((actionError) => {
        setBusy(false);
        toast.error(
          actionError instanceof Error ? actionError.message : failure
        );
      });
  };

  const deleteTarget = (): void => {
    setConfirming(false);
    run(
      () =>
        report.targetType === "thread"
          ? removeForumThread(report.targetId)
          : removeForumPost(report.targetId),
      "Unable to delete the reported content."
    );
  };

  const disabled = busy || busyPanel;

  return (
    <li className="rounded-[10px] border border-border px-3 py-2">
      <p className="m-0 flex flex-wrap items-center gap-2 text-[0.75rem] text-text-muted">
        <span className="settings-health-chip">{report.reason}</span>{" "}
        <span>{report.targetType === "thread" ? "Thread" : "Reply"}</span>
        {" by "}
        <span>{report.targetAuthorName}</span>
        {" · reported by "}
        <span>{report.reporterName}</span>
        {" · "}
        <span>{formatDate(report.createdAt)}</span>
      </p>
      <p className="mb-1 text-[0.9rem] wrap-anywhere whitespace-pre-wrap text-text">{report.targetSnippet}</p>
      {report.note !== null ? (
        <p className="mb-1.5 border-l-2 border-l-border-strong pl-2.5 text-[0.85rem] wrap-anywhere whitespace-pre-wrap text-text-secondary">{report.note}</p>
      ) : null}
      <div className="comment-actions">
        {/* Post reports carry no thread id in the DTO, so only thread targets
            can be linked back to a page. */}
        {report.targetType === "thread" ? (
          <button
            className="comment-action"
            type="button"
            disabled={disabled}
            onClick={() =>
              navigateTo(`/forum/thread/${encodeURIComponent(report.targetId)}`)
            }
          >
            View thread
          </button>
        ) : null}
        {report.status === "open" ? (
          <button
            className="comment-action"
            type="button"
            disabled={disabled}
            onClick={() =>
              run(
                () => dismissForumReport(report.id),
                "Unable to dismiss the report."
              )
            }
          >
            Dismiss
          </button>
        ) : null}
        <button
          className="comment-action comment-action-danger"
          type="button"
          disabled={disabled}
          onClick={() => setConfirming(true)}
        >
          Delete {report.targetType === "thread" ? "thread" : "reply"}
        </button>
      </div>
      {confirming ? (
        <ConfirmDialog
          title={
            report.targetType === "thread" ? "Delete thread?" : "Delete reply?"
          }
          message={
            report.targetType === "thread"
              ? "The thread, every reply on it, and this report are removed. This cannot be undone."
              : "The reply and this report are removed. This cannot be undone."
          }
          confirmLabel="Delete"
          danger
          onConfirm={deleteTarget}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </li>
  );
}
