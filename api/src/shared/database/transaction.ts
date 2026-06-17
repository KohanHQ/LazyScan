import type { Sql } from "postgres";
import { getDbClient, type DbClient } from "@/shared/database/client";

export type TransactionClient = Sql<{}>;

export async function withTransaction<T>(
    fn: (tx: TransactionClient) => Promise<T>,
    client: DbClient = getDbClient()
): Promise<T> {
    const resultTuple = (await client.begin(async (tx) => {
        const value = await fn(tx);
        return [value] as [T];
    })) as unknown as [T];

    return resultTuple[0];
}
