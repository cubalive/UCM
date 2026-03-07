import { execSync } from "child_process";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scenariosDir = path.join(__dirname, "scenarios");

if (!process.env.AUTH_TOKEN) {
  console.error("ERROR: Set AUTH_TOKEN env var first");
  console.error("Example: export AUTH_TOKEN=$(curl -s http://localhost:5000/api/auth/login -H 'Content-Type: application/json' -d '{\"email\":\"admin@ucm.com\",\"password\":\"pass\"}' | node -e \"process.stdin.on('data',d=>console.log(JSON.parse(d).token))\")");
  process.exit(1);
}

const scenarios = readdirSync(scenariosDir)
  .filter(f => f.endsWith(".mjs"))
  .sort();

console.log(`\n=== UCM Load Test Suite ===`);
console.log(`Scenarios: ${scenarios.join(", ")}`);
console.log(`Base URL: ${process.env.BASE_URL || "http://localhost:5000"}`);
console.log(`===========================\n`);

for (const scenario of scenarios) {
  console.log(`\n>>> Running: ${scenario}\n`);
  try {
    execSync(`node ${path.join(scenariosDir, scenario)}`, {
      stdio: "inherit",
      env: process.env,
      timeout: 60_000,
    });
  } catch (err) {
    console.error(`>>> FAILED: ${scenario}: ${err.message}`);
  }
  console.log(`\n>>> Completed: ${scenario}\n`);
}

console.log("\n=== All scenarios complete ===");
