import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sqlFile = path.join(import.meta.dirname, "supabase-migration.sql");
const sql = fs.readFileSync(sqlFile, "utf-8");

const statements = sql
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("--"));

async function executeSql(query: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (res.ok) return { ok: true };

  const text = await res.text();
  return { ok: false, error: `${res.status}: ${text}` };
}

async function tryPgMeta(fullSql: string): Promise<boolean> {
  const projectRef = SUPABASE_URL!.replace("https://", "").split(".")[0];

  const endpoints = [
    `${SUPABASE_URL}/pg/query`,
    `https://${projectRef}.supabase.co/pg/query`,
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY!,
          "Content-Type": "application/json",
          "x-connection-encrypted": "true",
        },
        body: JSON.stringify({ query: fullSql }),
      });

      if (res.ok) {
        console.log(`Migration executed successfully via ${endpoint}`);
        return true;
      }

      const text = await res.text();
      console.log(`Endpoint ${endpoint} returned ${res.status}: ${text.substring(0, 200)}`);
    } catch (e: any) {
      console.log(`Endpoint ${endpoint} failed: ${e.message}`);
    }
  }

  return false;
}

async function main() {
  console.log("Attempting to execute Supabase migration...\n");

  const success = await tryPgMeta(sql);

  if (success) {
    console.log("\nMigration completed successfully!");
    console.log("Verifying tables...");

    const verifyRes = await fetch(`${SUPABASE_URL}/rest/v1/cities?select=id,slug,name&limit=5`, {
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY!,
      },
    });

    if (verifyRes.ok) {
      const cities = await verifyRes.json();
      console.log("Cities table accessible. Rows:", JSON.stringify(cities));
    } else {
      console.log("Cities table check:", verifyRes.status, await verifyRes.text());
    }

    const profilesRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,email,role&limit=5`, {
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY!,
      },
    });

    if (profilesRes.ok) {
      const profiles = await profilesRes.json();
      console.log("Profiles table accessible. Rows:", JSON.stringify(profiles));
    } else {
      console.log("Profiles table check:", profilesRes.status, await profilesRes.text());
    }
  } else {
    console.log("\n=============================================");
    console.log("AUTOMATIC MIGRATION FAILED");
    console.log("=============================================");
    console.log("Please run the following SQL manually in your Supabase Dashboard:");
    console.log("1. Go to https://supabase.com/dashboard");
    console.log("2. Select your project");
    console.log("3. Go to SQL Editor");
    console.log("4. Paste and run the contents of: scripts/supabase-migration.sql");
    console.log("=============================================\n");
  }
}

main().catch(console.error);
