# Troubleshooting

Operational caveats and debugging findings. Append as they surface; prefer
evidence over guesses.

Known starting points (inherited):

- **Boot aborts if Redis is down** — the API requires Redis at startup (cache +
  denylist + streams).
- **govips/libvips is CGO** — image-svc builds need `vips-dev`/`vips`; build
  locally first if the Docker build fails (plan risk register).
- **Stuck stream entries** — a page stuck non-terminal usually means an unacked
  poison/retryable entry; check the worker `*_failures` table and the stream
  pending list.

> Placeholder — extend with concrete findings as they occur.
