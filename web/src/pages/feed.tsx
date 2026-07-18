import { useEffect, useState, type ReactElement } from "react";
import { Inbox } from "lucide-react";
import { getLibraryFeed } from "@/api/library";
import type { LibraryFeedEntry } from "@/api/library";
import { Cover } from "@/components/react/cover";
import { Empty, ErrorState, Loading } from "@/components/react/states";
import { RequireSession } from "@/components/react/require-session";
import { clickable } from "@/lib/clickable";
import { formatDate } from "@/utils/dom";

// Server clamps to staticConfig.libraryFeed.maxLimit; request the max so the
// page shows the full window (no pagination — the feed is a capped surface).
const FEED_LIMIT = 30;

export function FeedPage(): ReactElement {
  return (
    <RequireSession
      loading="Loading feed"
      loginMessage="The feed shows new chapters from your favorited and queued manga. Log in to see yours."
    >
      {() => <FeedContent />}
    </RequireSession>
  );
}

function Heading({ meta }: { meta?: ReactElement }): ReactElement {
  return (
    <section className="page-heading">
      <div>
        <h1>Feed</h1>
      </div>
      {meta}
    </section>
  );
}

function FeedContent(): ReactElement {
  const [entries, setEntries] = useState<LibraryFeedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    getLibraryFeed(FEED_LIMIT)
      .then((list) => {
        if (!ignore) {
          setEntries(list);
        }
      })
      .catch((loadError) => {
        if (!ignore) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load the feed."
          );
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  if (error !== null) {
    return (
      <>
        <Heading />
        <ErrorState message={error} />
      </>
    );
  }

  if (entries === null) {
    return <Loading message="Loading feed" />;
  }

  if (entries.length === 0) {
    return (
      <>
        <Heading />
        <Empty
          title="Nothing new yet"
          message="New ready chapters from your favorited and queued manga will appear here."
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
            {entries.length} new chapter{entries.length === 1 ? "" : "s"}
          </p>
        }
      />
      <ol className="history-list">
        {entries.map((entry) => (
          <FeedRow key={entry.chapter.id} entry={entry} />
        ))}
      </ol>
    </>
  );
}

// Rows reuse the history list styling: cover, manga title, chapter line, date.
function FeedRow({ entry }: { entry: LibraryFeedEntry }): ReactElement {
  const chapterLabel =
    entry.chapter.chapterNumber !== null
      ? `Ch. ${entry.chapter.chapterNumber} · ${entry.chapter.title}`
      : entry.chapter.title;

  return (
    <li
      className="history-row"
      aria-label={`Read ${entry.manga.title} — ${chapterLabel}`}
      {...clickable(
        `/manga/${encodeURIComponent(entry.manga.id)}/chapter/${encodeURIComponent(entry.chapter.id)}`
      )}
    >
      <div className="history-row-cover">
        <Cover
          url={entry.manga.coverUrl}
          seed={entry.manga.title}
          placeholderClass="history-cover-placeholder"
        />
      </div>
      <div className="history-row-body">
        <h3>{entry.manga.title}</h3>
        <p className="history-row-chapter">{chapterLabel}</p>
        <p>{formatDate(entry.readyAt)}</p>
      </div>
      <span className="history-resume" aria-hidden="true">
        Read
      </span>
    </li>
  );
}
