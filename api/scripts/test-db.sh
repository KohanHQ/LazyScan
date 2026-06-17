#!/usr/bin/env bash
set -euo pipefail

# Persistent test-database bootstrap.
#
# Creates the integration-test database ONCE and reuses it on every later run.
# The smoke suite (src/test/api.smoke.test.ts) drops and re-migrates the schema
# itself at the start of each run, so this script only needs to guarantee the
# database *exists* — it never drops it. Data lives in the compose
# `postgres-data` volume, so the test DB survives container restarts.
#
# Idempotent: safe to run any number of times. Reuses the DB if present.
#
# Override via env: TEST_DB_NAME, TEST_DB_USER, TEST_DB_ADMIN, PG_CONTAINER.

DB_NAME="${TEST_DB_NAME:-lazyscan_test}"
PG_USER="${TEST_DB_USER:-lazyscan}"
ADMIN_DB="${TEST_DB_ADMIN:-lazyscan}" # maintenance DB to connect through

CONTAINER="${PG_CONTAINER:-}"
if [ -z "$CONTAINER" ]; then
  CONTAINER="$(docker ps --filter name=postgres --format '{{.Names}}' | head -1 || true)"
fi

if [ -z "$CONTAINER" ]; then
  echo "error: no running postgres container found." >&2
  echo "  start the stack first (from the Atelier root):" >&2
  echo "    docker compose --profile dev up -d" >&2
  echo "  or point at a specific container: PG_CONTAINER=<name> bun run test:db" >&2
  exit 1
fi

exists="$(docker exec -i "$CONTAINER" psql -U "$PG_USER" -d "$ADMIN_DB" -tAc \
  "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null || true)"

if [ "$exists" = "1" ]; then
  echo "test db '${DB_NAME}' already exists in '${CONTAINER}' — reusing."
else
  docker exec -i "$CONTAINER" psql -U "$PG_USER" -d "$ADMIN_DB" \
    -c "CREATE DATABASE ${DB_NAME}"
  echo "created persistent test db '${DB_NAME}' in '${CONTAINER}'."
fi
