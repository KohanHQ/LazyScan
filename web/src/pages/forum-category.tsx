import { useEffect, useRef, useState, type ReactElement } from "react";
import { Lock, MessageSquare, Pin } from "lucide-react";
import {
  createForumThread,
  listForumCategories,
  listForumThreads,
  MAX_THREAD_BODY,
  MAX_THREAD_TITLE,
  type ForumCategory,
  type ForumThread,
  type ForumThreadPage,
} from "@/api/forum";
import { PageHeading } from "@/components/page-heading";
import { Empty, ErrorState, Loading } from "@/components/states";
import { clickable } from "@/lib/clickable";
import { navigateTo } from "@/router";
import { useSession } from "@/state/hooks";
import { formatDate } from "@/utils/format";

const PAGE_SIZE = 20;

// The thread rows live in their own state (load-more appends to them); this
// only tracks the page's load phase and the decorative category record.
type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; category: ForumCategory | null };

// Category page (/forum/:slug): the thread list (pinned first, server-ordered)
// plus the auth-gated new-thread composer.
export function ForumCategoryPage({ slug }: { slug: string }): ReactElement {
  const loggedIn = Boolean(useSession().user);

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [total, setTotal] = useState(0);
  const [moreHidden, setMoreHidden] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [composing, setComposing] = useState(false);
  // The server's opaque keyset cursor for the next page; null means this is the
  // end of the list, which is exactly when Load more hides.
  const cursorRef = useRef<string | null>(null);
  // Tracks the mounted slug so an in-flight loadMore from a previous category
  // can discard its late response instead of appending to the new list.
  const activeSlugRef = useRef(slug);

  useEffect(() => {
    let ignore = false;
    setState({ kind: "loading" });
    cursorRef.current = null;
    activeSlugRef.current = slug;
    setLoadingMore(false);
    void (async () => {
      let page: ForumThreadPage;
      let categories: ForumCategory[] | null;
      try {
        // The category lookup is decoration (name + description); only the
        // thread call is authoritative, so a categories failure degrades to the
        // slug rather than failing the page.
        [categories, page] = await Promise.all([
          listForumCategories().catch(() => null),
          listForumThreads(slug, null, PAGE_SIZE),
        ]);
      } catch (loadError) {
        if (!ignore) {
          setState({
            kind: "error",
            message:
              loadError instanceof Error
                ? loadError.message
                : "Unable to load this category.",
          });
        }
        return;
      }
      if (ignore) {
        return;
      }
      setThreads(page.threads);
      setTotal(page.total);
      cursorRef.current = page.nextCursor;
      setMoreHidden(page.nextCursor === null);
      setState({
        kind: "ready",
        category: categories?.find((item) => item.slug === slug) ?? null,
      });
    })();
    return () => {
      ignore = true;
    };
  }, [slug]);

  const loadMore = async (): Promise<void> => {
    const requestedSlug = slug;
    const requestedCursor = cursorRef.current;
    if (requestedCursor === null) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await listForumThreads(
        requestedSlug,
        requestedCursor,
        PAGE_SIZE
      );
      if (activeSlugRef.current !== requestedSlug) {
        return;
      }
      // The cursor already excludes page one; the id filter is belt-and-braces
      // against a thread that moved across the boundary between fetches.
      setThreads((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.threads.filter((item) => !seen.has(item.id))];
      });
      setTotal(page.total);
      cursorRef.current = page.nextCursor;
      setMoreHidden(page.nextCursor === null);
    } catch {
      // Keep the current list; the Load more button stays for a retry.
    } finally {
      if (activeSlugRef.current === requestedSlug) {
        setLoadingMore(false);
      }
    }
  };

  if (state.kind === "loading") {
    return (
      <>
        <Heading title={slug} />
        <Loading message="Loading threads" />
      </>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        <Heading title={slug} />
        <ErrorState message={state.message} />
      </>
    );
  }

  const title = state.category?.name ?? slug;

  return (
    <>
      <Heading
        title={title}
        description={state.category?.description ?? null}
        total={total}
        aside={
          loggedIn ? (
            <button
              className="primary-button"
              type="button"
              aria-expanded={composing}
              onClick={() => setComposing((open) => !open)}
            >
              {composing ? "Cancel" : "New thread"}
            </button>
          ) : undefined
        }
      />

      {loggedIn ? (
        composing ? (
          <NewThreadForm slug={slug} />
        ) : null
      ) : (
        <p className="comment-login">Log in to start a thread.</p>
      )}

      {threads.length === 0 ? (
        <Empty
          title="No threads yet"
          message="Nothing has been posted in this category. Start the first discussion."
          icon={<MessageSquare className="icon" size={20} />}
        />
      ) : (
        <>
          <ol className="forum-list">
            {threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} />
            ))}
          </ol>
          <button
            className="secondary-button library-more"
            type="button"
            hidden={moreHidden}
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </>
      )}
    </>
  );
}

function Heading({
  title,
  description,
  total,
  aside,
}: {
  title: string;
  description?: string | null;
  total?: number;
  aside?: ReactElement;
}): ReactElement {
  return (
    <>
      <button
        className="secondary-button forum-back"
        type="button"
        onClick={() => navigateTo("/forum")}
      >
        ← Back to forum
      </button>
      <PageHeading
        eyebrow="Community"
        title={title}
        meta={
          <>
            {description ? <p className="forum-row-desc">{description}</p> : null}
            {total !== undefined ? (
              <p className="heading-meta" data-role="count">
                {total} thread{total === 1 ? "" : "s"}
              </p>
            ) : null}
          </>
        }
        aside={aside}
      />
    </>
  );
}

// Creating jumps straight to the new thread, so the list never has to guess
// where the row belongs in the pinned-first server ordering.
function NewThreadForm({ slug }: { slug: string }): ReactElement {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (trimmedTitle.length === 0 || trimmedBody.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    createForumThread(slug, trimmedTitle, trimmedBody)
      .then((thread) => {
        navigateTo(`/forum/thread/${encodeURIComponent(thread.id)}`);
      })
      .catch((submitError) => {
        setBusy(false);
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Unable to create thread."
        );
      });
  };

  return (
    <form
      className="comment-form forum-thread-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        className="comment-input"
        type="text"
        aria-label="Thread title"
        placeholder="Thread title"
        maxLength={MAX_THREAD_TITLE}
        value={title}
        disabled={busy}
        onChange={(event) => setTitle(event.target.value)}
      />
      <textarea
        className="comment-input"
        aria-label="Thread body"
        placeholder="What do you want to discuss?"
        maxLength={MAX_THREAD_BODY}
        rows={5}
        value={body}
        disabled={busy}
        onChange={(event) => setBody(event.target.value)}
      />
      {error !== null ? <p className="comment-error">{error}</p> : null}
      <div className="comment-form-actions">
        <button
          className="primary-button"
          type="submit"
          disabled={busy || title.trim().length === 0 || body.trim().length === 0}
        >
          {busy ? "Posting…" : "Post thread"}
        </button>
      </div>
    </form>
  );
}

function ThreadRow({ thread }: { thread: ForumThread }): ReactElement {
  const flags = `${thread.pinned ? ", pinned" : ""}${thread.locked ? ", locked" : ""}`;

  return (
    <li
      className="forum-row"
      aria-label={`Open ${thread.title}${flags}`}
      {...clickable(`/forum/thread/${encodeURIComponent(thread.id)}`)}
    >
      <div className="forum-row-body">
        <h3>
          {thread.pinned ? (
            <span className="forum-glyph" title="Pinned">
              <Pin className="icon" size={14} aria-hidden="true" />
            </span>
          ) : null}
          {thread.locked ? (
            <span className="forum-glyph" title="Locked">
              <Lock className="icon" size={14} aria-hidden="true" />
            </span>
          ) : null}
          {thread.title}
        </h3>
        <p className="forum-row-desc">
          {thread.authorName} · {formatDate(thread.createdAt)}
        </p>
      </div>
      <p className="forum-row-meta">
        <span>
          {thread.replyCount} repl{thread.replyCount === 1 ? "y" : "ies"}
        </span>
        <span>Active {formatDate(thread.lastPostAt)}</span>
      </p>
    </li>
  );
}
