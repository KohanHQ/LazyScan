import { useEffect, useRef, useState, type ReactElement } from "react";
import { MessageSquare } from "lucide-react";
import {
  createComment,
  listComments,
  removeComment,
  updateComment,
  type Comment,
} from "@/api/comments";
import { ComposerTextarea } from "@/components/composer-textarea";
import { Cover } from "@/components/cover";
import { Empty, ErrorState } from "@/components/states";
import { linkify } from "@/lib/linkify";
import { useSession } from "@/state/hooks";
import { resolveAvatar } from "@/utils/avatar";
import { formatDate } from "@/utils/format";

const PAGE_SIZE = 20;
const MAX_BODY = 1000;

// Public comment section. The list renders for everyone; the compose form shows
// only when logged in, and edit/delete controls only on the viewer's own rows
// (plus delete for the admin role, mirroring the API).
export function Comments({ mangaId }: { mangaId: string }): ReactElement {
  const session = useSession();
  const currentUserId = session.user?.userId ?? null;
  const isAdmin = session.user?.role === "superuser";

  const [comments, setComments] = useState<Comment[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // The server's opaque keyset cursor for the next page; null means this is the
  // end of the list, which is exactly when Load more hides.
  const cursorRef = useRef<string | null>(null);
  const [moreHidden, setMoreHidden] = useState(true);
  // Tracks the currently mounted manga so an in-flight loadMore from a previous
  // mangaId can discard its late response instead of appending to the new list.
  const activeMangaRef = useRef(mangaId);

  useEffect(() => {
    let ignore = false;
    setComments(null);
    setError(null);
    cursorRef.current = null;
    activeMangaRef.current = mangaId;
    listComments(mangaId, null, PAGE_SIZE)
      .then((page) => {
        if (ignore) {
          return;
        }
        setComments(page.comments);
        setTotal(page.total);
        cursorRef.current = page.nextCursor;
        setMoreHidden(page.nextCursor === null);
      })
      .catch((loadError) => {
        if (!ignore) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load comments."
          );
        }
      });
    return () => {
      ignore = true;
    };
  }, [mangaId]);

  const loadMore = async (): Promise<void> => {
    const requestedManga = mangaId;
    const requestedCursor = cursorRef.current;
    if (requestedCursor === null) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await listComments(requestedManga, requestedCursor, PAGE_SIZE);
      // Manga switched mid-fetch: drop this response so it can't append to the
      // now-different list.
      if (activeMangaRef.current !== requestedManga) {
        return;
      }
      // The cursor already excludes what page one returned; the id filter is
      // belt-and-braces against a row the composer put in the list by hand.
      setComments((current) => {
        const seen = new Set((current ?? []).map((item) => item.id));
        return [
          ...(current ?? []),
          ...page.comments.filter((item) => !seen.has(item.id)),
        ];
      });
      setTotal(page.total);
      cursorRef.current = page.nextCursor;
      setMoreHidden(page.nextCursor === null);
    } catch {
      // Keep the current list; the Load more button stays for a retry.
    } finally {
      if (activeMangaRef.current === requestedManga) {
        setLoadingMore(false);
      }
    }
  };

  const onCreated = (comment: Comment): void => {
    // Newest-first list, so a new comment belongs at the head; the cursor points
    // at rows strictly older than page one and is unaffected.
    setComments((current) => [comment, ...(current ?? [])]);
    setTotal((value) => value + 1);
  };

  const onUpdated = (comment: Comment): void => {
    setComments(
      (current) =>
        current?.map((item) => (item.id === comment.id ? comment : item)) ??
        current
    );
  };

  const onRemoved = (id: string): void => {
    setComments((current) => current?.filter((item) => item.id !== id) ?? current);
    setTotal((value) => Math.max(0, value - 1));
  };

  return (
    <>
      <section className="section-heading">
        <div>
          <p className="eyebrow">Community</p>
          <h2>Comments</h2>
        </div>
        <p className="heading-meta">
          {total} comment{total === 1 ? "" : "s"}
        </p>
      </section>

      {currentUserId ? (
        <CommentForm mangaId={mangaId} onCreated={onCreated} />
      ) : (
        <p className="mb-5 text-[0.9rem] text-text-secondary">Log in to comment.</p>
      )}

      {error !== null ? (
        <ErrorState message={error} />
      ) : comments === null ? (
        <p className="mb-5 text-[0.9rem] text-text-secondary">
          Loading comments…
        </p>
      ) : comments.length === 0 ? (
        <Empty
          title="No comments yet"
          message="Be the first to share your thoughts on this title."
          icon={<MessageSquare className="icon" size={20} />}
        />
      ) : (
        <>
          <ol className="m-0 mb-2 grid list-none gap-2.5 p-0">
            {comments.map((comment) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                canEdit={comment.userId === currentUserId}
                canDelete={comment.userId === currentUserId || isAdmin}
                onUpdated={onUpdated}
                onRemoved={onRemoved}
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
    </>
  );
}

function CommentForm({
  mangaId,
  onCreated,
}: {
  mangaId: string;
  onCreated: (comment: Comment) => void;
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
    createComment(mangaId, trimmed)
      .then((comment) => {
        onCreated(comment);
        setBody("");
      })
      .catch((submitError) => {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Unable to post comment."
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <form
      className="mb-5 grid gap-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <ComposerTextarea
        ariaLabel="Add a comment"
        placeholder="Add a comment…"
        maxLength={MAX_BODY}
        rows={3}
        value={body}
        disabled={busy}
        onChange={setBody}
        hint="Be kind. Spoilers get flagged."
        action={
          <button
            className="primary-button"
            type="submit"
            disabled={busy || body.trim().length === 0}
          >
            {busy ? "Posting…" : "Post comment"}
          </button>
        }
      />
      {error !== null ? <p className="m-0 text-[0.85rem] text-danger-fg">{error}</p> : null}
    </form>
  );
}

function CommentRow({
  comment,
  canEdit,
  canDelete,
  onUpdated,
  onRemoved,
}: {
  comment: Comment;
  canEdit: boolean;
  canDelete: boolean;
  onUpdated: (comment: Comment) => void;
  onRemoved: (id: string) => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = (): void => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    updateComment(comment.id, trimmed)
      .then((updated) => {
        onUpdated(updated);
        setEditing(false);
      })
      .catch((saveError) => {
        // Keep edit mode open so the draft is not lost.
        setError(
          saveError instanceof Error ? saveError.message : "Unable to save comment."
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
    removeComment(comment.id)
      .then(() => onRemoved(comment.id))
      .catch((removeError) => {
        setError(
          removeError instanceof Error
            ? removeError.message
            : "Unable to delete comment."
        );
        setBusy(false);
      });
  };

  const edited = comment.updatedAt !== comment.createdAt;

  return (
    <li className="grid gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-[50%] bg-surface-accent" aria-hidden="true">
          <Cover
            url={resolveAvatar(comment.authorAvatar, comment.authorName)}
            seed={comment.authorName}
            placeholderClass="user-avatar"
            imgClassName="user-avatar"
          />
        </span>
        <span className="text-[0.9rem] font-semibold text-text">{comment.authorName}</span>
        <span className="ml-auto text-[0.8rem] text-text-secondary">
          {formatDate(comment.createdAt)}
          {edited ? " · edited" : ""}
        </span>
      </div>
      {editing ? (
        <>
          <ComposerTextarea
            ariaLabel="Edit comment"
            maxLength={MAX_BODY}
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
                setDraft(comment.body);
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
          <p className="m-0 text-[0.95rem] wrap-anywhere whitespace-pre-wrap text-text [&_a]:text-accent-fg [&_a]:wrap-anywhere">{linkify(comment.body)}</p>
          {canEdit || canDelete ? (
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
            </div>
          ) : null}
        </>
      )}
      {error !== null ? <p className="m-0 text-[0.85rem] text-danger-fg">{error}</p> : null}
    </li>
  );
}
