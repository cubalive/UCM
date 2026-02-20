import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import pgConnStringParse from "pg-connection-string";

function isNeonHost(hostname: string): boolean {
  const lc = hostname.toLowerCase();
  return lc.includes("neon.tech") || lc.includes("neon-") || lc.endsWith(".neon.fl0.io");
}

function isSupabaseHost(hostname: string): boolean {
  const lc = hostname.toLowerCase();
  return lc.includes("supabase.com") || lc.includes("supabase.co");
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

if (rawPgHost && isNeonHost(rawPgHost)) {
  console.error(`[DB-FATAL] PGHOST points to Neon (${sanitizeHost(rawPgHost)}). Neon is blocked.`);
  console.error(`[DB-FATAL] Remove or update PGHOST and restart.`);
  process.exit(1);
}

const databaseUrlHost = extractHost(rawDatabaseUrl);
const supabaseUrlHost = extractHost(rawSupabaseUrl);
const databaseUrlIsNeon = databaseUrlHost ? isNeonHost(databaseUrlHost) : false;
const databaseUrlIsSupabase = databaseUrlHost ? isSupabaseHost(databaseUrlHost) : false;

if (databaseUrlIsNeon) {
  console.warn(`[DB-BLOCK] DATABASE_URL host is Neon (${sanitizeHost(databaseUrlHost!)}). Neon is BLOCKED.`);
  if (!rawSupabaseUrl) {
    console.error(`[DB-FATAL] SUPABASE_DB_URL is also not set. No valid database configured. Exiting.`);
    process.exit(1);
  }
}

let chosenUrl = "";
let chosenSource: "DATABASE_URL" | "SUPABASE_DB_URL" = "DATABASE_URL";

if (rawDatabaseUrl && rawSupabaseUrl) {
  if (databaseUrlIsNeon) {
    chosenUrl = rawSupabaseUrl;
    chosenSource = "SUPABASE_DB_URL";
    console.warn(`[DB] DATABASE_URL is Neon — using SUPABASE_DB_URL instead.`);
  } else if (databaseUrlHost && supabaseUrlHost && databaseUrlHost === supabaseUrlHost) {
    chosenUrl = rawDatabaseUrl;
    chosenSource = "DATABASE_URL";
    console.log(`[DB] DATABASE_URL and SUPABASE_DB_URL share the same Supabase host. Using DATABASE_URL.`);
  } else if (databaseUrlIsSupabase) {
    chosenUrl = rawDatabaseUrl;
    chosenSource = "DATABASE_URL";
    console.log(`[DB] DATABASE_URL is on Supabase (${sanitizeHost(databaseUrlHost!)}). Using DATABASE_URL.`);
  } else {
    chosenUrl = rawSupabaseUrl;
    chosenSource = "SUPABASE_DB_URL";
    console.warn(`[DB-WARN] DATABASE_URL host (${sanitizeHost(databaseUrlHost || "unknown")}) is not Supabase — preferring SUPABASE_DB_URL.`);
  }
} else if (rawDatabaseUrl && !databaseUrlIsNeon) {
  if (databaseUrlIsSupabase) {
    chosenUrl = rawDatabaseUrl;
    chosenSource = "DATABASE_URL";
    console.log(`[DB] Using DATABASE_URL (Supabase: ${sanitizeHost(databaseUrlHost!)})`);
  } else {
    console.error(`[DB-FATAL] DATABASE_URL host (${sanitizeHost(databaseUrlHost || "unknown")}) is not Supabase. Set SUPABASE_DB_URL.`);
    process.exit(1);
  }
} else if (rawSupabaseUrl) {
  chosenUrl = rawSupabaseUrl;
  chosenSource = "SUPABASE_DB_URL";
} else {
  console.error("[DB-FATAL] Neither DATABASE_URL nor SUPABASE_DB_URL is set.");
  console.error("[DB-FATAL] This application requires Supabase PostgreSQL. Set at least one and restart.");
  process.exit(1);
}

const chosenHost = extractHost(chosenUrl);
if (chosenHost && isNeonHost(chosenHost)) {
  console.error(`[DB-FATAL] Chosen URL (${chosenSource}) points to Neon. Refusing to start.`);
  process.exit(1);
}
if (chosenHost && !isSupabaseHost(chosenHost)) {
  console.error(`[DB-FATAL] Chosen URL (${chosenSource}) host (${sanitizeHost(chosenHost)}) is not Supabase. Only Supabase is allowed.`);
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
  return (databaseUrlHost ? isNeonHost(databaseUrlHost) : false) ||
         (supabaseUrlHost ? isNeonHost(supabaseUrlHost) : false);
}

export { pool, db, dbReady, getDbSource, getDbHost, getDbPort, hasDatabaseUrl, hasSupabaseDbUrl, hasNeonRefs };
