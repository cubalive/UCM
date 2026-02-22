process.env.ROLE_MODE = process.env.ROLE_MODE || "worker";

import { initSchedulers, stopSchedulers, getRoleMode } from "../server/lib/schedulerInit";
import { startMemoryLogger, stopAllSchedulers } from "../server/lib/schedulerHarness";

const ROLE = getRoleMode();

if (ROLE !== "worker" && ROLE !== "all") {
  console.error(`[WORKER] Invalid ROLE_MODE="${ROLE}" for worker entrypoint. Use "worker" or "all".`);
  process.exit(1);
}

(async () => {
  const { dbReady, getDbSource } = await import("../server/db");
  await dbReady;
  console.log(`[WORKER] DB connected — source: ${getDbSource()}`);

  const { isRedisConnected } = await import("../server/lib/redis");
  const requireRedis = process.env.REQUIRE_REDIS === "true";
  if (requireRedis && !isRedisConnected()) {
    console.error("[WORKER] REQUIRE_REDIS=true but Redis is not connected. Exiting.");
    process.exit(1);
  }

  startMemoryLogger(5 * 60 * 1000);
  await initSchedulers();

  console.log(JSON.stringify({
    event: "worker_boot_complete",
    role: ROLE,
    pid: process.pid,
    redis: isRedisConnected() ? "connected" : "not_configured",
    dbSource: getDbSource(),
    uptime: process.uptime(),
    ts: new Date().toISOString(),
  }));

  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ event: "worker_shutdown_start", signal, ts: new Date().toISOString() }));

    await stopSchedulers();

    try {
      const { pool: dbPool } = await import("../server/db");
      await dbPool.end();
      console.log(JSON.stringify({ event: "worker_db_pool_closed", ts: new Date().toISOString() }));
    } catch {}

    setTimeout(() => {
      console.log(JSON.stringify({ event: "worker_forced_exit", ts: new Date().toISOString() }));
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  process.on("unhandledRejection", (reason: any) => {
    console.error(JSON.stringify({
      event: "worker_unhandled_rejection",
      error: reason?.message || String(reason),
      stack: reason?.stack?.slice(0, 1000),
      ts: new Date().toISOString(),
    }));
  });

  process.on("uncaughtException", (err: Error) => {
    console.error(JSON.stringify({
      event: "worker_uncaught_exception",
      error: err.message,
      stack: err.stack?.slice(0, 1000),
      ts: new Date().toISOString(),
    }));
    gracefulShutdown("uncaughtException");
  });
})();
