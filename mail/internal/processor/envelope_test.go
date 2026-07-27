package processor

import (
	"strings"
	"testing"
)

const (
	testEventID = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"
	testUserID  = "2c5f39cb-3fb2-22e3-994f-1127e4ddb538"
)

func validRaw() string {
	return `{
		"eventId": "` + testEventID + `",
		"eventType": "auth.email.verification_requested",
		"schemaVersion": 1,
		"occurredAt": "2026-06-05T10:00:00Z",
		"aggregateType": "user",
		"aggregateId": "` + testUserID + `",
		"payload": {
			"userId": "` + testUserID + `",
			"email": "person@example.com",
			"code": "482917",
			"expiresAt": "2026-06-05T10:10:00Z"
		}
	}`
}

func passwordResetRaw() string {
	return strings.Replace(validRaw(), EventTypeVerificationRequested,
		EventTypePasswordResetRequested, 1)
}

func TestParseEnvelopeValid(t *testing.T) {
	env, pl, err := parseEnvelope(validRaw())
	if err != nil {
		t.Fatalf("parseEnvelope: %v", err)
	}
	if env.EventID != testEventID {
		t.Errorf("EventID = %q", env.EventID)
	}
	if env.EventType != EventTypeVerificationRequested {
		t.Errorf("EventType = %q", env.EventType)
	}
	if env.SchemaVersion != 1 {
		t.Errorf("SchemaVersion = %d", env.SchemaVersion)
	}
	if pl.UserID != testUserID || pl.Email != "person@example.com" ||
		pl.Code != "482917" || pl.ExpiresAt != "2026-06-05T10:10:00Z" {
		t.Errorf("payload = %+v", pl)
	}
}

func TestParseEnvelopeIgnoresUnknownFields(t *testing.T) {
	raw := strings.Replace(validRaw(), `"schemaVersion": 1,`,
		`"schemaVersion": 1, "futureField": {"x": 1},`, 1)
	if _, _, err := parseEnvelope(raw); err != nil {
		t.Fatalf("parseEnvelope with unknown field: %v", err)
	}
}

func TestParseEnvelopeRejects(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{"garbage", "not json at all", "malformed envelope"},
		{"empty", "", "malformed envelope"},
		{"bad eventId", strings.Replace(validRaw(), testEventID, "not-a-uuid-but-36-characters-long!!", 1), "not a UUID"},
		{"double-encoded payload", `{"eventId":"` + testEventID + `","eventType":"auth.email.verification_requested","schemaVersion":1,"payload":"{\"email\":\"a@b.c\"}"}`, "not a JSON object"},
		{"missing payload", `{"eventId":"` + testEventID + `","eventType":"auth.email.verification_requested","schemaVersion":1}`, "not a JSON object"},
		{"payload array", `{"eventId":"` + testEventID + `","eventType":"auth.email.verification_requested","schemaVersion":1,"payload":[1]}`, "not a JSON object"},
		{"missing email", strings.Replace(validRaw(), `"email": "person@example.com",`, "", 1), "missing email"},
		{"missing code", strings.Replace(validRaw(), `"code": "482917",`, "", 1), "missing code"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := parseEnvelope(tt.raw)
			if err == nil {
				t.Fatal("parseEnvelope: want error, got nil")
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Errorf("error %q does not contain %q", err, tt.want)
			}
		})
	}
}

func TestParseErrorsNeverContainCode(t *testing.T) {
	// Reject-able envelopes that still carry the plaintext code: parse errors
	// surface in logs and mail_failures.error_message, so the code must
	// never ride along. The double-encoded case puts the code in the first
	// bytes of the payload — the exact spot a payload preview would expose
	// (findings.md §H4-004).
	raws := []string{
		strings.Replace(validRaw(), testEventID, "bad-uuid", 1),
		strings.Replace(validRaw(), `"email": "person@example.com",`, "", 1),
		`{"eventId":"` + testEventID + `","eventType":"auth.email.verification_requested","schemaVersion":1,"payload":"{\"code\":\"482917\"}"}`,
	}
	for _, raw := range raws {
		_, _, err := parseEnvelope(raw)
		if err == nil {
			t.Fatal("want error")
		}
		if strings.Contains(err.Error(), "482917") {
			t.Errorf("parse error leaks code: %q", err)
		}
	}
}

func TestIsUUID(t *testing.T) {
	if !isUUID(testEventID) {
		t.Error("canonical UUID rejected")
	}
	for _, s := range []string{"", "short", strings.Repeat("a", 36), testEventID + "x"} {
		if isUUID(s) {
			t.Errorf("isUUID(%q) = true", s)
		}
	}
}
