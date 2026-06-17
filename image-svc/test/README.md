# Tests (disabled)

Tests parked here with `.disabled` so `go test ./...` skips them (same
convention as Aegis, user decision 2026-06-04). They were green at the time
of the move (`go test -race ./...`).

To re-enable: each file is a white-box test (`package config`, etc.) — move
it **back into its package directory** and strip `.disabled`:

```sh
mv test/config_test.go.disabled internal/config/config_test.go
mv test/health_test.go.disabled internal/health/health_test.go
mv test/envelope_test.go.disabled internal/processor/envelope_test.go
mv test/processor_test.go.disabled internal/processor/processor_test.go
mv test/convert_test.go.disabled internal/convert/convert_test.go
go test -race ./...
```

They will not compile from this directory: Go only discovers `*_test.go`
files living in the package they test.

The convert suite (and any build since F5) needs libvips installed locally —
govips is cgo: `brew install vips` (macOS) / `apk add vips-dev` (alpine).

Coverage gaps (documented in the session logs): the consumer's Redis
lifecycle (XREADGROUP/XAUTOCLAIM/XPENDING/XACK) has no unit tests — no
testcontainers dependency yet; verified live against the compose stack
instead. Same for the store's page-write transactions and the minio storage
client (F5).
