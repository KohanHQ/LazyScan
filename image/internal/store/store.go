// Package store is the image service's Postgres access layer: page reads, page status
// writes with derived aggregate refresh, and the worker bookkeeping tables
// from LazyScan migration 022 (processed-events dedup, durable failure rows).
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

// Page is the chapter_pages subset the image service reads. Keys are precomputed at import
// creation and read from the row — never recomputed (known-constraints.md).
type Page struct {
	ID          string
	ImportID    string
	ChapterID   string
	PageNumber  int
	OriginalKey string
	StorageKey  string
	Status      string
}

// Failure is a durable poison/non-retryable failure record. EventID and
// PageID are nil when the envelope never parsed.
type Failure struct {
	EventID      *string
	PageID       *string
	ErrorMessage string
	RawEvent     string
	Retryable    bool
}

// IsProcessed reports whether the event was already fully handled
// (delivery dedup by eventId).
func (s *Store) IsProcessed(ctx context.Context, eventID string) (bool, error) {
	var one int
	err := s.pool.QueryRow(ctx,
		`SELECT 1 FROM chapter_worker_processed_events WHERE event_id = $1`,
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
		`INSERT INTO chapter_worker_processed_events (event_id, event_type)
		 VALUES ($1, $2)
		 ON CONFLICT (event_id) DO NOTHING`,
		eventID, eventType,
	)
	if err != nil {
		return fmt.Errorf("mark event %s processed: %w", eventID, err)
	}
	return nil
}

// LoadPage fetches the page row by id. Returns ErrPageNotFound when the row
// no longer exists (stale event for a deleted aggregate).
func (s *Store) LoadPage(ctx context.Context, pageID string) (Page, error) {
	var p Page
	err := s.pool.QueryRow(ctx,
		`SELECT id, import_id, chapter_id, page_number, original_key, storage_key, status
		 FROM chapter_pages WHERE id = $1`,
		pageID,
	).Scan(&p.ID, &p.ImportID, &p.ChapterID, &p.PageNumber, &p.OriginalKey, &p.StorageKey, &p.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return Page{}, fmt.Errorf("page %s: %w", pageID, ErrPageNotFound)
	}
	if err != nil {
		return Page{}, fmt.Errorf("load page %s: %w", pageID, err)
	}
	return p, nil
}

// refreshImportProgressSQL recomputes import/chapter aggregates from page
// rows. Derived, never incremented: duplicate deliveries cannot double-count
// (event-contract.md §Idempotency).
const refreshImportProgressSQL = `
	WITH counts AS (
	  SELECT
	    ci.id,
	    ci.total_files,
	    count(*) FILTER (WHERE cp.status = 'ready')::int AS ready_count,
	    count(*) FILTER (WHERE cp.status = 'failed')::int AS failed_count
	  FROM chapter_imports ci
	  JOIN chapter_pages cp ON cp.chapter_id = ci.chapter_id
	  WHERE ci.id = $1
	  GROUP BY ci.id, ci.total_files
	),
	updated_import AS (
	  UPDATE chapter_imports ci
	  SET
	    processed_files = counts.ready_count,
	    failed_files = counts.failed_count,
	    status = CASE
	      WHEN counts.failed_count > 0 AND counts.ready_count + counts.failed_count >= counts.total_files THEN 'failed'
	      WHEN counts.ready_count >= counts.total_files THEN 'completed'
	      ELSE 'processing'
	    END,
	    updated_at = now()
	  FROM counts
	  WHERE ci.id = counts.id
	  RETURNING ci.chapter_id, ci.status
	)
	UPDATE chapters c
	SET
	  status = CASE
	    WHEN updated_import.status = 'completed' THEN 'ready'
	    WHEN updated_import.status = 'failed' THEN 'failed'
	    ELSE 'processing'
	  END,
	  updated_at = now()
	FROM updated_import
	WHERE c.id = updated_import.chapter_id`

// MarkPageProcessing re-asserts `processing` and clears a stale error before
// work starts — unconditional, so a previously failed page retries cleanly.
func (s *Store) MarkPageProcessing(ctx context.Context, pageID string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE chapter_pages
		 SET status = 'processing', error_message = NULL, updated_at = now()
		 WHERE id = $1`,
		pageID,
	)
	if err != nil {
		return fmt.Errorf("mark page %s processing: %w", pageID, err)
	}
	return nil
}

// MarkPageReady records the durable success outcome: page -> `ready` with its
// final dimensions/URL, then aggregate refresh — one transaction. Two separate
// statements would leave a crash window with the page ready but aggregates
// stale forever (the ready-terminal no-op on redelivery never refreshes).
func (s *Store) MarkPageReady(ctx context.Context, pageID, importID, imageURL string, width, height, sizeBytes int) error {
	return s.withPageWriteTx(ctx, importID, "mark page "+pageID+" ready", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`UPDATE chapter_pages
			 SET status = 'ready', image_url = $2, width = $3, height = $4,
			     size_bytes = $5, error_message = NULL, updated_at = now()
			 WHERE id = $1`,
			pageID, imageURL, width, height, sizeBytes,
		)
		return err
	})
}

// MarkPageFailed records the durable failure outcome: page -> `failed` with
// its error message, then aggregate refresh — one transaction.
func (s *Store) MarkPageFailed(ctx context.Context, pageID, importID, errorMessage string) error {
	return s.withPageWriteTx(ctx, importID, "mark page "+pageID+" failed", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`UPDATE chapter_pages
			 SET status = 'failed', error_message = $2, updated_at = now()
			 WHERE id = $1`,
			pageID, errorMessage,
		)
		return err
	})
}

// withPageWriteTx wraps a page status write and the aggregate refresh in one
// transaction. The refresh no-ops harmlessly when the import row is gone.
//
// The import row is locked first: concurrent writes for pages of the same
// import would otherwise compute refresh counts from snapshots that miss
// each other's uncommitted page, and the later commit would store stale
// aggregates — permanently, since `ready` is terminal and nothing refreshes
// again. Lock order is consistent everywhere (import -> page -> chapter),
// so concurrent workers cannot deadlock.
func (s *Store) withPageWriteTx(ctx context.Context, importID, what string, write func(pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("%s: begin: %w", what, err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op

	if _, err := tx.Exec(ctx,
		`SELECT 1 FROM chapter_imports WHERE id = $1 FOR UPDATE`, importID,
	); err != nil {
		return fmt.Errorf("%s: lock import %s: %w", what, importID, err)
	}

	if err := write(tx); err != nil {
		return fmt.Errorf("%s: %w", what, err)
	}
	if _, err := tx.Exec(ctx, refreshImportProgressSQL, importID); err != nil {
		return fmt.Errorf("%s: refresh import %s progress: %w", what, importID, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("%s: commit: %w", what, err)
	}
	return nil
}

// RecordFailure inserts a durable failure row (chapter_worker_failures),
// keeping the raw stream message for poison diagnosis.
func (s *Store) RecordFailure(ctx context.Context, f Failure) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO chapter_worker_failures (event_id, page_id, error_message, raw_event, retryable)
		 VALUES ($1, $2, $3, $4, $5)`,
		f.EventID, f.PageID, f.ErrorMessage, f.RawEvent, f.Retryable,
	)
	if err != nil {
		return fmt.Errorf("record failure: %w", err)
	}
	return nil
}
