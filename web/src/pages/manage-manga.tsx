import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  createManga,
  deleteManga,
  getManga,
  updateManga,
  uploadMangaCover,
  MANGA_STATUSES,
} from "@/api/manga";
import type { Manga, MangaInput, MangaStatus } from "@/api/manga";
import { ConfirmDialog } from "@/components/react/confirm-dialog";
import { Cover } from "@/components/react/cover";
import { PageHeading } from "@/components/react/page-heading";
import { RequireSession } from "@/components/react/require-session";
import { ErrorState, Loading } from "@/components/react/states";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChaptersPanel } from "@/pages/manage-chapters-panel";
import { navigateTo } from "@/router";

type Mode = "create" | "edit";

export function MangaCreatePage(): ReactElement {
  return (
    <RequireSession loginMessage="Log in to manage manga.">
      {() => <MangaForm mode="create" manga={null} />}
    </RequireSession>
  );
}

export function MangaEditPage({ id }: { id: string }): ReactElement {
  return (
    <RequireSession loginMessage="Log in to manage manga.">
      {() => <MangaEditLoader id={id} />}
    </RequireSession>
  );
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; manga: Manga }
  | { kind: "error"; message: string };

function MangaEditLoader({ id }: { id: string }): ReactElement {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let ignore = false;
    setState({ kind: "loading" });
    getManga(id)
      .then((manga) => {
        if (!ignore) {
          setState({ kind: "ready", manga });
        }
      })
      .catch((error) => {
        if (!ignore) {
          setState({
            kind: "error",
            message:
              error instanceof Error ? error.message : "Unable to load manga.",
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, [id]);

  if (state.kind === "loading") {
    return <Loading message="Loading title" />;
  }
  if (state.kind === "error") {
    return <ErrorState message={state.message} />;
  }
  return <MangaForm mode="edit" manga={state.manga} />;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readInput(
  data: FormData,
  mode: Mode
): { input: MangaInput; cover: File | null } {
  const title = String(data.get("title") || "").trim();
  const slug = String(data.get("slug") || "").trim();
  const description = String(data.get("description") || "").trim();
  const status = String(data.get("status") || "ongoing") as MangaStatus;
  const totalChaptersRaw = String(data.get("totalChapters") || "").trim();
  const author = String(data.get("author") || "").trim();
  const artist = String(data.get("artist") || "").trim();
  const publisher = String(data.get("publisher") || "").trim();
  const publishedYearRaw = String(data.get("publishedYear") || "").trim();
  const tagsRaw = String(data.get("tags") || "").trim();
  const coverEntry = data.get("cover");
  const cover =
    coverEntry instanceof File && coverEntry.size > 0 ? coverEntry : null;

  const input: MangaInput = { title, slug, status };

  // On edit, an emptied optional field is sent as null so the API clears it; on
  // create the field is simply omitted.
  const text = (value: string): string | null | undefined =>
    value ? value : mode === "edit" ? null : undefined;
  const num = (value: string): number | null | undefined =>
    value ? Number(value) : mode === "edit" ? null : undefined;

  const description_ = text(description);
  if (description_ !== undefined) {
    input.description = description_;
  }
  const totalChapters_ = num(totalChaptersRaw);
  if (totalChapters_ !== undefined) {
    input.totalChapters = totalChapters_;
  }
  const author_ = text(author);
  if (author_ !== undefined) {
    input.author = author_;
  }
  const artist_ = text(artist);
  if (artist_ !== undefined) {
    input.artist = artist_;
  }
  const publisher_ = text(publisher);
  if (publisher_ !== undefined) {
    input.publisher = publisher_;
  }
  const publishedYear_ = num(publishedYearRaw);
  if (publishedYear_ !== undefined) {
    input.publishedYear = publishedYear_;
  }

  // Comma-separated tags; same create-omit / edit-clear semantics as above.
  const tags = tagsRaw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  if (tags.length > 0) {
    input.tags = tags;
  } else if (mode === "edit") {
    input.tags = null;
  }

  return { input, cover };
}

function MangaForm({
  mode,
  manga,
}: {
  mode: Mode;
  manga: Manga | null;
}): ReactElement {
  const heading = mode === "create" ? "New manga" : "Edit manga";
  const submitLabel = mode === "create" ? "Create manga" : "Save changes";
  const status = manga?.status ?? "ongoing";
  const maxYear = new Date().getFullYear() + 1;

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [coverDialogOpen, setCoverDialogOpen] = useState(false);
  // coverUrl lives here (not derived from manga) so a replace-cover upload
  // persists across reopens; the uncontrolled form fields ignore this re-render.
  const [coverUrl, setCoverUrl] = useState<string | null>(
    manga?.coverUrl ?? null
  );

  const titleRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const slugTouched = useRef(false);

  // On create, keep slug in sync with the title until the user edits slug by hand.
  const onTitleInput = (): void => {
    if (
      mode !== "create" ||
      slugTouched.current ||
      !slugRef.current ||
      !titleRef.current
    ) {
      return;
    }
    slugRef.current.value = slugify(titleRef.current.value);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const { input, cover } = readInput(new FormData(event.currentTarget), mode);

    if (!input.title || !input.slug) {
      setError("Title and slug are required.");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      let saved: Manga;
      if (mode === "create") {
        saved = await createManga(input, cover ?? undefined);
      } else {
        saved = await updateManga(manga!.id, input);
        if (cover) {
          saved = await uploadMangaCover(saved.id, cover);
        }
      }
      navigateTo(`/manga/${encodeURIComponent(saved.id)}`);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save manga."
      );
      setBusy(false);
    }
  };

  const onDelete = async (): Promise<void> => {
    if (!manga) {
      return;
    }
    setDeleteBusy(true);
    try {
      await deleteManga(manga.id);
      navigateTo("/");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete manga."
      );
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <PageHeading title={heading} />
      <section className="manage-panel">
        <form
          className="manage-form manage-form--cols"
          noValidate
          onSubmit={onSubmit}
        >
          <label className="field-wide">
            <span>Title</span>
            <input
              ref={titleRef}
              name="title"
              type="text"
              required
              maxLength={500}
              defaultValue={manga?.title ?? ""}
              onInput={onTitleInput}
            />
          </label>
          <label className="field-wide">
            <span>Slug</span>
            <input
              ref={slugRef}
              name="slug"
              type="text"
              required
              maxLength={200}
              defaultValue={manga?.slug ?? ""}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              onInput={() => {
                slugTouched.current = true;
              }}
            />
            <small>Lowercase letters, numbers, and single hyphens.</small>
          </label>
          <label className="field-wide">
            <span>Description</span>
            <textarea
              name="description"
              maxLength={5000}
              rows={4}
              defaultValue={manga?.description ?? ""}
            />
          </label>
          <label>
            <span>Author</span>
            <input
              name="author"
              type="text"
              maxLength={200}
              defaultValue={manga?.author ?? ""}
            />
          </label>
          <label>
            <span>Artist</span>
            <input
              name="artist"
              type="text"
              maxLength={200}
              defaultValue={manga?.artist ?? ""}
            />
          </label>
          <label>
            <span>Publisher</span>
            <input
              name="publisher"
              type="text"
              maxLength={200}
              defaultValue={manga?.publisher ?? ""}
            />
          </label>
          <label>
            <span>Published year</span>
            <input
              name="publishedYear"
              type="number"
              min={1900}
              max={maxYear}
              step={1}
              defaultValue={manga?.publishedYear ?? ""}
            />
          </label>
          <label className="field-wide">
            <span>Tags</span>
            <input
              name="tags"
              type="text"
              defaultValue={manga?.tags?.join(", ") ?? ""}
              placeholder="action, isekai, slice of life"
            />
            <small>Comma-separated, up to 10. Lowercased automatically.</small>
          </label>
          <label>
            <span>Status</span>
            <select name="status" defaultValue={status}>
              {MANGA_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/^\w/, (c) => c.toUpperCase())}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Total chapters</span>
            <input
              name="totalChapters"
              type="number"
              min={1}
              step={1}
              defaultValue={manga?.totalChapters ?? ""}
            />
          </label>
          {mode === "create" ? (
            <label className="field-wide">
              <span>Cover image (optional)</span>
              <input
                name="cover"
                type="file"
                accept="image/png,image/jpeg,image/webp"
              />
              <small>PNG, JPEG, or WebP. Requires storage to be configured.</small>
            </label>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          <div className="manage-actions">
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Saving" : submitLabel}
            </button>
            {mode === "edit" && manga ? (
              <>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setCoverDialogOpen(true)}
                >
                  Replace cover
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    navigateTo(
                      `/manage/manga/${encodeURIComponent(manga.id)}/chapter`
                    )
                  }
                >
                  Upload chapter
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={deleteBusy}
                  onClick={() => setConfirmingDelete(true)}
                >
                  {deleteBusy ? "Deleting" : "Delete"}
                </button>
              </>
            ) : null}
          </div>
        </form>
      </section>

      {mode === "edit" && manga ? <ChaptersPanel manga={manga} /> : null}

      {mode === "edit" && manga && coverDialogOpen ? (
        <CoverDialog
          manga={manga}
          coverUrl={coverUrl}
          onUploaded={setCoverUrl}
          onClose={() => setCoverDialogOpen(false)}
        />
      ) : null}
      {mode === "edit" && manga && confirmingDelete ? (
        <ConfirmDialog
          title="Delete manga"
          message={`Delete "${manga.title}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            void onDelete();
          }}
        />
      ) : null}
    </>
  );
}

// Cover replace runs in its own modal so the main edit form stays focused on its
// text fields; it calls the cover endpoint directly and reports the new url up.
function CoverDialog({
  manga,
  coverUrl,
  onUploaded,
  onClose,
}: {
  manga: Manga;
  coverUrl: string | null;
  onUploaded: (url: string | null) => void;
  onClose: () => void;
}): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onUpload = async (): Promise<void> => {
    const file = fileRef.current?.files?.[0] ?? null;
    if (!file) {
      setError("Choose an image to upload.");
      return;
    }
    setBusy(true);
    try {
      const updated = await uploadMangaCover(manga.id, file);
      onUploaded(updated.coverUrl);
      onClose();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to upload cover."
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
          <DialogTitle>Replace cover</DialogTitle>
        </DialogHeader>
        <div className="manage-form cover-dialog-body">
          <Cover
            url={coverUrl}
            seed={manga.title}
            placeholderClass="manage-cover-thumb"
            imgClassName="manage-cover-preview"
          />
          <label className="field-wide">
            <span>New cover</span>
            <input
              ref={fileRef}
              name="cover"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
            />
            <small>PNG, JPEG, or WebP. Requires storage to be configured.</small>
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
            onClick={() => void onUpload()}
          >
            {busy ? "Uploading" : "Upload cover"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
