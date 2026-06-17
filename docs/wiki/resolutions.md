# Resolutions

How findings were resolved. Paired with [`findings.md`](findings.md) — each entry
resolves a specific finding and must reference it; neither file is orphaned.

Format per resolution:

```md
## R-NNN <short title>  (resolves F-NNN)
- date:
- change: <what was done>
- files:
- verification: <how it was confirmed>
- constraints honored: <Do-Not rules respected>
```

## R-001 Make healthcheck wget dependency explicit  (resolves F-001)
- date: 2026-06-17
- change: Added `wget` to the runtime stage's `apk add` so the `HEALTHCHECK`'s
  `wget` is an explicit package, not an implicit BusyBox applet. User decision
  (defensive/future-proof) despite the finding being a verified false positive.
- files: image-svc/Dockerfile (`apk add --no-cache vips` → `vips wget`)
- verification: `docker run --rm alpine:3.23 apk add --no-cache vips wget` → OK,
  `command -v wget` → `/usr/bin/wget`.
- constraints honored: minimal one-token diff; no public-contract / behavior /
  core-code change; no unrelated cleanup.

## R-002 No change — stale rename pre-image findings  (resolves F-002)
- date: 2026-06-17
- change: None. All four findings reference pre-strip code the rename already
  removed; the real main.go is correct. Logged for the paired record, not fixed.
- files: none (verification only)
- verification: `grep -nE "cfg\.Addr|cfg\.LogFormat|health\.NewServer|internal/health|internal/metrics|newLogger|herald:" cmd/mail-svc/main.go`
  → no matches; `go build ./...`, `go vet ./...`, `gofmt -l` clean;
  white-box `go test -race` green. Re-review as `-t committed` after commit
  would resolve the pre-image confusion (deferred — diff is verified correct).
- constraints honored: no code touched; preserved existing behavior; no
  speculative fix applied to a false positive.
