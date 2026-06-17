# image-svc (ex-Kiln)

LazyScan's image worker (Go). Two entry points in one service:

- **Redis consumer** of `events:chapter-page` — downloads the staged
  original, converts (libvips), writes the page `ready`/`failed` + refreshes
  aggregates. Durable, at-least-once, idempotent.
- **Sync `POST /convert`** — so the API can drop `sharp` for avatars/covers.

## Run

Needs libvips (`brew install vips` / `apk add vips-dev`) — govips is cgo.

```sh
DATABASE_URL=... REDIS_URL=... STORAGE_ENDPOINT=... \
STORAGE_ACCESS_KEY_ID=... STORAGE_SECRET_ACCESS_KEY=... \
STORAGE_BUCKET=... STORAGE_PUBLIC_DOMAIN=... \
go run ./cmd/image-svc

curl http://localhost:8001/health
curl -X POST "http://localhost:8001/convert?w=512&h=512" --data-binary @test.jpg
```

`IMAGE_SVC_PORT` (default 8001) and `IMAGE_SVC_CONSUMER_*`
(claim-idle/max-deliveries/concurrency) are the optional tunables. Full
contract: `docs/wiki/modules/image-svc.md`.
