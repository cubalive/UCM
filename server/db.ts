import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const connStr = process.env.DATABASE_URL;
const IS_PROD = process.env.NODE_ENV === "production";

let parsedUrl: URL;
try {
  parsedUrl = new URL(connStr);
} catch {
  throw new Error("DATABASE_URL is not a valid connection string");
}

const dbHost = parsedUrl.hostname;
const dbPort = parseInt(parsedUrl.port || "5432", 10);
const isSupabaseHost = dbHost.includes("supabase");

if (IS_PROD && !isSupabaseHost) {
  console.error(
    `[FATAL] Production DATABASE_URL must point to Supabase (host must contain "supabase"). Current host: ${dbHost.replace(/^(.{6}).*(.{6})$/, "$1***$2")}`
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
  console.warn("[WARN] DATABASE_URL missing sslmode=require — SSL will still be enabled via pool config");
}

export const pool = new pg.Pool({
  connectionString: connStr,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: sslConfig,
});

console.log(
  `[DB] Pool created — host: ${dbHost.replace(/^(.{6}).*(.{6})$/, "$1***$2")}, port: ${dbPort}, ssl: ${!!sslConfig}, pooler: ${dbPort === 6543}`
);

export const db = drizzle(pool, { schema });
