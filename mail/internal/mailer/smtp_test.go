package mailer

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/wneessen/go-mail"
)

func TestFormatExpiry(t *testing.T) {
	tests := []struct {
		name, in, want string
	}{
		{"rfc3339", "2026-06-05T10:10:00Z", "10:10 UTC, Jun 5 2026"},
		{"offset normalized to utc", "2026-06-05T12:10:00+02:00", "10:10 UTC, Jun 5 2026"},
		{"garbage passes through", "soon", "soon"},
		{"empty passes through", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatExpiry(tt.in); got != tt.want {
				t.Errorf("formatExpiry(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestRenderHTMLBody(t *testing.T) {
	const code = "482917"
	const expiry = "10:10 UTC, Jun 5 2026"
	for _, c := range []content{verificationContent, passwordResetContent} {
		got, err := renderHTMLBody(c, code, expiry)
		if err != nil {
			t.Fatalf("renderHTMLBody(%q): %v", c.subject, err)
		}
		if !strings.Contains(got, code) {
			t.Errorf("%q: html body does not contain the code", c.subject)
		}
		if !strings.Contains(got, "It expires at "+expiry+".") {
			t.Errorf("%q: html body does not render the expiry", c.subject)
		}
		if !strings.Contains(got, c.heading) || !strings.Contains(got, c.footer) {
			t.Errorf("%q: html body does not carry its own copy", c.subject)
		}
	}
}

func TestRenderHTMLBodyEscapes(t *testing.T) {
	// Both values are server-generated digits/timestamps today, but the
	// template must escape regardless — a future payload bug must not become
	// markup injection.
	got, err := renderHTMLBody(verificationContent, `<script>alert(1)</script>`, `<b>soon</b>`)
	if err != nil {
		t.Fatalf("renderHTMLBody: %v", err)
	}
	if strings.Contains(got, "<script>") || strings.Contains(got, "<b>soon</b>") {
		t.Errorf("html body does not escape data: %q", got)
	}
}

func TestClassifyTransient(t *testing.T) {
	// Non-SendError (dial failures, timeouts) and SendErrors without a
	// server code must stay transient — never ErrPermanent.
	tests := []struct {
		name string
		err  error
	}{
		{"plain error", errors.New("connection refused")},
		{"senderror without server code", &mail.SendError{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classify(tt.err)
			if errors.Is(got, ErrPermanent) {
				t.Errorf("classify(%v) = ErrPermanent, want transient", tt.err)
			}
		})
	}
}

func TestSendMalformedRecipientIsPermanent(t *testing.T) {
	s, err := NewSMTP(SMTPOptions{Host: "localhost", Port: 1025, From: "no-reply@lazyscan.local"})
	if err != nil {
		t.Fatalf("NewSMTP: %v", err)
	}
	const code = "482917"
	// No SMTP dial happens: address parsing fails first.
	sends := []struct {
		name string
		send func(context.Context, string, string, string) error
	}{
		{"verification", s.SendVerificationCode},
		{"password reset", s.SendPasswordResetCode},
	}
	for _, tt := range sends {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.send(context.Background(), "not an address", code, "2026-06-05T10:10:00Z")
			if err == nil {
				t.Fatal("want error, got nil")
			}
			if !errors.Is(err, ErrPermanent) {
				t.Errorf("err = %v, want ErrPermanent", err)
			}
			if strings.Contains(err.Error(), code) {
				t.Errorf("error string leaks the code: %q", err)
			}
		})
	}
}

func TestNewSMTPWithSSL(t *testing.T) {
	// Implicit-TLS (SMTPS, port 465) wiring: NewSMTP holds no connection, so
	// this validates option assembly only — no dial happens.
	s, err := NewSMTP(SMTPOptions{Host: "smtp.example.com", Port: 465, From: "no-reply@lazyscan.local", SSL: true})
	if err != nil {
		t.Fatalf("NewSMTP SSL: %v", err)
	}
	if s == nil {
		t.Fatal("NewSMTP SSL returned nil client")
	}
}

// fakeSMTP runs a minimal single-connection SMTP conversation that answers
// RCPT TO with rcptCode, so go-mail produces a real *SendError carrying a
// server response code (not constructible from outside the package).
func fakeSMTP(t *testing.T, rcptCode int) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { ln.Close() })

	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		r := bufio.NewReader(conn)
		write := func(s string) { io.WriteString(conn, s+"\r\n") }

		write("220 fake ESMTP")
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			switch cmd := strings.ToUpper(strings.TrimSpace(line)); {
			case strings.HasPrefix(cmd, "EHLO"), strings.HasPrefix(cmd, "HELO"):
				write("250 fake greets you")
			case strings.HasPrefix(cmd, "MAIL FROM"):
				write("250 OK")
			case strings.HasPrefix(cmd, "RCPT TO"):
				write(fmt.Sprintf("%d mailbox unavailable", rcptCode))
			case strings.HasPrefix(cmd, "QUIT"):
				write("221 bye")
				return
			default:
				write("250 OK")
			}
		}
	}()
	return ln.Addr().String()
}

func TestSendClassifiesServerRejects(t *testing.T) {
	tests := []struct {
		name      string
		rcptCode  int
		permanent bool
	}{
		{"550 permanent reject", 550, true},
		{"450 transient reject", 450, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			addr := fakeSMTP(t, tt.rcptCode)
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				t.Fatalf("split %q: %v", addr, err)
			}
			var p int
			fmt.Sscanf(port, "%d", &p)

			s, err := NewSMTP(SMTPOptions{Host: host, Port: p, From: "no-reply@lazyscan.local", StartTLS: false})
			if err != nil {
				t.Fatalf("NewSMTP: %v", err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			const code = "482917"
			err = s.SendVerificationCode(ctx, "person@example.com", code, "2026-06-05T10:10:00Z")
			if err == nil {
				t.Fatal("SendVerificationCode: want error, got nil")
			}
			if got := errors.Is(err, ErrPermanent); got != tt.permanent {
				t.Errorf("ErrPermanent = %v, want %v (err: %v)", got, tt.permanent, err)
			}
			// The error string reaches logs and mail_failures.error_message:
			// the code must never appear in it.
			if strings.Contains(err.Error(), code) {
				t.Errorf("error string leaks the verification code: %q", err)
			}
		})
	}
}

// TestSendAgainstMailpit is the live happy path: it needs a running Mailpit
// (docker run --rm -p 8025:8025 -p 1025:1025 axllent/mailpit) and skips when
// SMTP :1025 is unreachable. The message is read back through Mailpit's REST
// API and must carry the code in both the plain and HTML bodies — and
// nowhere in the error path.
func TestSendAgainstMailpit(t *testing.T) {
	conn, err := net.DialTimeout("tcp", "localhost:1025", 250*time.Millisecond)
	if err != nil {
		t.Skip("mailpit not running on localhost:1025")
	}
	conn.Close()

	s, err := NewSMTP(SMTPOptions{Host: "localhost", Port: 1025, From: "no-reply@lazyscan.local", StartTLS: false})
	if err != nil {
		t.Fatalf("NewSMTP: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const code = "482917"
	to := fmt.Sprintf("h5-test-%d@example.com", time.Now().UnixNano())
	if err := s.SendVerificationCode(ctx, to, code, "2026-06-05T10:10:00Z"); err != nil {
		t.Fatalf("SendVerificationCode: %v", err)
	}

	msg := mailpitLatestTo(t, to)
	if msg.Subject != verificationContent.subject {
		t.Errorf("Subject = %q, want %q", msg.Subject, verificationContent.subject)
	}
	if !strings.Contains(msg.Text, code) {
		t.Errorf("plain body does not contain the code: %q", msg.Text)
	}
	if !strings.Contains(msg.Text, "10:10 UTC, Jun 5 2026") {
		t.Errorf("plain body does not render the expiry: %q", msg.Text)
	}
	if !strings.Contains(msg.HTML, code) {
		t.Errorf("html body does not contain the code: %q", msg.HTML)
	}
	if !strings.Contains(msg.HTML, "10:10 UTC, Jun 5 2026") {
		t.Errorf("html body does not render the expiry: %q", msg.HTML)
	}
}

type mailpitMessage struct {
	Subject string `json:"Subject"`
	Text    string `json:"Text"`
	HTML    string `json:"HTML"`
}

// mailpitLatestTo fetches the newest Mailpit message addressed to `to` via
// the REST API (search by recipient, then full message by ID).
func mailpitLatestTo(t *testing.T, to string) mailpitMessage {
	t.Helper()
	resp, err := http.Get("http://localhost:8025/api/v1/search?query=" + to)
	if err != nil {
		t.Fatalf("mailpit search: %v", err)
	}
	defer resp.Body.Close()
	var search struct {
		Messages []struct {
			ID string `json:"ID"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&search); err != nil {
		t.Fatalf("decode search: %v", err)
	}
	if len(search.Messages) == 0 {
		t.Fatalf("no mailpit message for %s", to)
	}

	resp, err = http.Get("http://localhost:8025/api/v1/message/" + search.Messages[0].ID)
	if err != nil {
		t.Fatalf("mailpit message: %v", err)
	}
	defer resp.Body.Close()
	var msg mailpitMessage
	if err := json.NewDecoder(resp.Body).Decode(&msg); err != nil {
		t.Fatalf("decode message: %v", err)
	}
	return msg
}
