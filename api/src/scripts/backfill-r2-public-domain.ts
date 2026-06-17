/**
 * One-off data backfill: rewrite stored object URLs that were generated with the
 * old, invalid Cloudflare R2 fallback domain to the configured public domain.
 *
 * Context: the storage wrapper used to fabricate `https://${bucketName}.r2.dev`
 * when no public domain was set. That host never resolves on R2 (managed dev
 * domains look like `https://pub-<hash>.r2.dev`). Rows persisted during that
 * window hold the broken prefix. This script rewrites ONLY that exact prefix to
 * `CLOUDFLARE_R2_PUBLIC_DOMAIN`, leaving every other value untouched.
 *
 * This is a one-off ops task, not a schema change, so it lives here instead of in
 * `src/migration` (those run on every/fresh DB and cannot read env-specific
 * config). Safe to re-run. Dry-run by default; pass --apply to write.
 *
 *   bun run src/scripts/backfill-r2-public-domain.ts            # dry run
 *   bun run src/scripts/backfill-r2-public-domain.ts --apply    # execute
 */
import type { Sql } from "postgres";
import { envSchema } from "@/env";
import { createConfig } from "@/config";
import { getDbClient, closeDbClient } from "@/shared/database/client";

// Columns the R2 upload pipeline populates with public object URLs.
const TARGETS: Array<{ table: string; column: string }> = [
  { table: "manga", column: "cover_url" },
  { table: "chapter_pages", column: "image_url" },
  { table: "uploads", column: "original_url" },
  { table: "uploads", column: "processed_url" },
];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const env = envSchema.parse(process.env);
  const config = createConfig(env);

  if (!config.cloudflare.isConfigured) {
    throw new Error(
      "Cloudflare R2 is not configured. Set the CLOUDFLARE_R2_* env vars (including CLOUDFLARE_R2_PUBLIC_DOMAIN) before running this backfill."
    );
  }

  const bucket = config.cloudflare.r2Bucket!;
  const correctDomain = config.cloudflare
    .r2PublicDomain!.trim()
    .replace(/\/+$/, "");
  const badPrefix = `https://${bucket}.r2.dev`;
  const prefixLen = badPrefix.length;

  if (correctDomain === badPrefix) {
    console.log(
      `Configured public domain equals the legacy fallback (${badPrefix}); nothing to backfill.`
    );
    return;
  }

  console.log(`Mode:          ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Legacy prefix: ${badPrefix}`);
  console.log(`New domain:    ${correctDomain}`);
  console.log("");

  const db = getDbClient();
  let total = 0;

  const run = async (tx: Sql<{}>): Promise<void> => {
    for (const { table, column } of TARGETS) {
      const [{ count }] = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM ${tx(table)}
        WHERE left(${tx(column)}, ${prefixLen}) = ${badPrefix}
      `;

      total += count;
      console.log(`${table}.${column}: ${count} row(s)`);

      if (apply && count > 0) {
        await tx`
          UPDATE ${tx(table)}
          SET ${tx(column)} = ${correctDomain} || substring(${tx(column)} from ${prefixLen + 1})
          WHERE left(${tx(column)}, ${prefixLen}) = ${badPrefix}
        `;
      }
    }
  };

  if (apply) {
    await db.begin(run);
  } else {
    await run(db);
  }

  console.log("");
  console.log(
    apply
      ? `Done. Rewrote ${total} row(s).`
      : `Dry run: ${total} row(s) would be rewritten. Re-run with --apply to write.`
  );
}

main()
  .then(async () => {
    await closeDbClient();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await closeDbClient();
    process.exit(1);
  });
