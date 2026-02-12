import pg from "pg";

const globalForBizDb = globalThis as unknown as {
  bizPool: pg.Pool | undefined;
};

export const bizPool =
  globalForBizDb.bizPool ??
  new pg.Pool({
    connectionString: process.env.BUSINESS_DATABASE_URL,
  });

globalForBizDb.bizPool = bizPool;
