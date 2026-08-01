import { useEffect, useRef, useState, type ReactElement } from "react";
import { Lock, MessageSquare } from "lucide-react";
import { ApiClientError } from "@/api/client";
import {
  createForumPost,
  getForumThread,
  listForumCategories,
  listForumPosts,
  MAX_POST_BODY,
  MAX_THREAD_BODY,
  MAX_THREAD_TITLE,
  removeForumPost,
  removeForumThread,
  setForumThreadLocked,
  setForumThreadPinned,
  updateForumPost,
  updateForumThread,
  type ForumCategory,
  type ForumPost,
  type ForumPostPage,
  type ForumThread,
} from "@/api/forum";
import { ComposerTextarea } from "@/components/composer-textarea";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Cover } from "@/components/cover";
import { ForumReportDialog } from "@/components/forum-report-dialog";
import { Empty, ErrorState, Loading } from "@/components/states";
import { useToast } from "@/components/ui/toast";
import { linkify } from "@/lib/linkify";
import { navigateTo } from "@/router";
import { useSession } from "@/state/hooks";
import { resolveAvatar } from "@/utils/avatar";
import { formatDate } from "@/utils/format";

const PAGE_SIZE = 20;

type ThreadData = {
  thread: ForumThread;
  posts: ForumPost[];
  total: number;
  nextCursor: string | null;
  categoryName: string | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ThreadData };

// Thread page (/forum/thread/:id): thread body, flat oldest-first replies with
// load-more, the auth-gated reply composer, own-content edit/delete, reports on
// every item, and the superuser lock/pin toggles.
export function ForumThreadPage({ id }: { id: string }): ReactElement {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let ignore = false;
    setState({ kind: "loading" });
    void (async () => {
      let thread: ForumThread;
      let page: ForumPostPage;
      let categories: ForumCategory[] | null;
      try {
        // Category names are decoration for the breadcrumb, so a failure there
        // degrades to the slug instead of failing the page.
        [thread, page, categories] = await Promise.all([
          getForumThread(id),
          listForumPosts(id, null, PAGE_SIZE),
          listForumCategories().catch(() => null),
        ]);
      } catch (loadError) {
        if (!ignore) {
          setState({
            kind: "error",
            message:
              loadError instanceof Error
                ? loadError.message
                : "Unable to load this thread.",
          });
        }
        return;
      }
      if (ignore) {
        return;
      }
      setState({
        kind: "ready",
        data: {
          thread,
          posts: page.posts,
          total: page.total,
          nextCursor: page.nextCursor,
          categoryName:
            categories?.find((item) => item.slug === thread.categorySlug)
              ?.name ?? null,
        },
      });
    })();
    return () => {
      ignore = true;
    };
  }, [id]);

  if (state.kind === "loading") {
    return <Loading message="Loading thread" />;
  }
  if (state.kind === "error") {
    return (
      <>
        <BackLink slug={null} label="forum" />
        <ErrorState message={state.message} />
      </>
    );
  }

  // Keyed on the thread id so a navigation between threads resets every child's
  // draft/busy state along with the loader above.
  return <ThreadView key={state.data.thread.id} initial={state.data} />;
}

function BackLink({
  slug,
  label,
}: {
  slug: string | null;
  label: string;
}): ReactElement {
  return (
    <button
      className="secondary-button mb-4.5"
      type="button"
      onClick={() =>
        navigateTo(slug === null ? "/forum" : `/forum/${encodeURIComponent(slug)}`)
      }
    >
      ← Back to {label}
    </button>
  );
}

function ThreadView({ initial }: { initial: ThreadData }): ReactElement {
  const session = useSession();
  const currentUserId = session.user?.userId ?? null;
  const isAdmin = session.user?.role === "superuser";
  const toast = useToast();

  const [thread, setThread] = useState(initial.thread);
  const [posts, setPosts] = useState(initial.posts);
  const [total, setTotal] = useState(initial.total);
  const [moreHidden, setMoreHidden] = useState(initial.nextCursor === null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reportTarget, setReportTarget] = useState<
    { type: "thread" | "post"; id: string } | null
  >(null);

  // The server's opaque keyset cursor for the next page; null is the end of the
  // list, which is exactly when Load more hides.
  const cursorRef = useRef<string | null>(initial.nextCursor);
  // Replies written in this session. They are the newest rows, so they stay at
  // the end of the oldest-first list and are deduped out of later pages.
  const createdIdsRef = useRef(new Set<string>());

  const loadMore = async (): Promise<void> => {
    const requestedCursor = cursorRef.current;
    if (requestedCursor === null) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await listForumPosts(thread.id, requestedCursor, PAGE_SIZE);
      setPosts((current) => {
        const seen = new Set(current.map((post) => post.id));
        const incoming = page.posts.filter((post) => !seen.has(post.id));
        const created = createdIdsRef.current;
        return [
          ...current.filter((post) => !created.has(post.id)),
          ...incoming,
          ...current.filter((post) => created.has(post.id)),
        ];
      });
      setTotal(page.total);
      cursorRef.current = page.nextCursor;
      setMoreHidden(page.nextCursor === null);
    } catch {
      // Keep the current list; the Load more button stays for a retry.
    } finally {
      setLoadingMore(false);
    }
  };

  const onCreated = (post: ForumPost): void => {
    createdIdsRef.current.add(post.id);
    setPosts((current) => [...current, post]);
    setTotal((value) => value + 1);
    // The cursor is deliberately untouched: it addresses a row, and appending at
    // the tail of an oldest-first list moves nothing the fetched window covers.
  };

  const onUpdated = (post: ForumPost): void => {
    setPosts((current) =>
      current.map((item) => (item.id === post.id ? post : item))
    );
  };

  const onRemoved = (postId: string): void => {
    setPosts((current) => current.filter((item) => item.id !== postId));
    setTotal((value) => Math.max(0, value - 1));
    // No cursor compensation to do: the cursor is a sort position, so deleting
    // the row it names still resumes the next page in the right place.
    createdIdsRef.current.delete(postId);
  };

  return (
    <>
      {/* The slug itself is the fallback label so the wording never points
          somewhere other than where the link goes. */}
      <BackLink
        slug={thread.categorySlug}
        label={initial.categoryName ?? thread.categorySlug}
      />

      <ThreadCard
        thread={thread}
        canEdit={thread.userId === currentUserId && (!thread.locked || isAdmin)}
        canDelete={thread.userId === currentUserId || isAdmin}
        canReport={currentUserId !== null && thread.userId !== currentUserId}
        isAdmin={isAdmin}
        replyCount={total}
        onChanged={setThread}
        onReport={() => setReportTarget({ type: "thread", id: thread.id })}
      />

      <section className="section-heading">
        <div>
          <p className="eyebrow">Discussion</p>
          <h2>Replies</h2>
        </div>
        <p className="heading-meta">
          {total} repl{total === 1 ? "y" : "ies"}
        </p>
      </section>

      {posts.length === 0 ? (
        <Empty
          title="No replies yet"
          message={
            thread.locked
              ? "This thread was locked before anyone replied."
              : "Be the first to reply to this thread."
          }
          icon={<MessageSquare className="icon" size={20} />}
        />
      ) : (
        <>
          <ol className="m-0 mb-2 grid list-none gap-2.5 p-0">
            {posts.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                canEdit={
                  post.userId === currentUserId && (!thread.locked || isAdmin)
                }
                canDelete={post.userId === currentUserId || isAdmin}
                canReport={
                  currentUserId !== null && post.userId !== currentUserId
                }
                onUpdated={onUpdated}
                onRemoved={onRemoved}
                onReport={() => setReportTarget({ type: "post", id: post.id })}
              />
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

      {/* The API refuses replies on a locked thread for everyone, superusers
          included, so the composer is replaced rather than disabled. */}
      {thread.locked ? (
        <p className="forum-locked-notice" role="status">
          <Lock className="icon" size={16} aria-hidden="true" />
          Thread locked — no new replies.
        </p>
      ) : currentUserId !== null ? (
        <ReplyForm
          threadId={thread.id}
          onCreated={onCreated}
          onLocked={() => {
            setThread((current) => ({ ...current, locked: true }));
            toast.error("This thread was locked. Your reply was not posted.");
          }}
        />
      ) : (
        <p className="mb-5 text-[0.9rem] text-text-secondary">Log in to reply.</p>
      )}

      {reportTarget !== null ? (
        <ForumReportDialog
          targetType={reportTarget.type}
          targetId={reportTarget.id}
          onClose={() => setReportTarget(null)}
        />
      ) : null}
    </>
  );
}

function ThreadCard({
  thread,
  canEdit,
  canDelete,
  canReport,
  isAdmin,
  replyCount,
  onChanged,
  onReport,
}: {
  thread: ForumThread;
  canEdit: boolean;
  canDelete: boolean;
  canReport: boolean;
  isAdmin: boolean;
  replyCount: number;
  onChanged: (thread: ForumThread) => void;
  onReport: () => void;
}): ReactElement {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [body, setBody] = useState(thread.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const save = (): void => {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (trimmedTitle.length === 0 || trimmedBody.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    updateForumThread(thread.id, trimmedTitle, trimmedBody)
      .then((updated) => {
        onChanged(updated);
        setEditing(false);
      })
      .catch((saveError) => {
        // Keep edit mode open so the draft is not lost.
        setError(
          saveError instanceof Error ? saveError.message : "Unable to save thread."
        );
      })
      .finally(() => setBusy(false));
  };

  const remove = (): void => {
    setConfirming(false);
    if (busy) {
      return;
    }
    setBusy(true);
    removeForumThread(thread.id)
      .then(() =>
        navigateTo(`/forum/${encodeURIComponent(thread.categorySlug)}`)
      )
      .catch((removeError) => {
        setBusy(false);
        toast.error(
          removeError instanceof Error
            ? removeError.message
            : "Unable to delete thread."
        );
      });
  };

  // Lock/pin round-trip returns the updated thread, so the UI takes the server's
  // word rather than toggling optimistically.
  const moderate = (action: "lock" | "pin"): void => {
    if (busy) {
      return;
    }
    setBusy(true);
    const request =
      action === "lock"
        ? setForumThreadLocked(thread.id, !thread.locked)
        : setForumThreadPinned(thread.id, !thread.pinned);
    request
      .then(onChanged)
      .catch((actionError) => {
        toast.error(
          actionError instanceof Error
            ? actionError.message
            : "Unable to update thread."
        );
      })
      .finally(() => setBusy(false));
  };

  const edited = thread.updatedAt !== thread.createdAt;

  return (
    <article className="grid gap-2 rounded-lg border border-border bg-surface px-5 py-4.5">
      {editing ? (
        <>
          <input
            className="comment-input"
            type="text"
            aria-label="Thread title"
            maxLength={MAX_THREAD_TITLE}
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
          <ComposerTextarea
            ariaLabel="Thread body"
            maxLength={MAX_THREAD_BODY}
            rows={6}
            value={body}
            disabled={busy}
            onChange={setBody}
          />
          <div className="flex items-center gap-2">
            <button
              className="primary-button"
              type="button"
              disabled={busy || title.trim().length === 0 || body.trim().length === 0}
              onClick={save}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setTitle(thread.title);
                setBody(thread.body);
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className="forum-thread-title">{thread.title}</h1>
          <div className="flex items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-[50%] bg-surface-accent" aria-hidden="true">
              <Cover
                url={resolveAvatar(thread.authorAvatar, thread.authorName)}
                seed={thread.authorName}
                placeholderClass="user-avatar"
                imgClassName="user-avatar"
              />
            </span>
            <span className="text-[0.9rem] font-semibold text-text">{thread.authorName}</span>
            <span className="ml-auto text-[0.8rem] text-text-secondary">
              {formatDate(thread.createdAt)}
              {edited ? " · edited" : ""}
            </span>
          </div>
          <p className="m-0 text-[0.95rem] wrap-anywhere whitespace-pre-wrap text-text [&_a]:text-accent-fg [&_a]:wrap-anywhere">{linkify(thread.body)}</p>
          <p className="m-0 text-[0.8rem] text-text-secondary">
            {replyCount} repl{replyCount === 1 ? "y" : "ies"}
            {thread.pinned ? " · pinned" : ""}
            {thread.locked ? " · locked" : ""}
          </p>
          <div className="flex items-center gap-2">
            {canEdit ? (
              <button
                className="comment-action"
                type="button"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
            ) : null}
            {canDelete ? (
              <button
                className="comment-action comment-action-danger"
                type="button"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                Delete
              </button>
            ) : null}
            {canReport ? (
              <button
                className="comment-action"
                type="button"
                disabled={busy}
                onClick={onReport}
              >
                Report
              </button>
            ) : null}
            {isAdmin ? (
              <>
                <button
                  className="comment-action forum-mod-action"
                  type="button"
                  disabled={busy}
                  onClick={() => moderate("lock")}
                >
                  {thread.locked ? "Unlock" : "Lock"}
                </button>
                <button
                  className="comment-action forum-mod-action"
                  type="button"
                  disabled={busy}
                  onClick={() => moderate("pin")}
                >
                  {thread.pinned ? "Unpin" : "Pin"}
                </button>
              </>
            ) : null}
          </div>
        </>
      )}
      {error !== null ? <p className="m-0 text-[0.85rem] text-danger-fg">{error}</p> : null}
      {confirming ? (
        <ConfirmDialog
          title="Delete thread?"
          message="The thread and every reply on it are removed. This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </article>
  );
}

function ReplyForm({
  threadId,
  onCreated,
  onLocked,
}: {
  threadId: string;
  onCreated: (post: ForumPost) => void;
  onLocked: () => void;
}): ReactElement {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const trimmed = body.trim();
    if (trimmed.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    createForumPost(threadId, trimmed)
      .then((post) => {
        onCreated(post);
        setBody("");
      })
      .catch((submitError) => {
        // Locked between load and submit: the composer unmounts, so the notice
        // (plus the caller's toast) carries the message, not this inline error.
        if (
          submitError instanceof ApiClientError &&
          submitError.code === "FORUM_THREAD_LOCKED"
        ) {
          onLocked();
          return;
        }
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Unable to post reply."
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <form
      className="mb-5 grid gap-2.5 mt-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <ComposerTextarea
        ariaLabel="Write a reply"
        placeholder="Write a reply…"
        maxLength={MAX_POST_BODY}
        rows={4}
        value={body}
        disabled={busy}
        onChange={setBody}
        hint="Be kind. Keep it on topic."
        action={
          <button
            className="primary-button"
            type="submit"
            disabled={busy || body.trim().length === 0}
          >
            {busy ? "Posting…" : "Post reply"}
          </button>
        }
      />
      {error !== null ? <p className="m-0 text-[0.85rem] text-danger-fg">{error}</p> : null}
    </form>
  );
}

function PostRow({
  post,
  canEdit,
  canDelete,
  canReport,
  onUpdated,
  onRemoved,
  onReport,
}: {
  post: ForumPost;
  canEdit: boolean;
  canDelete: boolean;
  canReport: boolean;
  onUpdated: (post: ForumPost) => void;
  onRemoved: (id: string) => void;
  onReport: () => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = (): void => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    updateForumPost(post.id, trimmed)
      .then((updated) => {
        onUpdated(updated);
        setEditing(false);
      })
      .catch((saveError) => {
        // Keep edit mode open so the draft is not lost.
        setError(
          saveError instanceof Error ? saveError.message : "Unable to save reply."
        );
      })
      .finally(() => setBusy(false));
  };

  const remove = (): void => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    removeForumPost(post.id)
      .then(() => onRemoved(post.id))
      .catch((removeError) => {
        setError(
          removeError instanceof Error
            ? removeError.message
            : "Unable to delete reply."
        );
        setBusy(false);
      });
  };

  const edited = post.updatedAt !== post.createdAt;

  return (
    <li className="grid gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-[50%] bg-surface-accent" aria-hidden="true">
          <Cover
            url={resolveAvatar(post.authorAvatar, post.authorName)}
            seed={post.authorName}
            placeholderClass="user-avatar"
            imgClassName="user-avatar"
          />
        </span>
        <span className="text-[0.9rem] font-semibold text-text">{post.authorName}</span>
        <span className="ml-auto text-[0.8rem] text-text-secondary">
          {formatDate(post.createdAt)}
          {edited ? " · edited" : ""}
        </span>
      </div>
      {editing ? (
        <>
          <ComposerTextarea
            ariaLabel="Edit reply"
            maxLength={MAX_POST_BODY}
            rows={3}
            value={draft}
            disabled={busy}
            onChange={setDraft}
          />
          <div className="flex items-center gap-2">
            <button
              className="primary-button"
              type="button"
              disabled={busy || draft.trim().length === 0}
              onClick={save}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(post.body);
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-[0.95rem] wrap-anywhere whitespace-pre-wrap text-text [&_a]:text-accent-fg [&_a]:wrap-anywhere">{linkify(post.body)}</p>
          {canEdit || canDelete || canReport ? (
            <div className="flex items-center gap-2">
              {canEdit ? (
                <button
                  className="comment-action"
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  Edit
                </button>
              ) : null}
              {canDelete ? (
                <button
                  className="comment-action comment-action-danger"
                  type="button"
                  disabled={busy}
                  onClick={remove}
                >
                  Delete
                </button>
              ) : null}
              {canReport ? (
                <button
                  className="comment-action"
                  type="button"
                  disabled={busy}
                  onClick={onReport}
                >
                  Report
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {error !== null ? <p className="m-0 text-[0.85rem] text-danger-fg">{error}</p> : null}
    </li>
  );
}
