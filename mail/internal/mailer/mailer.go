// Package mailer defines the email-sending seam: the SMTP implementation
// (go-mail, multipart plain-text + HTML template) wired in production, and
// the log-only Log stand-in kept as the SMTP rollback target. The
// verification code is never logged — anywhere, at any level.
package mailer

import (
	"context"
	"errors"
	"log/slog"
)

// ErrPermanent marks a send failure that redelivery cannot fix (e.g. the SMTP
// server permanently rejected the recipient). The processor records a failure
// row and acks; any other error leaves the entry pending for retry.
var ErrPermanent = errors.New("permanent send failure")

// Mailer sends one OTP email per auth.email.* event type. expiresAt is the
// payload's ISO-8601 expiry, rendered into the message body; implementations
// must never log or echo code outside the message itself.
type Mailer interface {
	SendVerificationCode(ctx context.Context, to, code, expiresAt string) error
	SendPasswordResetCode(ctx context.Context, to, code, expiresAt string) error
}

// Log is a log-only stand-in, kept as the rollback target for the SMTP
// mailer (revert the main.go wiring): it records that a send would have
// happened and succeeds. The code is deliberately dropped, not logged.
type Log struct {
	log *slog.Logger
}

// NewLog builds the log-only mailer.
func NewLog(log *slog.Logger) *Log {
	return &Log{log: log}
}

// SendVerificationCode logs the would-be delivery and reports success.
func (l *Log) SendVerificationCode(_ context.Context, to, _, expiresAt string) error {
	l.log.Info("would send verification email", "to", to, "expiresAt", expiresAt)
	return nil
}

// SendPasswordResetCode logs the would-be delivery and reports success.
func (l *Log) SendPasswordResetCode(_ context.Context, to, _, expiresAt string) error {
	l.log.Info("would send password reset email", "to", to, "expiresAt", expiresAt)
	return nil
}
