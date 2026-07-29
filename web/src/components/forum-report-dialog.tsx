import { useState, type ReactElement } from "react";
import { ApiClientError } from "@/api/client";
import {
  MAX_REPORT_NOTE,
  REPORT_REASONS,
  reportForumPost,
  reportForumThread,
  type ForumReportReason,
} from "@/api/forum";
import { ComposerTextarea } from "@/components/composer-textarea";
import { PopupSelect } from "@/components/popup-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

const REASON_LABELS: Record<ForumReportReason, string> = {
  spam: "Spam",
  abuse: "Abuse or harassment",
  nsfw: "NSFW content",
  other: "Other",
};

// Mount while a report is being composed; Escape/backdrop/X resolve as cancel
// (ConfirmDialog idiom). The reason picker is the themed PopupSelect.
export function ForumReportDialog({
  targetType,
  targetId,
  onClose,
}: {
  targetType: "thread" | "post";
  targetId: string;
  onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const [reason, setReason] = useState<ForumReportReason>("spam");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = (): void => {
    if (busy) {
      return;
    }
    setBusy(true);
    const send =
      targetType === "thread" ? reportForumThread : reportForumPost;
    send(targetId, reason, note)
      .then(() => {
        toast.success("Report submitted. A moderator will review it.");
        onClose();
      })
      .catch((reportError) => {
        // A duplicate is not a failure to correct — the report already exists,
        // so it closes on the neutral (success-variant) toast, not an error one.
        if (
          reportError instanceof ApiClientError &&
          reportError.code === "FORUM_REPORT_DUPLICATE"
        ) {
          toast.success("You have already reported this.");
          onClose();
          return;
        }
        setBusy(false);
        toast.error(
          reportError instanceof Error
            ? reportError.message
            : "Unable to submit report."
        );
      });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Report {targetType === "thread" ? "thread" : "reply"}
          </DialogTitle>
          <DialogDescription>
            Tell a moderator what is wrong with this {targetType}. Reports are
            private.
          </DialogDescription>
        </DialogHeader>
        <div className="forum-report-fields">
          <label htmlFor="forum-report-reason">Reason</label>
          <PopupSelect
            id="forum-report-reason"
            ariaLabel="Report reason"
            value={reason}
            options={REPORT_REASONS.map((value) => ({
              value,
              label: REASON_LABELS[value],
            }))}
            onChange={(value) => setReason(value as ForumReportReason)}
          />
          <label htmlFor="forum-report-note">Note (optional)</label>
          <ComposerTextarea
            id="forum-report-note"
            placeholder="Add any detail that helps triage…"
            maxLength={MAX_REPORT_NOTE}
            rows={3}
            value={note}
            disabled={busy}
            onChange={setNote}
          />
        </div>
        <DialogFooter>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={busy}
            onClick={submit}
          >
            {busy ? "Reporting…" : "Submit report"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
