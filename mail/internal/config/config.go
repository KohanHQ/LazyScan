// Package config parses the mail service's environment: pipeline connections
// (Postgres, Redis), SMTP delivery, and consumer tunables.
package config

import (
	"fmt"
	"strconv"
	"time"
)

// Config is the resolved mail service runtime configuration.
type Config struct {
	Port string // HTTP listen port for GET /health (MAIL_SVC_PORT)

	DatabaseURL string
	RedisURL    string

	SMTPHost     string
	SMTPPort     int
	SMTPFrom     string
	SMTPUsername string // optional; must be set together with SMTPPassword
	SMTPPassword string
	SMTPSSL      bool // implicit TLS on connect (SMTPS, port 465); mutually exclusive with SMTPStartTLS
	SMTPStartTLS bool // mandatory STARTTLS when true, plaintext when false (dev Mailpit)

	ClaimIdle     time.Duration // XAUTOCLAIM min-idle before reclaiming a pending entry
	MaxDeliveries int           // delivery count at which a message is poisoned
	Concurrency   int           // max entries handled concurrently per batch
}

const (
	defaultPort          = "8002"
	defaultSSL           = false // implicit TLS off by default; SMTPS hosts (port 465) set SMTP_SSL=true
	defaultStartTLS      = true  // secure default; dev/compose sets SMTP_STARTTLS=false explicitly
	defaultClaimIdle     = 60 * time.Second
	defaultMaxDeliveries = 5
	defaultConcurrency   = 1 // sequential sends; no legacy-parity reason to go higher
)

// Load reads configuration through getenv (os.Getenv in production, a stub in
// tests). Empty values fall back to defaults; DATABASE_URL, REDIS_URL, and
// SMTP_HOST/PORT/FROM have no defaults and must be set.
func Load(getenv func(string) string) (*Config, error) {
	cfg := &Config{
		Port:         envOr(getenv, "MAIL_SVC_PORT", defaultPort),
		DatabaseURL:  getenv("DATABASE_URL"),
		RedisURL:     getenv("REDIS_URL"),
		SMTPHost:     getenv("SMTP_HOST"),
		SMTPFrom:     getenv("SMTP_FROM"),
		SMTPUsername: getenv("SMTP_USERNAME"),
		SMTPPassword: getenv("SMTP_PASSWORD"),
	}

	if _, err := strconv.Atoi(cfg.Port); err != nil {
		return nil, fmt.Errorf("MAIL_SVC_PORT %q: must be a port number", cfg.Port)
	}
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL: required")
	}
	if cfg.RedisURL == "" {
		return nil, fmt.Errorf("REDIS_URL: required")
	}
	if cfg.SMTPHost == "" {
		return nil, fmt.Errorf("SMTP_HOST: required")
	}
	if cfg.SMTPFrom == "" {
		return nil, fmt.Errorf("SMTP_FROM: required")
	}
	if (cfg.SMTPUsername == "") != (cfg.SMTPPassword == "") {
		return nil, fmt.Errorf("SMTP_USERNAME and SMTP_PASSWORD: must be set together")
	}

	port := getenv("SMTP_PORT")
	p, err := strconv.Atoi(port)
	if err != nil || p < 1 || p > 65535 {
		return nil, fmt.Errorf("SMTP_PORT %q: must be a port number", port)
	}
	cfg.SMTPPort = p

	ssl := envOr(getenv, "SMTP_SSL", strconv.FormatBool(defaultSSL))
	useSSL, err := strconv.ParseBool(ssl)
	if err != nil {
		return nil, fmt.Errorf("SMTP_SSL %q: must be a boolean", ssl)
	}
	cfg.SMTPSSL = useSSL

	startTLS := envOr(getenv, "SMTP_STARTTLS", strconv.FormatBool(defaultStartTLS))
	tls, err := strconv.ParseBool(startTLS)
	if err != nil {
		return nil, fmt.Errorf("SMTP_STARTTLS %q: must be a boolean", startTLS)
	}
	cfg.SMTPStartTLS = tls

	// Implicit TLS (SMTPS, port 465) and STARTTLS (port 587) are different
	// transports — enabling both is a config mistake, not a stacking policy.
	if cfg.SMTPSSL && cfg.SMTPStartTLS {
		return nil, fmt.Errorf("SMTP_SSL and SMTP_STARTTLS: mutually exclusive (set SMTP_STARTTLS=false for SMTPS)")
	}

	claimIdle := envOr(getenv, "MAIL_SVC_CONSUMER_CLAIM_IDLE", defaultClaimIdle.String())
	d, err := time.ParseDuration(claimIdle)
	if err != nil || d <= 0 {
		return nil, fmt.Errorf("MAIL_SVC_CONSUMER_CLAIM_IDLE %q: must be a positive duration", claimIdle)
	}
	cfg.ClaimIdle = d

	maxDeliveries := envOr(getenv, "MAIL_SVC_CONSUMER_MAX_DELIVERIES", strconv.Itoa(defaultMaxDeliveries))
	n, err := strconv.Atoi(maxDeliveries)
	if err != nil || n < 1 {
		return nil, fmt.Errorf("MAIL_SVC_CONSUMER_MAX_DELIVERIES %q: must be a positive integer", maxDeliveries)
	}
	cfg.MaxDeliveries = n

	concurrency := envOr(getenv, "MAIL_SVC_CONSUMER_CONCURRENCY", strconv.Itoa(defaultConcurrency))
	w, err := strconv.Atoi(concurrency)
	if err != nil || w < 1 {
		return nil, fmt.Errorf("MAIL_SVC_CONSUMER_CONCURRENCY %q: must be a positive integer", concurrency)
	}
	cfg.Concurrency = w

	return cfg, nil
}

func envOr(getenv func(string) string, key, def string) string {
	if v := getenv(key); v != "" {
		return v
	}
	return def
}
