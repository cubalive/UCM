import "dotenv/config";
import { initSentry, captureException, sentryFlush } from "./lib/sentry.js";
initSentry();
import http from "http";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { globalRateLimiter } from "./middleware/rateLimiter.js";
import { requestMetricsMiddleware } from "./middleware/requestMetrics.js";
import healthRoutes from "./routes/health.js";
import billingRoutes from "./routes/billing.js";
import webhookRoutes from "./routes/webhooks.js";
import feeRoutes from "./routes/fees.js";
import adminRoutes from "./routes/admin.js";
import stripeConnectRoutes from "./routes/stripeConnect.js";
import tripRoutes from "./routes/trips.js";
import driverRoutes from "./routes/drivers.js";
import dispatchRoutes from "./routes/dispatch.js";
import clinicRoutes from "./routes/clinic.js";
import driverPayoutRoutes from "./routes/driverPayouts.js";
import authRoutes from "./routes/auth.js";
import importRoutes from "./routes/import.js";
import { csrfProtection, csrfTokenRoute } from "./middleware/csrf.js";
import logger from "./lib/logger.js";
import { getRedis } from "./lib/redis.js";
import { getPool } from "./db/index.js";
import { initWebSocket } from "./services/realtimeService.js";
import { startReconciliationJob } from "./jobs/reconciliationJob.js";
import { startDeadLetterMonitorJob } from "./jobs/deadLetterProcessor.js";
import { startStuckTripDetectorJob } from "./jobs/stuckTripDetector.js";
import { startLocationCleanupJob } from "./jobs/locationCleanup.js";

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT) || 3000;

// Initialize WebSocket on the same server
initWebSocket(server);

// Webhook route needs raw body — must be before express.json()
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), (req, _res, next) => {
  (req as any).rawBody = req.body;
  next();
});

// Global middleware
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(globalRateLimiter);
app.use(requestMetricsMiddleware);

// CORS for frontend
app.use((_req, res, next) => {
  const allowedOrigins = (process.env.APP_URL || "").split(",").map(s => s.trim()).filter(Boolean);
  const requestOrigin = _req.headers.origin;

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    res.header("Access-Control-Allow-Origin", requestOrigin);
    res.header("Access-Control-Allow-Credentials", "true");
  } else if (allowedOrigins.length > 0) {
    res.header("Access-Control-Allow-Origin", allowedOrigins[0]);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  // In development without APP_URL, allow the request origin (not wildcard with credentials)
  else if (process.env.NODE_ENV !== "production" && requestOrigin) {
    res.header("Access-Control-Allow-Origin", requestOrigin);
    res.header("Access-Control-Allow-Credentials", "true");
  }

  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token");
  res.header("Access-Control-Max-Age", "86400");
  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// CSRF token endpoint (must be before csrfProtection middleware)
app.get("/api/csrf-token", csrfTokenRoute);

// CSRF protection for state-changing requests
app.use(csrfProtection);

// Routes
app.use("/api", healthRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/fees", feeRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/stripe-connect", stripeConnectRoutes);
app.use("/api/trips", tripRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/dispatch", dispatchRoutes);
app.use("/api/clinic", clinicRoutes);
app.use("/api/driver-payouts", driverPayoutRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/import", importRoutes);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Unhandled error", { error: err.message, stack: err.stack });
  captureException(err);
  res.status(500).json({ error: "Internal server error" });
});

// Connect to Redis eagerly (lazy connect, but initiate)
try {
  const redis = getRedis();
  redis?.connect().catch(() => {
    logger.warn("Redis not available — operating without cache");
  });
} catch {
  logger.warn("Redis initialization skipped");
}

// Track cron jobs for graceful shutdown
const cronJobs: Array<{ stop: () => void }> = [];

server.listen(port, () => {
  logger.info(`UCM platform listening on port ${port}`, { env: process.env.NODE_ENV });

  // Start background jobs in production
  if (process.env.NODE_ENV === "production") {
    cronJobs.push(
      startReconciliationJob(),
      startDeadLetterMonitorJob(),
      startStuckTripDetectorJob(),
      startLocationCleanupJob(),
    );
  }
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`${signal} received — starting graceful shutdown`);

  // 1. Stop accepting new connections
  server.close(() => {
    logger.info("HTTP server closed");
  });

  // 2. Stop cron jobs
  for (const job of cronJobs) {
    try { job.stop(); } catch { /* already stopped */ }
  }

  // 3. Close Redis
  try {
    const redis = getRedis();
    if (redis) await redis.quit();
  } catch { /* non-fatal */ }

  // 4. Flush Sentry events
  await sentryFlush(2000);

  // 5. Close DB pool
  try {
    await getPool().end();
  } catch { /* non-fatal */ }

  logger.info("Graceful shutdown complete");

  // Force exit after 10s if draining stalls
  setTimeout(() => {
    logger.warn("Forced exit after shutdown timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
