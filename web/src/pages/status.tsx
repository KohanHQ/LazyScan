import { useState, type ReactElement } from "react";
import { Inbox } from "lucide-react";
import {
  clearReadingStatus,
  getReadingStatusList,
} from "@/api/reading-status";
import type {
  ReadingStatus,
  ReadingStatusEntry,
} from "@/api/reading-status";
import { useCached } from "@/lib/use-cached";
import { MangaCard } from "@/components/manga-card";
import { PageHeading } from "@/components/page-heading";
import { RequireSession } from "@/components/require-session";
import { Empty, ErrorState, Loading } from "@/components/states";

const TABS: { key: ReadingStatus; label: string }[] = [
  { key: "reading", label: "Reading" },
  { key: "completed", label: "Completed" },
  { key: "plan_to_read", label: "Plan to read" },
  { key: "on_hold", label: "On hold" },
  { key: "dropped", label: "Dropped" },
];

const DEFAULT_TAB: ReadingStatus = "reading";

export function StatusPage(): ReactElement {
  return (
    <RequireSession loginMessage="Log in to track your reading status.">
      {() => <StatusContent />}
    </RequireSession>
  );
}

function StatusContent(): ReactElement {
  const [tab, setTab] = useState<ReadingStatus>(DEFAULT_TAB);
  const { data: entries, error, reload } = useCached<ReadingStatusEntry[]>(
    tab,
    () => getReadingStatusList(tab)
  );

  const label = TABS.find((entry) => entry.key === tab)?.label ?? tab;

  return (
    <>
      <PageHeading title="Tracking" />
      <div className="library-tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            className={`library-tab${entry.key === tab ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={entry.key === tab}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="library-content">
        {error !== null ? (
          <ErrorState message={error} />
        ) : entries === null ? (
          <Loading message="Loading" />
        ) : entries.length === 0 ? (
          <Empty
            title={`Nothing marked "${label}"`}
            message="Set a status from a title's detail page to track it here."
            icon={<Inbox className="icon" size={20} />}
          />
        ) : (
          <section className="manga-grid" aria-label={label}>
            {entries.map((entry) => (
              <div className="library-card" key={entry.manga.id}>
                <MangaCard manga={entry.manga} />
                <RemoveButton mangaId={entry.manga.id} onRemoved={reload} />
              </div>
            ))}
          </section>
        )}
      </div>
    </>
  );
}

// Sits beside the card (not inside it), so its click never reaches the card's
// navigation. Disabled while the clear is in flight; re-enabled only on failure —
// success reloads the tab, unmounting this button.
function RemoveButton(props: {
  mangaId: string;
  onRemoved: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  // Surface a failed remove inline; the button stays enabled so it doubles as
  // the retry control (success reloads the tab, unmounting this).
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        className="library-remove"
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          clearReadingStatus(props.mangaId)
            .then(props.onRemoved)
            .catch((removeError) => {
              setError(
                removeError instanceof Error
                  ? removeError.message
                  : "Couldn't remove. Try again."
              );
              setBusy(false);
            });
        }}
      >
        Remove
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </>
  );
}
