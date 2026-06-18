# Findings

Code-review findings log. Paired with [`resolutions.md`](resolutions.md) — every
finding that gets fixed must have a matching resolution entry; the two are
interconnected and must not be orphaned.

Format per finding:

```md
## F-NNN <short title>
- date:
- source: <review tool / PR / manual>
- severity: low | medium | high
- location: path:line
- problem:
- status: open | resolved (→ R-NNN)
```

## F-001 Dockerfile healthcheck depends on wget
- date: 2026-06-17
- source: CodeRabbit CLI (`coderabbit review --agent`), Phase 2 image-svc strip
- severity: low (reported critical; downgraded — see note)
- location: image-svc/Dockerfile:19
- problem: The runtime `HEALTHCHECK` calls `wget`; the review flagged `wget` as
  missing from the runtime image (`apk add --no-cache vips` only).
- note: Verified false positive — `alpine:3.23` ships BusyBox `wget` at
  `/usr/bin/wget` (`docker run --rm alpine:3.23 command -v wget`), which the
  original Kiln Dockerfile relied on. Resolved anyway (R-001) by making the
  dependency explicit rather than implicit on BusyBox.
- status: resolved (→ R-001)

## F-002 Stale compile-error findings from the cmd rename (×4)
- date: 2026-06-17
- source: CodeRabbit CLI (`coderabbit review --agent -t uncommitted`), Phase 3 mail-svc strip
- severity: low (3 reported critical + 1 minor; all stale — see note)
- location: mail-svc/cmd/mail-svc/main.go, mail-svc/go.mod
- problem: The review flagged four "compile errors" in the new main.go —
  (a) `cfg.Addr` + `health.NewServer` at L84, (b) old `internal/health` /
  `internal/metrics` imports + old module path, (c) `cfg.LogFormat` at L40,
  (d) error prefix still `"herald:"` near L29.
- note: All four are verified false positives. The `git mv cmd/herald →
  cmd/mail-svc` rename made CodeRabbit diff the **pre-image** (the old
  herald main.go); it flagged removed code as if current. Grep for every
  cited symbol in the actual main.go → none present, and `go build ./...`
  is clean (a real `cfg.Addr`/`cfg.LogFormat`/`health.NewServer` reference
  could not compile). No actionable issue against the real diff.
- status: resolved (→ R-002)

## F-003 image-svc /convert response JSON parsed without error handling
- date: 2026-06-17
- source: CodeRabbit CLI (`coderabbit review --agent -t uncommitted`), Phase 4 API
- severity: high (reported critical)
- location: api/src/shared/upload/image.ts:116
- problem: `processImageBuffer` called `await response.json()` on the image-svc
  `/convert` 200 with no guard. A non-JSON/truncated body (proxy error page,
  partial write) throws a raw error that bubbles to the generic 500 handler
  instead of a typed upstream-failure response.
- status: resolved (→ R-003)

## F-004 width/height defaulted to 0 masks malformed convert results
- date: 2026-06-17
- source: CodeRabbit CLI (`coderabbit review --agent -t uncommitted`), Phase 4 API
- severity: low (reported minor)
- location: api/src/shared/upload/image.ts:126
- problem: `width: result.width || 0` / `height: result.height || 0` silently
  stored 0 dimensions when a 200 response lacked them. Mirrored the original
  `sharp` fallback, but in the HTTP path a dimensionless 200 is a real anomaly
  (image-svc always returns computed dims) that should surface, not persist.
- status: resolved (→ R-004)

## F-005 Rate limiter "unknown" IP fallback collapses to one bucket
- date: 2026-06-18
- source: CodeRabbit CLI (`coderabbit review --agent -t uncommitted`), P0 rate-limit
- severity: low (reported critical; downgraded — see note)
- location: api/src/middleware/rate.limit.ts:50
- problem: `enforceRateLimit` fell back to `"unknown"` when no client IP could be
  resolved, so every IP-less request shared one bucket (mis-throttle / shared-bucket
  DoS surface).
- note: Pre-existing behavior, preserved from the original limiter — not introduced
  by this change. Effectively unreachable in this deploy: `server.requestIP()` is
  null only for synthetic `app.handle()` calls, and with `trustProxy` on every
  limited route is under `/api/` where nginx sets `X-Real-IP`, so `ip` is always the
  real client. Hardened anyway (user decision, defense-in-depth). CodeRabbit's
  suggested patch (throw 400 *before* the `x-real-ip` check) was NOT applied — it
  would reject valid proxied requests when `socketIp` is absent but `X-Real-IP` is
  present.
- status: resolved (→ R-005)
