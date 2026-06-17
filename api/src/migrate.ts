import { readdir, readFile } from "fs/promises"
import path from "path"
import { getDbClient } from "@/shared/database/client"
import type { Sql } from "postgres"

const MIGRATIONS_DIR = path.join(
  import.meta.dir,
  "migration"
)

export async function runMigrations(db: Sql<{}> = getDbClient()) {
  await db`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `

  const files = (await readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith(".sql"))
    .sort()

  for (const file of files) {
    const [row] = await db`
      SELECT 1 FROM schema_migrations WHERE version = ${file}
    `

    if (row) continue

    console.log("Applying", file)

    const sql = await readFile(
      path.join(MIGRATIONS_DIR, file),
      "utf-8"
    )

    await db.begin(async (tx: Sql<{}>) => {
      await tx.unsafe(sql)
      await tx`
        INSERT INTO schema_migrations (version)
        VALUES (${file})
      `
    })
  }
}

if (import.meta.main) {
  runMigrations()
    .then(() => {
      console.log("Migrations complete")
      process.exit(0)
    })
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}
