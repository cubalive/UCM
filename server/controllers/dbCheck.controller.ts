import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { db, pool, getDbSource, getDbHost, getDbPort } from "../db";
import { sql } from "drizzle-orm";

export async function dbCheckHandler(req: AuthRequest, res: Response) {
  const result: Record<string, any> = {
    db_connected: false,
    drizzle_initialized: false,
    host: "",
    port: 0,
    source: "",
    env_present: {
      DATABASE_URL: !!process.env.DATABASE_URL,
    },
    timestamp_from_db: null,
    companies_count: null,
    sample_tables: [],
    error: null,
  };

  try {
    result.host = getDbHost();
    result.port = getDbPort();
    result.source = getDbSource();
    result.drizzle_initialized = !!db;

    const nowResult = await db.execute(sql`SELECT NOW() AS now`);
    result.timestamp_from_db = nowResult.rows?.[0]?.now ?? null;
    result.db_connected = true;

    const countResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM companies`);
    result.companies_count = countResult.rows?.[0]?.count ?? null;

    const tablesResult = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name LIMIT 30
    `);
    result.sample_tables = (tablesResult.rows || []).map((r: any) => r.table_name);
  } catch (err: any) {
    result.error = err.message;
  }

  res.json(result);
}
