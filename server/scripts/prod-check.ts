import crypto from "crypto";
import { db, pool } from "../db";
import { sql } from "drizzle-orm";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

let passes = 0;
let fails = 0;

function pass(label: string, detail?: string) {
  passes++;
  console.log(`  ${GREEN}PASS${RESET}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label: string, detail?: string) {
  fails++;
  console.log(`  ${RED}FAIL${RESET}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function warn(label: string, detail?: string) {
  console.log(`  ${YELLOW}WARN${RESET}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("=".repeat(60));
  console.log("  UCM Production Readiness Check");
  console.log("=".repeat(60));
  console.log(`  NODE_ENV: ${process.env.NODE_ENV || "(not set)"}`);
  console.log("");

  console.log("[1] Database Connection");
  const connStr = process.env.SUPABASE_DB_URL || "";
  let dbHost = "unknown", dbPort = 0, dbName = "unknown";
  try {
    const u = new URL(connStr);
    dbHost = u.hostname;
    dbPort = parseInt(u.port || "5432", 10);
    dbName = u.pathname.replace(/^\//, "") || "unknown";
  } catch {
    fail("SUPABASE_DB_URL parse", "Cannot parse SUPABASE_DB_URL");
  }

  const redacted = dbHost.length > 12
    ? dbHost.slice(0, 6) + "***" + dbHost.slice(-6)
    : dbHost;
  console.log(`  Host: ${redacted}  Port: ${dbPort}  DB: ${dbName}`);

  const isSupabaseHost = dbHost.includes("supabase");
  if (dbPort === 6543) {
    pass("Pooler port 6543 detected");
  } else if (process.env.NODE_ENV === "production" && isSupabaseHost) {
    fail("Pooler port", `Supabase host requires port 6543, got ${dbPort}`);
  } else {
    warn("Pooler port", `Using port ${dbPort} (not pooler). OK for non-Supabase or dev.`);
  }

  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    const latency = Date.now() - start;
    pass("DB connectivity", `${latency}ms`);
  } catch (err: any) {
    fail("DB connectivity", err.message);
  }

  let serverVersion = "unknown";
  try {
    const vRes = await db.execute(sql`SHOW server_version`);
    serverVersion = (vRes as any).rows?.[0]?.server_version || "unknown";
    pass("Server version", serverVersion);
  } catch (err: any) {
    fail("Server version", err.message);
  }

  let currentUser = "unknown";
  try {
    const uRes = await db.execute(sql`SELECT current_user AS cu`);
    currentUser = (uRes as any).rows?.[0]?.cu || "unknown";
    pass("Current user", currentUser);
  } catch (err: any) {
    fail("Current user", err.message);
  }

  const fingerprint = crypto
    .createHash("sha256")
    .update(`${dbHost}:${dbPort}:${dbName}:${serverVersion}`)
    .digest("hex")
    .slice(0, 16);
  console.log(`  DB Fingerprint: ${fingerprint}`);

  console.log("");
  console.log("[2] Entity Counts");
  try {
    const countRes = await db.execute(sql`
      SELECT 'companies' as entity, count(*)::int as c FROM companies
      UNION ALL SELECT 'cities', count(*)::int FROM cities
      UNION ALL SELECT 'users', count(*)::int FROM users
      UNION ALL SELECT 'vehicles', count(*)::int FROM vehicles
      UNION ALL SELECT 'drivers', count(*)::int FROM drivers
      UNION ALL SELECT 'clinics', count(*)::int FROM clinics
      UNION ALL SELECT 'patients', count(*)::int FROM patients
      UNION ALL SELECT 'trips', count(*)::int FROM trips
      UNION ALL SELECT 'invoices', count(*)::int FROM invoices
      ORDER BY entity
    `);
    for (const row of (countRes as any).rows) {
      const ok = row.c > 0;
      if (ok) pass(row.entity, `count=${row.c}`);
      else warn(row.entity, "count=0 (may need seeding)");
    }
  } catch (err: any) {
    fail("Entity count query", err.message);
  }

  console.log("");
  console.log("[3] Tenant Isolation (Cross-Company Check)");
  try {
    const companies = await db.execute(sql`SELECT id, name FROM companies LIMIT 3`);
    const companyList = (companies as any).rows || [];
    if (companyList.length >= 2) {
      const c1 = companyList[0];
      const c2 = companyList[1];
      const crossRes = await db.execute(sql`
        SELECT count(*)::int as c FROM trips
        WHERE company_id = ${c1.id}
        AND id IN (SELECT id FROM trips WHERE company_id = ${c2.id})
      `);
      const crossCount = (crossRes as any).rows?.[0]?.c || 0;
      if (crossCount === 0) {
        pass("No cross-company trip overlap", `${c1.name} vs ${c2.name}`);
      } else {
        fail("Cross-company overlap detected!", `${crossCount} trips shared`);
      }
    } else {
      warn("Tenant isolation", "Need at least 2 companies to test");
    }
  } catch (err: any) {
    fail("Tenant isolation query", err.message);
  }

  console.log("");
  console.log("[4] Required Env Vars");
  const required = ["SUPABASE_DB_URL", "JWT_SECRET", "SESSION_SECRET"];
  for (const key of required) {
    if (process.env[key]) {
      pass(key, "set");
    } else {
      fail(key, "MISSING");
    }
  }

  console.log("");
  console.log("=".repeat(60));
  if (fails === 0) {
    console.log(`  ${GREEN}ALL CHECKS PASSED${RESET} (${passes} passed, ${fails} failed)`);
  } else {
    console.log(`  ${RED}SOME CHECKS FAILED${RESET} (${passes} passed, ${fails} failed)`);
  }
  console.log("=".repeat(60));

  await pool.end();
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Prod check error:", err);
  process.exit(1);
});
