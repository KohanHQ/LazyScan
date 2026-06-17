# Project Agent Instructions

You are working inside **LazyScan** — a self-upload manga reader assembled as a
monorepo of four services backed by Postgres, Redis, and Cloudflare R2. This file
governs all four; there are no per-service `AGENTS.md`.

Your primary role is:

* understanding the existing codebase
* implementing features safely
* debugging issues
* performing targeted refactors
* maintaining architecture consistency
* updating project documentation when needed

Do not immediately generate code from prompt context alone.

Always inspect existing implementation first.

Prioritize **correctness, maintainability, readability, operational safety, small
reviewable diffs** over theoretical purity, unnecessary abstractions, broad rewrites.

---

# Repository Layout

| Path | Service | Stack | Notes |
|---|---|---|---|
| `api/` | API | Bun + Elysia (TS) | REST API; owns DB migrations; outbox + in-process dispatcher → Redis streams |
| `web/` | Web | SPA + nginx | serves SPA, proxies `/api`; page uploads go browser → R2 (presigned PUT) |
| `image-svc/` | Image worker (ex-Kiln) | Go | consumes `events:chapter-page` + sync `POST /convert` |
| `mail-svc/` | Mail worker (ex-Herald) | Go | consumes `events:email`, sends OTP mail |

Architecture overview: `docs/wiki/architecture.md`. Per-service contracts:
`docs/wiki/modules/{image-svc,mail-svc}.md`.

> **Build is phased.** The repo is assembled per
> `LazyScan-Stack/.hermes/plans/2026-06-17_173000-lazyscan-lite-concrete.md`.
> image-svc/mail-svc are currently **pre-strip** forks of Kiln/Herald — they
> still carry Prometheus/OTel/log-framework that Phases 2–3 remove. The module
> docs describe that pre-strip state; update them in the same change that strips.

---

# Project Wiki

Documentation lives in `docs/wiki`. Read relevant docs before significant work.

```txt
docs/wiki/
  README.md              index
  architecture.md        6-container async pipeline
  conventions.md         coding + commit conventions
  database.md            schema ownership, migrations
  domain.md              manga / chapters / pages / users
  known-constraints.md   repo-wide inherited contracts + hidden constraints
  troubleshooting.md     debugging findings, operational caveats
  findings.md            code-review findings log (paired with resolutions.md)
  resolutions.md         fixes for findings (same IDs, never orphaned)
  modules/               per-service contracts
  sessions/              append-only session history (DD-MM-YYYY.md)
  decisions/             architecture decision records
```

If documentation conflicts with implementation: **treat code as source of truth**
and mention the drift.

---

# Session Logging

After meaningful implementation changes, append (never overwrite) an entry to
`docs/wiki/sessions/DD-MM-YYYY.md`:

```md
---
time: 08:42 PM
type: feature|fix|refactor|investigation
breaking_change: false
modules:
  - example-module
---

# Summary
# Files Touched
# Previous Behavior
# New Behavior
# Reason For Change
# Risks
# Notes
```

---

# Before Writing Code

1. inspect surrounding code
2. identify existing patterns
3. identify affected modules
4. identify hidden contracts
5. identify rollback risk
6. identify async/distributed implications
7. prefer the smallest safe implementation

Do not assume current architecture is accidental. "Ugly" behavior may exist for
operational reasons. The hidden contracts here are real (see Change Safety below
and `docs/wiki/known-constraints.md`): status enums are DB CHECK-constrained,
storage keys are precomputed on page rows, aggregate progress is derived not
incremented.

---

# Change Safety Rules

## Repo-wide

Do NOT modify unless explicitly required: DTO/response formats, mapper behavior,
auth behavior, retry semantics, idempotency guarantees, migration history, public
API contracts. Avoid mixing cleanup, formatting, refactors, and behavior changes
in one diff. If a breaking change seems necessary: explain why, explain risks,
propose safer alternatives first.

## Event pipeline (api ↔ workers — the load-bearing contract)

* The **event envelope and stream topology** are additive-only in v1; anything
  else is a `schemaVersion` bump. Streams: `events:chapter-page`, `events:email`.
* **ack-after-durable-outcome** ordering — never ack before the outcome is durable
  in Postgres.
* **dedup by `eventId`** (`*_processed_events`) and the worker poison/failure path.
* The **outbox is the source of truth**, not Redis (see `known-constraints.md`).

## image-svc (Go)

* status enum strings + their transition semantics (workers only move pages
  `processing → ready|failed`)
* the **key-from-DB rule** — never recompute storage keys
* **derived aggregate progress** — never increment counters
* **`ready`-is-terminal** idempotency
* the image profile (fit 1080×1920, never enlarge, WebP q88, ≤10 MB in)
* consumer env names/defaults (claim-idle, max-deliveries, concurrency) — note
  Phase 2 renames the `KILN_*` prefix; preserve the semantics

## mail-svc (Go)

* **the verification code is never logged** — not at any level, not in error
  strings, not in poison diagnostics that reach logs. Plaintext code lives only in
  the envelope payload and (on poison) `herald_failures.raw_event`.
* dedup-by-`eventId` (`herald_processed_events`); owns no auth tables
* mail-svc env names/defaults — note Phase 3 renames the `HERALD_*` prefix

## api (Bun/Elysia, TS)

* preserve the outbox table, `startOutboxDispatcher()`, and stream routing
* preserve transaction boundaries and validation flow
* the API owns DB migrations; the Go workers run none

---

# Async / Distributed Concerns

For queues, retries, workers, async jobs — always assume duplicate delivery,
retries, and unreliable ordering. Protect correctness first: idempotency, retry
safety, partial failures, transaction consistency.

---

# Database / Migration Rules

Migrations are owned by the API and run at its boot. Prefer additive migrations,
backward compatibility, phased rollout. Avoid destructive schema changes and
rewriting migration history unless explicitly required.

---

# Debugging Expectations

Inspect actual execution flow first; verify assumptions from code; prefer evidence
over guessing; trace the request/event lifecycle and transaction boundaries. Do
not invent root causes. If uncertain, say so and explain why.

---

# Testing Expectations

* **Go (image-svc, mail-svc):** verification baseline — `gofmt -l` clean,
  `go vet ./...` clean. White-box tests are parked at `test/*.go.disabled`
  (compile only from inside their package dirs); restore the relevant ones when
  behavior changes, or state the remaining risk.
* **TS (api):** add/update tests when practical; focus on regression,
  transactional correctness, async behavior, edge cases.
* Run live checks against the running stack when pipeline behavior is touched.

Targeted dependencies are accepted (the Go services are **not** stdlib-only), but
a dependency is added only in the phase that uses it — challenge any added early.

---

# Documentation Expectations

If architecture or behavior changes meaningfully, update the relevant docs under
`docs/wiki` (and the module doc for the affected service). Prefer concise,
operationally useful, append-only notes. Avoid giant documentation dumps and
speculative documentation.

---

# Commits

Subject-only Conventional Commits (`type: summary`). No body unless the "why" is
non-obvious, no `Co-Authored-By`, no phase tokens. Never rewrite/force-push
`main`; work on `development`.

---

# Communication Style

Be direct and pragmatic. Challenge unsafe assumptions. Explain tradeoffs clearly.
Prefer maintainable solutions over theoretical perfection. Protect long-term
maintainability and operational stability.
