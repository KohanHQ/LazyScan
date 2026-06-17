package mailer

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/wneessen/go-mail"
)

// SMTPOptions configures the SMTP mailer (values from config: SMTP_*).
type SMTPOptions struct {
	Host     string
	Port     int
	From     string
	Username string // enables SMTP auth when non-empty
	Password string
	StartTLS bool // mandatory STARTTLS when true, plaintext when false (dev Mailpit)
}

// SMTP sends verification emails through go-mail. go-mail's debug logging is
// never enabled: it dumps the full SMTP conversation, message body — and the
// code — included.
type SMTP struct {
	client *mail.Client
	from   string
}

// NewSMTP builds the SMTP mailer. The client holds no connection until a send
// dials (DialAndSend per message), so construction validates options only.
func NewSMTP(opts SMTPOptions) (*SMTP, error) {
	policy := mail.NoTLS
	if opts.StartTLS {
		policy = mail.TLSMandatory
	}
	clientOpts := []mail.Option{
		mail.WithPort(opts.Port),
		mail.WithTLSPolicy(policy),
	}
	if opts.Username != "" {
		clientOpts = append(clientOpts,
			mail.WithSMTPAuth(mail.SMTPAuthAutoDiscover),
			mail.WithUsername(opts.Username),
			mail.WithPassword(opts.Password),
		)
	}
	client, err := mail.NewClient(opts.Host, clientOpts...)
	if err != nil {
		return nil, fmt.Errorf("smtp client: %w", err)
	}
	return &SMTP{client: client, from: opts.From}, nil
}

// SendVerificationCode dials, sends one message, and closes the connection.
// Errors are classified for the processor's retry taxonomy: ErrPermanent for
// failures redelivery cannot fix, plain errors for transient ones.
func (s *SMTP) SendVerificationCode(ctx context.Context, to, code, expiresAt string) error {
	msg := mail.NewMsg()
	if err := msg.From(s.from); err != nil {
		return fmt.Errorf("from address %q: %w", s.from, err)
	}
	if err := msg.To(to); err != nil {
		// A malformed recipient address can never parse on redelivery either.
		return fmt.Errorf("%w: recipient address %q: %v", ErrPermanent, to, err)
	}
	msg.Subject(subject)
	expiry := formatExpiry(expiresAt)
	msg.SetBodyString(mail.TypeTextPlain, fmt.Sprintf(plainBodyTemplate, code, expiry))
	// Plain part first, HTML alternative last: multipart/alternative clients
	// prefer the last part they can render (RFC 2046), text-only clients keep
	// the unchanged plain body.
	html, err := renderHTMLBody(code, expiry)
	if err != nil {
		// Unreachable with a Must-parsed template and an in-memory buffer; if
		// it ever fires it stays transient (classify's default — ambiguity
		// retries), and the poison threshold caps the redeliveries.
		return err
	}
	msg.AddAlternativeString(mail.TypeTextHTML, html)

	if err := s.client.DialAndSendWithContext(ctx, msg); err != nil {
		return classify(err)
	}
	return nil
}

// classify maps a go-mail delivery error onto the retry taxonomy. Only an
// SMTP 5xx server response is permanent; everything else — dial failures,
// timeouts, 4xx — stays transient so redelivery retries it. Ambiguity
// defaults to transient: a misclassified permanent failure silently drops
// the email (failure row + ack, no retry).
func classify(err error) error {
	var sendErr *mail.SendError
	if errors.As(err, &sendErr) {
		if code := sendErr.ErrorCode(); code >= 500 && code <= 599 {
			return fmt.Errorf("%w: smtp send: %v", ErrPermanent, err)
		}
	}
	return fmt.Errorf("smtp send: %w", err)
}

// formatExpiry renders the payload's ISO-8601 expiry for the message body,
// falling back to the raw string when it does not parse — the email must
// still go out (the API enforces the real TTL; this is display only).
func formatExpiry(expiresAt string) string {
	t, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil {
		return expiresAt
	}
	return t.UTC().Format("15:04 UTC, Jan 2 2006")
}
