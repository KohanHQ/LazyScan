# LazyScan

Self-upload manga reader. Compact fork of the LazyScan stack: a Bun/Elysia `api`,
an nginx-served SPA `web`, and two Go workers — `image-svc` (ex-Kiln, WebP convert
+ chapter-page consumer) and `mail-svc` (ex-Herald, verification mail consumer) —
backed by Postgres, Redis, and Cloudflare R2. Six containers, async outbox pipeline
preserved.

Run `cp .env.example .env`, fill it in, then `docker compose up -d --build`.

The authoritative rewrite plan and per-phase tasks live in
`LazyScan-Stack/.hermes/plans/` (see `2026-06-17_173000-lazyscan-lite-concrete.md`).
This repo is being assembled phase by phase.
