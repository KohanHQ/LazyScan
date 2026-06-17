import postgres, { type Sql } from "postgres";

export type DbClient = Sql<{}>;

type DbClientOptions = {
    databaseUrl?: string;
    max?: number;
    idleTimeoutSeconds?: number;
    connectTimeoutSeconds?: number;
};

let dbClient: DbClient | null = null;

function resolveDatabaseUrl(explicitUrl?: string): string {
    const url = explicitUrl ?? process.env.DATABASE_URL;
    if (!url) {
        throw new Error("DATABASE_URL is required");
    }
    return url;
}

export function createDbClient(options: DbClientOptions = {}): DbClient {
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);

    const max = options.max ?? 10;
    const idleTimeoutSeconds = options.idleTimeoutSeconds ?? 30;
    const connectTimeoutSeconds = options.connectTimeoutSeconds ?? 10;

    return postgres(databaseUrl, {
        max,
        idle_timeout: idleTimeoutSeconds,
        connect_timeout: connectTimeoutSeconds,
    });
}

export function getDbClient(): DbClient {
    if (!dbClient) {
        dbClient = createDbClient();
    }

    return dbClient;
}

export async function closeDbClient(): Promise<void> {
    if (!dbClient) return;
    const current = dbClient;
    dbClient = null;
    await current.end({ timeout: 5 });
}

