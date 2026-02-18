import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import pgConnStringParse from "pg-connection-string";

const IS_PROD = process.env.NODE_ENV === "production";

const rawConnStr = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
const connStr = rawConnStr.trim();

if (!connStr) {
  throw new Error("Database connection string must be set (SUPABASE_DB_URL or DATABASE_URL)");
}

if (connStr !== rawConnStr) {
  const source = process.env.SUPABASE_DB_URL ? "SUPABASE_DB_URL" : "DATABASE_URL";
  console.warn(
    `[BOOT-WARN] ${source} had leading/trailing whitespace (raw=${rawConnStr.length} chars, trimmed=${connStr.length} chars). Auto-trimmed.`
  );
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(connStr);
} catch {
  throw new Error("Database connection string is not valid (failed URL parse)");
}

const pgParsed = pgConnStringParse.parse(connStr);

if (!pgParsed.host || pgParsed.host === "base") {
  const source = process.env.SUPABASE_DB_URL ? "SUPABASE_DB_URL" : "DATABASE_URL";
  console.error(
    `[FATAL] pg-connection-string resolved host="${pgParsed.host}" from ${source}. ` +
    `Connection string may be malformed (leading whitespace?). Expected a valid database host.`
  );
  process.exit(1);
}

if (IS_PROD && !pgParsed.host.includes("supabase")) {
  console.error(
    `[FATAL] Production DB host must contain "supabase". pg-connection-string resolved host="${pgParsed.host}".`
  );
  process.exit(1);
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

const useSSL = isSupabaseHost || IS_PROD;
const sslConfig = useSSL ? { rejectUnauthorized: false } : false;

if (IS_PROD && !connStr.includes("sslmode=require")) {
  console.warn("[WARN] Connection string missing sslmode=require — SSL will still be enabled via pool config");
}

const poolConnStr = useSSL && connStr.includes("sslmode=require")
  ? connStr.replace(/[?&]sslmode=require/g, "").replace(/\?$/, "")
  : connStr;

export const pool = new pg.Pool({
  connectionString: poolConnStr,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: sslConfig,
});

console.log(
  `[DB] Pool created — source: ${source}, host: ${dbHost.replace(/^(.{6}).*(.{6})$/, "$1***$2")}, port: ${dbPort}, ssl: ${!!sslConfig}, pooler: ${dbPort === 6543}`
);

export const db = drizzle(pool, { schema });
