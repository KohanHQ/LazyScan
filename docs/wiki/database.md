# Database

Postgres is the system of record. Migrations are **owned by the API** and run at
its boot; the Go workers run none (see
[`known-constraints.md`](known-constraints.md)).

Key tables (from the inherited pipeline): `chapter_pages`, `chapter_imports`,
`chapters`, `outbox_events`, `chapter_worker_processed_events`,
`chapter_worker_failures`, `herald_processed_events`, `herald_failures`,
`email_verifications`, users/manga/library tables.

> Placeholder — populated with schema detail as phases land. Status enums and
> the worker bookkeeping contract are in [`known-constraints.md`](known-constraints.md)
> and the module docs.
