import pg from "pg";
import fs from "fs";

const connStr = process.env.SUPABASE_DB_URL;
if (!connStr) {
  console.error("SUPABASE_DB_URL not set");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: connStr,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

const sql = fs.readFileSync("migrations/0000_keen_darwin.sql", "utf-8");
const statements = sql
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

let created = 0;
let skipped = 0;
let errors = 0;

for (const stmt of statements) {
  const label = stmt.slice(0, 80).replace(/\n/g, " ");
  try {
    await pool.query(stmt);
    created++;
    console.log(`[OK] ${label}...`);
  } catch (err) {
    if (
      err.code === "42710" ||
      err.code === "42P07" ||
      err.message.includes("already exists")
    ) {
      skipped++;
      console.log(`[SKIP] ${label}...`);
    } else {
      errors++;
      console.error(`[ERR] ${label}...`);
      console.error(`  Code: ${err.code}, Message: ${err.message}`);
    }
  }
}

console.log(`\nDone: ${created} created, ${skipped} skipped, ${errors} errors`);
await pool.end();
process.exit(errors > 0 ? 1 : 0);
