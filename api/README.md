# Structure

```
apps/
  api/
    src/
      main.ts                 # app bootstrap
      app.ts                  # elysia app wiring
      env.ts                  # env parsing & validation

      modules/
        auth/
          auth.handler.ts
          auth.service.ts
          auth.repo.ts
          auth.model.ts

        manga/
          manga.handler.ts
          manga.service.ts
          manga.repo.ts
          manga.model.ts

        chapter/
          chapter.handler.ts
          chapter.service.ts
          chapter.repo.ts
          chapter.model.ts

        reader/
          reader.handler.ts    # progress, mark as read
          reader.service.ts

        upload/
          upload.handler.ts    # presign / job creation
          upload.service.ts
          image.worker.ts      # png → webp processing

      shared/
        http/
          response.ts
          errors.ts

        db/
          client.ts            # postgres client
          transaction.ts

        storage/
          r2.ts                # s3-compatible wrapper

        crypto/
          password.ts
          jwt.ts

        scheduler/
          cleanup.ts           # delete read chapters

        utils/
          id.ts
          time.ts

      migrations/
        001_init.sql
        002_manga.sql

    bun.lockb
    package.json
    tsconfig.json
```

# Testing

The smoke suite (`src/test/api.smoke.test.ts`) is an **integration** test: it
needs a real Postgres. It drops and re-migrates the schema on every run, so it
must point at a dedicated database whose name contains `test` (the suite refuses
anything else and never touches your dev `lazyscan` DB).

The test database is **persistent and reused** — created once, then reused on
every later run. Only the tables inside are wiped/re-migrated; the database
itself survives in the compose `postgres-data` volume.

```bash
# one-time (and idempotent): create the persistent test DB in the running
# compose Postgres. Safe to re-run — reuses the DB if it already exists.
bun run test:db

# run the suite (defaults TEST_DATABASE_URL to lazyscan_test on localhost:5432)
bun run test

# or do both in one shot
bun run test:local
```

Requires the stack's Postgres to be up (`docker compose --profile dev up -d`
from the Atelier root). Override defaults with `TEST_DATABASE_URL`, or point the
bootstrap at a specific container with `PG_CONTAINER=<name> bun run test:db`. CI
provisions its own `lazyscan_test` service container and sets
`TEST_DATABASE_URL`, so `bun run test` works there unchanged.
