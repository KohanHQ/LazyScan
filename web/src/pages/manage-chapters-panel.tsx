import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  deleteChapter,
  listMangaChapters,
  previewChapter,
  publishChapter,
  reorderChapterPages,
  unpublishChapter,
  updateChapter,
} from "@/api/chapter";
import type { ChapterPage, ReaderChapter } from "@/api/chapter";
import type { Manga } from "@/api/manga";
import { ConfirmDialog } from "@/components/react/confirm-dialog";
import { ErrorState, Loading } from "@/components/react/states";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Chapter management surface for the manga edit page: list every chapter (any
// status/publish state) and act on it — publish/unpublish, edit metadata, delete,
// and a combined preview + page-reorder dialog. Rendered only in edit mode.

type ListState =
  | { kind: "loading" }
  | { kind: "ready"; chapters: ReaderChapter[] }
  | { kind: "error"; message: string };

type DialogState =
  | { kind: "none" }
  | { kind: "edit"; chapter: ReaderChapter }
  | { kind: "pages"; chapter: ReaderChapter }
  | { kind: "delete"; chapter: ReaderChapter };

function visibilityLabel(chapter: ReaderChapter): string {
  if (chapter.status === "ready") {
    return chapter.publishedAt ? "Published" : "Draft";
  }
  if (chapter.status === "failed") {
    return "Failed";
  }
  return "Processing";
}

function visibilityClass(chapter: ReaderChapter): string {
  if (chapter.status === "ready") {
    return chapter.publishedAt ? "is-published" : "is-draft";
  }
  if (chapter.status === "failed") {
    return "is-failed";
  }
  return "is-processing";
}

function chapterLabel(chapter: ReaderChapter): string {
  const number =
    chapter.chapterNumber === null ? "" : `Ch. ${chapter.chapterNumber} · `;
  return `${number}${chapter.title}`;
}

export function ChaptersPanel({ manga }: { manga: Manga }): ReactElement {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  useEffect(() => {
    // Refresh keeps the current list visible until new data lands (no reload
    // flash); the initial "loading" comes from the initializer above.
    let ignore = false;
    setActionError(null);
    listMangaChapters(manga.id)
      .then((chapters) => {
        if (!ignore) {
          setState({ kind: "ready", chapters });
        }
      })
      .catch((error) => {
        if (!ignore) {
          setState({
            kind: "error",
            message:
              error instanceof Error ? error.message : "Unable to load chapters.",
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, [manga.id, reload]);

  const refresh = (): void => setReload((value) => value + 1);

  const runAction = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
      refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed.");
    }
  };

  const closeDialog = (): void => setDialog({ kind: "none" });

  return (
    <section className="manage-panel manage-chapters">
      <h2 className="manage-subheading">Chapters</h2>
      {state.kind === "loading" ? (
        <Loading message="Loading chapters" />
      ) : state.kind === "error" ? (
        <ErrorState message={state.message} />
      ) : state.chapters.length === 0 ? (
        <p className="muted">
          No chapters yet. Use &quot;Upload chapter&quot; above to add one.
        </p>
      ) : (
        <>
          <ul className="chapter-admin-list">
            {state.chapters.map((chapter) => (
              <li className="chapter-admin-row" key={chapter.id}>
                <div className="chapter-admin-main">
                  <span className="chapter-admin-title">
                    {chapterLabel(chapter)}
                  </span>
                  <span
                    className={`chapter-admin-badge ${visibilityClass(chapter)}`}
                  >
                    {visibilityLabel(chapter)}
                  </span>
                </div>
                <div className="chapter-admin-actions">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setDialog({ kind: "pages", chapter })}
                  >
                    Pages
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setDialog({ kind: "edit", chapter })}
                  >
                    Edit
                  </button>
                  {chapter.publishedAt ? (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        void runAction(() =>
                          unpublishChapter(manga.id, chapter.id)
                        )
                      }
                    >
                      Unpublish
                    </button>
                  ) : (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        void runAction(() =>
                          publishChapter(manga.id, chapter.id)
                        )
                      }
                    >
                      Publish
                    </button>
                  )}
                  <button
                    className="ghost-button danger"
                    type="button"
                    onClick={() => setDialog({ kind: "delete", chapter })}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {actionError ? <p className="form-error">{actionError}</p> : null}
        </>
      )}

      {dialog.kind === "edit" ? (
        <EditChapterDialog
          manga={manga}
          chapter={dialog.chapter}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog();
            refresh();
          }}
        />
      ) : null}
      {dialog.kind === "pages" ? (
        <PagesDialog
          manga={manga}
          chapter={dialog.chapter}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog();
            refresh();
          }}
        />
      ) : null}
      {dialog.kind === "delete" ? (
        <ConfirmDialog
          title="Delete chapter"
          message={`Delete "${chapterLabel(dialog.chapter)}"? This removes its pages and cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={closeDialog}
          onConfirm={() => {
            const chapter = dialog.chapter;
            closeDialog();
            void runAction(() => deleteChapter(manga.id, chapter.id));
          }}
        />
      ) : null}
    </section>
  );
}

// --- Edit dialog (title / number / volume / sort order) ---

function EditChapterDialog({
  manga,
  chapter,
  onClose,
  onSaved,
}: {
  manga: Manga;
  chapter: ReaderChapter;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const volumeRef = useRef<HTMLInputElement>(null);
  const sortRef = useRef<HTMLInputElement>(null);

  const onSave = async (): Promise<void> => {
    const title = titleRef.current?.value.trim() ?? "";
    if (!title) {
      setError("Title is required.");
      return;
    }
    const numberRaw = numberRef.current?.value.trim() ?? "";
    const volumeRaw = volumeRef.current?.value.trim() ?? "";
    const sortRaw = sortRef.current?.value.trim() ?? "";

    setBusy(true);
    try {
      // Empty optional fields are sent as null so the API clears them; sortOrder
      // is only included when set.
      await updateChapter(manga.id, chapter.id, {
        title,
        chapterNumber: numberRaw ? Number(numberRaw) : null,
        volume: volumeRaw ? Number(volumeRaw) : null,
        ...(sortRaw ? { sortOrder: Number(sortRaw) } : {}),
      });
      onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save chapter."
      );
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit chapter</DialogTitle>
        </DialogHeader>
        <div className="manage-form">
          <label>
            <span>Title</span>
            <input
              ref={titleRef}
              type="text"
              maxLength={500}
              defaultValue={chapter.title}
            />
          </label>
          <label>
            <span>Chapter number</span>
            <input
              ref={numberRef}
              type="number"
              min={0}
              step="any"
              defaultValue={chapter.chapterNumber ?? ""}
            />
          </label>
          <label>
            <span>Volume</span>
            <input
              ref={volumeRef}
              type="number"
              min={0}
              step="any"
              defaultValue={chapter.volume ?? ""}
            />
          </label>
          <label>
            <span>Sort order</span>
            <input
              ref={sortRef}
              type="number"
              step={1}
              defaultValue={chapter.sortOrder}
            />
          </label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <DialogFooter>
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => void onSave()}
          >
            {busy ? "Saving" : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Pages dialog (preview + reorder) ---

type PagesState =
  | { kind: "loading" }
  | { kind: "ready"; pages: ChapterPage[] }
  | { kind: "error"; message: string };

function PagesDialog({
  manga,
  chapter,
  onClose,
  onSaved,
}: {
  manga: Manga;
  chapter: ReaderChapter;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const [state, setState] = useState<PagesState>({ kind: "loading" });
  // Working copy reordered in memory; persisted only on Save.
  const [order, setOrder] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let ignore = false;
    previewChapter(manga.id, chapter.id)
      .then((preview) => {
        if (ignore) {
          return;
        }
        const pages = [...preview.pages].sort(
          (a, b) => a.pageNumber - b.pageNumber
        );
        setState({ kind: "ready", pages });
        setOrder(pages.map((page) => page.id));
      })
      .catch((loadError) => {
        if (!ignore) {
          setState({
            kind: "error",
            message:
              loadError instanceof Error
                ? loadError.message
                : "Unable to load pages.",
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, [manga.id, chapter.id]);

  const move = (id: string, direction: -1 | 1): void => {
    setOrder((current) => {
      const index = current.indexOf(id);
      const swap = index + direction;
      if (index < 0 || swap < 0 || swap >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[swap]] = [next[swap], next[index]];
      return next;
    });
  };

  const onSave = async (): Promise<void> => {
    setBusy(true);
    try {
      await reorderChapterPages(manga.id, chapter.id, order);
      onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save order."
      );
      setBusy(false);
    }
  };

  const byId =
    state.kind === "ready"
      ? new Map(state.pages.map((page) => [page.id, page]))
      : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{`${chapterLabel(chapter)} — pages`}</DialogTitle>
        </DialogHeader>
        {state.kind === "loading" ? (
          <Loading message="Loading pages" />
        ) : state.kind === "error" ? (
          <ErrorState message={state.message} />
        ) : (
          <>
            <p className="muted">
              Use the arrows to reorder, then save. Page numbers renumber 1..N in
              this order.
            </p>
            <ol className="page-reorder-list">
              {order.map((id, index) => {
                const page = byId?.get(id);
                if (!page) {
                  return null;
                }
                return (
                  <li className="page-reorder-row" key={page.id}>
                    <span className="page-reorder-index">{index + 1}</span>
                    {page.imageUrl ? (
                      <img
                        className="page-reorder-thumb"
                        src={page.imageUrl}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="page-reorder-thumb is-empty">
                        {page.status}
                      </span>
                    )}
                    <span className="page-reorder-name">
                      {page.originalFilename}
                    </span>
                    <span className="page-reorder-move">
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={index === 0}
                        aria-label="Move up"
                        onClick={() => move(page.id, -1)}
                      >
                        ▲
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={index === order.length - 1}
                        aria-label="Move down"
                        onClick={() => move(page.id, 1)}
                      >
                        ▼
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
            {error ? <p className="form-error">{error}</p> : null}
            <DialogFooter>
              <button
                className="secondary-button"
                type="button"
                onClick={onClose}
              >
                Close
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={busy}
                onClick={() => void onSave()}
              >
                {busy ? "Saving" : "Save order"}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
