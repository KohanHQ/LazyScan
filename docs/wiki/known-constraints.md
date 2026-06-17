# Known Constraints

Repo-wide inherited contracts and hidden constraints. Service-specific contracts
live in the module docs — [`modules/image-svc.md`](modules/image-svc.md),
[`modules/mail-svc.md`](modules/mail-svc.md). Code is the source of truth.

## Cross-cutting

- **One Redis, three tenants.** API cache (bare prefixes `popular:*`/`manga:*`,
  SCAN invalidation), auth denylist, and the event streams
  (`events:chapter-page`, `events:email`) share one instance. Compose runs it
  `--maxmemory-policy noeviction` so stream entries are never silently dropped.
- **Migrations are owned by the API** (run at its boot). image-svc and mail-svc
  run **no** migrations — they assume the worker bookkeeping tables already
  exist (`*_processed_events`, `*_failures`, `outbox_events`).
- **Outbox is the source of truth, not Redis.** Publish to a stream is
  at-least-once and retried from the outbox; consumers dedup by `eventId`. A
  trimmed stream entry is replayable by re-nulling its outbox row's
  `published_at`.
- **Storage is backend-agnostic; R2 by env.** API and image-svc share one
  `STORAGE_*` S3 client. R2 needs no code change — `region=auto`,
  `forcePathStyle=true`, R2 endpoint. Pages/covers served directly from R2.
- **8 GiB storage cap** (Phase 4) is a soft gate at chapter-import admission,
  computed from `SUM(size_bytes) WHERE status='ready'`. It undercounts staged +
  in-flight originals; the 2 GB margin (8 of R2's free 10) absorbs it.

## Status enums (DB CHECK-constrained — exact strings)

- `chapter_pages.status`: `waiting_upload | processing | ready | failed`
- `chapter_imports.status`: `uploading | processing | completed | failed`
- `chapters.status`: `draft | importing | processing | ready | failed`

Writing any other value violates a CHECK. Workers only move pages
`processing → ready|failed`.

## Drift watch (post-strip)

The module docs currently describe the **pre-strip** workers (they still carry
Prometheus/OTel/log-framework). Phases 2–3 remove that fat; update the module
docs in the same change so they keep matching the code.
