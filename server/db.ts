import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

const connStr = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();

if (!connStr) {
  console.error("[DB-FATAL] No database connection string found. Set SUPABASE_DB_URL.");
  process.exit(1);
}

const envSource = process.env.SUPABASE_DB_URL ? "SUPABASE_DB_URL" : "DATABASE_URL";

if (process.env.SUPABASE_DB_URL && process.env.DATABASE_URL) {
  console.log("[DB] SUPABASE_DB_URL found — ignoring DATABASE_URL");
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(connStr);
} catch {
  console.error(`[DB-FATAL] ${envSource} is not a valid URL. Exiting.`);
  process.exit(1);
}

const host = parsedUrl.hostname.toLowerCase();

if (!host.includes("supabase")) {
  console.error(`[DB-FATAL] Only Supabase connections are supported. Got host: "${host}"`);
  process.exit(1);
}

const port = parseInt(parsedUrl.port || "5432", 10);
const isPooler = port === 6543;

if (isPooler) {
  const currentUser = decodeURIComponent(parsedUrl.username);
  if (currentUser === "postgres" && !currentUser.includes(".")) {
    const supabaseUrl = process.env.SUPABASE_URL || "";
    if (supabaseUrl) {
      try {
        const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
        if (projectRef && projectRef.length > 5) {
          parsedUrl.username = encodeURIComponent(`postgres.${projectRef}`);
          console.warn(
            `[BOOT-WARN] Pooler port 6543 requires "postgres.PROJECT_REF" — auto-corrected username`
          );
        }
      } catch {}
    }
  }
}

let finalConnStr = parsedUrl.toString();
if (finalConnStr.includes("sslmode=require")) {
  finalConnStr = finalConnStr.replace(/[?&]sslmode=require/g, "").replace(/\?$/, "");
}

function sanitizeHost(h: string): string {
  if (h.length <= 14) return h;
  return h.replace(/^(.{6}).*(.{6})$/, "$1***$2");
}

// D3 FIX: Production requires strict SSL; development allows permissive with warning
// D6 FIX: Pool size scales with replica count
const IS_PROD = process.env.NODE_ENV === "production";
const DB_POOL_GLOBAL_MAX = parseInt(process.env.DB_POOL_GLOBAL_MAX || "80", 10);
const RAILWAY_REPLICA_COUNT = parseInt(process.env.RAILWAY_REPLICA_COUNT || "1", 10);
const poolSize = Math.min(
  Math.floor((DB_POOL_GLOBAL_MAX - 10) / RAILWAY_REPLICA_COUNT),
  25
);

function buildSslConfig(): pg.ConnectionConfig["ssl"] {
  if (IS_PROD) {
    // D3 FIX: Production MUST verify server certificate
    const sslConfig: { rejectUnauthorized: boolean; ca?: string } = {
      rejectUnauthorized: true,
    };
    // Support custom CA bundles (RDS, custom CAs)
    if (process.env.DB_SSL_CA) {
      try {
        sslConfig.ca = Buffer.from(process.env.DB_SSL_CA, "base64").toString("utf-8");
      } catch {
        console.warn("[DB] DB_SSL_CA is not valid base64 — using as raw PEM");
        sslConfig.ca = process.env.DB_SSL_CA;
      }
    }
    return sslConfig;
  }

  // Development: allow permissive SSL but log a warning
  console.warn("[DB-WARN] Non-production mode: SSL certificate verification is disabled. Do NOT use this in production.");
  return { rejectUnauthorized: false };
}

const pool = new pg.Pool({
  connectionString: finalConnStr,
  max: poolSize,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
  ssl: buildSslConfig(),
});

const db = drizzle(pool, { schema });

/**
 * Verify the database connection is healthy and SSL is active.
 */
async function verifyDatabaseConnection(): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  const redacted = sanitizeHost(host);
  try {
    const client = await pool.connect();
    // Verify SSL is active
    const sslResult = await client.query("SELECT ssl_is_used()");
    const sslActive = sslResult.rows[0]?.ssl_is_used ?? false;
    await client.query("SELECT 1");
    client.release();
    console.log(`[DB] Connected — source: ${envSource}`);
    console.log(`[DB] Host: ${redacted}, port: ${port}, ssl: ${sslActive}, pooler: ${isPooler}, pool_size: ${poolSize}, replicas: ${RAILWAY_REPLICA_COUNT}`);
    if (!sslActive && IS_PROD) {
      console.error("[DB-WARN] SSL is NOT active on the database connection in production!");
    }
  } catch (err: any) {
    console.error(`[DB-FATAL] Cannot connect to PostgreSQL at ${redacted}:${port}`);
    console.error(`[DB-FATAL] Error: ${err.message}`);
    console.error(`[DB-FATAL] Check that ${envSource} has the correct password and the Supabase project is active.`);
    process.exit(1);
  }
}

const dbReady = verifyDatabaseConnection();

function getDbSource(): string { return envSource; }
function getDbHost(): string { return host; }
function getDbPort(): number { return port; }
function closeDatabasePool(): Promise<void> { return pool.end(); }

export { pool, db, dbReady, getDbSource, getDbHost, getDbPort, verifyDatabaseConnection, closeDatabasePool };
