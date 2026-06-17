# Module: mail-svc (ex-Herald)

> Salvaged from Herald `docs/wiki/` at Phase 1 scaffold — folded architecture +
> event-contract into one module doc (Herald had no known-constraints doc).
> Reflects the **pre-strip** state of the code as copied. Phase 3 (plan §6)
> strips metrics/OTel/log-framework and must update this doc to match.
> Originals: `LazyScan-Stack/Herald/docs/wiki/`.
>
> SECURITY: the OTP event payload carries the **plaintext code** — never log it
> (see Event Contract below). This rule is load-bearing; preserve it in Phase 3.

---


# Architecture

Herald is a pure email projector: it consumes
`auth.email.verification_requested` events from `events:email` and sends
the OTP email. No auth tables are read or written; everything needed to
send is in the event payload (the one deliberate exception to the IDs-only
envelope rule — herald-otp-plan.md).

```txt
LazyScan API                         Herald
POST /auth/register
-> same tx: users(verified=false)
   + email_verifications + outbox
-> dispatcher: outbox -> XADD events:email
                                     XREADGROUP (group herald)
                                     -> parse envelope
                                     -> dedup by eventId
                                     -> send (go-mail SMTP)
                                     -> MarkProcessed -> XACK
```

## Packages

```txt
cmd/herald/        wiring + graceful drain-then-close shutdown
internal/config/   env parsing (HERALD_*, DATABASE_URL, REDIS_URL)
internal/consumer/ events:email / herald group — Kiln's XREADGROUP/
                   XAUTOCLAIM/poison/ack lifecycle, ported; ~10s
                   XPENDING poll feeds the stream gauges
                   (StreamObserver seam, O3)
internal/processor/ envelope parse (incl. double-encode guard) ->
                   schemaVersion check -> dedup -> send ->
                   MarkProcessed -> ack; never logs the code;
                   reports durable outcomes (ok|dedup|failed)
                   through the Observer seam (O3)
internal/metrics/  Prometheus registry + every herald_* metric
                   (observability plan O3); the only client_golang
                   importer; type label clamped to known event types
internal/mailer/   Mailer interface + ErrPermanent sentinel + go-mail
                   SMTP impl (multipart plain-text + HTML template;
                   5xx = permanent, else transient; debug logging
                   never enabled — it dumps the body and the code)
                   + Log impl kept as the rollback target
internal/store/    IsProcessed / MarkProcessed / RecordFailure over
                   herald_processed_events / herald_failures
internal/health/   /healthz on :8086 (Aegis 8080, Kiln 8085) +
                   /metrics on the same internal mux when wired
                   (O3; port unpublished in compose)
```

Policy lives in the processor; the consumer only moves messages and obeys
the returned `Outcome`. The zero value is `OutcomeRetryable` — a code path
that forgets to decide leaves the message pending, never acks unhandled
work.

## Metrics (observability plan O3)

`/metrics` joins the healthz mux on `HERALD_ADDR` (`:8086`, unpublished in
compose — Prometheus scrapes over the compose network; Grafana is the only
human-facing surface). All `herald_*`, same shape as Kiln's:

| Metric | Type | Labels |
|---|---|---|
| `herald_events_processed_total` | counter | `type`, `outcome` (`ok`\|`dedup`\|`failed`) |
| `herald_event_processing_duration_seconds` | histogram | `type` |
| `herald_stream_pending` | gauge | — (XPENDING count, ~10s poll) |
| `herald_stream_oldest_pending_seconds` | gauge | — (age of oldest pending entry, from its stream ID) |
| `herald_poison_total` | counter | — |

Outcome mapping: `dedup` = idempotency skip (IsProcessed hit, poison
threshold on already-processed); `failed` = durable failure (schemaVersion
reject, permanent SMTP reject, poison recorded); `ok` = everything else
durably acked (sent, unknown-eventType skip). Retryable attempts are not
counted — the entry stays pending and the stream gauges carry that signal.
The `type` label is clamped to the known event types (`other` otherwise).
Metrics carry no payload data — the never-log-the-code rule holds. The
seams (`processor.Observer`, `consumer.StreamObserver`) are nil-safe:
unwired (tests, rollback) means no metrics, zero behavior change.
Dependency: `github.com/prometheus/client_golang v1.23.2` (Aegis pin,
dep-per-phase — O3 is its phase).

## Bookkeeping tables

Created by LazyScan migration `023_email_verification.sql` (api boot runs
migrations before Herald consumes — Kiln/022 precedent):

- `herald_processed_events(event_id PK, event_type, processed_at)` — a row
  here means the email was sent (or the event was otherwise durably
  resolved). Dedup for at-least-once delivery.
- `herald_failures(id, event_id, user_id, error_message, raw_event,
  failed_at, retryable)` — durable poison/non-retryable failure records.

## Phases (H0–H7)

Full table: `../../LazyScan/docs/wiki/herald-otp-plan.md §Phases`.

| Phase | Scope | Status |
|---|---|---|
| H0–H3 | Plan/ADR, migration 023, API hard-verify, dispatcher routing | done (LazyScan side, 2026-06-05) |
| H4 | This skeleton: consumer/processor log-only, healthz, Dockerfile | done 2026-06-05 |
| H5 | go-mail SMTP mailer + plain-text template; tests vs Mailpit | done 2026-06-06 |
| H6 | Compose: mailpit + herald — registration flow becomes whole | done 2026-06-06 |
| **H7** | Web verify UX + wiki updates (LazyScan side) | done 2026-06-06 |

Herald runs in the Atelier stack compose
(`/Users/konnco/Atelier/docker-compose.yml`, unversioned — repos carry only
Dockerfiles) alongside `mailpit` (`axllent/mailpit:v1.30.1`, UI
http://localhost:8025, SMTP :1025, `/mailpit readyz` healthcheck). Herald
depends on api healthy (migration 023 runs at api boot), postgres, redis,
and mailpit healthy; `SMTP_HOST=mailpit`, `SMTP_STARTTLS=false`.


---


# Event Contract

**Binding** since H3 (the LazyScan dispatcher routes `auth.email.*` to
`events:email`): additive-only in v1, anything else is a schemaVersion
bump, `eventType` never reused for a different meaning, consumers ignore
unknown fields. Same discipline as `Kiln/docs/wiki/event-contract.md`.
Authoritative source: `../../LazyScan/docs/wiki/herald-otp-plan.md`.

## `auth.email.verification_requested` (schemaVersion 1)

```json
{
  "eventId": "uuid",
  "eventType": "auth.email.verification_requested",
  "schemaVersion": 1,
  "occurredAt": "2026-06-05T10:00:00Z",
  "aggregateType": "user",
  "aggregateId": "user_uuid",
  "payload": {
    "userId": "user_uuid",
    "email": "person@example.com",
    "code": "482917",
    "expiresAt": "2026-06-05T10:10:00Z"
  }
}
```

The payload carries the **plaintext code** — the one deliberate exception
to the IDs-only envelope rule (Herald has nothing to look up). Mitigations:
10-minute TTL bounds exposure; the code is **never logged** anywhere; the
producer writes it only to `outbox_events.payload` and (on poison) it may
persist in `herald_failures.raw_event` for diagnosis.

## Stream topology

| Item | Value |
|---|---|
| Stream key | `events:email` |
| Consumer group | `herald` |
| Consumer name | `herald-{hostname}-{pid}` |
| Wire format | single field `event` = envelope JSON, `MAXLEN ~ 10000` |
| Group creation | `XGROUP CREATE events:email herald 0 MKSTREAM` (BUSYGROUP ignored) |
| Delivery | at-least-once; Herald dedups by `eventId` (`herald_processed_events`) |
| Resend | new event, new `eventId` |

## Delivery semantics

Ack-after-durable-outcome: the consumer XACKs only when the processor
reports `OutcomeAck`, which requires the outcome to already be durable in
Postgres. A lost ack means redelivery hits the dedup check and no-ops.

Poison path: entries that cannot be handled stay pending; once the
XAUTOCLAIM reclaim sees the delivery count reach
`HERALD_CONSUMER_MAX_DELIVERIES`, the processor records a failure row and
acks.

## Processor outcome matrix

| Case | Outcome |
|---|---|
| unparseable envelope (incl. double-encoded jsonb payload, missing email/code) | pending → poison threshold → failure row + ack |
| `schemaVersion != 1` | non-retryable failure row + ack (not marked processed — rejected, not handled) |
| unknown `eventType` | MarkProcessed + ack (forward-compat) |
| duplicate `eventId` | ack (dedup) |
| send transient error | no ack → redelivery retries |
| send permanent reject (`mailer.ErrPermanent`) | failure row + MarkProcessed + ack |
| success | MarkProcessed + ack |

At H4 the mailer is log-only and never fails: every well-formed event ends
in MarkProcessed + ack with a "would send" log line (code redacted).
