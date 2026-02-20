import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  console.error("[DB-FATAL] DATABASE_URL is required. Supabase connection missing.");
  process.exit(1);
}

const connStr = process.env.DATABASE_URL.trim();

let parsedUrl: URL;
try {
  parsedUrl = new URL(connStr);
} catch {
  console.error("[DB-FATAL] DATABASE_URL is not a valid URL. Exiting.");
  process.exit(1);
}

const host = parsedUrl.hostname.toLowerCase();

if (host.includes("neon.tech") || host.includes("neon-") || host.endsWith(".neon.fl0.io")) {
  console.error("[DB-FATAL] Neon connection detected. Only Supabase is allowed.");
  process.exit(1);
}

if (host.includes("localhost") || host.includes("replit")) {
  console.error(`[DB-FATAL] Invalid host "${host}". Only Supabase is allowed.`);
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

const pool = new pg.Pool({
  connectionString: finalConnStr,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: { rejectUnauthorized: false },
});

const db = drizzle(pool, { schema });

const dbReady = (async () => {
  const redacted = sanitizeHost(host);
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    console.log(`[DB] Connected — source: DATABASE_URL`);
    console.log(`[DB] Host: ${redacted}, port: ${port}, ssl: true, pooler: ${isPooler}`);
  } catch (err: any) {
    console.error(`[DB-FATAL] Cannot connect to PostgreSQL at ${redacted}:${port}`);
    console.error(`[DB-FATAL] Error: ${err.message}`);
    console.error(`[DB-FATAL] Check that DATABASE_URL has the correct password and the Supabase project is active.`);
    process.exit(1);
  }
})();

function getDbSource(): string { return "DATABASE_URL"; }
function getDbHost(): string { return host; }
function getDbPort(): number { return port; }

export { pool, db, dbReady, getDbSource, getDbHost, getDbPort };
