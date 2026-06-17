// Package store is Herald's Postgres access layer: the worker bookkeeping
// tables from LazyScan migration 023 (processed-events dedup, durable failure
// rows). Herald is a pure email projector — it never reads or writes the auth
// tables themselves.
package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store wraps the Postgres connection pool.
type Store struct {
	pool *pgxpool.Pool
}

// Open connects the pool and verifies the connection.
func Open(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Close releases the pool.
func (s *Store) Close() {
	s.pool.Close()
}

// Failure is a durable poison/non-retryable failure record. EventID and
// UserID are nil when the envelope never parsed. RawEvent keeps the raw
// stream message for poison diagnosis (it may contain the plaintext code —
// same exposure window as outbox_events.payload).
type Failure struct {
	EventID      *string
	UserID       *string
	ErrorMessage string
	RawEvent     string
	Retryable    bool
}

// IsProcessed reports whether the event was already fully handled
// (delivery dedup by eventId).
func (s *Store) IsProcessed(ctx context.Context, eventID string) (bool, error) {
	var one int
	err := s.pool.QueryRow(ctx,
		`SELECT 1 FROM herald_processed_events WHERE event_id = $1`,
		eventID,
	).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("check processed event %s: %w", eventID, err)
	}
	return true, nil
}

// MarkProcessed records the durable outcome for an event. Duplicate inserts
// are a no-op conflict (PK on event_id) — at-least-once delivery absorbs.
func (s *Store) MarkProcessed(ctx context.Context, eventID, eventType string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO herald_processed_events (event_id, event_type)
		 VALUES ($1, $2)
		 ON CONFLICT (event_id) DO NOTHING`,
		eventID, eventType,
	)
	if err != nil {
		return fmt.Errorf("mark event %s processed: %w", eventID, err)
	}
	return nil
}

// RecordFailure inserts a durable failure row (herald_failures), keeping the
// raw stream message for poison diagnosis.
func (s *Store) RecordFailure(ctx context.Context, f Failure) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO herald_failures (event_id, user_id, error_message, raw_event, retryable)
		 VALUES ($1, $2, $3, $4, $5)`,
		f.EventID, f.UserID, f.ErrorMessage, f.RawEvent, f.Retryable,
	)
	if err != nil {
		return fmt.Errorf("record failure: %w", err)
	}
	return nil
}
