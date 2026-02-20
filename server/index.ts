import express, { type Request, Response, NextFunction } from "express";
import crypto from "crypto";
import path from "path";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes/index";
import { serveStatic } from "./static";
import { createServer } from "http";
import { recordRequest as recordReqMetric } from "./lib/requestMetrics";
import { tracingMiddleware } from "./lib/requestTracing";
import { tenantGuard } from "./lib/tenantGuard";

const app = express();
const httpServer = createServer(app);

const IS_PROD = process.env.NODE_ENV === "production";
if (IS_PROD) {
  app.set("trust proxy", 1);
}

app.use(cookieParser());

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
  }
}

app.use(
  express.json({
    limit: "256kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.get("/.well-known/assetlinks.json", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.unitedcaremobility.driver",
        sha256_cert_fingerprints: [
          "0C:34:66:B4:36:FD:CC:8D:8C:8E:7C:B1:31:B9:94:D7:E7:A7:06:AD:B3:F4:68:59:33:0E:3C:CA:17:14:EF:2A",
        ],
      },
    },
  ]);
});

function readOriginList(prefix: string): Set<string> {
  const origins = new Set<string>();
  for (let i = 1; i <= 10; i++) {
    const val = process.env[`${prefix}_${i}`]?.trim().replace(/\/+$/, "");
    if (val) origins.add(val);
  }
  return origins;
}

const BUILTIN_APP_ORIGINS = new Set([
  "https://unitedcaremobility.com",
  "https://www.unitedcaremobility.com",
  "https://app.unitedcaremobility.com",
  "https://driver.unitedcaremobility.com",
  "https://admin.unitedcaremobility.com",
]);

const envAppOrigins = readOriginList("ALLOWED_APP_ORIGIN");
const envPublicOrigins = readOriginList("ALLOWED_PUBLIC_ORIGIN");
const envLegacyOrigins = readOriginList("ALLOWED_ORIGIN");

const hasNewVars = envAppOrigins.size > 0 || envPublicOrigins.size > 0;
const legacyAsApp = hasNewVars ? [] : Array.from(envLegacyOrigins);

export const allowedAppOrigins = new Set(Array.from(BUILTIN_APP_ORIGINS).concat(Array.from(envAppOrigins), legacyAsApp));
export const allowedPublicOrigins = new Set(Array.from(envPublicOrigins));

function isReplitDev(origin: string): boolean {
  return /^https:\/\/[a-z0-9\-]+\.replit\.dev$/i.test(origin)
    || /^https:\/\/[a-z0-9\-]+\.picard\.replit\.dev$/i.test(origin);
}

function isAppOrigin(origin: string): boolean {
  if (!origin) return false;
  if (allowedAppOrigins.has(origin)) return true;
  if (isReplitDev(origin)) return true;
  return false;
}

function isPublicOrigin(origin: string): boolean {
  if (!origin) return false;
  if (allowedPublicOrigins.has(origin)) return true;
  if (/^https:\/\/[a-z0-9\-]+\.lovable\.app$/i.test(origin)) return true;
  if (isReplitDev(origin)) return true;
  return false;
}

app.use("/api/public", (req, res, next) => {
  const origin = req.headers.origin || "";
  res.setHeader("Vary", "Origin");

  if (isPublicOrigin(origin) || isAppOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
  } else if (origin) {
    console.warn(`[CORS] Blocked public origin="${origin}" path="${req.path}" method="${req.method}"`);
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/public")) return next();

  const origin = req.headers.origin || "";
  res.setHeader("Vary", "Origin");

  if (isAppOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Stripe-Signature");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Max-Age", "86400");
  } else if (origin) {
    console.warn(`[CORS] Blocked origin="${origin}" path="${req.path}" method="${req.method}"`);
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req: Request, _res: Response, next: NextFunction) => {
  req.requestId = (req.headers["x-request-id"] as string) || crypto.randomUUID().slice(0, 12);
  next();
});

app.use(tracingMiddleware);
app.use(tenantGuard);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const auth = (req as any).user;
      const entry: Record<string, unknown> = {
        requestId: req.requestId,
        method: req.method,
        route: path,
        status: res.statusCode,
        ms: duration,
      };
      if (auth?.userId) entry.userId = auth.userId;
      if (auth?.role) entry.role = auth.role;
      if (auth?.companyId) entry.companyId = auth.companyId;

      console.log(JSON.stringify(entry));

      recordReqMetric(req.method, path, res.statusCode, duration);
    }
  });

  next();
});

(async () => {
  const { dbReady, getDbSource, db: bootDb } = await import("./db");
  await dbReady;

  try {
    const { sql: bootSql } = await import("drizzle-orm");
    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS ops_smoke_runs (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        environment TEXT NOT NULL DEFAULT 'development',
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'running',
        results_json JSONB,
        triggered_by INTEGER REFERENCES users(id)
      )
    `);
    await bootDb.execute(bootSql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await bootDb.execute(bootSql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS deleted_by INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS delete_reason TEXT`);
    await bootDb.execute(bootSql`ALTER TABLE clinics ADD COLUMN IF NOT EXISTS deleted_by INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE clinics ADD COLUMN IF NOT EXISTS delete_reason TEXT`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS deleted_by INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS delete_reason TEXT`);

    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS working_city_id INTEGER REFERENCES cities(id)`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS working_city_scope TEXT DEFAULT 'CITY'`);

    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS company_cities (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id),
        city_id INTEGER NOT NULL REFERENCES cities(id),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`
      CREATE UNIQUE INDEX IF NOT EXISTS company_cities_unique_idx ON company_cities(company_id, city_id)
    `);

    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS clinic_companies (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        clinic_id INTEGER NOT NULL REFERENCES clinics(id),
        company_id INTEGER NOT NULL REFERENCES companies(id),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`
      CREATE UNIQUE INDEX IF NOT EXISTS clinic_companies_unique_idx ON clinic_companies(clinic_id, company_id)
    `);

    try {
      await bootDb.execute(bootSql`
        CREATE UNIQUE INDEX IF NOT EXISTS cities_state_name_unique_idx ON cities(state, lower(name))
      `);
    } catch (idxErr: any) {
      if (!idxErr.message?.includes("already exists")) {
        console.warn("[BOOT] cities unique index skipped:", idxErr.message);
      }
    }

    console.log("[BOOT] Schema migrations applied successfully");
  } catch (migErr: any) {
    console.warn("[BOOT] Schema migration warning:", migErr.message);
  }

  const bootConfig = {
    event: "boot_config",
    nodeEnv: process.env.NODE_ENV || "undefined",
    appBaseUrl: process.env.PUBLIC_BASE_URL || "(not set)",
    dbSource: getDbSource(),
    sessionCookie: { secure: IS_PROD, sameSite: IS_PROD ? "none" : "lax", domain: ".unitedcaremobility.com (auto)", path: "/" },
  };
  console.log(JSON.stringify(bootConfig));

  app.get("/api/boot", (_req, res) => {
    res.json({
      nodeEnv: process.env.NODE_ENV || "undefined",
      appBaseUrl: process.env.PUBLIC_BASE_URL || "(not set)",
      dbSource: getDbSource(),
      allowedAppOrigins: Array.from(allowedAppOrigins).map(o => o.replace(/https?:\/\//, "***")),
      allowedPublicOrigins: Array.from(allowedPublicOrigins).map(o => o.replace(/https?:\/\//, "***")),
      cookieMode: { secure: IS_PROD, sameSite: IS_PROD ? "none" : "lax" },
      trustProxy: IS_PROD,
      timestamp: new Date().toISOString(),
    });
  });

  try {
    const { seedSuperAdmin, seedData, seedVehicleMakesModels } = await import("./seed");
    await seedSuperAdmin();
    await seedData();
    await seedVehicleMakesModels();
  } catch (err) {
    console.error("Seed error:", err);
  }

  await registerRoutes(httpServer, app);

  const { initWebSocket } = await import("./lib/realtime");
  initWebSocket(httpServer);

  const { registerDriverLocationRoutes } = await import("./lib/driverLocationIngest");
  registerDriverLocationRoutes(app);

  const { registerAdminMetricsRoutes } = await import("./lib/adminMetricsRoutes");
  registerAdminMetricsRoutes(app);

  const { startJobEngine } = await import("./lib/jobEngine");
  startJobEngine();

  const { validateTwilioAtBoot } = await import("./lib/sms/twilioClient");
  validateTwilioAtBoot();

  const { registerSmsAdminRoutes } = await import("./lib/sms/smsAdminRoutes");
  registerSmsAdminRoutes(app);

  const { startSmsReminderScheduler } = await import("./lib/smsReminderScheduler");
  startSmsReminderScheduler();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);

  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 15_000;
  httpServer.keepAliveTimeout = 65_000;

  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );

  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received — graceful shutdown starting`);

    const { stopJobEngine } = await import("./lib/jobEngine");
    stopJobEngine();

    httpServer.close(() => {
      log("HTTP server closed");
    });

    try {
      const { pool: dbPool } = await import("./db");
      await dbPool.end();
      log("DB pool closed");
    } catch {}

    setTimeout(() => {
      log("Forced exit after timeout");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
})();
