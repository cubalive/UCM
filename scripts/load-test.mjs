#!/usr/bin/env node
import autocannon from "autocannon";

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const DURATION = parseInt(process.env.DURATION || "60", 10);
const CONNECTIONS = parseInt(process.env.CONNECTIONS || "50", 10);

const scenarios = [
  {
    name: "GET /api/healthz",
    url: `${BASE_URL}/api/healthz`,
    method: "GET",
  },
  {
    name: "GET / (frontend)",
    url: `${BASE_URL}/`,
    method: "GET",
  },
  {
    name: "POST /api/login (bad creds)",
    url: `${BASE_URL}/api/login`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "loadtest@fake.com", password: "wrong" }),
  },
];

async function runScenario(scenario) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Scenario: ${scenario.name}`);
  console.log(`Duration: ${DURATION}s | Connections: ${CONNECTIONS}`);
  console.log("=".repeat(60));

  const opts = {
    url: scenario.url,
    method: scenario.method || "GET",
    duration: DURATION,
    connections: CONNECTIONS,
    pipelining: 1,
    timeout: 10,
  };
  if (scenario.headers) opts.headers = scenario.headers;
  if (scenario.body) opts.body = scenario.body;

  const result = await autocannon(opts);
  return result;
}

function printSummary(name, result) {
  const { requests, latency, throughput, errors, timeouts, non2xx } = result;
  console.log(`\n--- ${name} ---`);
  console.log(`  Requests/sec  avg: ${requests.average}  total: ${requests.total}`);
  console.log(`  Latency (ms)  p50: ${latency.p50}  p90: ${latency.p90}  p99: ${latency.p99}  max: ${latency.max}`);
  console.log(`  Throughput    avg: ${(throughput.average / 1024).toFixed(1)} KB/s`);
  console.log(`  Errors: ${errors}  Timeouts: ${timeouts}  Non-2xx: ${non2xx}`);
}

async function main() {
  console.log(`Load Test — ${BASE_URL}`);
  console.log(`Duration per scenario: ${DURATION}s  Connections: ${CONNECTIONS}`);
  console.log(`Total scenarios: ${scenarios.length}`);

  const results = [];

  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    results.push({ name: scenario.name, result });
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log("=".repeat(60));
  for (const { name, result } of results) {
    printSummary(name, result);
  }

  const allPassed = results.every(
    (r) => r.result.errors === 0 && r.result.timeouts === 0
  );
  console.log(`\nOverall: ${allPassed ? "PASS" : "FAIL (errors or timeouts detected)"}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
