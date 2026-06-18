# Deferred Notes

Long rationale, accepted caveats, and historical context split out of
[nice-to-have.md](nice-to-have.md) to keep that file actionable. Items here are
known and intentionally not active — do not re-raise them as backlog without new
evidence.

## Accepted caveats

- **Storage quota undercounts in-flight bytes.** The 8 GiB import gate counts only
  `SUM(size_bytes) WHERE status='ready'` + declared incoming. Staged and in-flight
  originals are not counted; the ~2 GB margin (8 of R2's free 10) plus
  `ENABLE_STORAGE_PRUNE` absorb the difference. Accepted for the single-box lite
  stack. See `known-constraints.md`.
- **Cover/avatar orphan risk on partial failure.** If an R2 PUT succeeds but the
  following DB write fails, the object is orphaned (no live reference). Chapter
  staged originals are pruned; these one-off objects are not. Accepted as low-volume
  drift; revisit only if R2 usage approaches the cap. Tracked as the residual
  orphan-sweep item in `nice-to-have.md` (P1).

## Historical context

- **Lite trim (Phases 1–5, 2026-06-17/18).** The stack was compacted from the
  four-repo LazyScan-Stack (api, web, Kiln, Herald + MinIO + Aegis + observability)
  into a six-container monorepo: postgres, redis, image-svc, mail-svc, api, web.
  MinIO/replica, Aegis, and Prometheus/OTel were intentionally dropped; storage
  moved to R2 and the edge to a single-origin nginx + Cloudflare Tunnel. See the
  `sessions/` logs and `architecture.md`.
