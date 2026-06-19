# Nice-to-have / Known Gaps / Deferred

Living backlog of deferred work and known gaps, sorted by rough urgency. Keep this
file actionable. Move accepted caveats, completed work, and long rationale to
[deferred-notes.md](deferred-notes.md).

Treat implementation as the source of truth. Items here are not scheduled unless a
session explicitly scopes them.

Review workflow:

1. Keep unreviewed or unclear candidates in this file.
2. Review manually with the user and ask for clarification when assumptions are
   unclear.
3. If the user approves the approach, update
   [approved-to-implement.md](approved-to-implement.md).
4. If the user does not approve it yet, leave it here or move long rationale to
   [deferred-notes.md](deferred-notes.md).

Urgency guide:

- **P0 / Approved next** — already approved or high leverage unblocker.
- **P1 / Important** — improves reliability, operations, or core user workflows.
- **P2 / Product polish** — useful user-facing improvements, not blocking.
- **P3 / Later** — speculative, low-impact, or only needed after growth.
- **Deferred / Revisit only with new decision** — known but intentionally not active.
- **Done / Historical reference** — implemented items kept briefly for context.

## P0 / Approved next

- _(empty — rate limiting shipped 2026-06-18; see Done.)_

## P1 / Important

### Deploy / Acceptance

- **Acceptance item 7 (`507` over-cap) never run live** — the over-cap `507`
  (`STORAGE_QUOTA_EXCEEDED`) path exists in code and is smoke-tested but unverified
  on prod: no quota lever on the live box (needs ~8 GiB of real content or a
  temporary `STORAGE_QUOTA_BYTES` drop + restore). Parked until there's a safe way
  to exercise it. (Item 8, corrupt-page → `failed`, **verified live 2026-06-19** —
  see `deploy.md` §4 / session 2026-06-19.)

### Storage

- **Orphaned-object sweep (residual)** — staged page originals and the `logs`
  table are already pruned (see Done). What is still unhandled: objects with no
  live DB reference — covers/avatars where the R2 PUT succeeded but the DB write
  failed, and leftovers from deleted manga. `pruneStagingOriginals` only reclaims a
  known DB-tied set, not a list-bucket-vs-DB diff. Lower urgency than it looks
  (staged originals were the main growth source and are handled), but on an 8 GiB
  cap / R2 free-tier box the drift is real over time.

### Tests / Tooling

- **API negative-path coverage** — the smoke suite (17/17) leans on happy paths and
  key regressions. Add targeted authorization, validation, and error-path tests as
  behavior changes — especially around the new `/api/v1` mount and the quota gate.

## P2 / Product polish

### Profile / Personalization

- **General user avatar flow** — owner-only custom avatar exists
  (`upload.service.ts`, owner-gated `avatar` type); everyone else stays on the
  derived avatar. Open avatar upload/selection to all users. Route + convert
  pipeline already exist — mainly auth-gate widening + a web entry point. Pairs with
  **Animated GIF owner avatar** (shipped — see Done; same MIME/convert touch
  points). _(from legacy P2 review 2026-06-19; carried over as still-relevant.)_

### Upload / Management

- **Replace individual failed page** — allow replacing one staged/failed page instead
  of re-running the whole original. _(from legacy P2; not verified against trimmed
  repo — check current retry surface before scoping.)_

### Reader Experience

- **Reader zoom/pan** — _verified absent 2026-06-19_. Reader has direction
  (ltr/rtl/vertical incl. webtoon scroll), fit modes, and preload
  (`pages/reader.ts`, `state/settings.ts`) but no zoom/pan for inspecting hi-res
  pages. QoL on an otherwise-mature reader. Effort: low-med. _(from legacy P2.)_

- **Double-page / spread mode**, **chapter jump/search inside reader**, **reader
  shortcut/help overlay** — additional legacy reader-P2 ideas; not verified against
  the trimmed reader. Confirm against `pages/reader.ts` before scoping. _(from legacy
  P2.)_

### Library / Discovery

- **Author/artist pages** — _verified absent 2026-06-19_ (no author/artist route in
  `web/src`). List manga by the same creator from existing metadata. Discovery win,
  data already stored. Effort: low-med. _(from legacy P2.)_

- **Card-level favorite/queue affordance**, **reading queue manual reorder**
  (`user_library.position` reserved), **new-chapters feed read-state polish** —
  legacy library-P2 ideas; not verified against trimmed repo (note: library advanced
  filter/sort already shipped in trimmed). Confirm before scoping. _(from legacy P2.)_

> Cherry-pick note (2026-06-19): the above were surfaced by reviewing the legacy
> `LazyScan-Stack` backlog against this repo. Items tagged _verified absent_ were
> grep-confirmed missing here; untagged ones still need a trimmed-repo check. Legacy
> "Done" ≠ trimmed Done — webtoon scroll, library advanced filter/sort, and reading
> status are already shipped here despite legacy still listing them. Promote chosen
> items to P1/P0 (or `approved-to-implement.md`) when scoped.

Otherwise populate as items are reviewed against this repo. Carry candidates here
only after confirming they apply to the trimmed stack — do not import the
LazyScan-Stack backlog wholesale; that tree is experimental and its state diverges.

## P3 / Later / Only if needed

### Deploy / Build

- **Off-box image build → registry** — `docker compose up -d --build` on the VPS
  recompiles api + web on the box; the web `bun run build` (vite + tsc) is the
  long pole and likely swaps on the 1.9 GB VM (slow deploys). Move the build to
  CI (GitHub Actions) → push images to GHCR → VPS does `docker compose pull &&
  up -d` (no compile on the box). Cost: CI + registry wiring + image-tag pinning
  in compose. Cheap interim: deps layers already cache (Dockerfiles install
  before `COPY src`); rebuild only changed services (`--build api web`).

### Web / Branding

- **Replace the HTML favicon** — currently the scaffold default
  (`web/index.html:6` → `web/public/favicon.svg`). Swap for a real LazyScan-branded
  icon. Trivial, low-impact.

- **Distributed rate limiting** — the limiter store is an in-memory `Map`
  (`rate.limit.ts:10`), correct for the single API instance this stack runs. Move
  to a shared store (Redis) only if the API is ever scaled past one replica.
- **Re-add observability (compact OTel)** — Prometheus/OTel were stripped from
  image-svc and mail-svc during the lite trim (Phases 2–3); `/metrics` still exists
  on the API but is internal-only. Idle footprint is tiny (~84 MB total across the
  6 containers, near-zero CPU), so RAM headroom exists — but the self-hosted triad
  (OTel Collector ~50–100 MB + Prometheus ~80–150 MB **+ unbounded local TSDB disk**
  + Grafana ~100–150 MB) breaks the lite ethos for 6 small containers. Do **not**
  self-host the triad. Two compact paths that fit:
  1. **Metrics-only, scrape-free** — in-process OTel metrics SDK in api/image-svc/
     mail-svc exposing `/metrics` (API already has it); curl-time snapshots, no
     collector, no storage. ~0 cost, but no history/dashboards.
  2. **Push to external free tier (recommended)** — thin OTLP exporter (SDK-direct
     or one Grafana Alloy agent) → Grafana Cloud free tier (10k series). Dashboards
     + history with **no self-hosted TSDB**, so no local VM disk growth. (Note: the
     8 GiB cap is the R2 object-storage gate, unrelated to Prometheus local-disk
     TSDB — separate tier.) Trade-off: external dependency.
  Stays P3 (idle-low removes the blocker, not a need). Promote to P2 only when
  committing to wire option 2. **Don't re-litigate self-host:** VPS is 1.9 GB RAM,
  shared with non-lazyscan containers; the triad would eat ~half the free margin and
  re-introduces the PromQL/scrape/dashboard overhead the lite trim deliberately
  dropped. **Dozzle already covers the infra layer** (per-container CPU/mem/liveness)
  — OTel is only worth it for *app-level* signals (request rate, p99, outbox queue
  depth, conversion timings, error rates), and only via push (option 2) when a real
  "why is this slow" can't be answered from logs.
- **Request IDs / correlation IDs** — logging works without them; add only if
  cross-service request correlation becomes necessary.

## Deferred / Revisit only with new decision

- **MinIO + replica** — intentionally dropped by the lite trim in favor of R2
  (single object store, no self-hosted storage tier). Re-raise only with a new
  hosting decision.
- **Aegis (auth gateway)** — intentionally dropped by the lite trim; auth lives in
  the API. Re-raise only with a new decision.

## Done / Historical reference

Move old done notes to [deferred-notes.md](deferred-notes.md) once they are no
longer useful for near-term planning.

### Profile / Personalization

- **Animated GIF owner avatar** — shipped + **verified live 2026-06-19**. Owner
  GIF avatar is stored as-is (skip image-svc convert, which only emits static
  WebP) at `avatars/{userId}.gif`; static PNG/JPEG/WebP still convert to 512px
  WebP. Web `<img>` plays it (no render change). Chose store-as-is over
  animated-WebP transcode to avoid touching the load-bearing `convert.go`.
  Owner-only (one object). See session 2026-06-19 + commit `7dc2040`.

### Upload / Management

- **ZIP/CBZ chapter upload** — shipped + deployed 2026-06-19. Client-side unzip
  (`fflate`) in `web/src/utils/cbz.ts`; archive → `File[]` feeds the existing
  presign → image-svc convert → outbox path (server untouched). Desktop-gated
  (`pointer:fine` + `min-width:1024px`) + 250 MB cap; page-by-page is the mobile
  fallback. Verified live at 184 pages, RAM trivial. Covers kept as page 1 by
  design. v2 streaming/worker unzip parked (gate makes it moot). See session
  2026-06-19.

### Web / UI (reported bugs)

- **Library funnel / draft-checkbox CSS bugs** — fixed 2026-06-18. (1) Library
  header funnel overlapped the Advanced button: the absolute funnel/kbd/pop now
  anchor to a new inner `.library-search-box` instead of `.library-search-wrap`
  (which also holds Advanced). (2) Chapter-upload draft checkbox rendered as a big
  white box above its label: `.manage-form .manage-checkbox` now sets
  `display: flex` (scoped to outrank `.manage-form label`'s grid) and
  `.manage-checkbox input` resets the bled-in field look (min-height/border/
  padding/background). Web-only, no JS. See session 2026-06-18.

### Email / Auth

- **Email OTP verification + mailer** — implemented as `mail-svc` (the stripped
  Herald + implicit-TLS SMTPS to Sumopod on 465), consuming `events:email` from the
  outbox → Redis Streams pipeline. Register is hard-verify (no session until
  `verify-email`); login gates unverified accounts (`EMAIL_NOT_VERIFIED`). See
  `modules/mail-svc.md` and session 2026-06-17 (Phase 3).
- **DKIM (OTP deliverability)** — configured 2026-06-18; OTP mail now lands in the
  inbox (verified by received message). Closes the earlier SPF-only spam-land gap.
- **"Check your spam" hint on verify step** — added a muted `.auth-hint` line under
  the code prompt in `renderVerifyView` (`web/src/pages/login.ts`). Copy-only, no
  CSS/JS. See session 2026-06-18.

### Storage

- **Staged page-original prune** — auto poller (`startStoragePrune` →
  `pruneStagingOriginals`, gated by `ENABLE_STORAGE_PRUNE`) plus on-demand admin
  `POST /storage/prune`. Reclaims originals image-svc has already converted.
- **Log retention / prune** — migration `026_logs_prune.sql` + `prune_logs()` SQL
  function + admin `POST /logs/prune` with a default retention window. The `logs`
  table no longer grows unbounded.
- **8 GiB storage cap** — chapter-import admission gate (`507`
  `STORAGE_QUOTA_EXCEEDED`) on projected `SUM(size_bytes) WHERE status='ready'` +
  incoming. Undercounts staged/in-flight originals (absorbed by the ~2 GB margin +
  prune). See `known-constraints.md` (Phase 4).

### Deploy / Edge

- **Rate limiting (live)** — fixed-window limiter wired + verified in production
  (2026-06-18): global 100/15min, auth strict 5/15min + loose 20/15min, public-read
  60/1min burst cap, keyed on the real client IP (`CF-Connecting-IP` → nginx
  `X-Real-IP`). See session 2026-06-18 (deploy) and `approved-to-implement.md`. The
  limiter had been inert (Elysia local-scope hook stripping + name dedup); fixed.
- **Single-origin nginx edge** — SPA at `/`, API at `/api/v1/*`, `/health` at root;
  same host, no CORS, same-site cookies; 10 MB edge body cap. `/metrics`
  internal-only. See session 2026-06-17 (Phase 5) and `deploy.md`.
- **R2 storage profile** — backend-agnostic `STORAGE_*` S3 client; R2 by env
  (`STORAGE_PROVIDER=s3`), objects served from the R2 public domain, page uploads
  via presigned PUT. See `known-constraints.md`.
- **API drops `sharp`** — avatars/covers now convert synchronously via image-svc
  `POST /convert`; chapter pages stay async via the outbox. See session 2026-06-17
  (Phase 4).
