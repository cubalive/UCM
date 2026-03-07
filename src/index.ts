import "dotenv/config";
import http from "http";
import express from "express";
import helmet from "helmet";
import { globalRateLimiter } from "./middleware/rateLimiter.js";
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
import logger from "./lib/logger.js";
import { getRedis } from "./lib/redis.js";
import { initWebSocket } from "./services/realtimeService.js";
import { startReconciliationJob } from "./jobs/reconciliationJob.js";
import { startDeadLetterMonitorJob } from "./jobs/deadLetterProcessor.js";

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
app.use(globalRateLimiter);

// CORS for frontend
app.use((_req, res, next) => {
  const origin = process.env.APP_URL || "";
  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  } else {
    res.header("Access-Control-Allow-Origin", _req.headers.origin || "*");
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

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Unhandled error", { error: err.message, stack: err.stack });
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

server.listen(port, () => {
  logger.info(`UCM platform listening on port ${port}`, { env: process.env.NODE_ENV });

  // Start background jobs in production
  if (process.env.NODE_ENV === "production") {
    startReconciliationJob();
    startDeadLetterMonitorJob();
  }
});

export default app;
