import autocannon from "autocannon";
import http from "http";
import { WebSocket } from "ws";
import { readFileSync } from "fs";

const BASE = process.env.TARGET || "http://localhost:5000";
const CONNECTIONS = parseInt(process.env.CONNECTIONS || "200", 10);
const DURATION = parseInt(process.env.DURATION || "120", 10);
const TOKEN = process.env.AUTH_TOKEN || readFileSync("/tmp/test_token.txt", "utf8").trim();

const AUTH_HEADERS = { authorization: `Bearer ${TOKEN}` };

async function runAutocannon(title, opts) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`  connections=${opts.connections}  duration=${opts.duration}s`);
  console.log(`${"=".repeat(60)}`);

  const result = await autocannon({
    ...opts,
    headers: { ...AUTH_HEADERS, ...(opts.headers || {}) },
  });

  const summary = {
    title,
    url: opts.url,
    connections: opts.connections,
    duration: opts.duration,
    avgLatencyMs: result.latency.average,
    p50LatencyMs: result.latency.p50,
    p95LatencyMs: result.latency.p95,
    p99LatencyMs: result.latency.p99,
    maxLatencyMs: result.latency.max,
    reqPerSec: result.requests.average,
    totalRequests: result.requests.total,
    total2xx: result["2xx"],
    total4xx: result["4xx"],
    total5xx: result["5xx"],
    totalTimeouts: result.timeouts,
    totalErrors: result.errors,
    errorRatePercent: result.requests.total > 0
      ? (((result["5xx"] + result.errors + result.timeouts) / result.requests.total) * 100).toFixed(2)
      : "0.00",
    throughputMBps: (result.throughput.average / 1024 / 1024).toFixed(2),
  };

  console.log(`  avg=${summary.avgLatencyMs}ms  p95=${summary.p95LatencyMs}ms  p99=${summary.p99LatencyMs}ms  max=${summary.maxLatencyMs}ms`);
  console.log(`  req/s=${summary.reqPerSec}  total=${summary.totalRequests}  2xx=${summary.total2xx}  5xx=${summary.total5xx}  errors=${summary.totalErrors}  timeouts=${summary.totalTimeouts}`);
  console.log(`  error_rate=${summary.errorRatePercent}%  throughput=${summary.throughputMBps} MB/s`);

  return summary;
}

async function getDbPoolStatus() {
  try {
    const res = await fetch(`${BASE}/api/ops/db-info`, { headers: AUTH_HEADERS });
    const data = await res.json();
    return { poolStats: data.poolStats, poolConfig: data.poolConfig };
  } catch (e) {
    return { error: e.message };
  }
}

async function getMemoryUsage() {
  try {
    const res = await fetch(`${BASE}/api/ops/readyz`, { headers: AUTH_HEADERS });
    const data = await res.json();
    return data.memory;
  } catch (e) {
    return { error: e.message };
  }
}

async function wsStressTest(count, durationSec) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  WebSocket Stress: ${count} connections, ${durationSec}s`);
  console.log(`${"=".repeat(60)}`);

  const wsUrl = BASE.replace("http", "ws") + `/ws?token=${TOKEN}`;
  const sockets = [];
  let connected = 0;
  let rejected = 0;
  let errors = 0;
  let messagesSent = 0;
  let messagesReceived = 0;
  let rateLimited = 0;

  for (let i = 0; i < count; i++) {
    try {
      const ws = new WebSocket(wsUrl);
      ws.on("open", () => { connected++; });
      ws.on("message", (data) => {
        messagesReceived++;
        const msg = data.toString();
        if (msg.includes("rate_limit") || msg.includes("too_many")) rateLimited++;
      });
      ws.on("error", () => { errors++; });
      ws.on("close", () => { rejected++; });
      sockets.push(ws);
    } catch {
      errors++;
    }
    if (i % 50 === 0) await new Promise(r => setTimeout(r, 100));
  }

  await new Promise(r => setTimeout(r, 3000));
  console.log(`  Connected: ${connected}  Errors: ${errors}  Rejected: ${rejected}`);

  const heartbeatInterval = setInterval(() => {
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
        messagesSent++;
      }
    }
  }, 5000);

  const msgBurstInterval = setInterval(() => {
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "subscribe", channel: "trip:test" }));
        messagesSent++;
      }
    }
  }, 1000);

  await new Promise(r => setTimeout(r, durationSec * 1000));

  clearInterval(heartbeatInterval);
  clearInterval(msgBurstInterval);

  for (const ws of sockets) {
    try { ws.close(); } catch {}
  }

  await new Promise(r => setTimeout(r, 2000));

  const result = {
    attempted: count,
    connected,
    errors,
    rejected,
    messagesSent,
    messagesReceived,
    rateLimited,
    stability: errors === 0 && connected > 0 ? "STABLE" : errors < count * 0.1 ? "DEGRADED" : "UNSTABLE",
  };

  console.log(`  Sent: ${messagesSent}  Received: ${messagesReceived}  Rate-limited: ${rateLimited}`);
  console.log(`  Stability: ${result.stability}`);

  return result;
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║        UCM EXTREME LOAD TEST                           ║");
  console.log(`║  Target: ${BASE.padEnd(47)}║`);
  console.log(`║  Connections: ${String(CONNECTIONS).padEnd(42)}║`);
  console.log(`║  Duration: ${String(DURATION).padEnd(45)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");

  const memBefore = await getMemoryUsage();
  const poolBefore = await getDbPoolStatus();
  console.log(`\nMemory before: RSS=${memBefore.rss}MB  Heap=${memBefore.heapUsed}/${memBefore.heapTotal}MB`);
  console.log(`Pool before: total=${poolBefore.poolStats?.totalCount}  idle=${poolBefore.poolStats?.idleCount}  waiting=${poolBefore.poolStats?.waitingCount}`);

  const results = {};

  results.healthz = await runAutocannon("Phase 2A: /api/healthz", {
    url: `${BASE}/api/healthz`,
    connections: CONNECTIONS,
    duration: Math.min(DURATION, 30),
  });

  results.trips = await runAutocannon("Phase 2B: /api/trips", {
    url: `${BASE}/api/trips`,
    connections: Math.min(CONNECTIONS, 100),
    duration: Math.min(DURATION, 30),
  });

  results.invoices = await runAutocannon("Phase 2C: /api/invoices", {
    url: `${BASE}/api/invoices`,
    connections: Math.min(CONNECTIONS, 100),
    duration: Math.min(DURATION, 30),
  });

  results.readyz = await runAutocannon("Phase 2D: /api/ops/readyz", {
    url: `${BASE}/api/ops/readyz`,
    connections: Math.min(CONNECTIONS, 50),
    duration: Math.min(DURATION, 20),
  });

  const poolMid = await getDbPoolStatus();
  const memMid = await getMemoryUsage();
  console.log(`\nMid-test pool: total=${poolMid.poolStats?.totalCount}  idle=${poolMid.poolStats?.idleCount}  waiting=${poolMid.poolStats?.waitingCount}`);
  console.log(`Mid-test memory: RSS=${memMid.rss}MB  Heap=${memMid.heapUsed}/${memMid.heapTotal}MB`);

  const wsResult = await wsStressTest(Math.min(CONNECTIONS, 100), 20);
  results.websocket = wsResult;

  const memAfter = await getMemoryUsage();
  const poolAfter = await getDbPoolStatus();

  const peakReqPerSec = Math.max(
    results.healthz.reqPerSec || 0,
    results.trips.reqPerSec || 0,
    results.invoices.reqPerSec || 0,
    results.readyz.reqPerSec || 0,
  );

  const maxP99 = Math.max(
    results.healthz.p99LatencyMs || 0,
    results.trips.p99LatencyMs || 0,
    results.invoices.p99LatencyMs || 0,
    results.readyz.p99LatencyMs || 0,
  );

  const totalErrors = Object.values(results)
    .filter(r => r.totalErrors !== undefined)
    .reduce((a, r) => a + (r.total5xx || 0) + (r.totalErrors || 0) + (r.totalTimeouts || 0), 0);
  const totalReqs = Object.values(results)
    .filter(r => r.totalRequests !== undefined)
    .reduce((a, r) => a + (r.totalRequests || 0), 0);

  const bottlenecks = [];
  if (maxP99 > 2000) bottlenecks.push("High p99 latency (>2s)");
  if (poolAfter.poolStats?.waitingCount > 0) bottlenecks.push("DB pool contention (waiting > 0)");
  if (memAfter.rss > 500) bottlenecks.push("High memory usage (>500MB RSS)");
  if (totalErrors / totalReqs > 0.01) bottlenecks.push("Error rate > 1%");
  if (wsResult.stability !== "STABLE") bottlenecks.push("WebSocket instability");

  const report = {
    timestamp: new Date().toISOString(),
    maxConnectionsTested: CONNECTIONS,
    peakReqPerSecond: peakReqPerSec,
    p99Latency: maxP99,
    dbPoolStatus: {
      before: poolBefore.poolStats,
      mid: poolMid.poolStats,
      after: poolAfter.poolStats,
      config: poolBefore.poolConfig,
    },
    memoryUsageMB: {
      before: memBefore,
      mid: memMid,
      after: memAfter,
    },
    websocketStability: wsResult.stability,
    websocketDetails: {
      connected: wsResult.connected,
      errors: wsResult.errors,
      rateLimited: wsResult.rateLimited,
    },
    errorRatePercent: totalReqs > 0 ? ((totalErrors / totalReqs) * 100).toFixed(3) : "0.000",
    totalRequests: totalReqs,
    totalErrors,
    bottlenecksDetected: bottlenecks,
    safeProductionCapacityEstimate: peakReqPerSec > 500
      ? "HIGH (500+ req/s sustained)"
      : peakReqPerSec > 100
        ? "MEDIUM (100-500 req/s)"
        : "LOW (<100 req/s — investigate)",
    endpoints: {
      healthz: results.healthz,
      trips: results.trips,
      invoices: results.invoices,
      readyz: results.readyz,
    },
  };

  console.log("\n" + "=".repeat(60));
  console.log("  FINAL REPORT");
  console.log("=".repeat(60));
  console.log(JSON.stringify(report, null, 2));

  return report;
}

main().catch(err => { console.error("Load test failed:", err); process.exit(1); });
