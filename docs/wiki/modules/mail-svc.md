# Module: mail-svc (ex-Herald)

> Salvaged from Herald `docs/wiki/` at Phase 1 scaffold — folded architecture +
> event-contract into one module doc. **Post-strip (Phase 3, plan §6):**
> Prometheus metrics, the metrics/health HTTP framework, and the JSON-log
> framework are removed; module path is `github.com/latoulicious/lazyscan/mail-svc`,
> env prefix `HERALD_*` → `MAIL_SVC_*`, logging is stdlib `slog` text.
> The consumer/mailer/processor/store **behavior** is unchanged.
> Originals: `LazyScan-Stack/Herald/docs/wiki/`.
>
> SECURITY: the OTP event payload carries the **plaintext code** — never log it
> (see Event Contract below). This rule is load-bearing and is preserved.

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
cmd/mail-svc/      wiring + graceful drain-then-close shutdown;
                   inline GET /health → 200 on MAIL_SVC_PORT (8002)
internal/config/   env parsing (MAIL_SVC_*, DATABASE_URL, REDIS_URL,
                   SMTP_*) — SMTP_SSL and SMTP_STARTTLS mutually exclusive
internal/consumer/ events:email / herald group — XREADGROUP/
                   XAUTOCLAIM/poison/ack-after-durable lifecycle
internal/processor/ envelope parse (incl. double-encode guard) ->
                   schemaVersion check -> dedup -> send ->
                   MarkProcessed -> ack; never logs the code
internal/mailer/   Mailer interface + ErrPermanent sentinel + go-mail
                   SMTP impl (multipart plain-text + HTML template;
                   SMTPS/STARTTLS/plaintext; 5xx = permanent, else
                   transient; debug logging never enabled — it dumps
                   the body and the code) + Log impl (rollback target)
internal/store/    IsProcessed / MarkProcessed / RecordFailure over
                   herald_processed_events / herald_failures
```

Policy lives in the processor; the consumer only moves messages and obeys
the returned `Outcome`. The zero value is `OutcomeRetryable` — a code path
that forgets to decide leaves the message pending, never acks unhandled
work.

## Observability (stripped in Phase 3)

The Prometheus `herald_*` metrics, the `/metrics` endpoint, and the
`processor.Observer` / `consumer.StreamObserver` seams are **removed** —
along with the `prometheus/client_golang` dependency. The only HTTP surface
left is `GET /health` → 200 on `MAIL_SVC_PORT` (8002), used by the compose
healthcheck. Operational signal is `slog` text on stdout (the code is never
logged). The processor's durable-outcome semantics (sent, dedup, failure,
poison) are unchanged; only their metric emission is gone.

## TLS transport (Phase 3)

The mailer supports three transports, set by env (`SMTP_SSL` and
`SMTP_STARTTLS` are mutually exclusive — config rejects both true):

| Want | `SMTP_SSL` | `SMTP_STARTTLS` | Typical port |
|---|---|---|---|
| SMTPS / implicit TLS (Sumopod) | `true` | `false` | 465 |
| STARTTLS upgrade | `false` | `true` | 587 |
| plaintext (dev Mailpit) | `false` | `false` | 1025 |

`.env.example` ships the Sumopod SMTPS profile (`smtp.sumopod.com`, 465).

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

In the LazyScan-lite compose (`docker-compose.yml`), mail-svc builds from
`./mail-svc` and depends on postgres healthy (migration 023 runs at api boot)
and redis started. No published port (consumer-only; `/health` is internal to
the healthcheck). Production SMTP comes from `.env` (Sumopod SMTPS profile by
default). For a local Mailpit run instead: `SMTP_HOST=mailpit`, `SMTP_PORT=1025`,
`SMTP_SSL=false`, `SMTP_STARTTLS=false`.


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
