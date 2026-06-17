# Conventions

Authoritative agent rules: root [`AGENTS.md`](../../AGENTS.md). This file holds
project-specific conventions; populate as patterns settle.

## Languages

- **api** — Bun + Elysia (TypeScript). Thin handlers, logic in services,
  persistence in repositories. Preserve outbox/dispatcher + transaction
  boundaries.
- **image-svc / mail-svc** — Go. Stdlib `log/slog` after the Phase 2/3 strip.
  Consumer/store/convert/mailer behavior is contract — do not alter.
- **web** — SPA build served by nginx.

## Commits

Subject-only Conventional Commits (`type: summary`). No body unless the "why"
is non-obvious, no `Co-Authored-By`, no phase tokens. (Atelier-wide standard.)

## Docs

- Code is source of truth; note drift rather than trusting stale docs.
- Append session history to `sessions/DD-MM-YYYY.md` — never overwrite.
- Keep notes concise and operational; no speculative documentation.
