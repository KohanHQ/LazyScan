# Deploy

Phase 5 runbook. Single-origin edge (nginx) → 6-container stack on a VPS, one
Cloudflare Tunnel hostname, R2 for objects. Operator steps — handles **real
secrets**; `.env` is git-ignored, never commit it.

## Topology

```
Cloudflare Tunnel (manga.sanctuary.my.id) → 127.0.0.1:8080 (web/nginx)
  /            → SPA
  /api/v1/*    → api:3000   (single origin, no CORS, same-site cookies)
  /health      → api:3000   (ops; unlogged)
images (covers/pages/avatars) → R2 public domain (STORAGE_PUBLIC_DOMAIN), not via nginx
```

`/metrics` is never exposed at the edge — scrape it on the internal network only.

## 1. VPS

```bash
ssh vm-12-237-ubuntu
apt update && apt install -y docker.io docker-compose-v2
git clone https://github.com/latoulicious/lazyscan /opt/lazyscan && cd /opt/lazyscan
cp .env.example .env && nano .env      # fill real secrets (see below)
docker compose up -d --build
docker compose logs -f
```

`.env` must set: `JWT_SECRET`, `POSTGRES_PASSWORD`, R2 (`STORAGE_ENDPOINT`,
`STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET`,
`STORAGE_PUBLIC_DOMAIN`), SMTP (`SMTP_*`), superuser (`DEFAULT_SUPERUSER_*`).
Keep `STORAGE_PROVIDER=s3` — the default `r2` reads unset `CLOUDFLARE_*` and
storage reports not-configured. `STORAGE_QUOTA_BYTES=8589934592` (8 GiB).

## 2. R2 bucket CORS (one-time, required)

Page uploads go browser → R2 directly via presigned PUT (cross-origin), so the
bucket needs a CORS rule allowing the app origin or every upload fails preflight:

```json
[{ "AllowedOrigins": ["https://manga.sanctuary.my.id"],
   "AllowedMethods": ["PUT","GET"],
   "AllowedHeaders": ["content-type"],
   "MaxAgeSeconds": 3600 }]
```

Apply via R2 dashboard or `wrangler r2 bucket cors`. Bucket public policy must
expose **read of final objects only** — not bucket listing, not write.

## 3. Cloudflare Tunnel

One public hostname → `http://127.0.0.1:8080` (web). No `/minio` hostname —
images come from R2's own domain. `STORAGE_PUBLIC_DOMAIN` = R2 custom domain
(or the bucket's `*.r2.dev`).

## 4. Acceptance (end-to-end)

- [ ] `docker compose ps` → all 6 up; postgres healthy.
- [ ] Hostname serves the SPA; `…/api/v1/manga` returns JSON (not SPA HTML).
- [ ] Register → OTP email arrives (mail-svc via SMTP).
- [ ] Create manga + upload cover → converts (image-svc `/convert`), shows from R2.
- [ ] Import a chapter → pages flip `status='ready'` → readable from R2.
- [ ] Presigned page upload succeeds (no CORS preflight error in console).
- [ ] Import projected over 8 GiB → `507`.
- [ ] Corrupt page → marked `failed`, stream not stuck.
