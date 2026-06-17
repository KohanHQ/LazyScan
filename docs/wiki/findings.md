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
