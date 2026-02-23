import pg from "pg";

const globalForBizDb = globalThis as unknown as {
  bizPool: pg.Pool | undefined;
  bizDbReady: Promise<void> | undefined;
};

/**
 * Ensure the business database exists. Connects to the default "postgres"
 * database on the same server and creates the target DB if missing.
 * Safe to call multiple times — only runs once.
 */
async function ensureBizDatabase(): Promise<void> {
  const connStr = process.env.BUSINESS_DATABASE_URL;
  if (!connStr) return;

  const url = new URL(connStr);
  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName) return;

  // Connect to the default "postgres" database to run CREATE DATABASE
  url.pathname = "/postgres";
  const client = new pg.Client({ connectionString: url.toString() });
  try {
    await client.connect();
    const res = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (res.rowCount === 0) {
      // Database names cannot be parameterized; value is from our own env config
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[biz-db] Created database "${dbName}"`);
    }
  } catch (err: unknown) {
    // If DB already exists (race condition) or permission error, log and continue
    console.warn("[biz-db] ensureBizDatabase:", err instanceof Error ? err.message : err);
  } finally {
    await client.end();
  }
}

globalForBizDb.bizDbReady ??= ensureBizDatabase();

export const bizPool =
  globalForBizDb.bizPool ??
  new pg.Pool({
    connectionString: process.env.BUSINESS_DATABASE_URL,
  });

globalForBizDb.bizPool = bizPool;

/** Await this before first biz-db query to ensure the database exists. */
export const bizDbReady: Promise<void> = globalForBizDb.bizDbReady;
