import { getDbClient, type DbClient } from "@/shared/database/client";
import type { Fragment } from "postgres";

type Direction = "asc" | "desc";

// Scalar values postgres.js can bind as a parameter. Branded UUIDs are strings.
type ScalarValue = string | number | boolean | Date | null;

// Minimal squirrel-style SELECT builder over postgres.js. It composes parameterized
// fragments rather than concatenating strings, so values stay bound ($1, $2, ...) and
// identifiers are escaped. Covers the single-table read patterns in our repositories;
// joins and aliased projections stay as hand-written SQL.
class SelectQuery {
  private readonly conditions: Fragment[] = [];
  private readonly orderings: Fragment[] = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;

  constructor(
    private readonly sql: DbClient,
    private readonly table: string,
    private readonly columns: readonly string[]
  ) {}

  // Raw condition fragment for anything beyond equality, e.g.
  // .where(sql`image_url IS NOT NULL`).
  where(condition: Fragment): this {
    this.conditions.push(condition);
    return this;
  }

  whereEq(column: string, value: ScalarValue): this {
    // `col = NULL` is always NULL (never true) in SQL; a null value must compile
    // to `col IS NULL` to match rows. Other values stay bound as parameters.
    this.conditions.push(
      value === null
        ? this.sql`${this.sql(column)} IS NULL`
        : this.sql`${this.sql(column)} = ${value}`
    );
    return this;
  }

  orderBy(column: string, direction: Direction = "asc"): this {
    const dir = direction === "asc" ? this.sql`ASC` : this.sql`DESC`;
    this.orderings.push(this.sql`${this.sql(column)} ${dir}`);
    return this;
  }

  // Raw ordering for multi-key / NULLS LAST cases the helper does not model.
  orderByRaw(ordering: Fragment): this {
    this.orderings.push(ordering);
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  offset(count: number): this {
    this.offsetValue = count;
    return this;
  }

  build(): Fragment {
    const sql = this.sql;
    const where = this.conditions.length
      ? sql`WHERE ${this.conditions.reduce((acc, c) => sql`${acc} AND ${c}`)}`
      : sql``;
    const order = this.orderings.length
      ? sql`ORDER BY ${this.orderings.reduce((acc, o) => sql`${acc}, ${o}`)}`
      : sql``;
    const limit = this.limitValue === null ? sql`` : sql`LIMIT ${this.limitValue}`;
    const offset = this.offsetValue === null ? sql`` : sql`OFFSET ${this.offsetValue}`;

    return sql`
      SELECT ${sql([...this.columns])}
      FROM ${sql(this.table)}
      ${where} ${order} ${limit} ${offset}
    `;
  }
}

export function select(
  table: string,
  columns: readonly string[],
  sql: DbClient = getDbClient()
): SelectQuery {
  return new SelectQuery(sql, table, columns);
}
