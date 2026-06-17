package processor

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Envelope is the auth.email.verification_requested v1 envelope
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

// Payload carries the full message to send — the one deliberate exception to
// the IDs-only envelope rule: Herald is a pure email projector with nothing
// to look up. Code must never appear in logs or error strings.
type Payload struct {
	UserID    string `json:"userId"`
	Email     string `json:"email"`
	Code      string `json:"code"`
	ExpiresAt string `json:"expiresAt"`
}

// parseEnvelope decodes and validates the raw `event` stream field. A non-nil
// error is always poison: the message can never parse on redelivery either,
// so the caller leaves it pending until the delivery threshold acks it with a
// failure row — never a crash. Error strings never include payload values.
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
	// Reject, never unwrap. No payload preview in the error (Kiln includes
	// one): these errors reach logs and herald_failures.error_message, and
	// the payload carries the plaintext code (findings.md §H4-004).
	trimmed := bytes.TrimSpace(env.Payload)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return env, Payload{}, fmt.Errorf("payload is not a JSON object")
	}

	var pl Payload
	if err := json.Unmarshal(env.Payload, &pl); err != nil {
		return env, pl, fmt.Errorf("malformed payload: %w", err)
	}
	if pl.Email == "" {
		return env, pl, fmt.Errorf("payload missing email")
	}
	if pl.Code == "" {
		return env, pl, fmt.Errorf("payload missing code")
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
