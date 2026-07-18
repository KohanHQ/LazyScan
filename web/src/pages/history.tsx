import { useEffect, useRef, useState, type ReactElement } from "react";
import { Inbox } from "lucide-react";
import { clearReadingProgress, getReadingHistory } from "@/api/reader";
import type { MangaHistoryEntry } from "@/api/reader";
import { Cover } from "@/components/react/cover";
import { Empty, ErrorState, Loading } from "@/components/react/states";
import { RequireSession } from "@/components/react/require-session";
import { clickable } from "@/lib/clickable";
import { formatDate } from "@/utils/dom";

const PAGE_SIZE = 20;
const HAS_OBSERVER = "IntersectionObserver" in window;

export function HistoryPage(): ReactElement {
  return (
    <RequireSession
      loading="Loading history"
      loginMessage="Reading history is saved to your account. Log in to see what you were reading."
    >
      {() => <HistoryContent />}
    </RequireSession>
  );
}

function Heading({ meta }: { meta?: ReactElement }): ReactElement {
  return (
    <section className="page-heading">
      <div>
        <h1>History</h1>
      </div>
      {meta}
    </section>
  );
}

function HistoryContent(): ReactElement {
  const [entries, setEntries] = useState<MangaHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreHidden, setMoreHidden] = useState(true);

  // Paging control flow in refs so the mount-once observer outlives any render
  // and the in-flight guard survives re-renders (mirrors home.tsx Library).
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const doneRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const syncMore = (): void => {
    setMoreHidden(HAS_OBSERVER || doneRef.current || loadingRef.current);
  };

  // First page decides between the empty state and the paged history shell.
  useEffect(() => {
    let ignore = false;
    getReadingHistory({ limit: PAGE_SIZE, offset: 0 })
      .then((firstPage) => {
        if (ignore) {
          return;
        }
        setEntries(firstPage);
        offsetRef.current = firstPage.length;
        doneRef.current = firstPage.length < PAGE_SIZE;
        syncMore();
      })
      .catch((loadError) => {
        if (!ignore) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load history."
          );
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  const loadMore = async (): Promise<void> => {
    if (loadingRef.current || doneRef.current) {
      return;
    }
    loadingRef.current = true;
    syncMore();
    try {
      const page = await getReadingHistory({
        limit: PAGE_SIZE,
        offset: offsetRef.current,
      });
      setEntries((current) => [...(current ?? []), ...page]);
      offsetRef.current += page.length;
      doneRef.current = page.length < PAGE_SIZE;
    } catch {
      // Stop auto-loading on error.
      doneRef.current = true;
    } finally {
      loadingRef.current = false;
      syncMore();
    }
  };

  // Latest loadMore for the mount-once observer below.
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  const showShell = entries !== null && entries.length > 0;

  // The sentinel only exists in the shell; (re)attach the observer when it
  // mounts and disconnect if the list empties back to the empty state.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !HAS_OBSERVER) {
      return;
    }
    const observer = new IntersectionObserver(
      (obsEntries) => {
        if (obsEntries.some((entry) => entry.isIntersecting)) {
          void loadMoreRef.current();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [showShell]);

  const removeManga = (mangaId: string): void => {
    setEntries((current) =>
      (current ?? []).filter((entry) => entry.mangaId !== mangaId)
    );
  };

  if (error !== null) {
    return (
      <>
        <Heading />
        <ErrorState message={error} />
      </>
    );
  }

  if (entries === null) {
    return <Loading message="Loading history" />;
  }

  if (entries.length === 0) {
    return (
      <>
        <Heading />
        <Empty
          title="No history yet"
          message="Chapters you read will appear here."
          icon={<Inbox className="icon" size={20} />}
        />
      </>
    );
  }

  return (
    <>
      <Heading
        meta={
          <p className="heading-meta">
            {entries.length} title{entries.length === 1 ? "" : "s"}
          </p>
        }
      />
      <ol className="history-list">
        {entries.map((entry) => (
          <HistoryRow
            key={`${entry.mangaId}:${entry.chapterId}`}
            entry={entry}
            onRemoved={removeManga}
          />
        ))}
      </ol>
      <div ref={sentinelRef} className="library-sentinel" aria-hidden="true" />
      <button
        className="secondary-button library-more"
        type="button"
        hidden={moreHidden}
        onClick={() => void loadMore()}
      >
        Load more
      </button>
    </>
  );
}

function HistoryRow({
  entry,
  onRemoved,
}: {
  entry: MangaHistoryEntry;
  onRemoved: (mangaId: string) => void;
}): ReactElement {
  const percent = historyProgressPercent(entry);
  const pages =
    entry.chapterPageCount > 0
      ? `Page ${entry.pageNumber}/${entry.chapterPageCount}`
      : `Page ${entry.pageNumber}`;
  const progress = percent !== null ? `${pages} · ${percent}%` : pages;
  const meta = `${progress} · ${formatDate(entry.updatedAt)}`;

  return (
    <li
      className="history-row"
      aria-label={`Continue reading ${entry.title}`}
      {...clickable(
        `/manga/${encodeURIComponent(entry.mangaId)}/chapter/${encodeURIComponent(entry.chapterId)}`
      )}
    >
      <div className="history-row-cover">
        <Cover
          url={entry.coverUrl}
          seed={entry.title}
          placeholderClass="history-cover-placeholder"
        />
      </div>
      <div className="history-row-body">
        <h3>{entry.title}</h3>
        <p className="history-row-chapter">{historyChapterLabel(entry)}</p>
        <p>{meta}</p>
      </div>
      <span className="history-resume" aria-hidden="true">
        Resume
      </span>
      <HistoryRemoveButton
        mangaId={entry.mangaId}
        title={entry.title}
        onRemoved={onRemoved}
      />
    </li>
  );
}

// The row is the clickable nav target, so stop the button's click/keys from
// bubbling to it. Disabled while the clear is in flight; re-enabled only on
// failure — success filters the row out, unmounting this button.
function HistoryRemoveButton(props: {
  mangaId: string;
  title: string;
  onRemoved: (mangaId: string) => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="history-remove"
      type="button"
      aria-label={`Remove ${props.title} from history`}
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        setBusy(true);
        clearReadingProgress(props.mangaId)
          .then(() => props.onRemoved(props.mangaId))
          .catch(() => setBusy(false));
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      Remove
    </button>
  );
}

// Chapter-level progress percent for a history entry. The page count can be 0
// for a chapter whose pages were since removed; render no percent then.
export function historyProgressPercent(entry: MangaHistoryEntry): number | null {
  if (entry.chapterPageCount <= 0) {
    return null;
  }
  const ratio = entry.pageNumber / entry.chapterPageCount;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

export function historyChapterLabel(entry: MangaHistoryEntry): string {
  return entry.chapterNumber !== null
    ? `Ch. ${entry.chapterNumber} · ${entry.chapterTitle}`
    : entry.chapterTitle;
}
