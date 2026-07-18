import { useEffect, useState, type ReactElement } from "react";
import { Inbox } from "lucide-react";
import {
  clearReadingStatus,
  getReadingStatusList,
} from "@/api/reading-status";
import type {
  ReadingStatus,
  ReadingStatusEntry,
} from "@/api/reading-status";
import { MangaCard } from "@/components/react/manga-card";
import { PageHeading } from "@/components/react/page-heading";
import { RequireSession } from "@/components/react/require-session";
import { Empty, ErrorState, Loading } from "@/components/react/states";

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
  // Bumped after a removal to re-run the loader for the current tab.
  const [reloadKey, setReloadKey] = useState(0);
  const [entries, setEntries] = useState<ReadingStatusEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    setEntries(null);
    setError(null);
    getReadingStatusList(tab)
      .then((list) => {
        if (!ignore) {
          setEntries(list);
        }
      })
      .catch((loadError) => {
        if (!ignore) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load your list."
          );
        }
      });
    return () => {
      ignore = true;
    };
  }, [tab, reloadKey]);

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
                <RemoveButton
                  mangaId={entry.manga.id}
                  onRemoved={() => setReloadKey((key) => key + 1)}
                />
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
  return (
    <button
      className="library-remove"
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        clearReadingStatus(props.mangaId)
          .then(props.onRemoved)
          .catch(() => setBusy(false));
      }}
    >
      Remove
    </button>
  );
}
