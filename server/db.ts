import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import pgConnStringParse from "pg-connection-string";

const IS_PROD = process.env.NODE_ENV === "production";

function prepareConnStr(raw: string, label: string): { connStr: string; host: string; port: number; isSupabase: boolean; useSSL: boolean | object } {
  let connStr = raw.trim();
  if (connStr !== raw) {
    console.warn(`[BOOT-WARN] ${label} had leading/trailing whitespace — auto-trimmed.`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(connStr);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }

  const isPoolerPort = parsedUrl.port === "6543";
  const currentUser = decodeURIComponent(parsedUrl.username);
  if (isPoolerPort && currentUser === "postgres" && !currentUser.includes(".")) {
    let projectRef = "";
    const supabaseUrl = process.env.SUPABASE_URL || "";
    if (supabaseUrl) {
      try { projectRef = new URL(supabaseUrl).hostname.split(".")[0]; } catch {}
    }
    if (projectRef && projectRef.length > 5) {
      parsedUrl.username = encodeURIComponent(`postgres.${projectRef}`);
      connStr = parsedUrl.toString();
      console.warn(
        `[BOOT-WARN] Pooler port 6543 requires "postgres.PROJECT_REF" — auto-corrected using SUPABASE_URL ref.`
      );
    }
  }

  const pgParsed = pgConnStringParse.parse(connStr);
  if (!pgParsed.host || pgParsed.host === "base") {
    throw new Error(`${label} resolved host="${pgParsed.host}" — connection string is malformed`);
  }

  const host = parsedUrl.hostname;
  const port = parseInt(parsedUrl.port || "5432", 10);
  const isSupabase = host.includes("supabase");
  const useSSL = isSupabase || IS_PROD;

  if (useSSL && connStr.includes("sslmode=require")) {
    connStr = connStr.replace(/[?&]sslmode=require/g, "").replace(/\?$/, "");
  }

  return { connStr, host, port, isSupabase, useSSL };
}

function createPool(connStr: string, useSSL: boolean | object, label: string): pg.Pool {
  const sslConfig = useSSL ? { rejectUnauthorized: false } : false;
  return new pg.Pool({
    connectionString: connStr,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslConfig,
  });
}

async function testConnection(p: pg.Pool): Promise<boolean> {
  try {
    const client = await p.connect();
    await client.query("SELECT 1");
    client.release();
    return true;
  } catch {
    return false;
  }
}

let _ready = false;
let pool: pg.Pool = null as any;
let db: ReturnType<typeof drizzle> = null as any;
let dbSource = "unknown";
let dbHost = "unknown";
let dbPort = 5432;

function assertReady() {
  if (!_ready) throw new Error("[DB] Database not initialized — await dbReady before using pool/db");
}

const supabaseRaw = process.env.SUPABASE_DB_URL || "";
const fallbackRaw = process.env.DATABASE_URL || "";

if (!supabaseRaw && !fallbackRaw) {
  throw new Error("Database connection string must be set (SUPABASE_DB_URL or DATABASE_URL)");
}

async function initDb() {
  if (supabaseRaw) {
    try {
      const info = prepareConnStr(supabaseRaw, "SUPABASE_DB_URL");
      const candidate = createPool(info.connStr, info.useSSL, "SUPABASE_DB_URL");
      const ok = await testConnection(candidate);
      if (ok) {
        pool = candidate;
        dbSource = "SUPABASE_DB_URL";
        dbHost = info.host;
        dbPort = info.port;
        db = drizzle(pool, { schema });
        _ready = true;
        console.log(
          `[DB] Connected — source: SUPABASE_DB_URL, host: ${dbHost.replace(/^(.{6}).*(.{6})$/, "$1***$2")}, port: ${dbPort}, ssl: ${!!info.useSSL}, pooler: ${dbPort === 6543}`
        );
        return;
      } else {
        console.warn(`[DB-WARN] SUPABASE_DB_URL connection test failed — trying DATABASE_URL fallback...`);
        await candidate.end().catch(() => {});
      }
    } catch (e: any) {
      console.warn(`[DB-WARN] SUPABASE_DB_URL invalid (${e.message}) — trying DATABASE_URL fallback...`);
    }
  }

  if (fallbackRaw) {
    try {
      const info = prepareConnStr(fallbackRaw, "DATABASE_URL");
      const candidate = createPool(info.connStr, info.useSSL, "DATABASE_URL");
      const ok = await testConnection(candidate);
      if (ok) {
        pool = candidate;
        dbSource = "DATABASE_URL";
        dbHost = info.host;
        dbPort = info.port;
        db = drizzle(pool, { schema });
        _ready = true;
        console.log(
          `[DB] Connected — source: DATABASE_URL, host: ${dbHost.replace(/^(.{6}).*(.{6})$/, "$1***$2")}, port: ${dbPort}, ssl: ${!!info.useSSL}`
        );
        return;
      } else {
        await candidate.end().catch(() => {});
      }
    } catch (e: any) {
      console.error(`[DB-FATAL] DATABASE_URL also invalid: ${e.message}`);
    }
  }

  throw new Error("All database connections failed. Check SUPABASE_DB_URL and DATABASE_URL.");
}

const dbReady = initDb();

function getDbSource() { return dbSource; }

export { pool, db, dbReady, dbSource, getDbSource };
