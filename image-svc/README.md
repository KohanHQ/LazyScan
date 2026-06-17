# Kiln

LazyScan's chapter-page processing worker: Go + Redis Streams + Postgres
outbox, replacing the BullMQ worker. Phase F5 — real page processing
(download → libvips convert → upload → page/aggregate writes) behind
LazyScan's `CHAPTER_WORKER_BACKEND` flag.

## Run

Needs libvips (`brew install vips` / `apk add vips-dev`) — govips is cgo.

```sh
DATABASE_URL=... REDIS_URL=... STORAGE_ENDPOINT=... \
STORAGE_ACCESS_KEY_ID=... STORAGE_SECRET_ACCESS_KEY=... \
STORAGE_BUCKET=... STORAGE_PUBLIC_DOMAIN=... \
go run ./cmd/kiln
curl http://localhost:8085/healthz
```

Full env table and the flag runbook: `docs/wiki/running.md`.

See `docs/wiki/` for the event contract, inherited constraints, phase plan,
and session history.
