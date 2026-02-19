import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD env vars are required");
  process.exit(1);
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  return data.token;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function createJob(token: string, companyId: number): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/admin/imports`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ companyId, sourceSystem: "smoke_test", consentConfirmed: true }),
  });
  if (!res.ok) throw new Error(`Create job failed: ${res.status} ${await res.text()}`);
  const job = await res.json() as any;
  console.log(`  Created job: ${job.id} for company ${companyId}`);
  return job.id;
}

async function uploadFile(token: string, jobId: string, entity: string, filePath: string): Promise<void> {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const boundary = `----FormBoundary${Date.now()}`;
  const parts: Buffer[] = [];

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: text/csv\r\n\r\n`
  ));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const res = await fetch(`${BASE_URL}/api/admin/imports/${jobId}/upload?entity=${entity}`, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Upload ${entity} failed: ${res.status} ${await res.text()}`);
  console.log(`  Uploaded ${entity}: ${fileName}`);
}

async function validate(token: string, jobId: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/admin/imports/${jobId}/validate`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Validate failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  console.log(`  Validation: status=${data.status}`);
  for (const [entity, counts] of Object.entries(data.counts || {})) {
    const c = counts as any;
    console.log(`    ${entity}: ok=${c.ok} error=${c.error} skipped=${c.skipped}`);
  }
  if (data.status !== "validated") throw new Error(`Validation did not pass: ${data.status}`);
  return data;
}

async function runImport(token: string, jobId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/admin/imports/${jobId}/run`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Run import failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  console.log(`  Run: status=${data.status} message=${data.message || ""}`);
}

async function waitForCompletion(token: string, jobId: string, timeoutMs = 60000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BASE_URL}/api/admin/imports/${jobId}/status`, {
      headers: authHeaders(token),
    });
    if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
    const data = await res.json() as any;
    if (data.status === "completed") {
      console.log(`  Import completed!`);
      if (data.progress?.results) {
        for (const [entity, r] of Object.entries(data.progress.results)) {
          const rr = r as any;
          console.log(`    ${entity}: inserted=${rr.inserted} updated=${rr.updated} errors=${rr.errors}`);
        }
      }
      return data;
    }
    if (data.status === "failed") {
      throw new Error(`Import failed: ${JSON.stringify(data)}`);
    }
    const pct = data.progress?.percent ?? 0;
    process.stdout.write(`  Progress: ${pct}% (${data.progress?.current || 0}/${data.progress?.total || "?"})\r`);
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Import timed out after ${timeoutMs}ms`);
}

async function checkHealth(token: string, companyId: number): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/admin/imports/company/${companyId}/health`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Health check failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  console.log(`  Company Health for "${data.companyName}" (ID=${data.companyId}):`);
  for (const [entity, count] of Object.entries(data.counts)) {
    console.log(`    ${entity}: ${count}`);
  }
  return data;
}

async function main() {
  console.log("=== Import Smoke Test ===\n");
  const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/import");

  const COMPANY_ID = parseInt(process.env.SMOKE_TEST_COMPANY_ID || "4");

  console.log("[1] Logging in...");
  const token = await login();
  console.log("  Logged in successfully\n");

  console.log("[2] Checking initial health...");
  const healthBefore = await checkHealth(token, COMPANY_ID);
  console.log();

  console.log("[3] Creating import job...");
  const jobId = await createJob(token, COMPANY_ID);
  console.log();

  console.log("[4] Uploading fixture files...");
  const entities = ["clinics", "drivers", "vehicles", "patients"];
  for (const entity of entities) {
    const filePath = path.join(FIXTURE_DIR, `${entity}.csv`);
    if (fs.existsSync(filePath)) {
      await uploadFile(token, jobId, entity, filePath);
    } else {
      console.log(`  Skipping ${entity}: no fixture file`);
    }
  }
  console.log();

  console.log("[5] Validating...");
  await validate(token, jobId);
  console.log();

  console.log("[6] Running import...");
  await runImport(token, jobId);
  console.log();

  console.log("[7] Waiting for completion...");
  const result = await waitForCompletion(token, jobId);
  console.log();

  console.log("[8] Checking health after import...");
  const healthAfter = await checkHealth(token, COMPANY_ID);
  console.log();

  console.log("=== VERIFICATION ===");
  let pass = true;
  for (const entity of entities) {
    const before = (healthBefore.counts as any)[entity] || 0;
    const after = (healthAfter.counts as any)[entity] || 0;
    const delta = after - before;
    const status = delta > 0 ? "PASS" : "FAIL";
    if (delta <= 0) pass = false;
    console.log(`  ${entity}: ${before} -> ${after} (delta: +${delta}) [${status}]`);
  }

  console.log(`\n=== Overall: ${pass ? "PASS" : "FAIL"} ===`);
  if (!pass) {
    console.log("\nSome entities did not gain records. Check the event log for errors.");
    process.exit(1);
  }

  console.log("\nSmoke test passed! All entities gained records.");
}

main().catch(err => {
  console.error("\nFATAL:", err.message);
  process.exit(1);
});
