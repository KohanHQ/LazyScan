// Package processor runs the per-message pipeline: parse -> schemaVersion
// check -> dedup -> send -> record processed event. Outcome matrix and
// idempotency rules: event-contract.md. The verification code is never
// logged at any step.
package processor

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/KohanHQ/lazyscan/mail/internal/mailer"
	"github.com/KohanHQ/lazyscan/mail/internal/store"
)

// EventTypeVerificationRequested is the only event type the mail service handles in v1.
const EventTypeVerificationRequested = "auth.email.verification_requested"

// Store is the narrow Postgres surface the handler needs (fakeable in tests).
type Store interface {
	IsProcessed(ctx context.Context, eventID string) (bool, error)
	MarkProcessed(ctx context.Context, eventID, eventType string) error
	RecordFailure(ctx context.Context, f store.Failure) error
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

// Handler decides the outcome of one email event.
type Handler struct {
	store Store
	mail  mailer.Mailer
	log   *slog.Logger
}

// New builds a Handler.
func New(st Store, m mailer.Mailer, log *slog.Logger) *Handler {
	return &Handler{store: st, mail: m, log: log}
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
			UserID:       uuidOrNil(pl.UserID),
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

	if env.EventType != EventTypeVerificationRequested {
		// Forward-compat: the stream may carry new auth.email.* event types
		// before the mail service learns them (consumers dispatch on eventType). Record
		// processed so redelivery no-ops; no failure row — this is not an
		// error.
		if err := h.store.MarkProcessed(ctx, env.EventID, env.EventType); err != nil {
			return OutcomeRetryable, err
		}
		h.log.Warn("ignoring unknown eventType", "eventId", env.EventID, "eventType", env.EventType)
		return OutcomeAck, nil
	}

	log := h.log.With("eventId", env.EventID, "userId", pl.UserID)

	done, err := h.store.IsProcessed(ctx, env.EventID)
	if err != nil {
		return OutcomeRetryable, err
	}
	if done {
		log.Info("duplicate delivery, already processed")
		return OutcomeAck, nil
	}

	if err := h.mail.SendVerificationCode(ctx, pl.Email, pl.Code, pl.ExpiresAt); err != nil {
		if errors.Is(err, mailer.ErrPermanent) {
			// SMTP permanently rejected the message — redelivery cannot fix
			// it. Failure row + processed row, then ack: the event was
			// handled, its outcome is failure (failure taxonomy).
			return h.failSend(ctx, env, pl, raw, err, log)
		}
		// Transient send failure: leave pending, redelivery retries.
		log.Warn("send failed, leaving pending", "error", err)
		return OutcomeRetryable, err
	}

	if err := h.store.MarkProcessed(ctx, env.EventID, env.EventType); err != nil {
		// Send succeeded but the dedup row didn't land — redelivery re-sends
		// (at-least-once; the user gets the same code twice, harmless).
		return OutcomeRetryable, err
	}
	log.Info("verification email handled", "email", pl.Email)
	return OutcomeAck, nil
}

// failSend records the durable non-retryable outcome: a failure row and the
// processed-events row — the event was handled, its outcome is failure, so
// duplicate deliveries dedup instead of re-failing. Any error here leaves the
// entry pending; every step is idempotent on redelivery.
func (h *Handler) failSend(ctx context.Context, env Envelope, pl Payload, raw string, cause error, log *slog.Logger) (Outcome, error) {
	err := h.store.RecordFailure(ctx, store.Failure{
		EventID:      &env.EventID,
		UserID:       uuidOrNil(pl.UserID),
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
	log.Warn("send failed, non-retryable", "error", cause)
	return OutcomeAck, nil
}

// HandlePoison records the durable failure for an entry whose delivery count
// reached the max (contract §Poison messages): failure row with the raw
// message, then ack.
func (h *Handler) HandlePoison(ctx context.Context, raw string, deliveries int64) (Outcome, error) {
	env, pl, parseErr := parseEnvelope(raw)

	msg := fmt.Sprintf("max deliveries reached (%d)", deliveries)
	if parseErr != nil {
		msg = fmt.Sprintf("%s: %v", msg, parseErr)
	}

	if parseErr == nil {
		// Success-then-lost-ack: the outcome is already durable — never
		// record a failure for an event that was fully handled.
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

	failure := store.Failure{
		EventID:      uuidOrNil(env.EventID),
		UserID:       uuidOrNil(pl.UserID),
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
		"eventId", env.EventID, "userId", pl.UserID, "deliveries", deliveries)
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
