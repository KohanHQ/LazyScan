import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { apiRequest } from "@/api/client";
import {
  completeChapterUpload,
  createChapterUpload,
  getChapterUpload,
  putToPresignedUrl,
  retryChapterUpload,
} from "@/api/chapter";
import type {
  ChapterImportDetail,
  ChapterPage,
  ChapterUploadTarget,
  CreateChapterUploadResponse,
} from "@/api/chapter";
import { getManga } from "@/api/manga";
import { PageHeading } from "@/components/page-heading";
import { RequireSession } from "@/components/require-session";
import { ErrorState, Loading } from "@/components/states";
import { cbzSupported, extractCbz, isArchiveFile } from "@/utils/cbz";
import { validateChapterNumbers } from "@/utils/validation";
import { navigateTo } from "@/router";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 300;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
// Progress poll backs off: responsive early, then ramps toward the cap so a long
// conversion doesn't hammer the status endpoint.
const POLL_INTERVAL_START_MS = 2000;
const POLL_INTERVAL_MAX_MS = 10000;
const POLL_BACKOFF_FACTOR = 1.5;
const MAX_POLL_FAILURES = 3;

export function ChapterUploadPage({ id }: { id: string }): ReactElement {
  return (
    <RequireSession loginMessage="Log in to upload chapters.">
      {() => <ChapterUploadFlow mangaId={id} />}
    </RequireSession>
  );
}

type Phase =
  | { kind: "form" }
  | {
      kind: "uploading";
      created: CreateChapterUploadResponse;
      files: File[];
      holdAsDraft: boolean;
    }
  | { kind: "processing"; uploadId: string };

function ChapterUploadFlow({ mangaId }: { mangaId: string }): ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  if (phase.kind === "uploading") {
    return (
      <UploadingPhase
        mangaId={mangaId}
        created={phase.created}
        files={phase.files}
        holdAsDraft={phase.holdAsDraft}
        onComplete={(uploadId) => setPhase({ kind: "processing", uploadId })}
      />
    );
  }
  if (phase.kind === "processing") {
    return <ProcessingPhase mangaId={mangaId} uploadId={phase.uploadId} />;
  }
  return (
    <FormPhase
      mangaId={mangaId}
      onCreated={(created, files, holdAsDraft) =>
        setPhase({ kind: "uploading", created, files, holdAsDraft })
      }
    />
  );
}

// --- Form phase ---

function FormPhase({
  mangaId,
  onCreated,
}: {
  mangaId: string;
  onCreated: (
    created: CreateChapterUploadResponse,
    files: File[],
    holdAsDraft: boolean
  ) => void;
}): ReactElement {
  const [mangaTitle, setMangaTitle] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    getManga(mangaId)
      .then((manga) => {
        if (!ignore) {
          setMangaTitle(manga.title);
        }
      })
      .catch(() => {
        // Title is decorative; the upload routes still work without it.
        if (!ignore) {
          setMangaTitle("");
        }
      });
    return () => {
      ignore = true;
    };
  }, [mangaId]);

  if (mangaTitle === null) {
    return <Loading />;
  }
  return (
    <ChapterForm mangaId={mangaId} mangaTitle={mangaTitle} onCreated={onCreated} />
  );
}

function ChapterForm({
  mangaId,
  mangaTitle,
  onCreated,
}: {
  mangaId: string;
  mangaTitle: string;
  onCreated: (
    created: CreateChapterUploadResponse,
    files: File[],
    holdAsDraft: boolean
  ) => void;
}): ReactElement {
  // CBZ/ZIP is desktop-only (in-memory unzip); accept + hint adapt to the device.
  const archiveOk = cbzSupported();
  const accept = archiveOk
    ? "image/png,image/jpeg,image/webp,.cbz,.zip"
    : "image/png,image/jpeg,image/webp";
  const hint = archiveOk
    ? `PNG, JPEG, or WebP — or a CBZ/ZIP archive. Up to ${MAX_FILES} pages, 10MB each. Pages are ordered by filename.`
    : `PNG, JPEG, or WebP. Up to ${MAX_FILES} pages, 10MB each. Pages are ordered by filename.`;

  // Resolved at pick time (loose images, or a dropped CBZ/ZIP unzipped into its
  // pages); submit reads this, not the raw input FileList.
  const [selection, setSelection] = useState<File[]>([]);
  const [countLabel, setCountLabel] = useState("");
  const [dragover, setDragover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // CBZ extraction is async; while it runs, submit is disabled and this guards a
  // re-pick race — each pick bumps the counter so a superseded extraction's late
  // result can't land its stale pages against the newer selection.
  const [extracting, setExtracting] = useState(false);
  const pickSeqRef = useRef(0);

  // A single dropped CBZ/ZIP is unzipped into its image pages; anything else is
  // loose files. Archive errors / unsupported devices clear the pick.
  const onFilesChange = async (fileList: FileList | null): Promise<void> => {
    const mySeq = ++pickSeqRef.current;
    setError(null);
    const picked = fileList ? Array.from(fileList) : [];
    const archive = picked.find(isArchiveFile);

    if (!archive) {
      setExtracting(false);
      setSelection(picked);
      setCountLabel(pageCountLabel(picked.length));
      return;
    }
    if (picked.length > 1) {
      setExtracting(false);
      setSelection([]);
      setCountLabel("");
      setError(
        "Upload one CBZ/ZIP archive on its own, not mixed with other files."
      );
      return;
    }
    if (!cbzSupported()) {
      setExtracting(false);
      setSelection([]);
      setCountLabel("");
      setError("CBZ/ZIP import is desktop-only. Use individual page images here.");
      return;
    }
    // Clear any prior selection up front so a stale pick can't be submitted while
    // this archive is still unzipping (submit is also disabled via `extracting`).
    setExtracting(true);
    setSelection([]);
    setCountLabel("Reading archive…");
    try {
      const pages = await extractCbz(archive);
      // A newer pick superseded this extraction — drop its stale result.
      if (mySeq !== pickSeqRef.current) {
        return;
      }
      setSelection(pages);
      setCountLabel(`CBZ · ${pageCountLabel(pages.length)}`);
      setExtracting(false);
    } catch (extractError) {
      if (mySeq !== pickSeqRef.current) {
        return;
      }
      setSelection([]);
      setCountLabel("");
      setError(
        extractError instanceof Error
          ? extractError.message
          : "Could not read the archive."
      );
      setExtracting(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") || "").trim();
    const chapterNumberRaw = String(data.get("chapterNumber") || "").trim();
    const volumeRaw = String(data.get("volume") || "").trim();
    const sortOrderRaw = String(data.get("sortOrder") || "").trim();
    const holdAsDraft = data.get("holdAsDraft") === "on";

    // Required fields + page constraints, then the numeric-field backstop for the
    // suppressed native validation (form is noValidate).
    const validationError =
      validateSelection(title, selection) ??
      validateChapterNumbers(chapterNumberRaw, volumeRaw, sortOrderRaw);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setBusy(true);
    let created: CreateChapterUploadResponse;
    try {
      created = await createChapterUpload(mangaId, {
        title,
        ...(chapterNumberRaw ? { chapterNumber: Number(chapterNumberRaw) } : {}),
        ...(volumeRaw ? { volume: Number(volumeRaw) } : {}),
        ...(sortOrderRaw ? { sortOrder: Number(sortOrderRaw) } : {}),
        files: selection.map((file) => ({
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        })),
      });
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create chapter."
      );
      setBusy(false);
      return;
    }
    onCreated(created, selection, holdAsDraft);
  };

  return (
    <>
      <PageHeading
        eyebrow="Chapter upload"
        title={mangaTitle || "Upload chapter"}
      />
      <section className="manage-panel">
        <form className="manage-form" noValidate onSubmit={onSubmit}>
          <label>
            <span>Chapter title</span>
            <input name="title" type="text" required maxLength={500} />
          </label>
          <label>
            <span>Chapter number (optional)</span>
            <input name="chapterNumber" type="number" min={0} step="any" />
          </label>
          <label>
            <span>Volume (optional)</span>
            <input name="volume" type="number" min={0} step="any" />
          </label>
          <label>
            <span>Sort order (optional)</span>
            <input name="sortOrder" type="number" step={1} />
          </label>
          <label>
            <span>Page images</span>
            {/* The file input overlays the dropzone (opacity 0) so click-to-browse
                and native file drops both hit it; drag events only toggle the class. */}
            <div
              className={`dropzone${dragover ? " is-dragover" : ""}`}
              onDragEnter={() => setDragover(true)}
              onDragOver={() => setDragover(true)}
              onDragLeave={() => setDragover(false)}
              onDrop={() => setDragover(false)}
            >
              <input
                className="dropzone-input"
                name="files"
                type="file"
                accept={accept}
                multiple
                required
                onChange={(event) => void onFilesChange(event.target.files)}
              />
              <div className="dropzone-prompt">
                <strong>Drag &amp; drop pages here</strong>
                <span>or click to browse</span>
                <span className="dropzone-count" hidden={countLabel === ""}>
                  {countLabel}
                </span>
              </div>
            </div>
            <small>{hint}</small>
          </label>
          <label className="manage-checkbox">
            <input name="holdAsDraft" type="checkbox" />
            <span>
              Save as draft — review and reorder pages before publishing (readers
              won&apos;t see it until you publish)
            </span>
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="manage-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={busy || extracting}
            >
              {busy ? "Creating" : "Start upload"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                navigateTo(`/manage/manga/${encodeURIComponent(mangaId)}`)
              }
            >
              Back
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

// --- Uploading phase ---

type PageStatus = {
  state: "pending" | "uploading" | "ready" | "failed";
  label: string;
};

type UploadOutcome =
  | { kind: "uploading" }
  | { kind: "failed"; failed: ChapterUploadTarget[] }
  | { kind: "error"; message: string };

function UploadingPhase({
  mangaId,
  created,
  files,
  holdAsDraft,
  onComplete,
}: {
  mangaId: string;
  created: CreateChapterUploadResponse;
  files: File[];
  holdAsDraft: boolean;
  onComplete: (uploadId: string) => void;
}): ReactElement {
  const uploadId = created.import.id;

  const [run, setRun] = useState<{
    targets: ChapterUploadTarget[];
    token: number;
  }>(() => ({
    targets: [...created.uploads].sort((a, b) => a.pageNumber - b.pageNumber),
    token: 0,
  }));
  const [statuses, setStatuses] = useState<Record<string, PageStatus>>(() => {
    const initial: Record<string, PageStatus> = {};
    for (const target of created.uploads) {
      initial[target.pageId] = { state: "pending", label: "Pending" };
    }
    return initial;
  });
  const [outcome, setOutcome] = useState<UploadOutcome>({ kind: "uploading" });

  useEffect(() => {
    let cancelled = false;
    const pick = buildFilePicker(files);
    const failed: ChapterUploadTarget[] = [];

    const setStatus = (pageId: string, status: PageStatus): void =>
      setStatuses((prev) => ({ ...prev, [pageId]: status }));

    // Presigned URLs are issued once at create time and can expire before a large
    // serial batch reaches its later pages. On the first expiry-shaped 403, switch
    // the rest of the batch to the API proxy route (no signed URL, fresh auth per
    // request) — a one-time switch that also retries the page that hit expiry.
    let useApiFallback = false;

    void (async () => {
      for (const target of run.targets) {
        if (cancelled) {
          return;
        }
        setStatus(target.pageId, { state: "uploading", label: "Uploading" });
        const file = pick(target.filename);
        if (!file) {
          setStatus(target.pageId, { state: "failed", label: "Missing file" });
          failed.push(target);
          continue;
        }
        try {
          if (useApiFallback) {
            await uploadPageViaApi(mangaId, uploadId, target.pageId, file);
          } else {
            await putToPresignedUrl(target.uploadUrl, file);
          }
          if (cancelled) {
            return;
          }
          setStatus(target.pageId, { state: "ready", label: "Uploaded" });
        } catch (uploadError) {
          if (cancelled) {
            return;
          }
          const status = (uploadError as { status?: number }).status;
          if (!useApiFallback && status === 403) {
            // Expired presigned URL: switch remaining pages to the proxy and
            // retry this one via it. If the proxy also fails, fall through to the
            // normal failed-page handling (surfaced by the retry UI below).
            useApiFallback = true;
            try {
              await uploadPageViaApi(mangaId, uploadId, target.pageId, file);
              if (cancelled) {
                return;
              }
              setStatus(target.pageId, { state: "ready", label: "Uploaded" });
              continue;
            } catch (proxyError) {
              if (cancelled) {
                return;
              }
              setStatus(target.pageId, {
                state: "failed",
                label:
                  proxyError instanceof Error ? proxyError.message : "Upload failed",
              });
              failed.push(target);
              continue;
            }
          }
          setStatus(target.pageId, {
            state: "failed",
            label:
              uploadError instanceof Error ? uploadError.message : "Upload failed",
          });
          failed.push(target);
        }
      }
      if (cancelled) {
        return;
      }
      if (failed.length > 0) {
        setOutcome({ kind: "failed", failed });
        return;
      }
      try {
        await completeChapterUpload(mangaId, uploadId, { holdAsDraft });
      } catch (completeError) {
        if (cancelled) {
          return;
        }
        setOutcome({
          kind: "error",
          message:
            completeError instanceof Error
              ? completeError.message
              : "Unable to start processing.",
        });
        return;
      }
      if (cancelled) {
        return;
      }
      onComplete(uploadId);
    })();

    // Unmounting (navigating away) cancels between PUTs; retry re-runs this
    // effect for only the failed targets against the same URLs (valid ~15 min).
    return () => {
      cancelled = true;
    };
  }, [run]);

  if (outcome.kind === "error") {
    return <ErrorState message={outcome.message} />;
  }

  const back = (): void =>
    navigateTo(`/manage/manga/${encodeURIComponent(mangaId)}`);

  return (
    <>
      <PageHeading eyebrow="Chapter upload" title="Uploading pages" />
      <section className="manage-panel">
        <p className="upload-hint">
          Uploading {run.targets.length} pages to storage. Keep this tab open.
        </p>
        <ol className="upload-list">
          {run.targets.map((target) => {
            const status = statuses[target.pageId] ?? {
              state: "pending",
              label: "Pending",
            };
            return (
              <li className="upload-row" key={target.pageId}>
                <span className="upload-name">
                  {`${target.pageNumber.toString().padStart(3, "0")} · ${target.filename}`}
                </span>
                <span className={`upload-status upload-status-${status.state}`}>
                  {status.label}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="manage-actions">
          <button className="secondary-button" type="button" onClick={back}>
            Back to manga
          </button>
        </div>
      </section>
      {outcome.kind === "failed" ? (
        <section className="manage-panel upload-retry">
          <p className="form-error">
            {`${outcome.failed.length} page(s) failed to upload.`}
          </p>
          <div className="manage-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                const failed = outcome.failed;
                setStatuses((prev) => {
                  const next = { ...prev };
                  for (const target of failed) {
                    next[target.pageId] = { state: "pending", label: "Pending" };
                  }
                  return next;
                });
                setOutcome({ kind: "uploading" });
                setRun((prev) => ({ targets: failed, token: prev.token + 1 }));
              }}
            >
              Retry failed uploads
            </button>
            <button className="secondary-button" type="button" onClick={back}>
              Back to manga
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}

// --- Processing phase ---

type ProcState =
  | { kind: "polling"; detail: ChapterImportDetail | null }
  | { kind: "error"; message: string };

function ProcessingPhase({
  mangaId,
  uploadId,
}: {
  mangaId: string;
  uploadId: string;
}): ReactElement {
  const [state, setState] = useState<ProcState>({
    kind: "polling",
    detail: null,
  });
  // Retry bumps pollToken to restart polling; the effect cleanup clears the
  // prior timer first so two pollers never tick the same view.
  const [pollToken, setPollToken] = useState(0);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    let timeoutId: number | null = null;
    let cancelled = false;
    let consecutiveFailures = 0;
    let delay = POLL_INTERVAL_START_MS;

    const scheduleNext = (): void => {
      timeoutId = window.setTimeout(() => void tick(), delay);
      delay = Math.min(
        Math.round(delay * POLL_BACKOFF_FACTOR),
        POLL_INTERVAL_MAX_MS
      );
    };

    const tick = async (): Promise<void> => {
      if (cancelled) {
        return;
      }
      let detail: ChapterImportDetail;
      try {
        detail = await getChapterUpload(mangaId, uploadId);
        consecutiveFailures = 0;
      } catch {
        // A single read failure is transient; persistent ones (deleted import,
        // expired auth, sustained 404) would poll forever, so stop after a few.
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_POLL_FAILURES) {
          if (!cancelled) {
            setState({
              kind: "error",
              message:
                "Lost contact with the server while processing. Refresh to check status.",
            });
          }
          return;
        }
        if (!cancelled) {
          scheduleNext();
        }
        return;
      }
      if (cancelled) {
        return;
      }
      setState({ kind: "polling", detail });
      if (
        detail.import.status === "completed" ||
        detail.import.status === "failed"
      ) {
        return;
      }
      scheduleNext();
    };

    void tick();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [mangaId, uploadId, pollToken]);

  if (state.kind === "error") {
    return <ErrorState message={state.message} />;
  }

  const detail = state.detail;
  const status = detail?.import.status ?? "processing";
  const total = detail?.import.totalFiles ?? 0;
  const processed = detail?.import.processedFiles ?? 0;
  const failed = detail?.import.failedFiles ?? 0;
  const pages = detail?.pages ?? [];
  // Retry is offered as soon as one page failed, not only on a terminal `failed`
  // import (it stays `processing` until every page settles); the route is idempotent.
  const canRetry = status === "failed" || failed > 0;

  const heading =
    status === "completed"
      ? "Chapter ready"
      : status === "failed"
        ? "Processing failed"
        : "Processing pages";

  const back = (): void =>
    navigateTo(`/manage/manga/${encodeURIComponent(mangaId)}`);

  const onRetry = async (): Promise<void> => {
    setRetryBusy(true);
    setRetryError(null);
    try {
      await retryChapterUpload(mangaId, uploadId);
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Retry failed.");
      setRetryBusy(false);
      return;
    }
    setState({ kind: "polling", detail: null });
    setRetryBusy(false);
    setPollToken((token) => token + 1);
  };

  return (
    <>
      <PageHeading eyebrow="Chapter upload" title={heading} />
      <section className="manage-panel">
        {retryError ? <p className="form-error">{retryError}</p> : null}
        <p className="upload-hint">
          {`Processed ${processed}/${total}${failed ? ` · ${failed} failed` : ""}`}
        </p>
        {detail?.import.errorMessage ? (
          <p className="form-error">{detail.import.errorMessage}</p>
        ) : null}
        {pages.length ? (
          <ol className="upload-list">
            {pages.map((page) => (
              <li className="upload-row" key={page.id}>
                <span className="upload-name">
                  {`${page.pageNumber.toString().padStart(3, "0")} · ${page.originalFilename}`}
                </span>
                <span
                  className={`upload-status upload-status-${pageStatusClass(page)}`}
                >
                  {pageStatusLabel(page)}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        <div className="manage-actions">
          {status === "completed" ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => navigateTo(`/manga/${encodeURIComponent(mangaId)}`)}
            >
              View manga
            </button>
          ) : null}
          {canRetry ? (
            <button
              className="primary-button"
              type="button"
              disabled={retryBusy}
              onClick={() => void onRetry()}
            >
              {retryBusy ? "Retrying" : "Retry processing"}
            </button>
          ) : null}
          <button className="secondary-button" type="button" onClick={back}>
            Back to manga
          </button>
        </div>
      </section>
    </>
  );
}

// --- Helpers ---

function pageCountLabel(count: number): string {
  if (count === 0) {
    return "";
  }
  return count === 1 ? "1 file selected" : `${count} files selected`;
}

function validateSelection(title: string, files: File[]): string | null {
  if (!title) {
    return "Chapter title is required.";
  }
  if (files.length === 0) {
    return "Select at least one page image.";
  }
  if (files.length > MAX_FILES) {
    return `Too many pages. Maximum is ${MAX_FILES}.`;
  }
  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `Unsupported file type for "${file.name}". Use PNG, JPEG, or WebP.`;
    }
    if (file.size > MAX_BYTES) {
      return `"${file.name}" exceeds the 10MB per-page limit.`;
    }
  }
  return null;
}

// Fallback for when presigned URLs expire mid-batch: stream the page
// through the existing API proxy route, which re-authenticates per request and
// has no signed-URL expiry. No server change — this route already exists.
async function uploadPageViaApi(
  mangaId: string,
  uploadId: string,
  pageId: string,
  file: File
): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  await apiRequest(
    `/manga/${encodeURIComponent(mangaId)}/chapter/uploads/${encodeURIComponent(uploadId)}/pages/${encodeURIComponent(pageId)}/upload`,
    { method: "POST", body: form }
  );
}

// Maps upload targets back to picked files by filename (the API natural-sorts and
// assigns page numbers); duplicate names are consumed in pick order.
function buildFilePicker(files: File[]): (filename: string) => File | undefined {
  const byName = new Map<string, File[]>();
  for (const file of files) {
    const bucket = byName.get(file.name) ?? [];
    bucket.push(file);
    byName.set(file.name, bucket);
  }
  return (filename: string) => byName.get(filename)?.shift();
}

function pageStatusClass(page: ChapterPage): string {
  switch (page.status) {
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    case "processing":
      return "uploading";
    default:
      return "pending";
  }
}

function pageStatusLabel(page: ChapterPage): string {
  switch (page.status) {
    case "ready":
      return "Ready";
    case "failed":
      return page.errorMessage ? `Failed: ${page.errorMessage}` : "Failed";
    case "processing":
      return "Processing";
    default:
      return "Waiting";
  }
}
