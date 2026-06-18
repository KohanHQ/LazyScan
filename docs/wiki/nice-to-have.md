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

### Core UI/UX (reported bugs)

User-reported 2026-06-18 (screenshots confirmed). Symptom + root cause below;
verify in the browser before committing the CSS fix.

- **Advanced filter — funnel icon overlaps the "Advanced" label.** In the Library
  header the status-filter funnel button renders on top of the adjacent Advanced
  button text (reads "Adv▣ced"). Cause: `.library-filter` (the funnel,
  `icons.filter()`, `web/src/pages/home.ts:168`) lives in `.library-search-wrap`
  and collides with the sibling `.library-advanced-btn` (`home.ts:177`) — a
  positioning/spacing bug in the `.heading-aside` row (`base.css` ~`:2737`).
  Likely fix: gap/positioning between the funnel and the Advanced button (the
  funnel may be absolutely positioned against the search input and bleed past it).
- **Save-as-draft checkbox — unstyled, mis-laid-out.** On the chapter upload form
  the `holdAsDraft` checkbox renders as a large raw white box stacked *above* its
  label instead of an inline row beside it (`web/src/pages/manage-chapter.ts:94`).
  Root cause: `.manage-checkbox` (`web/src/styles/base.css:3848`) sets
  `flex-direction: row`, `align-items: flex-start`, `gap: 8px` **without
  `display: flex`** — the flex props are inert, so input + label fall back to
  block/inline layout (a global form-`input` style likely also bleeds onto the
  native checkbox, hence the oversized white box). Fix: add `display: flex` (and
  confirm the checkbox isn't picking up a full-width form-input rule).

### Email / Auth

- **DKIM not configured (OTP deliverability)** — SPF + the sumo-verification TXT
  are in place, but DKIM is missing (session 2026-06-18 note), so OTP mail may
  spam-land. Public signup is only half-usable until codes deliver reliably. DNS
  fix, not code.

### Deploy / Acceptance

- **Acceptance items 7 & 8 never run live** — the over-cap `507`
  (`STORAGE_QUOTA_EXCEEDED`) and corrupt-page → `failed` paths exist in code and
  are smoke-tested, but were left untested on the live box by choice (`deploy.md`
  §4; session 2026-06-18). Verify against the real 8 GiB cap before trusting the
  cap / failure handling.

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

### Email / Auth (UX)

- **"Check your spam" hint on verify step** — after register the user lands on the
  verify-email view (`renderVerifyView`, `web/src/pages/login.ts:137`); the only
  copy is "Enter the 6-digit code sent to …" (`login.ts:149`). Add a small note
  near that hint (or by the Resend button) telling the user to check their spam
  folder if the code isn't in the inbox. Cheap mitigation for the DKIM
  deliverability gap (P1) — codes that spam-land are still findable. Copy-only
  change; no API/flow change.

### Profile / Personalization

- **Animated GIF owner avatar** — let the owner upload an animated GIF avatar and
  have the web profile render the animation. Three places block it today, all
  assuming static WebP:
  1. API MIME allowlists exclude GIF — `api/src/modules/upload/upload.validation.ts:46`
     and `api/src/shared/upload/image.ts:29` (`image/jpeg|jpg|png|webp` only).
  2. image-svc rejects non-JPEG/PNG/WebP input (`convert.go:85`) and exports
     **static** WebP via `ExportWebp` (`convert.go:115`) — animation is lost even
     if GIF were accepted.
  3. The avatar key is deterministic `avatars/{userId}.webp`
     (`upload.service.ts:61`), so the stored object is always `.webp`.
  Decision needed before scoping: store the GIF as-is (skip convert for the avatar
  type) vs transcode to **animated** WebP (libvips/govips multi-frame load
  `n=-1` + animated export). Web render is likely already fine (`<img>` plays
  animated GIF/WebP) — confirm the avatar slot isn't a static `background-image`
  crop (`web/src/utils/avatar.ts`, profile render).

Otherwise populate as items are reviewed against this repo. Carry candidates here
only after confirming they apply to the trimmed stack — do not import the
LazyScan-Stack backlog wholesale; that tree is experimental and its state diverges.

## P3 / Later / Only if needed

### Web / Branding

- **Replace the HTML favicon** — currently the scaffold default
  (`web/index.html:6` → `web/public/favicon.svg`). Swap for a real LazyScan-branded
  icon. Trivial, low-impact.

- **Distributed rate limiting** — the limiter store is an in-memory `Map`
  (`rate.limit.ts:10`), correct for the single API instance this stack runs. Move
  to a shared store (Redis) only if the API is ever scaled past one replica.
- **Re-add observability** — Prometheus/OTel were stripped from image-svc and
  mail-svc during the lite trim (Phases 2–3). `/metrics` still exists on the API
  but is internal-only. Re-add worker metrics only if debugging a live incident
  needs cross-service visibility.
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

### Email / Auth

- **Email OTP verification + mailer** — implemented as `mail-svc` (the stripped
  Herald + implicit-TLS SMTPS to Sumopod on 465), consuming `events:email` from the
  outbox → Redis Streams pipeline. Register is hard-verify (no session until
  `verify-email`); login gates unverified accounts (`EMAIL_NOT_VERIFIED`). See
  `modules/mail-svc.md` and session 2026-06-17 (Phase 3).

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
