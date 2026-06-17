package processor

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Envelope is the chapter.page.processing_requested v1 envelope
// (event-contract.md). Unknown fields are ignored per contract; Payload stays
// raw so its shape can be validated before decoding (jsonb double-encode
// defense below).
type Envelope struct {
	EventID       string          `json:"eventId"`
	EventType     string          `json:"eventType"`
	SchemaVersion int             `json:"schemaVersion"`
	OccurredAt    string          `json:"occurredAt"`
	AggregateType string          `json:"aggregateType"`
	AggregateID   string          `json:"aggregateId"`
	Payload       json.RawMessage `json:"payload"`
}

// Payload carries IDs only — Kiln loads current state from Postgres at
// processing time (the event says "process this page", the database says
// what that means right now).
type Payload struct {
	ImportID  string `json:"importId"`
	ChapterID string `json:"chapterId"`
	PageID    string `json:"pageId"`
}

// parseEnvelope decodes and validates the raw `event` stream field. A non-nil
// error is always poison: the message can never parse on redelivery either,
// so the caller leaves it pending until the delivery threshold acks it with a
// failure row — never a crash.
func parseEnvelope(raw string) (Envelope, Payload, error) {
	var env Envelope
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		return Envelope{}, Payload{}, fmt.Errorf("malformed envelope JSON: %w", err)
	}
	if !isUUID(env.EventID) {
		return env, Payload{}, fmt.Errorf("eventId %q: not a UUID", env.EventID)
	}

	// Defensive: a payload that is a JSON string instead of an object is the
	// known double-encoded jsonb bug (JSON.stringify into a jsonb param).
	// Reject, never unwrap.
	trimmed := bytes.TrimSpace(env.Payload)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return env, Payload{}, fmt.Errorf("payload is not a JSON object (got %.20q)", trimmed)
	}

	var pl Payload
	if err := json.Unmarshal(env.Payload, &pl); err != nil {
		return env, Payload{}, fmt.Errorf("malformed payload: %w", err)
	}
	if pl.PageID == "" {
		return env, pl, fmt.Errorf("payload missing pageId")
	}
	return env, pl, nil
}

// isUUID checks the canonical 8-4-4-4-12 hex form (no dependency needed for
// one format check).
func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			isHex := (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
			if !isHex {
				return false
			}
		}
	}
	return true
}
