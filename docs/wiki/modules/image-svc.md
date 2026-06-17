# Module: image-svc (ex-Kiln)

> Salvaged from Kiln `docs/wiki/` at Phase 1 scaffold — folded architecture +
> event-contract + known-constraints into one module doc. Reflects the
> **pre-strip** state of the code as copied. Phase 2 (plan §5) strips
> metrics/OTel/log-framework + repoints R2 + adds HTTP `/convert`, and must
> update this doc to match. Originals: `LazyScan-Stack/Kiln/docs/wiki/`.

---


# Architecture

Kiln is LazyScan's chapter-page processing worker (Go), which replaced the
BullMQ worker over a Redis Streams + Postgres outbox pipeline (BullMQ
removed at F7, 2026-06-05). Unlike Aegis, Kiln is **not** stdlib-only —
targeted dependencies are accepted (pgx, go-redis, storage SDK, image
library), but none is added before the phase that uses it.

## Target Pipeline

```txt
LazyScan API (TS)
-> upload complete: verify staged originals
-> same DB tx: pages -> processing, INSERT outbox_events
-> dispatcher (TS, F3): outbox -> XADD events:chapter-page
Kiln (Go, F4+)
-> XREADGROUP (group kiln)
-> dedup (processed-events, page ready check)
-> download original (MinIO/R2, key from page row)
-> resize/convert (inside 1080x1920, no enlargement, WebP q88)
-> upload to storage_key (deterministic, overwrite-safe)
-> page -> ready, refresh import/chapter aggregates, record processed event
-> XACK
Web -> polls LazyScan API only (Kiln never web-facing)
```

Full contract: `event-contract.md`. Inherited invariants:
`known-constraints.md`.

## Packages

Current (F7 — Kiln code unchanged since F6; F7 was LazyScan-side removal):

```txt
cmd/kiln             wiring: config -> logger -> store -> redis -> storage -> vips startup -> consumer + health server, signal-driven graceful shutdown (consumer drains first)
internal/config      env parsing + validation (Load takes a getenv func for tests); DATABASE_URL/REDIS_URL/STORAGE_* required, KILN_CONSUMER_* tunables
internal/health      /healthz liveness endpoint (compose-healthcheck parity with Aegis) + /metrics on the same internal mux when wired (O3; port unpublished in compose)
internal/metrics     Prometheus registry + every kiln_* metric (observability plan O3); the only client_golang importer — processor/consumer feed it through nil-safe seams; type label clamped to known event types
internal/consumer    Redis Streams group consumer: XREADGROUP/XAUTOCLAIM/XPENDING/XACK lifecycle, poison threshold detection; entries within a batch handled concurrently (KILN_CONSUMER_CONCURRENCY, F6); policy-free — obeys the processor's Outcome; ~10s XPENDING poll feeds the stream gauges (StreamObserver seam)
internal/processor   per-message pipeline: envelope parse -> dedup -> load page -> download -> convert -> upload -> page ready/failed + aggregate refresh -> processed-event; reports durable outcomes (ok|dedup|failed) through the Observer seam
internal/storage     S3-compatible object client (minio-go): download original, upload converted page; NoSuchKey -> ErrObjectNotFound (non-retryable)
internal/convert     image pipeline (govips/libvips — the engine sharp wraps): EXIF auto-rotate, fit inside 1080x1920, never enlarge, WebP q88, input <= 10MB; all errors ErrUnprocessable (non-retryable)
internal/store       pgx access: page reads, page status writes + derived aggregate refresh (one tx, import row locked first to serialize per-import refreshes — F6), processed-events, failure rows
```

Dependencies: `github.com/redis/go-redis/v9`, `github.com/jackc/pgx/v5`
(F4); `github.com/minio/minio-go/v7`, `github.com/davidbyttow/govips/v2`
(F5 — govips is cgo, so the Docker build is `CGO_ENABLED=1` with
`vips-dev`/`vips` apk packages and local builds need `brew install vips`);
`github.com/prometheus/client_golang` (observability plan O3, Aegis pin
v1.23.2, confined to `internal/metrics`).

## Metrics (observability plan O3)

`/metrics` joins the healthz mux on `KILN_ADDR` (`:8085`, unpublished in
compose — Prometheus scrapes over the compose network; Grafana is the only
human-facing surface). All `kiln_*`:

| Metric | Type | Labels |
|---|---|---|
| `kiln_events_processed_total` | counter | `type`, `outcome` (`ok`\|`dedup`\|`failed`) |
| `kiln_event_processing_duration_seconds` | histogram | `type` |
| `kiln_stream_pending` | gauge | — (XPENDING count, ~10s poll) |
| `kiln_stream_oldest_pending_seconds` | gauge | — (age of oldest pending entry, from its stream ID) |
| `kiln_poison_total` | counter | — |

Outcome mapping: `dedup` = idempotency skip (IsProcessed hit,
ready-terminal, poison threshold on already-processed); `failed` = durable
failure (schemaVersion reject, non-retryable page failure, poison
recorded); `ok` = everything else durably acked (success, unknown-eventType
skip, page-row-missing skip). Retryable attempts are not counted — the
entry stays pending and the stream gauges carry that signal. The `type`
label is clamped to the known event types (`other` otherwise) — cardinality
discipline against producer-controlled values. The seams
(`processor.Observer`, `consumer.StreamObserver`) are nil-safe: unwired
(tests, rollback) means no metrics, zero behavior change.

## Phases (Forge plan F0–F7)

| Phase | What | Side | Status |
|---|---|---|---|
| F0 | design contract docs | Kiln | **done (2026-06-04)** + walking skeleton |
| F1 | outbox table migration | LazyScan | **done (2026-06-04)** — `022_chapter_worker_outbox.sql` |
| F2 | write outbox events in dual mode (BullMQ still enqueues) | LazyScan | **done (2026-06-04)** — `shared/outbox/outbox.ts` + `completeChapterImport` |
| F3 | dispatcher: outbox → Redis Streams | LazyScan | **done (2026-06-04)** — `shared/outbox/dispatcher.ts` in API process; contract now **binding** |
| F4 | Kiln consumer dry run (parse, load metadata, log only) | Kiln | **done (2026-06-04)** — consumer/processor/store, compose service |
| F5 | Kiln processes pages behind flag | Kiln + LazyScan flag | **done (2026-06-05)** — storage/convert, page+aggregate writes, `CHAPTER_WORKER_BACKEND` |
| F6 | new imports use Kiln | LazyScan flag | **done (2026-06-05)** — flag default `redis_streams`, concurrent consumer |
| F7 | deprecate BullMQ | LazyScan | **done (2026-06-05)** — enqueue, worker, compose service, dependency, `CHAPTER_WORKER_BACKEND` flag removed |

Rollback through F6 was `CHAPTER_WORKER_BACKEND=bullmq` + stop Kiln. Since
F7 the flag and the BullMQ path are gone — rollback is a git revert +
redeploy (see `event-contract.md` §Rollback).

## Current Behavior (F7 — Kiln is the only chapter-page backend)

`go run ./cmd/kiln` (DATABASE_URL + REDIS_URL + STORAGE_* required)
connects Postgres, Redis, and S3-compatible storage, ensures the `kiln`
consumer group, and consumes `events:chapter-page` — entries within one
read/claim batch run concurrently (`KILN_CONSUMER_CONCURRENCY`, default 2
for parity with the removed BullMQ worker); per-import aggregate refreshes
are serialized by locking the import row first (lost-update fix). Per
entry: parse envelope
→ dedup by eventId → load
page row → `ready` is terminal no-op → re-assert `processing` → download
original (key from the row) → convert (reader profile) → upload to
`storage_key` (deterministic, overwrite-safe) → one tx: page `ready` with
image_url/width/height/size_bytes + derived aggregate refresh → insert
processed-events row → XACK. Non-retryable failures (original missing,
unsupported/corrupt/oversize image) mark the page `failed` + refresh
aggregates + failure row + processed-events + ack; transient failures
leave the entry pending for redelivery/reclaim. Poison entries at
`KILN_CONSUMER_MAX_DELIVERIES` now also mark the page `failed` (the F4
deviation is closed). Every completed/retried import produces outbox
events unconditionally — F7 removed LazyScan's `CHAPTER_WORKER_BACKEND`
flag along with the whole BullMQ path (enqueue, worker entrypoint, compose
service, dependency). SIGINT/SIGTERM drains the consumer (waits for the
in-flight batch) before shutting the health server down (10s timeout).


---


# Event Contract

Status: **binding** since F3 (2026-06-04) — the LazyScan dispatcher
publishes real events. v1 changes are additive only; anything else is a
schemaVersion bump. Source plan: [infra-plan.md](infra-plan.md).

## Event: `chapter.page.processing_requested`

One event per chapter page, written by the LazyScan API after staged
originals are verified, published through the outbox dispatcher after DB
commit.

### Envelope (schemaVersion 1)

```json
{
  "eventId": "uuid",
  "eventType": "chapter.page.processing_requested",
  "schemaVersion": 1,
  "occurredAt": "2026-06-04T10:00:00Z",
  "aggregateType": "chapter_page",
  "aggregateId": "chapter_page_uuid",
  "payload": {
    "importId": "import_uuid",
    "chapterId": "chapter_uuid",
    "pageId": "chapter_page_uuid"
  }
}
```

### Envelope rules

- `eventId` is globally unique (UUID v4); the idempotency key for event
  delivery.
- `eventType` is stable; never reused for a different meaning.
- `schemaVersion` is required. v1 changes are **additive only**; removing
  or re-typing a field requires v2.
- Consumers ignore unknown fields.
- Consumers are idempotent by `eventId` (delivery dedup) **and** `pageId`
  (a `ready` page is terminal — see Idempotency).
- Events carry IDs and facts, not domain snapshots: Kiln loads current
  page/import state from Postgres at processing time. The event says
  "process this page", the database says what that means right now.
- Naming note: today's BullMQ job payload calls the page field
  `chapterPageId` (`api/src/modules/chapter/chapter.model.ts:135`). The
  envelope standardizes on `pageId`; the API maps when writing outbox rows.

## Stream Topology

| Item | Value | Why |
|---|---|---|
| Stream key | `events:chapter-page` | `events:` prefix is unused in the shared Redis — BullMQ owns `bull:*`, the API cache uses bare prefixes like `popular:`/`manga:` with SCAN invalidation. No collision either way. |
| Consumer group | `kiln` | one group = the worker fleet; each event processed by one member |
| Consumer name | `kiln-{hostname}-{pid}` | stable enough to find a crashed consumer's pending entries, unique enough to run replicas |
| Group creation | `XGROUP CREATE events:chapter-page kiln 0 MKSTREAM` | idempotent at startup (`BUSYGROUP` ignored); `0` so a group created late still sees earlier events |

One stream for now. New event types share this stream until volume argues
otherwise (consumers dispatch on `eventType`).

### Wire format (decided at F3)

One stream field per entry: `event`, holding the envelope JSON verbatim.
`schemaVersion` lives inside the envelope, not in stream fields.

```txt
XADD events:chapter-page MAXLEN ~ 10000 * event {"eventId":...}
```

- `MAXLEN ~ 10000` (approximate trim) bounds Redis memory; the outbox is
  the source of truth, so an entry trimmed before consumption is
  replayable by re-nulling its row's `published_at`.
- Consumers must treat a missing/unparseable `event` field as poison
  (taxonomy below), not crash.

## Delivery Semantics

**At-least-once.** Every consumer behavior below assumes duplicates and
reordering are normal, not exceptional.

Lifecycle per message:

1. `XREADGROUP GROUP kiln {consumer} BLOCK {ms} COUNT {n} STREAMS events:chapter-page >`
2. Parse envelope; malformed JSON or missing required fields → poison path
   (below), never a crash loop.
3. Process (see Worker Responsibilities in `architecture.md`).
4. `XACK` **only after** the durable outcome is recorded in Postgres —
   either the page is `ready`/`failed` or the processed-events row exists.

Crash between 4's database write and the ack leaves the entry pending —
redelivery hits the processed-events/`ready` checks and no-ops. That is the
designed behavior, not an edge case.

### Pending reclaim (crashed consumers)

- `XAUTOCLAIM events:chapter-page kiln {consumer} {min-idle} ...` runs
  periodically on every consumer.
- Proposed `min-idle`: **60s** (an order of magnitude above normal per-page
  processing; tune when real timings exist).

### Poison messages

- Delivery count comes from `XAUTOCLAIM`/`XPENDING` metadata.
- Proposed max deliveries: **5**. At the threshold:
  1. record a durable failure row (`chapter_worker_failures`, below) with
     the raw message;
  2. mark the page `failed` if the envelope parsed well enough to know it;
  3. `XACK` — a poison message never blocks the pending list forever.
- Unparseable envelopes skip step 2 (no page to mark) but still get 1 and 3.
- ~~F4 dry-run deviation~~ — closed at F5 (2026-06-05): step 2 is
  implemented. Guards: an already-processed eventId acks without touching
  the page (success-then-lost-ack), and a `ready` page stays terminal even
  on the poison path. A fully-handled poison event is also recorded in
  processed-events so straggler redeliveries dedup.

## Idempotency Rules

Inherited from the current pipeline (see `known-constraints.md`) plus the
plan's rules:

- **`ready` is terminal.** If the page row is already `ready`, mark the
  event processed and ack — no reprocessing, no counter changes
  (today's no-op: `chapter.service.ts:534`).
- **Keys come from the database.** `original_key` and `storage_key` are
  precomputed at import creation and stored on the page row. Kiln reads
  them; it never derives keys. Retried uploads overwrite the same final key.
- **Processed-events dedup.** Before work: `SELECT` on
  `chapter_worker_processed_events` by `event_id` → present means ack and
  stop. After success: `INSERT` the row (PK on `event_id` makes double
  insert a no-op conflict).
- **Aggregate progress is derived, never incremented.** Import/chapter
  status and `processed_files`/`failed_files` counts are recomputed from
  page rows (today: `refreshImportProgress`,
  `chapter.repository.ts:464-503`). Kiln keeps that property — duplicate
  deliveries cannot double-count.

## Failure Taxonomy

| Class | Examples | Behavior |
|---|---|---|
| **Retryable** | storage download/upload transient failure, Redis disconnect, Postgres transient failure, worker crash mid-page | do **not** ack; entry stays pending; redelivery (or reclaim) retries until max deliveries |
| **Non-retryable** | original object missing, unsupported image format, input over size limit, corrupt image | mark page `failed` + store `error_message`, refresh aggregate progress, record failure row, **ack** |

The existing manual retry route
(`POST /manga/:id/chapter/uploads/:uploadId/retry`) remains the operator
path for failed pages; implemented at F5 (unconditional since F7): it
writes fresh outbox rows (new `eventId` from the DB default, same
`pageId`) for non-ready pages, in the same tx as the import/chapter status
flips.

## Outbox & Dispatcher (LazyScan-side, F1–F3 — not Kiln code)

Implemented 2026-06-04: tables in migration `022_chapter_worker_outbox.sql`
(F1), writes in `completeChapterImport` via `shared/outbox/outbox.ts` (F2),
dispatcher in `shared/outbox/dispatcher.ts` started by the API process at
boot (F3).

Flow:

```txt
upload complete (staged originals verified)
-> same DB transaction: page statuses -> processing, INSERT outbox_events rows
-> dispatcher (in the TS API process): every 1s, batch 100:
   read unpublished rows oldest-first
   -> XADD events:chapter-page (wire format above)
   -> mark published_at / increment publish_attempts + last_publish_error
      on failure (row retried next tick)
```

Rules:

- Never publish to Redis as the only durable action — the outbox row is the
  source of truth; publish is retried until marked.
- Publishing is at-least-once too: dispatcher crash after XADD before
  `published_at` re-publishes the same `eventId`. Consumer dedup absorbs it.
- Multiple API instances would each run a dispatcher (no SKIP LOCKED in
  v1) — duplicate publishes, absorbed the same way. Revisit if the API ever
  scales horizontally.
- `last_publish_error` is not cleared on a later success; `published_at IS
  NOT NULL` marks the error historical.

## Rollback

**F7 (2026-06-05) removed the BullMQ path entirely** — enqueue, worker
entrypoint, compose service, `bullmq` dependency, and the
`CHAPTER_WORKER_BACKEND` flag. Kiln is the only chapter-page backend;
completion/retry write outbox events unconditionally. Rolling back to
BullMQ is now a git revert of the F7 commit + redeploy, not a flag flip.
Operational fallback for a *Kiln* outage is simpler than rollback: events
queue durably in the outbox/stream and Kiln drains the backlog when it
returns; failed imports stay retryable through the existing API route.

History (F5–F6): the two backends ran side by side behind
`CHAPTER_WORKER_BACKEND` (LazyScan `env.ts`, read at completion/retry
time):

- `bullmq` (default until F6): legacy enqueue, **no outbox events
  written** — this ended F2's unconditional dual-write, otherwise Kiln
  would real-process the same pages BullMQ owns.
- `redis_streams` (default since F6): outbox events written in the
  completion tx, no BullMQ enqueue.
- One backend per import: the choice was atomic per completion/retry call;
  flips happened only while no imports were mid-flight (the plan's `dual`
  per-import split was never needed; the binary flag satisfied the
  guarantee for F5/F6).


---


# Known Constraints

Inherited contracts from the live LazyScan pipeline. Source of truth is the
LazyScan code (paths below, all under `../LazyScan/api/src/`), not the infra
plan docs — the plan's envelope example said `pageId` while the (removed at
F7) BullMQ payload said `chapterPageId`; the envelope standardized on
`pageId` (history in `event-contract.md`).

## Status Enums (DB CHECK-constrained — exact strings)

From `migration/007_chapter_imports.sql` (+ `009`, `020`):

- `chapter_pages.status`: `waiting_upload | processing | ready | failed`
- `chapter_imports.status`: `uploading | processing | completed | failed`
- `chapters.status`: `draft | importing | processing | ready | failed`

Writing any other value violates a CHECK constraint. Kiln only ever moves
pages `processing -> ready|failed` (and re-asserts `processing` if needed).

## Keys Come From the Database (do not recompute)

`original_key` and `storage_key` are precomputed at import creation and
stored on the `chapter_pages` row (`modules/chapter/chapter.service.ts:100-114`).
Formats, for reference only:

```txt
original:  imports/{importId}/originals/{NNN}-{sanitizedFilename}
final:     manga/{mangaSlug}/chapters/{chapterId}/pages/{NNN}.webp
```

Kiln reads keys from the row. Deterministic final keys make retried uploads
overwrite-safe.

## Image Profile (output parity with the sharp pipeline)

From `shared/upload/image.ts`:

- inputs: `image/jpeg`, `image/png`, `image/webp`; max input **10MB**
- EXIF auto-rotate before measuring
- resize only when exceeding **1080×1920**, `fit: inside` (aspect
  preserved), **never enlarge**
- output: WebP, **quality 88**
- on success the row gets `width`, `height`, `size_bytes`, `image_url`

Kiln's output must be visually equivalent; pixel-exactness with sharp is not
promised (different codec builds), dimension/format/quality rules are.

## Pipeline Invariants

- Page `ready` is terminal success — reprocessing a ready page is a no-op.
  Since F7 the only implementation is Kiln's (`internal/processor`); the TS
  worker that originated the rule was removed.
- Aggregate progress (`processed_files`, `failed_files`, import + chapter
  status) is **derived from page rows**, never incremented. The TS
  `refreshImportProgress` CTE was ported to Kiln's `internal/store` (one tx
  with the page write) and removed from LazyScan at F7.
- Upload-complete verifies every staged original exists before any
  processing is requested (`chapter.service.ts:322`).
- Web polls `GET /manga/:id/chapter/uploads/:uploadId` — the API reads
  Postgres. Kiln never becomes part of the web contract.
- Chapter page PUTs go browser → MinIO/R2 directly via presigned URLs; only
  metadata and processing traverse the API/worker.

## Shared Redis

One Redis serves two tenants (three until F7):

- API cache: bare prefixes (`popular:*`, `manga:*`) with SCAN invalidation
  (`shared/cache/redis.ts`)
- Kiln: `events:chapter-page` stream — prefix chosen to collide with
  neither the cache nor the (now removed) BullMQ keys
- ~~BullMQ: `bull:chapter-page-processing:*` keys~~ — removed at F7
  (2026-06-05); queues were verified drained and the leftover bookkeeping
  keys deleted. The dual-phase rule (one backend per **import**, so the
  same page is never processed by both) is historical.

## Operational

- Migrations are owned by the LazyScan API (run at its boot via
  `migrate.ts`); Kiln runs none. Outbox/processed-events/failures tables
  landed as LazyScan migration `022_chapter_worker_outbox.sql` (F1,
  2026-06-04). Note: `chapter_worker_failures.raw_event TEXT` holds the
  raw stream message for poison rows (addition over the plan's SQL).
- Local infra (compose): postgres 16
  (`postgresql://lazyscan:lazyscan@postgres:5432/lazyscan`), redis 7
  (`redis://redis:6379`), MinIO (`http://minio:9000`, bucket `lazyscan`,
  path-style, creds `lazyscan`/`lazyscansecret`).
- Manual retry route (`POST .../uploads/:uploadId/retry`) re-enqueues
  non-ready pages by minting fresh `eventId`s (implemented F5,
  unconditional since F7 — the `CHAPTER_WORKER_BACKEND` flag is gone).

## Open Items (F0, 2026-06-04)

- ~~Image library~~ — resolved at F5 (2026-06-05): **govips/libvips**, the
  same engine sharp wraps — maximal output parity, no codec
  wheel-reinvention. Cost accepted: cgo (`CGO_ENABLED=1`), `vips-dev`/
  `vips` apk packages in the Dockerfile, `brew install vips` for local
  builds/tests.
- ~~Dispatcher location~~ — resolved at F3 (2026-06-04): lives inside the
  TS API process (`shared/outbox/dispatcher.ts`, 1s tick, batch 100,
  `XADD MAXLEN ~ 10000`); may still move to a separate service later.
- ~~Repo is not a git repository yet~~ — resolved same day: pushed to
  `github.com/LazyScan/Kiln` (2026-06-04).
- Proposed tunables pending real measurements: XAUTOCLAIM min-idle 60s and
  max deliveries 5 shipped at F4 as env-tunable defaults
  (`KILN_CONSUMER_CLAIM_IDLE`, `KILN_CONSUMER_MAX_DELIVERIES`); consumer
  concurrency resolved at F6 (2026-06-05): `KILN_CONSUMER_CONCURRENCY`,
  default 2 (BullMQ parity), per-batch bounded. Per-import aggregate
  refreshes are serialized via an import-row `FOR UPDATE` lock — the TS
  pipeline carries that lost-update race at concurrency 2; Kiln closes it.
