# LazyScan Wiki

Centralized project wiki. Single source for architecture, conventions, and
operational caveats — replaces the per-service `docs/wiki/` that the original
Kiln/Herald repos carried (those were folded into `modules/` at Phase 1).

## Structure

| Path | Purpose |
|---|---|
| `architecture.md` | system overview — the 6-container async pipeline |
| `conventions.md` | coding/commit conventions, per-language notes |
| `database.md` | schema ownership, migrations |
| `domain.md` | domain model (manga / chapters / pages / users) |
| `known-constraints.md` | repo-wide inherited contracts + hidden constraints |
| `troubleshooting.md` | debugging findings, operational caveats |
| `findings.md` | code-review findings log (paired with `resolutions.md`) |
| `resolutions.md` | how findings were resolved (paired with `findings.md`) |
| `modules/` | per-service contracts — `image-svc.md`, `mail-svc.md` |
| `sessions/` | append-only session history (`DD-MM-YYYY.md`) |
| `decisions/` | architecture decision records |

## Build plan

The repo is assembled phase by phase. Authoritative plan + per-phase tasks:
`LazyScan-Stack/.hermes/plans/2026-06-17_173000-lazyscan-lite-concrete.md`.
Phase 1 (scaffold) is done; Phases 2–5 strip the workers, repoint storage to R2,
trim the API, and add the nginx edge.

> Doc rule (from root `AGENTS.md`): code is source of truth; note drift, keep
> notes concise, append session history — never overwrite it.
