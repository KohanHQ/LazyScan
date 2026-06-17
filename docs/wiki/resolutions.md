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

## R-003 Guard the convert response parse  (resolves F-003)
- date: 2026-06-17
- change: Wrapped `response.json()` in try/catch; a parse failure now throws
  `AppError 502 IMAGE_PROCESSING_FAILED` with the cause, matching the existing
  unreachable / non-ok 502 paths in the same function.
- files: api/src/shared/upload/image.ts
- verification: `bun run typecheck` clean; `bun run test` 17/17 green; re-review
  `coderabbit review --agent -t uncommitted` → 0 findings.
- constraints honored: localized to the new HTTP block; no DTO/contract/signature
  change; no unrelated cleanup.

## R-004 Validate convert dimensions instead of defaulting to 0  (resolves F-004)
- date: 2026-06-17
- change: Reject a 200 missing `webp` or non-positive/non-finite `width`+`height`
  with `AppError 502 IMAGE_PROCESSING_FAILED`; return the real dims (dropped the
  `|| 0` fallback).
- files: api/src/shared/upload/image.ts
- verification: same run as R-003 (typecheck + 17/17 tests + clean re-review).
- constraints honored: user-approved deviation from the original `|| 0` (surfaces
  a real upstream anomaly); confined to the convert path, no contract change.
