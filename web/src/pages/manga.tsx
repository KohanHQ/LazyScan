import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from "react";
import { Bookmark, ChevronLeft, ChevronRight, Heart, Inbox } from "lucide-react";
import { listReadyChapters } from "@/api/chapter";
import type { ReaderChapter } from "@/api/chapter";
import {
  addToLibrary,
  getLibraryMembership,
  removeFromLibrary,
} from "@/api/library";
import type { LibraryList, LibraryMembership } from "@/api/library";
import { getManga } from "@/api/manga";
import type { Manga } from "@/api/manga";
import {
  getReadChapters,
  getReadingProgress,
  markChapterRead,
  markMangaRead,
  unmarkChapterRead,
} from "@/api/reader";
import type { ReadingProgress } from "@/api/reader";
import {
  clearReadingStatus,
  getReadingStatus,
  setReadingStatus,
} from "@/api/reading-status";
import type { ReadingStatus } from "@/api/reading-status";
import { statusLabel } from "@/components/manga-card";
import { Comments } from "@/components/comments";
import { Cover } from "@/components/cover";
import { Empty, ErrorState, Loading } from "@/components/states";
import { clickable } from "@/lib/clickable";
import { usePopupDismiss } from "@/lib/use-popup-dismiss";
import { invalidateChapterCache } from "@/pages/reader";
import { useSession } from "@/state/hooks";
import { formatDate } from "@/utils/format";

type MangaData = {
  manga: Manga;
  chapters: ReaderChapter[];
  progress: ReadingProgress | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: MangaData };

// Public manga detail page (/manga/:id). The comment section is public;
// logged-in users additionally get favorite/queue toggles, a reading-status
// selector, per-chapter read toggles, mark-all-read, and the comment compose form.
export function MangaPage({ id }: { id: string }): ReactElement {
  const loggedIn = Boolean(useSession().user);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  // readSet is page-level so mark-all-read's reload refreshes it and toggles made
  // while paging survive Prev/Next (vanilla kept one mutable Set).
  const [readSet, setReadSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    let ignore = false;
    setState({ kind: "loading" });
    // Invalidate the reader's chapter cache at load start.
    invalidateChapterCache(id);
    void (async () => {
      let manga: Manga;
      let chapters: ReaderChapter[];
      let progress: ReadingProgress | null;
      let readIds: string[];
      try {
        [manga, chapters, progress, readIds] = await Promise.all([
          getManga(id),
          listReadyChapters(id),
          loggedIn ? getReadingProgress(id) : Promise.resolve(null),
          // Explicit per-chapter read state. Best-effort: a failure renders all
          // chapters unread rather than blocking the page.
          loggedIn ? getReadChapters(id).catch(() => []) : Promise.resolve([]),
        ]);
      } catch (error) {
        if (!ignore) {
          setState({
            kind: "error",
            message:
              error instanceof Error ? error.message : "Unable to load manga.",
          });
        }
        return;
      }
      if (ignore) {
        return;
      }
      setReadSet(new Set(readIds));
      setState({ kind: "ready", data: { manga, chapters, progress } });
    })();
    return () => {
      ignore = true;
    };
  }, [id, loggedIn, reloadKey]);

  if (state.kind === "loading") {
    return <Loading message="Loading title" />;
  }
  if (state.kind === "error") {
    return <ErrorState message={state.message} />;
  }

  const { manga, chapters, progress } = state.data;
  // Mark-all-read re-fetches everything; the rows must reflect the new read state.
  const reload = (): void => setReloadKey((key) => key + 1);

  return (
    <>
      <MangaHeader manga={manga} mangaId={id} loggedIn={loggedIn} />
      <section className="section-heading">
        <div>
          <p className="eyebrow">Ready chapters</p>
          <h2>Available to read</h2>
        </div>
        <div className="heading-aside">
          {chapters.length > 0 && loggedIn ? (
            <MarkAllRead mangaId={id} onDone={reload} />
          ) : null}
          <p className="heading-meta">{chapters.length} chapters</p>
        </div>
      </section>
      {chapters.length > 0 ? (
        <ChapterList
          mangaId={id}
          chapters={chapters}
          progress={progress}
          readSet={readSet}
          setReadSet={setReadSet}
          loggedIn={loggedIn}
        />
      ) : (
        <Empty
          title="No chapters to read yet"
          message="Nothing is ready here — uploads stay hidden until processing finishes."
          icon={<Inbox className="icon" size={20} />}
        />
      )}
      <Comments mangaId={id} />
    </>
  );
}

function MangaHeader({
  manga,
  mangaId,
  loggedIn,
}: {
  manga: Manga;
  mangaId: string;
  loggedIn: boolean;
}): ReactElement {
  return (
    <section className="grid grid-cols-[minmax(180px,280px)_minmax(0,1fr)] [align-items:start] gap-7 [@media(max-width:720px)]:grid-cols-[1fr]">
      <div className="aspect-[3/4] overflow-hidden rounded-lg bg-[var(--cover-bg)] [@media(max-width:720px)]:w-[min(260px,100%)]">
        <Cover
          url={manga.coverUrl}
          seed={manga.title}
          placeholderClass="cover-placeholder cover-placeholder-large"
          imgClassName="block h-full w-full object-cover"
        />
      </div>
      <div className="manga-detail-body">
        <p className="eyebrow">{statusLabel(manga.status)}</p>
        <h1>{manga.title}</h1>
        <div className="mt-1 mb-3.5 flex flex-wrap items-center gap-2.5">
          <div className="flex flex-wrap gap-2.5">
            {loggedIn ? <LibraryActions mangaId={mangaId} /> : null}
          </div>
          <div>
            {loggedIn ? <ReadingStatusControl mangaId={mangaId} /> : null}
          </div>
        </div>
        <dl className="my-5 flex flex-wrap gap-4 text-[#66746d]">
          <div className="min-w-[140px]">
            <dt className="text-[0.78rem] font-extrabold text-text-label uppercase">Total chapters</dt>
            <dd className="m-0 mt-0.5 font-extrabold text-text">{manga.totalChapters ?? "Unknown"}</dd>
          </div>
          {manga.author ? (
            <div className="min-w-[140px]">
              <dt className="text-[0.78rem] font-extrabold text-text-label uppercase">Author</dt>
              <dd className="m-0 mt-0.5 font-extrabold text-text">{manga.author}</dd>
            </div>
          ) : null}
          {manga.artist ? (
            <div className="min-w-[140px]">
              <dt className="text-[0.78rem] font-extrabold text-text-label uppercase">Artist</dt>
              <dd className="m-0 mt-0.5 font-extrabold text-text">{manga.artist}</dd>
            </div>
          ) : null}
          {manga.publisher ? (
            <div className="min-w-[140px]">
              <dt className="text-[0.78rem] font-extrabold text-text-label uppercase">Publisher</dt>
              <dd className="m-0 mt-0.5 font-extrabold text-text">{manga.publisher}</dd>
            </div>
          ) : null}
          {manga.publishedYear ? (
            <div className="min-w-[140px]">
              <dt className="text-[0.78rem] font-extrabold text-text-label uppercase">Published</dt>
              <dd className="m-0 mt-0.5 font-extrabold text-text">{manga.publishedYear}</dd>
            </div>
          ) : null}
          <div className="min-w-[140px]">
            <dt className="text-[0.78rem] font-extrabold text-text-label uppercase">Updated</dt>
            <dd className="m-0 mt-0.5 font-extrabold text-text">{formatDate(manga.updatedAt)}</dd>
          </div>
        </dl>
        {manga.tags.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-1.5" aria-label="Tags">
            {manga.tags.map((tag) => (
              <span
                className="rounded-[999px] border border-border px-2.5 py-[3px] text-[0.78rem] font-bold text-text-label"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        <p className="mb-0 max-w-[68ch] text-text-secondary">
          {manga.description || "No description available."}
        </p>
      </div>
    </section>
  );
}

// Favorite / queue toggles. Membership is fetched once; any failure hides the
// whole control (it is an enhancement, not core to reading).
function LibraryActions({ mangaId }: { mangaId: string }): ReactElement | null {
  const [membership, setMembership] = useState<LibraryMembership | null>(null);

  useEffect(() => {
    let ignore = false;
    setMembership(null);
    getLibraryMembership(mangaId)
      .then((value) => {
        if (!ignore) {
          setMembership(value);
        }
      })
      .catch(() => {
        // Stays hidden on failure.
      });
    return () => {
      ignore = true;
    };
  }, [mangaId]);

  if (membership === null) {
    return null;
  }

  const flip = (list: LibraryList): void =>
    setMembership((current) =>
      current ? { ...current, [list]: !current[list] } : current
    );

  return (
    <>
      <LibraryToggle
        list="favorite"
        active={membership.favorite}
        mangaId={mangaId}
        onFlip={() => flip("favorite")}
      />
      <LibraryToggle
        list="queue"
        active={membership.queue}
        mangaId={mangaId}
        onFlip={() => flip("queue")}
      />
    </>
  );
}

function LibraryToggle({
  list,
  active,
  mangaId,
  onFlip,
}: {
  list: LibraryList;
  active: boolean;
  mangaId: string;
  onFlip: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const Icon = list === "favorite" ? Heart : Bookmark;
  const label =
    list === "favorite"
      ? active
        ? "Favorited"
        : "Favorite"
      : active
        ? "In queue"
        : "Add to queue";

  const toggle = async (): Promise<void> => {
    setBusy(true);
    const request = active
      ? removeFromLibrary(list, mangaId)
      : addToLibrary(list, mangaId);
    // Hold the spinner ~400ms even when the request returns instantly, so the
    // feedback registers instead of flickering.
    const minVisible = new Promise((resolve) => window.setTimeout(resolve, 400));
    try {
      await Promise.all([request, minVisible]);
      onFlip();
    } catch {
      // Keep the current state on failure.
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className={`detail-action${active ? " is-active" : ""}`}
      type="button"
      aria-pressed={active}
      disabled={busy}
      onClick={() => void toggle()}
    >
      {busy ? (
        <>
          <span className="button-spinner" aria-hidden="true" />
          <span>{active ? "Removing" : "Adding"}</span>
        </>
      ) : (
        <>
          <Icon
            className="icon"
            size={20}
            aria-hidden="true"
            fill={active ? "currentColor" : "none"}
          />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

const READING_STATUS_OPTIONS: { value: ReadingStatus; label: string }[] = [
  { value: "reading", label: "Reading" },
  { value: "completed", label: "Completed" },
  { value: "plan_to_read", label: "Plan to read" },
  { value: "on_hold", label: "On hold" },
  { value: "dropped", label: "Dropped" },
];

// Single-select reading status via a custom button + popup (the catalog filter
// idiom). Fetched once; any failure hides the control (enhancement, not core).
function ReadingStatusControl({
  mangaId,
}: {
  mangaId: string;
}): ReactElement | null {
  const [phase, setPhase] = useState<"loading" | "ready" | "hidden">("loading");
  const [current, setCurrent] = useState<ReadingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ignore = false;
    getReadingStatus(mangaId)
      .then(({ status }) => {
        if (!ignore) {
          setCurrent(status);
          setPhase("ready");
        }
      })
      .catch(() => {
        if (!ignore) {
          setPhase("hidden");
        }
      });
    return () => {
      ignore = true;
    };
  }, [mangaId]);

  // Popup idiom mirrors settings.tsx.
  usePopupDismiss(popOpen, [popRef, btnRef], () => setPopOpen(false));

  if (phase !== "ready") {
    return null;
  }

  const labelFor = (value: ReadingStatus | null): string =>
    value === null
      ? "No status"
      : READING_STATUS_OPTIONS.find((option) => option.value === value)?.label ??
        "No status";

  const choose = (next: ReadingStatus | null): void => {
    setPopOpen(false);
    if (next === current) {
      return;
    }
    const previous = current;
    setBusy(true);
    const request =
      next === null ? clearReadingStatus(mangaId) : setReadingStatus(mangaId, next);
    void request
      .then(() => setCurrent(next))
      // Keep the previous status on failure.
      .catch(() => setCurrent(previous))
      .finally(() => setBusy(false));
  };

  const options: { value: ReadingStatus | null; label: string }[] = [
    { value: null, label: "No status" },
    ...READING_STATUS_OPTIONS,
  ];

  return (
    <div className="detail-status-control">
      <button
        ref={btnRef}
        className="detail-status-select"
        type="button"
        aria-label="Reading status"
        aria-haspopup="true"
        aria-expanded={popOpen}
        disabled={busy}
        onClick={() => setPopOpen((open) => !open)}
      >
        <span>{labelFor(current)}</span>
      </button>
      <div ref={popRef} className={`library-filter-pop${popOpen ? " is-open" : ""}`} role="menu">
        {options.map((option) => (
          <button
            key={option.value ?? ""}
            className={`library-filter-option${
              option.value === current ? " is-active" : ""
            }`}
            type="button"
            role="menuitemradio"
            aria-checked={option.value === current}
            onClick={() => choose(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// "Mark all read" pins progress to the end; the parent reloads so the rows
// reflect the new read state.
function MarkAllRead({
  mangaId,
  onDone,
}: {
  mangaId: string;
  onDone: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="secondary-button"
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        markMangaRead(mangaId)
          .then(onDone)
          .catch(() => setBusy(false));
      }}
    >
      {busy ? "Marking" : "Mark all read"}
    </button>
  );
}

// The full chapter array stays in memory; paging is purely client-side so the
// reader's ordering and rollover are untouched.
const CHAPTERS_PER_PAGE = 10;

function ChapterList({
  mangaId,
  chapters,
  progress,
  readSet,
  setReadSet,
  loggedIn,
}: {
  mangaId: string;
  chapters: ReaderChapter[];
  progress: ReadingProgress | null;
  readSet: Set<string>;
  setReadSet: Dispatch<SetStateAction<Set<string>>>;
  loggedIn: boolean;
}): ReactElement {
  const [page, setPage] = useState(1);
  const regionRef = useRef<HTMLDivElement>(null);

  const totalPages = Math.max(1, Math.ceil(chapters.length / CHAPTERS_PER_PAGE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * CHAPTERS_PER_PAGE;
  const slice = chapters.slice(start, start + CHAPTERS_PER_PAGE);
  const hasVolumes = chapters.some((chapter) => chapter.volume !== null);

  const goTo = (next: number): void => {
    setPage(next);
    regionRef.current?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div ref={regionRef}>
      <ol className="grid list-none gap-2.5 p-0">
        {slice.map((chapter, index) => {
          const previous = index > 0 ? slice[index - 1] : null;
          // First row of each page repeats its volume header — the slice-local
          // comparison re-emits it naturally.
          const showHeader =
            hasVolumes && (previous === null || previous.volume !== chapter.volume);
          return (
            <Fragment key={chapter.id}>
              {showHeader ? (
                <li
                  className="mt-1.5 mb-0.5 list-none border-b border-b-border px-0.5 py-1 text-[0.78rem] font-extrabold tracking-[0.05em] text-text-muted uppercase"
                  aria-hidden="true"
                >
                  {volumeLabel(chapter.volume)}
                </li>
              ) : null}
              <ChapterRow
                chapter={chapter}
                mangaId={mangaId}
                progress={progress}
                read={readSet.has(chapter.id)}
                loggedIn={loggedIn}
                setReadSet={setReadSet}
              />
            </Fragment>
          );
        })}
      </ol>
      {totalPages > 1 ? (
        <nav className="chapter-pager" aria-label="Chapter pages">
          <button
            className="secondary-button"
            type="button"
            aria-label="Previous page"
            disabled={currentPage === 1}
            onClick={() => goTo(currentPage - 1)}
          >
            <ChevronLeft className="icon" size={16} aria-hidden="true" />
          </button>
          <span className="chapter-pager-status">
            Page {currentPage}/{totalPages}
          </span>
          <button
            className="secondary-button"
            type="button"
            aria-label="Next page"
            disabled={currentPage === totalPages}
            onClick={() => goTo(currentPage + 1)}
          >
            <ChevronRight className="icon" size={16} aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </div>
  );
}

function volumeLabel(volume: number | null): string {
  return volume === null ? "No Volume" : `Volume ${volume}`;
}

// Read state is explicit per chapter, not positional: "read" when in the set,
// "current" only when it is the pinned progress chapter and not yet read (read
// supersedes current).
function ChapterRow({
  chapter,
  mangaId,
  progress,
  read,
  loggedIn,
  setReadSet,
}: {
  chapter: ReaderChapter;
  mangaId: string;
  progress: ReadingProgress | null;
  read: boolean;
  loggedIn: boolean;
  setReadSet: Dispatch<SetStateAction<Set<string>>>;
}): ReactElement {
  const chapterNumber =
    chapter.chapterNumber === null ? "" : `Chapter ${chapter.chapterNumber}`;
  const isCurrent = !read && progress?.chapterId === chapter.id;
  const progressLabel = isCurrent && progress ? `Page ${progress.pageNumber}` : "";
  const metaText = [chapterNumber, progressLabel].filter(Boolean).join(" · ");

  return (
    <li
      // .chapter-row-current / -read stay: unlayered modifier rules are the only
      // thing that can out-rank this element's own utilities.
      className={`chapter-row flex cursor-pointer items-center justify-between gap-4.5 rounded-lg border border-border bg-surface px-4 py-3 outline-none hover:border-accent-fg hover:bg-surface-accent focus-visible:border-accent-fg focus-visible:bg-surface-accent [@media(max-width:720px)]:flex-col [@media(max-width:720px)]:items-stretch ${isCurrent ? " chapter-row-current" : ""}${
        read ? " chapter-row-read" : ""
      }`}
      aria-label={`Read ${chapter.title}`}
      {...clickable(
        `/manga/${encodeURIComponent(mangaId)}/chapter/${encodeURIComponent(chapter.id)}`
      )}
    >
      <div className="min-w-0">
        <h3>
          {chapter.title}
          {read ? (
            <span className="ml-2 inline-block text-[0.875rem] text-text-muted" aria-label="Read">
              {"✓"}
            </span>
          ) : isCurrent ? (
            <span
              className="ml-2 inline-block text-[0.875rem] text-text-muted"
              aria-label="In progress"
            >
              {"▶"}
            </span>
          ) : null}
        </h3>
        {metaText ? <p className="mb-0 text-text-secondary">{metaText}</p> : null}
      </div>
      <div className="flex flex-none items-center gap-3">
        <span className="text-[0.875rem] text-text-muted">{formatDate(chapter.updatedAt)}</span>
        {loggedIn ? (
          <ChapterReadToggle
            chapter={chapter}
            mangaId={mangaId}
            read={read}
            setReadSet={setReadSet}
          />
        ) : null}
      </div>
    </li>
  );
}

function ChapterReadToggle({
  chapter,
  mangaId,
  read,
  setReadSet,
}: {
  chapter: ReaderChapter;
  mangaId: string;
  read: boolean;
  setReadSet: Dispatch<SetStateAction<Set<string>>>;
}): ReactElement {
  const [busy, setBusy] = useState(false);

  const toggle = (): void => {
    setBusy(true);
    const request = read
      ? unmarkChapterRead(mangaId, chapter.id)
      : markChapterRead(mangaId, chapter.id);
    void request
      .then(() => {
        setReadSet((current) => {
          const next = new Set(current);
          if (read) {
            next.delete(chapter.id);
          } else {
            next.add(chapter.id);
          }
          return next;
        });
      })
      .catch(() => {
        // Keep the existing state on failure.
      })
      .finally(() => setBusy(false));
  };

  return (
    <button
      className={`chapter-read-toggle${read ? " is-read" : ""}`}
      type="button"
      aria-pressed={read}
      aria-label={`Mark ${chapter.title} as ${read ? "unread" : "read"}`}
      disabled={busy}
      // The row is the nav target; keep the toggle's click/keys from reaching it.
      onClick={(event) => {
        event.stopPropagation();
        toggle();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {read ? "Read" : "Mark read"}
    </button>
  );
}
