import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";
import logger from "../lib/logger.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: false },
    });
    pool.on("error", (err) => {
      logger.error("Unexpected database pool error", { error: err.message });
    });
  }
  return pool;
}

export function getDb() {
  if (!db) {
    db = drizzle(getPool(), { schema });
  }
  return db;
}

export async function checkDbHealth(): Promise<{ connected: boolean; latencyMs?: number }> {
  try {
    const start = Date.now();
    const p = getPool();
    const client = await p.connect();
    await client.query("SELECT 1");
    client.release();
    return { connected: true, latencyMs: Date.now() - start };
  } catch {
    return { connected: false };
  }
}

export { schema };
