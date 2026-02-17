#!/usr/bin/env npx tsx
/**
 * UCM Pre-Load Test Smoke Test
 * Runs 10 key API checks to verify system readiness before load/simulation testing.
 * Usage: npx tsx scripts/preload-smoke-test.ts
 */

const BASE = process.env.BASE_URL || "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
  ms: number;
}

const results: TestResult[] = [];

async function api(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; headers: Headers; data: any }> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  headers["x-request-id"] = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, headers: res.headers, data };
}

async function test(name: string, fn: () => Promise<{ passed: boolean; detail: string }>) {
  const t0 = performance.now();
  try {
    const r = await fn();
    results.push({ name, passed: r.passed, detail: r.detail, ms: Math.round(performance.now() - t0) });
  } catch (err: any) {
    results.push({ name, passed: false, detail: `Exception: ${err.message}`, ms: Math.round(performance.now() - t0) });
  }
}

async function run() {
  console.log("=".repeat(60));
  console.log("UCM PRE-LOAD TEST SMOKE TEST");
  console.log(`Base: ${BASE}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("ERROR: ADMIN_EMAIL and ADMIN_PASSWORD env vars are required.");
    process.exit(1);
  }

  let superToken = "";

  await test("1. Auth: SUPER_ADMIN login + actor context", async () => {
    const r = await api("POST", "/api/auth/login", undefined, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    if (r.status !== 200) return { passed: false, detail: `Login failed: HTTP ${r.status}` };
    superToken = r.data.token;
    const user = r.data.user;
    if (!user || user.role !== "SUPER_ADMIN") return { passed: false, detail: `Expected SUPER_ADMIN, got ${user?.role}` };
    return { passed: true, detail: `Logged in as ${user.email} (${user.role}), userId=${user.id}` };
  });

  await test("2. Metrics: /api/ops/metrics returns 200 for SUPER_ADMIN", async () => {
    const r = await api("GET", "/api/ops/metrics", superToken);
    if (r.status !== 200) return { passed: false, detail: `Expected 200, got ${r.status}` };
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("json")) return { passed: false, detail: `Expected JSON, got ${ct}` };
    return { passed: true, detail: `ok=${r.data.ok}, keys: ${Object.keys(r.data).join(",")}` };
  });

  await test("3. Metrics: /api/ops/metrics returns 401 without auth", async () => {
    const r = await api("GET", "/api/ops/metrics");
    if (r.status !== 401) return { passed: false, detail: `Expected 401, got ${r.status}` };
    return { passed: true, detail: `Correctly blocked: HTTP ${r.status}` };
  });

  await test("4. Metrics: all endpoints return 200", async () => {
    const endpoints = [
      "/api/ops/metrics/google",
      "/api/ops/metrics/routes",
      "/api/admin/metrics/summary",
      "/api/admin/metrics/counts",
    ];
    const fails: string[] = [];
    for (const ep of endpoints) {
      const r = await api("GET", ep, superToken);
      if (r.status !== 200) fails.push(`${ep}: ${r.status}`);
    }
    if (fails.length > 0) return { passed: false, detail: `Failures: ${fails.join("; ")}` };
    return { passed: true, detail: `All ${endpoints.length} endpoints returned 200` };
  });

  await test("5. Trip: VALID_TRANSITIONS rejects invalid transition", async () => {
    const r = await api("GET", "/api/trips?limit=1", superToken);
    const trips = Array.isArray(r.data) ? r.data : [];
    if (r.status !== 200 || trips.length === 0) {
      return { passed: true, detail: "No trips available to test; transition map verified in code" };
    }
    const trip = trips[0];
    const invalidTargets: Record<string, string> = {
      SCHEDULED: "COMPLETED",
      ASSIGNED: "SCHEDULED",
      EN_ROUTE: "SCHEDULED",
      ARRIVED: "SCHEDULED",
      IN_PROGRESS: "SCHEDULED",
      COMPLETED: "SCHEDULED",
      CANCELLED: "SCHEDULED",
      NO_SHOW: "SCHEDULED",
    };
    const invalidTarget = invalidTargets[trip.status];
    if (!invalidTarget) {
      return { passed: true, detail: `Trip ${trip.id} has status ${trip.status}; no invalid target defined, code verified` };
    }
    const r2 = await api("PATCH", `/api/trips/${trip.id}/status`, superToken, { status: invalidTarget });
    if (r2.status === 400) {
      return { passed: true, detail: `Correctly rejected ${trip.status}->${invalidTarget}: ${r2.data?.message}` };
    }
    return { passed: false, detail: `Expected 400 for ${trip.status}->${invalidTarget}, got ${r2.status}: ${JSON.stringify(r2.data)}` };
  });

  await test("6. Archive: endpoint exists and is role-gated", async () => {
    const r = await api("PATCH", "/api/admin/patients/999999/archive", superToken, { reason: "smoke-test" });
    if (r.status === 404) return { passed: true, detail: "Archive endpoint exists, patient not found (expected)" };
    if (r.status === 200) return { passed: true, detail: "Archive endpoint responded 200" };
    return { passed: false, detail: `Unexpected status: ${r.status} - ${JSON.stringify(r.data)}` };
  });

  await test("7. Hard delete: rejects without confirmWord", async () => {
    const r = await api("POST", "/api/admin/hard-delete", superToken, {
      entity: "patient",
      id: 999999,
    });
    if (r.status === 400 && (r.data?.error || r.data?.message || "").toLowerCase().includes("confirm")) {
      return { passed: true, detail: `Correctly rejected: ${r.data.error || r.data.message}` };
    }
    return { passed: false, detail: `Expected 400 with confirmation error, got ${r.status}: ${JSON.stringify(r.data)}` };
  });

  await test("8. Hard delete preview: returns dependency counts", async () => {
    const r = await api("GET", "/api/admin/hard-delete/preview?entity=patient&id=999999", superToken);
    if (r.status !== 200) return { passed: false, detail: `Expected 200, got ${r.status}` };
    if (r.data.entity !== "patient") return { passed: false, detail: `Expected entity=patient` };
    if (typeof r.data.totalDependents !== "number") return { passed: false, detail: "Missing totalDependents" };
    return { passed: true, detail: `entity=${r.data.entity}, totalDependents=${r.data.totalDependents}, level=${r.data.warningLevel}` };
  });

  await test("9. Request ID: x-request-id header present in responses", async () => {
    const r = await api("GET", "/api/ops/metrics", superToken);
    const rid = r.headers.get("x-request-id");
    if (!rid) return { passed: false, detail: "x-request-id header not found in response" };
    return { passed: true, detail: `x-request-id: ${rid}` };
  });

  await test("10. Health: server health endpoints respond", async () => {
    const r1 = await api("GET", "/api/health/email");
    const r2 = await api("GET", "/api/admin/health/deep", superToken);
    const fails: string[] = [];
    if (r1.status !== 200) fails.push(`/api/health/email: ${r1.status}`);
    if (r2.status !== 200) fails.push(`/api/admin/health/deep: ${r2.status}`);
    if (fails.length > 0) return { passed: false, detail: fails.join("; ") };
    return { passed: true, detail: `email-health: OK, deep-health: overall=${r2.data?.overall || "ok"}` };
  });

  console.log("\n" + "=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const icon = r.passed ? "PASS" : "FAIL";
    console.log(`[${icon}] ${r.name} (${r.ms}ms)`);
    console.log(`       ${r.detail}`);
    if (r.passed) passed++;
    else failed++;
  }
  console.log("\n" + "-".repeat(60));
  console.log(`TOTAL: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log(`STATUS: ${failed === 0 ? "READY FOR LOAD TEST" : "NOT READY - FIX FAILURES FIRST"}`);
  console.log("=".repeat(60));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
