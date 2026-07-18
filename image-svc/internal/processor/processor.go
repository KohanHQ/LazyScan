// Package processor runs the per-message pipeline: parse -> dedup -> load
// page row -> download original -> convert -> upload -> page ready +
// aggregate refresh -> record processed event. Failure taxonomy and
// idempotency rules: event-contract.md.
package processor

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/KohanHQ/lazyscan/image-svc/internal/convert"
	"github.com/KohanHQ/lazyscan/image-svc/internal/storage"
	"github.com/KohanHQ/lazyscan/image-svc/internal/store"
)

// EventTypeProcessingRequested is the only event type Kiln handles in v1.
const EventTypeProcessingRequested = "chapter.page.processing_requested"

// Store is the narrow Postgres surface the handler needs (fakeable in tests).
type Store interface {
	IsProcessed(ctx context.Context, eventID string) (bool, error)
	MarkProcessed(ctx context.Context, eventID, eventType string) error
	LoadPage(ctx context.Context, pageID string) (store.Page, error)
	MarkPageProcessing(ctx context.Context, pageID string) error
	MarkPageReady(ctx context.Context, pageID, importID, imageURL string, width, height, sizeBytes int) error
	MarkPageFailed(ctx context.Context, pageID, importID, errorMessage string) error
	RecordFailure(ctx context.Context, f store.Failure) error
}

// ObjectStore is the storage surface: download the original, upload the
// converted page (deterministic key from the row — overwrite-safe retries).
type ObjectStore interface {
	Download(ctx context.Context, key string) ([]byte, error)
	Upload(ctx context.Context, key string, data []byte, contentType, sourceKey string) error
}

// Converter runs the reader image profile.
type Converter interface {
	Convert(input []byte, opt convert.Options) (convert.Result, error)
}

// Outcome tells the consumer what to do with the stream entry. The zero value
// is deliberately OutcomeRetryable: a code path that forgets to decide leaves
// the message pending (safe) instead of acking work that never happened.
type Outcome int

const (
	// OutcomeRetryable leaves the entry pending — no ack; redelivery or
	// reclaim retries it (failure taxonomy: retryable).
	OutcomeRetryable Outcome = iota
	// OutcomeAck means a durable outcome exists in Postgres; the consumer
	// must XACK (ack-after-durable-outcome).
	OutcomeAck
)

// Handler decides the outcome of one chapter-page event.
type Handler struct {
	store        Store
	objects      ObjectStore
	convert      Converter
	publicDomain string // image_url = publicDomain + "/" + storage_key
	log          *slog.Logger
}

// New builds a Handler. publicDomain is the browser-reachable base URL for
// final objects (trailing slash trimmed).
func New(st Store, objects ObjectStore, conv Converter, publicDomain string, log *slog.Logger) *Handler {
	return &Handler{
		store:        st,
		objects:      objects,
		convert:      conv,
		publicDomain: strings.TrimRight(publicDomain, "/"),
		log:          log,
	}
}

// Handle processes one raw envelope (the stream entry's `event` field value).
// It returns OutcomeAck only after the durable outcome is recorded.
func (h *Handler) Handle(ctx context.Context, raw string) (Outcome, error) {
	env, pl, err := parseEnvelope(raw)
	if err != nil {
		// Unparseable is poison, but below the delivery threshold the entry
		// just stays pending — the reclaim path acks it with a failure row
		// once deliveries reach the max (HandlePoison).
		h.log.Warn("unparseable envelope, leaving pending for poison threshold", "error", err)
		return OutcomeRetryable, nil
	}

	if env.SchemaVersion != 1 {
		// Contract violation, non-retryable: redelivery cannot change the
		// version. Durable failure row, then ack. Not marked processed — the
		// event was rejected, not handled.
		err := h.store.RecordFailure(ctx, store.Failure{
			EventID:      &env.EventID,
			PageID:       uuidOrNil(pl.PageID),
			ErrorMessage: fmt.Sprintf("unsupported schemaVersion %d", env.SchemaVersion),
			RawEvent:     raw,
			Retryable:    false,
		})
		if err != nil {
			h.log.Error("record schemaVersion failure", "eventId", env.EventID, "error", err)
			return OutcomeRetryable, err
		}
		h.log.Warn("rejected event: unsupported schemaVersion",
			"eventId", env.EventID, "schemaVersion", env.SchemaVersion)
		return OutcomeAck, nil
	}

	if env.EventType != EventTypeProcessingRequested {
		// Forward-compat: the stream may carry new event types before Kiln
		// learns them (consumers dispatch on eventType). Record processed so
		// redelivery no-ops; no failure row — this is not an error.
		if err := h.store.MarkProcessed(ctx, env.EventID, env.EventType); err != nil {
			return OutcomeRetryable, err
		}
		h.log.Warn("ignoring unknown eventType", "eventId", env.EventID, "eventType", env.EventType)
		return OutcomeAck, nil
	}

	log := h.log.With("eventId", env.EventID, "pageId", pl.PageID, "importId", pl.ImportID)

	done, err := h.store.IsProcessed(ctx, env.EventID)
	if err != nil {
		return OutcomeRetryable, err
	}
	if done {
		log.Info("duplicate delivery, already processed")
		return OutcomeAck, nil
	}

	page, err := h.store.LoadPage(ctx, pl.PageID)
	if errors.Is(err, store.ErrPageNotFound) {
		// Stale event for a deleted aggregate — not a processing failure.
		if err := h.store.MarkProcessed(ctx, env.EventID, env.EventType); err != nil {
			return OutcomeRetryable, err
		}
		log.Warn("page row missing, recording processed and skipping")
		return OutcomeAck, nil
	}
	if err != nil {
		return OutcomeRetryable, err
	}

	if page.Status == "ready" {
		// `ready` is terminal — reprocessing is a no-op (known-constraints.md).
		if err := h.store.MarkProcessed(ctx, env.EventID, env.EventType); err != nil {
			return OutcomeRetryable, err
		}
		log.Info("page already ready, terminal no-op")
		return OutcomeAck, nil
	}

	// Re-assert `processing` and clear a stale error — unconditional, so a
	// previously failed page retries cleanly.
	if err := h.store.MarkPageProcessing(ctx, page.ID); err != nil {
		return OutcomeRetryable, err
	}

	original, err := h.objects.Download(ctx, page.OriginalKey)
	if errors.Is(err, storage.ErrObjectNotFound) {
		// Original gone after the verification window — non-retryable.
		return h.failPage(ctx, env, page, raw, err, log)
	}
	if err != nil {
		return OutcomeRetryable, err // transient storage failure
	}

	result, err := h.convert.Convert(original, convert.Default())
	if errors.Is(err, convert.ErrUnprocessable) {
		// Unsupported format, over the size limit, corrupt — deterministic
		// for this input, so non-retryable.
		return h.failPage(ctx, env, page, raw, err, log)
	}
	if err != nil {
		return OutcomeRetryable, err
	}

	if err := h.objects.Upload(ctx, page.StorageKey, result.WebP, "image/webp", page.OriginalKey); err != nil {
		return OutcomeRetryable, err // retried upload overwrites the same key
	}

	imageURL := h.publicDomain + "/" + page.StorageKey
	if err := h.store.MarkPageReady(ctx, page.ID, page.ImportID, imageURL, result.Width, result.Height, len(result.WebP)); err != nil {
		return OutcomeRetryable, err
	}
	log.Info("page processed",
		"pageNumber", page.PageNumber,
		"storageKey", page.StorageKey,
		"width", result.Width,
		"height", result.Height,
		"sizeBytes", len(result.WebP),
	)

	if err := h.store.MarkProcessed(ctx, env.EventID, env.EventType); err != nil {
		return OutcomeRetryable, err
	}
	return OutcomeAck, nil
}

// failPage records the durable non-retryable outcome (failure taxonomy):
// page `failed` + error message + aggregate refresh, a failure row, and the
// processed-events row — the event was handled, its outcome is failure, so
// duplicate deliveries dedup instead of re-failing. Any error here leaves
// the entry pending; every step is idempotent on redelivery.
func (h *Handler) failPage(ctx context.Context, env Envelope, page store.Page, raw string, cause error, log *slog.Logger) (Outcome, error) {
	if err := h.store.MarkPageFailed(ctx, page.ID, page.ImportID, cause.Error()); err != nil {
		return OutcomeRetryable, err
	}
	err := h.store.RecordFailure(ctx, store.Failure{
		EventID:      &env.EventID,
		PageID:       &page.ID,
		ErrorMessage: cause.Error(),
		RawEvent:     raw,
		Retryable:    false,
	})
	if err != nil {
		return OutcomeRetryable, err
	}
	if err := h.store.MarkProcessed(ctx, env.EventID, env.EventType); err != nil {
		return OutcomeRetryable, err
	}
	log.Warn("page failed, non-retryable", "error", cause)
	return OutcomeAck, nil
}

// HandlePoison records the durable failure for an entry whose delivery count
// reached the max (contract §Poison messages): failure row with the raw
// message, page marked `failed` when the envelope parsed well enough to
// know it, then ack.
func (h *Handler) HandlePoison(ctx context.Context, raw string, deliveries int64) (Outcome, error) {
	env, pl, parseErr := parseEnvelope(raw)

	msg := fmt.Sprintf("max deliveries reached (%d)", deliveries)
	if parseErr != nil {
		msg = fmt.Sprintf("%s: %v", msg, parseErr)
	}

	if parseErr == nil {
		// Success-then-lost-ack: the outcome is already durable — never fail
		// a page whose event was fully handled.
		done, err := h.store.IsProcessed(ctx, env.EventID)
		if err != nil {
			return OutcomeRetryable, err
		}
		if done {
			h.log.Info("poison threshold on already-processed event, acking",
				"eventId", env.EventID, "deliveries", deliveries)
			return OutcomeAck, nil
		}
	}

	// Contract step 2: mark the page failed if the envelope parsed well
	// enough to know it. `ready` stays terminal even here.
	if parseErr == nil && isUUID(pl.PageID) {
		page, err := h.store.LoadPage(ctx, pl.PageID)
		switch {
		case errors.Is(err, store.ErrPageNotFound):
			// stale event; nothing to mark
		case err != nil:
			return OutcomeRetryable, err
		case page.Status != "ready":
			if err := h.store.MarkPageFailed(ctx, page.ID, page.ImportID, msg); err != nil {
				return OutcomeRetryable, err
			}
		}
	}

	failure := store.Failure{
		EventID:      uuidOrNil(env.EventID),
		PageID:       uuidOrNil(pl.PageID),
		ErrorMessage: msg,
		RawEvent:     raw,
		Retryable:    false,
	}
	if err := h.store.RecordFailure(ctx, failure); err != nil {
		h.log.Error("record poison failure", "error", err)
		return OutcomeRetryable, err
	}
	if parseErr == nil {
		// Resolved by poisoning — dedup absorbs any straggler redelivery.
		if err := h.store.MarkProcessed(ctx, env.EventID, env.EventType); err != nil {
			return OutcomeRetryable, err
		}
	}
	h.log.Warn("poison message recorded, acked",
		"eventId", env.EventID, "pageId", pl.PageID, "deliveries", deliveries)
	return OutcomeAck, nil
}

// uuidOrNil maps anything that is not a canonical UUID to NULL — the audit
// columns are UUID-typed, and a failure row must never fail to insert because
// the poison input was garbage.
func uuidOrNil(s string) *string {
	if !isUUID(s) {
		return nil
	}
	return &s
}
