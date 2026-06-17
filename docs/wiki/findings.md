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
