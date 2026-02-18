import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

const IS_PROD = process.env.NODE_ENV === "production";

const connStr = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!connStr) {
  throw new Error("Database connection string must be set (SUPABASE_DB_URL or DATABASE_URL)");
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(connStr);
} catch {
  throw new Error("Database connection string is not valid");
}

const dbHost = parsedUrl.hostname;
const dbPort = parseInt(parsedUrl.port || "5432", 10);
const isSupabaseHost = dbHost.includes("supabase");
const source = process.env.SUPABASE_DB_URL ? "SUPABASE_DB_URL" : "DATABASE_URL";

if (IS_PROD && !isSupabaseHost) {
  console.error(
    `[FATAL] Production DB must point to Supabase (host must contain "supabase"). Source: ${source}, host: ${dbHost.replace(/^(.{6}).*(.{6})$/, "$1***$2")}`
  );
  process.exit(1);
}

if (IS_PROD && dbPort !== 6543) {
  console.error(
    `[FATAL] Production Supabase DB must use pooler port 6543. Current port: ${dbPort}`
  );
  process.exit(1);
}

const sslConfig = isSupabaseHost || IS_PROD ? { rejectUnauthorized: false } : false;

if (IS_PROD && !connStr.includes("sslmode=require")) {
  console.warn("[WARN] Connection string missing sslmode=require — SSL will still be enabled via pool config");
}

export const pool = new pg.Pool({
  connectionString: connStr,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: sslConfig,
});

console.log(
  `[DB] Pool created — source: ${source}, host: ${dbHost.replace(/^(.{6}).*(.{6})$/, "$1***$2")}, port: ${dbPort}, ssl: ${!!sslConfig}, pooler: ${dbPort === 6543}`
);

export const db = drizzle(pool, { schema });
