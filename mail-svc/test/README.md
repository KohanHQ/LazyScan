# Tests (disabled)

Tests parked here with `.disabled` so `go test ./...` skips them (same
convention as Kiln and Aegis, user decision 2026-06-04). They were green at
the time of the move (`go test -race ./...`).

To re-enable: each file is a white-box test (`package config`, etc.) — move
it **back into its package directory** and strip `.disabled`:

```sh
mv test/config_test.go.disabled internal/config/config_test.go
mv test/envelope_test.go.disabled internal/processor/envelope_test.go
mv test/processor_test.go.disabled internal/processor/processor_test.go
mv test/smtp_test.go.disabled internal/mailer/smtp_test.go
go test -race ./...
```

They will not compile from this directory: Go only discovers `*_test.go`
files living in the package they test.

The mailer suite (H5) is self-contained except `TestSendAgainstMailpit`,
which skips unless Mailpit is reachable on `localhost:1025`:

```sh
docker run --rm -p 8025:8025 -p 1025:1025 axllent/mailpit
```

The 5xx/4xx classification tests run an in-process fake SMTP server — no
external dependency.

Coverage gaps (same shape as Kiln's): the consumer's Redis lifecycle
(XREADGROUP/XAUTOCLAIM/XPENDING/XACK) has no unit tests — no testcontainers
dependency; verify live against the compose stack at H6. Same for the
store's bookkeeping queries.
