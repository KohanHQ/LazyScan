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
