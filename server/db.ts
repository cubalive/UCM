import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import pgConnStringParse from "pg-connection-string";

function isNeonOrReplit(url: string): boolean {
  const lc = url.toLowerCase();
  return lc.includes("neon.tech") || lc.includes("helium") || lc.includes("replit") || lc.includes("@neondatabase");
}

function extractHost(url: string): string | null {
  try { return new URL(url.trim()).hostname; } catch { return null; }
}

function sanitizeHost(host: string): string {
  if (host.length <= 14) return host;
  return host.replace(/^(.{6}).*(.{6})$/, "$1***$2");
}

const rawDatabaseUrl = (process.env.DATABASE_URL || "").trim();
const rawSupabaseUrl = (process.env.SUPABASE_DB_URL || "").trim();
const rawPgHost = (process.env.PGHOST || "").trim();

if (rawPgHost && rawPgHost.toLowerCase().includes("neon.tech")) {
  console.error(`[DB-FATAL] PGHOST contains "neon.tech" (${sanitizeHost(rawPgHost)}). Neon is blocked.`);
  console.error(`[DB-FATAL] Remove or update PGHOST and restart.`);
  process.exit(1);
}

const databaseUrlIsNeon = rawDatabaseUrl ? isNeonOrReplit(rawDatabaseUrl) : false;

if (databaseUrlIsNeon) {
  const neonHost = extractHost(rawDatabaseUrl);
  console.error(`[DB-BLOCK] DATABASE_URL contains Neon/Replit host (${sanitizeHost(neonHost || "unknown")}). Neon is BLOCKED — will not be used.`);
  if (!rawSupabaseUrl) {
    console.error(`[DB-FATAL] SUPABASE_DB_URL is also not set. No valid database configured. Exiting.`);
    process.exit(1);
  }
}

let chosenUrl = "";
let chosenSource: "DATABASE_URL" | "SUPABASE_DB_URL" = "DATABASE_URL";

if (rawDatabaseUrl && rawSupabaseUrl) {
  const hostA = extractHost(rawDatabaseUrl);
  const hostB = extractHost(rawSupabaseUrl);

  if (databaseUrlIsNeon) {
    chosenUrl = rawSupabaseUrl;
    chosenSource = "SUPABASE_DB_URL";
    console.warn(`[DB-WARN] DATABASE_URL (Neon) and SUPABASE_DB_URL both exist. Neon blocked — using SUPABASE_DB_URL.`);
  } else if (hostA && hostB && hostA !== hostB) {
    console.warn(`[DB-WARN] DATABASE_URL and SUPABASE_DB_URL point to different hosts.`);
    console.warn(`  DATABASE_URL   host: ${sanitizeHost(hostA!)}`);
    console.warn(`  SUPABASE_DB_URL host: ${sanitizeHost(hostB!)}`);
    chosenUrl = rawSupabaseUrl;
    chosenSource = "SUPABASE_DB_URL";
    console.warn(`[DB-WARN] Preferring SUPABASE_DB_URL (the intended Supabase connection).`);
  } else {
    chosenUrl = rawDatabaseUrl;
    chosenSource = "DATABASE_URL";
    console.log(`[DB] Both DATABASE_URL and SUPABASE_DB_URL set (same host). Using DATABASE_URL.`);
  }
} else if (rawDatabaseUrl && !databaseUrlIsNeon) {
  chosenUrl = rawDatabaseUrl;
  chosenSource = "DATABASE_URL";
} else if (rawSupabaseUrl) {
  chosenUrl = rawSupabaseUrl;
  chosenSource = "SUPABASE_DB_URL";
} else {
  console.error("[DB-FATAL] Neither DATABASE_URL nor SUPABASE_DB_URL is set.");
  console.error("[DB-FATAL] This application requires Supabase PostgreSQL. Set at least one and restart.");
  process.exit(1);
}

if (isNeonOrReplit(chosenUrl)) {
  console.error(`[DB-FATAL] Chosen URL (${chosenSource}) points to Neon/Replit, not Supabase. Refusing to start.`);
  process.exit(1);
}

function prepareConnStr(raw: string): { connStr: string; host: string; port: number; useSSL: boolean | object } {
  let connStr = raw.trim();
  if (connStr !== raw) {
    console.warn(`[BOOT-WARN] ${chosenSource} had leading/trailing whitespace — auto-trimmed.`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(connStr);
  } catch {
    console.error(`[DB-FATAL] ${chosenSource} is not a valid URL. Exiting.`);
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
    console.error(`[DB-FATAL] ${chosenSource} resolved host="${pgParsed.host}" — connection string is malformed. Exiting.`);
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

const connInfo = prepareConnStr(chosenUrl);

const pool = new pg.Pool({
  connectionString: connInfo.connStr,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: { rejectUnauthorized: false },
});

const db = drizzle(pool, { schema });

const dbReady = (async () => {
  const redacted = sanitizeHost(connInfo.host);
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    console.log(
      `[DB] Connected — source: ${chosenSource}, host: ${redacted}, port: ${connInfo.port}, ssl: true, pooler: ${connInfo.port === 6543}`
    );
  } catch (err: any) {
    console.error(`[DB-FATAL] Cannot connect to PostgreSQL at ${redacted}:${connInfo.port} (source: ${chosenSource})`);
    console.error(`[DB-FATAL] Error: ${err.message}`);
    console.error(`[DB-FATAL] Check that ${chosenSource} has the correct password and the Supabase project is active.`);
    console.error("[DB-FATAL] No fallback database will be used. Exiting.");
    process.exit(1);
  }
})();

function getDbSource(): string { return chosenSource; }
function getDbHost(): string { return connInfo.host; }
function getDbPort(): number { return connInfo.port; }
function hasDatabaseUrl(): boolean { return !!rawDatabaseUrl; }
function hasSupabaseDbUrl(): boolean { return !!rawSupabaseUrl; }
function hasNeonRefs(): boolean {
  return isNeonOrReplit(rawDatabaseUrl) || isNeonOrReplit(rawSupabaseUrl);
}

export { pool, db, dbReady, getDbSource, getDbHost, getDbPort, hasDatabaseUrl, hasSupabaseDbUrl, hasNeonRefs };
