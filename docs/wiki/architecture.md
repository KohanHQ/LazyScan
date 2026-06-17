# Architecture

LazyScan is a self-upload manga reader. The pipeline is async, durable, and
event-driven — kept intact from the original stack, just compacted. Six runtime
containers: **postgres, redis, image-svc, mail-svc, api, web**.

```txt
            Cloudflare Tunnel (one hostname)
                       │
                  web (nginx)              ← serves SPA + proxies /api → api:3000
                       │
                  api (Bun/Elysia)  ──writes──► outbox table ──dispatcher──► Redis streams
                       │                                                        │
                       │ POST /convert (avatars/covers, sync)        ┌──────────┴──────────┐
                       ▼                                       events:chapter-page    events:email
                  image-svc (Go, ex-Kiln) ◄──────────────────────────┘                    │
                       │  convert + write chapter_pages back            mail-svc (Go, ex-Herald)
                       ▼                                                        │ SMTP
                      R2 ◄── webp pages/covers/avatars                          ▼
                                                                          mail provider
   Postgres ── chapter_pages, *_processed_events, outbox_events, ...
   Redis ───── cache + denylist + streams
```

## Components

- **api** (Bun/Elysia) — REST API. Owns DB migrations. Writes the outbox; an
  in-process dispatcher (`startOutboxDispatcher()`) drains it to Redis streams.
- **web** (nginx) — serves the built SPA, proxies `/api` to the API (single
  origin, no CORS). Page uploads go browser → R2 directly via presigned PUT.
- **image-svc** (Go, ex-Kiln) — consumes `events:chapter-page` (durable bulk
  page convert) **and** serves sync `POST /convert` (avatars/covers). Contract:
  [`modules/image-svc.md`](modules/image-svc.md).
- **mail-svc** (Go, ex-Herald) — consumes `events:email`, sends OTP mail.
  Contract: [`modules/mail-svc.md`](modules/mail-svc.md).
- **postgres** — system of record. **redis** — cache + auth denylist + the
  outbox→consumer streams (load-bearing; boot aborts if Redis is down).
- **R2** (Cloudflare) — object storage; pages/covers/avatars served directly via
  `STORAGE_PUBLIC_DOMAIN`.

Dropped vs the original stack: MinIO (→ R2), Aegis edge (→ nginx), the
observability stack (Prometheus/OTel/Grafana). See the plan for rationale.
