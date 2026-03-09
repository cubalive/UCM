import "dotenv/config";
import { getEnv } from "./lib/env.js";

// Validate environment variables eagerly at boot — fail fast
const env = getEnv();

import { initSentry, captureException, sentryFlush } from "./lib/sentry.js";
initSentry();
import http from "http";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { globalRateLimiter } from "./middleware/rateLimiter.js";
import { requestMetricsMiddleware } from "./middleware/requestMetrics.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
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
import { initWebSocket, shutdownWebSocket } from "./services/realtimeService.js";
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
app.use(requestIdMiddleware);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(globalRateLimiter);
app.use(requestMetricsMiddleware);

// ── CORS ─────────────────────────────────────────────────────────────
// Production domains: app/driver/clinic.unitedcaremobility.com
// APP_URL env var is comma-separated list of allowed origins
const PRODUCTION_ORIGINS = [
  "https://app.unitedcaremobility.com",
  "https://driver.unitedcaremobility.com",
  "https://clinic.unitedcaremobility.com",
  "https://ucm-api-production.up.railway.app",
];

function buildAllowedOrigins(): Set<string> {
  const envOrigins = (process.env.APP_URL || "").split(",").map(s => s.trim()).filter(Boolean);
  return new Set([...PRODUCTION_ORIGINS, ...envOrigins]);
}

const allowedOrigins = buildAllowedOrigins();

app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;

  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    res.header("Access-Control-Allow-Origin", requestOrigin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  // In development without explicit APP_URL, allow the request origin
  else if (process.env.NODE_ENV !== "production" && requestOrigin) {
    res.header("Access-Control-Allow-Origin", requestOrigin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  // In production, reject unknown origins — do NOT set any Allow-Origin header

  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-Request-ID");
  res.header("Access-Control-Expose-Headers", "X-Request-ID");
  res.header("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
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
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  const status = (err as any).status || (err as any).statusCode || 500;
  logger.error("Unhandled error", {
    error: err.message,
    stack: err.stack,
    requestId: req.requestId,
    method: req.method,
    path: req.path,
  });
  captureException(err);
  res.status(status).json({ error: status >= 500 ? "Internal server error" : err.message });
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

server.listen(port, '0.0.0.0', () => {
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

  // 2. Close WebSocket connections gracefully
  await shutdownWebSocket();

  // 3. Stop cron jobs
  for (const job of cronJobs) {
    try { job.stop(); } catch { /* already stopped */ }
  }

  // 4. Close Redis
  try {
    const redis = getRedis();
    if (redis) await redis.quit();
  } catch { /* non-fatal */ }

  // 5. Flush Sentry events
  await sentryFlush(2000);

  // 6. Close DB pool
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

process.on("unhandledRejection", (reason: any) => {
  logger.error("Unhandled promise rejection", {
    error: reason?.message || String(reason),
    stack: reason?.stack?.slice(0, 1000),
  });
  captureException(reason instanceof Error ? reason : new Error(String(reason)));
});

process.on("uncaughtException", (err: Error) => {
  logger.error("Uncaught exception", { error: err.message, stack: err.stack?.slice(0, 1000) });
  captureException(err);
  shutdown("uncaughtException");
});

export default app;
