import { useEffect, useState, type ReactElement } from "react";
import { Inbox } from "lucide-react";
import { getLibraryFeed } from "@/api/library";
import type { LibraryFeedEntry } from "@/api/library";
import { Cover } from "@/components/cover";
import { Empty, ErrorState, Loading } from "@/components/states";
import { RequireSession } from "@/components/require-session";
import { clickable } from "@/lib/clickable";
import { formatDate } from "@/utils/format";

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
          <p className="m-0 font-bold text-text-secondary">
            {entries.length} new chapter{entries.length === 1 ? "" : "s"}
          </p>
        }
      />
      <ol className="mb-7 grid list-none gap-2.5 p-0">
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
      className="flex cursor-pointer items-center gap-3.5 rounded-lg border border-border bg-surface p-2.5 outline-none hover:border-accent-fg hover:bg-surface-accent focus-visible:border-accent-fg focus-visible:bg-surface-accent"
      aria-label={`Read ${entry.manga.title}, ${chapterLabel}`}
      {...clickable(
        `/manga/${encodeURIComponent(entry.manga.id)}/chapter/${encodeURIComponent(entry.chapter.id)}`
      )}
    >
      <div className="h-16 w-12 shrink-0 overflow-hidden rounded-sm bg-[var(--cover-bg)]">
        <Cover
          url={entry.manga.coverUrl}
          seed={entry.manga.title}
          placeholderClass="grid h-full w-full place-items-center bg-surface-raised text-[1.4rem] font-black text-[color:var(--text-bright)]"
          imgClassName="block h-full w-full object-cover"
        />
      </div>
      {/* .history-row-body stays: it is the hook for its `h3`/`p` descendant
          rules, and unlayered `h3 { font-size: 1rem }` beats a font utility. */}
      <div className="history-row-body">
        <h3>{entry.manga.title}</h3>
        <p className="overflow-hidden font-bold text-ellipsis whitespace-nowrap">
          {chapterLabel}
        </p>
        <p>{formatDate(entry.readyAt)}</p>
      </div>
      <span
        className="ml-auto flex-none self-center text-[0.78rem] font-extrabold text-accent-fg uppercase"
        aria-hidden="true"
      >
        Read
      </span>
    </li>
  );
}
