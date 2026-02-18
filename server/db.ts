import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import pgConnStringParse from "pg-connection-string";

const IS_PROD = process.env.NODE_ENV === "production";

const databaseUrlRaw = process.env.DATABASE_URL || "";
if (databaseUrlRaw) {
  const lcHost = databaseUrlRaw.toLowerCase();
  if (lcHost.includes("neon.tech") || lcHost.includes("helium") || lcHost.includes("replit")) {
    console.warn("[DB] DATABASE_URL ignored (Supabase-only mode) — pointed to non-Supabase host.");
  } else {
    console.warn("[DB] DATABASE_URL ignored (Supabase-only mode). Only SUPABASE_DB_URL is used.");
  }
}

const supabaseRaw = process.env.SUPABASE_DB_URL || "";

if (!supabaseRaw) {
  console.error("[DB-FATAL] SUPABASE_DB_URL is not set. This application requires Supabase PostgreSQL. Exiting.");
  process.exit(1);
}

function prepareConnStr(raw: string): { connStr: string; host: string; port: number; useSSL: boolean | object } {
  let connStr = raw.trim();
  if (connStr !== raw) {
    console.warn("[BOOT-WARN] SUPABASE_DB_URL had leading/trailing whitespace — auto-trimmed.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(connStr);
  } catch {
    console.error("[DB-FATAL] SUPABASE_DB_URL is not a valid URL. Exiting.");
    process.exit(1);
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
        `[BOOT-WARN] Pooler port 6543 requires "postgres.PROJECT_REF" — auto-corrected username to postgres.${projectRef}`
      );
    }
  }

  const pgParsed = pgConnStringParse.parse(connStr);
  if (!pgParsed.host || pgParsed.host === "base") {
    console.error(`[DB-FATAL] SUPABASE_DB_URL resolved host="${pgParsed.host}" — connection string is malformed. Exiting.`);
    process.exit(1);
  }

  const host = parsedUrl.hostname;
  const port = parseInt(parsedUrl.port || "5432", 10);
  const useSSL = true;

  if (connStr.includes("sslmode=require")) {
    connStr = connStr.replace(/[?&]sslmode=require/g, "").replace(/\?$/, "");
  }

  return { connStr, host, port, useSSL };
}

const connInfo = prepareConnStr(supabaseRaw);

const pool = new pg.Pool({
  connectionString: connInfo.connStr,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: { rejectUnauthorized: false },
});

const db = drizzle(pool, { schema });

const dbReady = (async () => {
  const redactedHost = connInfo.host.replace(/^(.{6}).*(.{6})$/, "$1***$2");
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    console.log(
      `[DB] Connected — source: SUPABASE_DB_URL, host: ${redactedHost}, port: ${connInfo.port}, ssl: true, pooler: ${connInfo.port === 6543}`
    );
  } catch (err: any) {
    console.error(`[DB-FATAL] Cannot connect to Supabase PostgreSQL at ${redactedHost}:${connInfo.port}`);
    console.error(`[DB-FATAL] Error: ${err.message}`);
    console.error("[DB-FATAL] Check that SUPABASE_DB_URL has the correct password and the Supabase project is active.");
    console.error("[DB-FATAL] No fallback database will be used. Exiting.");
    process.exit(1);
  }
})();

function getDbSource() { return "SUPABASE_DB_URL"; }

export { pool, db, dbReady, getDbSource };
