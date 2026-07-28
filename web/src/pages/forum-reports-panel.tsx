import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  dismissForumReport,
  listForumReports,
  removeForumPost,
  removeForumThread,
  type ForumReport,
  type ForumReportStatus,
} from "@/api/forum";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PopupSelect } from "@/components/popup-select";
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
  const [total, setTotal] = useState(0);
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
      let target = nextTrail;
      let result = await listForumReports(
        nextStatus,
        target[target.length - 1],
        REPORTS_LIMIT
      );
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
      setTotal(result.total);
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
    <section className="manage-panel settings-panel">
      <div className="settings-heading-row">
        <h2 className="settings-heading">Forum reports</h2>
        <div className="settings-heading-aside">
          <p className="settings-health-chips">
            <span
              className={`settings-health-chip${status === "open" && total > 0 ? " is-bad" : ""}`}
            >
              {total} {status}
            </span>
          </p>
          <PopupSelect
            className="library-filter-select"
            ariaLabel="Filter reports by status"
            value={status}
            options={[
              { value: "open", label: "Open" },
              { value: "dismissed", label: "Dismissed" },
            ]}
            onChange={(value) => {
              if (value !== status) {
                void goTo(FIRST_PAGE, value as ForumReportStatus);
              }
            }}
          />
        </div>
      </div>

      {error !== null ? <p className="settings-import-error">{error}</p> : null}

      <div aria-busy={loading} style={loading ? { opacity: 0.6 } : undefined}>
        {!ready ? (
          <p className="settings-note">Loading reports…</p>
        ) : reports.length === 0 ? (
          <p className="settings-note">
            {status === "open"
              ? "No open reports. The queue is clear."
              : "No dismissed reports."}
          </p>
        ) : (
          <ol className="settings-logs">
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
            disabled={!hasPrevious || loading}
            onClick={() => void goTo(trail.slice(0, -1))}
          >
            Previous
          </button>
          <span className="chapter-pager-status">Page {page}</span>
          <button
            className="secondary-button"
            type="button"
            disabled={!hasNext || loading}
            onClick={() => void goTo([...trail, nextCursor])}
          >
            Next
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
    <li className="settings-log-row">
      <p className="settings-log-meta">
        <span className="settings-health-chip">{report.reason}</span>{" "}
        <span>{report.targetType === "thread" ? "Thread" : "Reply"}</span>
        {" by "}
        <span>{report.targetAuthorName}</span>
        {" · reported by "}
        <span>{report.reporterName}</span>
        {" · "}
        <span>{formatDate(report.createdAt)}</span>
      </p>
      <p className="forum-report-snippet">{report.targetSnippet}</p>
      {report.note !== null ? (
        <p className="forum-report-note">{report.note}</p>
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
