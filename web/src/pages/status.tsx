import { useEffect, useRef, useState, type ReactElement } from "react";
import { Inbox } from "lucide-react";
import {
  clearReadingStatus,
  getReadingStatusList,
} from "@/api/reading-status";
import type {
  ReadingStatus,
  ReadingStatusEntry,
} from "@/api/reading-status";
import { animateIn } from "@/lib/animate-in";
import { useCached } from "@/lib/use-cached";
import { MangaCard } from "@/components/manga-card";
import { PageHeading } from "@/components/page-heading";
import { RequireSession } from "@/components/require-session";
import { CardGridSkeleton, Empty, ErrorState } from "@/components/states";
import { useToast } from "@/components/ui/toast";

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

  // Keyed on the tab too: a cached tab keeps `loaded` true, so the flag alone
  // wouldn't fire on switch-back.
  const resultsRef = useRef<HTMLDivElement>(null);
  const loaded = entries !== null;
  useEffect(() => {
    const results = resultsRef.current;
    if (results) {
      animateIn(results);
    }
  }, [tab, loaded]);

  return (
    <>
      <PageHeading title="Tracking" />
      <div className="mb-5 flex gap-2 border-b border-b-border-strong" role="tablist">
        {TABS.map((entry) => (
          // .library-tab stays: unlayered `button { font: inherit }` beats font
          // utilities, and `border: none` + a 2px bottom edge is not expressible.
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
      <div ref={resultsRef} className="library-content">
        {error !== null ? (
          <ErrorState message={error} />
        ) : entries === null ? (
          <CardGridSkeleton />
        ) : entries.length === 0 ? (
          <Empty
            title={`Nothing marked "${label}"`}
            message="Set a status from a title's detail page to track it here."
            icon={<Inbox className="icon" size={20} />}
          />
        ) : (
          <section
            className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4.5"
            aria-label={label}
          >
            {entries.map((entry) => (
              // .library-card stays: it is the hook for `.library-card > .manga-card`,
              // which stretches a card this page cannot add a class to.
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
  const toast = useToast();
  // A failed remove toasts and re-enables the button, so it doubles as the retry
  // control (success reloads the tab, unmounting this).
  return (
    // .library-remove stays: unlayered `button { font: inherit }` beats the font
    // utilities, and `button:disabled` beats the disabled: ones (.65 vs .6).
    <button
      className="library-remove"
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        clearReadingStatus(props.mangaId)
          .then(props.onRemoved)
          .catch((removeError) => {
            toast.error(
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
  );
}
