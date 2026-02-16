import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { recordRequest as recordReqMetric } from "./lib/requestMetrics";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
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

const CORS_EXACT_ORIGINS = new Set([
  "https://unitedcaremobility.com",
  "https://www.unitedcaremobility.com",
  "https://app.unitedcaremobility.com",
  "https://driver.unitedcaremobility.com",
  "https://admin.unitedcaremobility.com",
  "https://lovable.app",
]);

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (CORS_EXACT_ORIGINS.has(origin)) return true;
  if (/^https:\/\/[a-z0-9\-]+\.lovable\.app$/i.test(origin)) return true;
  if (/^https:\/\/[a-z0-9\-]+\.replit\.dev$/i.test(origin)) return true;
  if (/^https:\/\/[a-z0-9\-]+\.picard\.replit\.dev$/i.test(origin)) return true;
  return false;
}

app.use("/api", (req, res, next) => {
  const origin = req.headers.origin || "";
  res.setHeader("Vary", "Origin");

  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Stripe-Signature");
    res.setHeader("Access-Control-Allow-Credentials", "false");
    res.setHeader("Access-Control-Max-Age", "86400");
  } else if (origin) {
    console.warn(`[CORS] Blocked origin="${origin}" path="${req.path}" method="${req.method}"`);
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
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

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);

      recordReqMetric(req.method, path, res.statusCode, duration);
    }
  });

  next();
});

(async () => {
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

  const { startEtaEngine } = await import("./lib/etaEngine");
  startEtaEngine();

  const { startVehicleAutoAssignScheduler } = await import("./lib/vehicleAutoAssign");
  startVehicleAutoAssignScheduler();

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
})();
