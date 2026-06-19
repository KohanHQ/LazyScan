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

## R-005 Fail closed on undetectable client IP  (resolves F-005)
- date: 2026-06-18
- change: Dropped the `?? "unknown"` fallback. Resolve `ip` via the existing
  `x-real-ip`/socket logic, then throw 429 (`tooManyRequests`) only if it is still
  undetectable — placed *after* resolution so the normal `X-Real-IP` path is
  unchanged. Did not use CodeRabbit's suggested ordering (which throws before the
  proxy-header check and would 400 valid proxied requests).
- files: api/src/middleware/rate.limit.ts
- verification: `bun run typecheck` clean; CodeRabbit re-review
  `-t uncommitted` → 0 findings; runtime probes still hold (enabled→429 +
  Retry-After, disabled→200 gate).
- constraints honored: smallest safe change (~4 lines); preserves the normal
  resolution path; no DTO/contract/behavior change beyond the security hardening.

## R-006 Exempt import-progress poll from the global rate cap  (resolves F-006)
- date: 2026-06-19
- change: The status-poll `GET …/chapter/uploads/:uploadId` now carries its own
  generous bucket (`uploadStatusLimit`, 120/60s = ~2/sec) and is **exempted** from
  the global cap: the `globalRateLimit` hook early-returns for that route
  (`isUploadStatusPoll` — method GET + suffix regex, prefix-agnostic, excludes
  `/complete` `/retry` `/pages`). So polling a large import can no longer drain the
  IP's global 100/15min budget and 429 unrelated requests (login/browse). Global
  cap unchanged (still 100/15min — the poll was the only offender). Web side: the
  poll now backs off 2s → ×1.5 → 10s cap instead of a fixed 2s interval, cutting
  steady-state request/DB pressure (defense-in-depth).
- files: api/src/config.ts (new `rateLimit.uploadStatus`), api/src/middleware/
  rate.limit.ts (`isUploadStatusPoll` skip + `uploadStatusLimit`),
  api/src/modules/chapter/chapter.handler.ts (`beforeHandle: uploadStatusLimit` on
  the poll GET), web/src/pages/manage-chapter.ts (backoff polling).
- verification: api `bun run typecheck` clean; web `bun run build` + 51 unit tests
  pass; exemption regex probed against 8 route paths (poll matched w/ & w/o
  `/api/v1`; complete/retry/page-upload/list correctly NOT matched); CodeRabbit
  `-t uncommitted` → 0 findings. **Runtime probe PENDING post-deploy**: confirm
  hammering the poll >100×/15min no longer 429s login from the same IP, and the
  poll's own 120/60s bucket still bounds abuse. (Rate-limit is gated off in the
  smoke suite, so static verification only locally.)
- constraints honored: smallest safe change; global cap + per-route auth/publicRead
  buckets unchanged; no DTO/response-contract change; poll-route auth gating
  untouched (still owner/superuser-scoped).

## R-007 Require >= 10 bytes in GIF magic check  (resolves F-007)
- date: 2026-06-19
- change: `isGifBuffer` now requires `buffer.length >= 10` (was `>= 6`) so the
  magic-byte sniff also guards `readGifDimensions`' offset-6-9 reads. A malformed
  6–9 byte upload with valid GIF magic now fails the sniff → clean 400
  (`INVALID_IMAGE`) instead of an unhandled `RangeError` → 500. No valid GIF is
  rejected (a real GIF is always >= 13 bytes: 6-byte header + 7-byte logical
  screen descriptor). Applied with user approval; CodeRabbit's exact suggested fix.
- files: api/src/modules/upload/upload.service.ts (`isGifBuffer`)
- verification: api `bun run typecheck` clean; CodeRabbit re-review
  `--type uncommitted` → 0 findings (twice — after the fix and after the comment
  trim). DB-backed avatar path not run live (no local Postgres/storage; see
  session note).
- constraints honored: smallest safe change (one-line bound); no DTO/response
  contract change; owner-gate + static-image path untouched.
