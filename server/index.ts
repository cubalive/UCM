import express, { type Request, Response, NextFunction } from "express";
import crypto from "crypto";
import path from "path";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { registerRoutes } from "./routes/index";
import { serveStatic } from "./static";
import { createServer } from "http";
import { recordRequest as recordReqMetric } from "./lib/requestMetrics";
import { tracingMiddleware } from "./lib/requestTracing";
import { tenantGuard } from "./lib/tenantGuard";
import { phiAuditMiddleware } from "./middleware/phiAudit";
import { inputSanitizer } from "./middleware/inputSanitizer";
import { apiRateLimiter } from "./middleware/rateLimiter";
import { structuredLoggerMiddleware } from "./middleware/structuredLogger";
import { subdomainRoleGuard } from "./middleware/subdomainRoleGuard";
import compression from "compression";
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    release: process.env.UCM_BUILD_VERSION || "dev",
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
  });
  console.log(JSON.stringify({ event: "sentry_initialized", environment: process.env.NODE_ENV || "development", ts: new Date().toISOString() }));
}

const app = express();
const httpServer = createServer(app);

// Healthcheck MUST be registered before any middleware to guarantee Railway/infra can reach it
app.get("/api/health/live", (_req, res) => {
  res.status(200).json({ status: "alive", uptime: Math.round(process.uptime()), pid: process.pid });
});

app.post("/api/metrics/web-vitals", express.json({ limit: "4kb" }), (req, res) => {
  const { name, value, rating, page } = req.body || {};
  if (name && value !== undefined) {
    console.log(`[WEB-VITAL] ${name}=${typeof value === 'number' ? value.toFixed(1) : value} rating=${rating || 'unknown'} page=${page || '/'}`);
  }
  res.status(204).end();
});

const IS_PROD = process.env.NODE_ENV === "production";
if (IS_PROD) {
  app.set("trust proxy", 1);
}

// Generate a unique nonce per request for strict CSP
app.use((_req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  next();
});

app.use((req, res, next) => {
  const nonce = res.locals.cspNonce;
  const cspDirectives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://js.stripe.com https://maps.googleapis.com`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.stripe.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://*.unitedcaremobility.com wss://*.unitedcaremobility.com wss: https://*.supabase.co https://api.stripe.com https://maps.googleapis.com https://*.upstash.io",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  res.setHeader("Content-Security-Policy", cspDirectives);
  next();
});

app.use(helmet({
  contentSecurityPolicy: false, // Handled by custom middleware above with per-request nonce
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
}));
app.use(cookieParser());
app.use(compression({ threshold: 1024 }));

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
    user?: import("./auth").AuthPayload;
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
  "https://clinic.unitedcaremobility.com",
  "https://driver.unitedcaremobility.com",
  "https://dispatch.unitedcaremobility.com",
  "https://admin.unitedcaremobility.com",
  "https://pharmacy.unitedcaremobility.com",
  "https://broker.unitedcaremobility.com",
]);

const envAppOrigins = readOriginList("ALLOWED_APP_ORIGIN");
const envPublicOrigins = readOriginList("ALLOWED_PUBLIC_ORIGIN");
const envLegacyOrigins = readOriginList("ALLOWED_ORIGIN");

const hasNewVars = envAppOrigins.size > 0 || envPublicOrigins.size > 0;
const legacyAsApp = hasNewVars ? [] : Array.from(envLegacyOrigins);

export const allowedAppOrigins = new Set(Array.from(BUILTIN_APP_ORIGINS).concat(Array.from(envAppOrigins), legacyAsApp));
export const allowedPublicOrigins = new Set(Array.from(envPublicOrigins));

function isAppOrigin(origin: string): boolean {
  if (!origin) return false;
  if (allowedAppOrigins.has(origin)) return true;
  return false;
}

function isPublicOrigin(origin: string): boolean {
  if (!origin) return false;
  if (allowedPublicOrigins.has(origin)) return true;
  return false;
}

app.use("/api/public", (req, res, next) => {
  const origin = req.headers.origin || "";
  res.setHeader("Vary", "Origin");

  if (isPublicOrigin(origin) || isAppOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-City-Id, X-UCM-Device, x-ucm-company-id, X-CSRF-Token");
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Stripe-Signature, X-City-Id, X-UCM-Device, x-ucm-company-id, X-CSRF-Token");
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

// Intercept res.json to sanitize 5xx error messages before they reach the client.
// This catches cases where controllers do res.status(500).json({ message: err.message })
// and ensures internal details (DB errors, stack traces) are never exposed.
app.use((_req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    if (res.statusCode >= 500 && body && typeof body === "object") {
      // Log the original error internally
      if (body.message || body.error) {
        console.error(JSON.stringify({
          event: "sanitized_error_response",
          originalMessage: body.message || body.error,
          path: _req.path,
          requestId: _req.requestId,
          ts: new Date().toISOString(),
        }));
      }
      // Replace with safe message
      body = {
        message: "An unexpected error occurred",
        requestId: _req.requestId,
      };
    }
    return originalJson(body);
  } as any;
  next();
});

// Prototype pollution protection — strip dangerous keys from all request bodies
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === "object") {
    const dangerousKeys = ["__proto__", "constructor", "prototype"];
    const sanitize = (obj: any): any => {
      if (typeof obj !== "object" || obj === null) return obj;
      for (const key of dangerousKeys) {
        if (key in obj) {
          delete obj[key];
        }
      }
      for (const value of Object.values(obj)) {
        if (typeof value === "object" && value !== null) {
          sanitize(value);
        }
      }
      return obj;
    };
    req.body = sanitize(req.body);
  }
  next();
});

app.use(tracingMiddleware);
app.use(inputSanitizer);

// CSRF protection for all state-changing requests using cookie-based auth
import { csrfProtection } from "./auth";
app.use("/api", csrfProtection);

app.use("/api", apiRateLimiter);
app.use(tenantGuard);
app.use(subdomainRoleGuard);
app.use(phiAuditMiddleware);

// Structured request logger — logs every API request in structured JSON with PII masking.
// Placed after auth/tenant middleware so user info is available.
app.use(structuredLoggerMiddleware);

// Attach Sentry user context for error tracking
app.use((req: Request, _res: Response, next: NextFunction) => {
  const user = (req as any).user;
  if (user && process.env.SENTRY_DSN) {
    Sentry.setUser({ id: String(user.userId), role: user.role, companyId: user.companyId });
  }
  next();
});

// Sentry error handler — must be after all controllers but before custom error handlers
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      recordReqMetric(req.method, path, res.statusCode, duration);
    }
  });

  next();
});

// Track boot readiness so pre-boot handler can serve appropriate responses
let bootReady = false;

// Pre-boot handler: serve a loading page for non-API requests while boot is in progress.
// This prevents the browser from getting no response (or unexpected JSON) during the
// long migration/seed sequence. Once boot finishes, serveStatic takes over.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (bootReady) return next();
  // Let API and health routes through to their handlers
  if (req.path.startsWith("/api")) return next();
  // During boot, serve a minimal loading page for browser requests
  const acceptsHtml = (req.headers.accept || "").includes("text/html");
  if (acceptsHtml) {
    const nonce = res.locals.cspNonce || "";
    res.status(503).set("Retry-After", "5").set("Cache-Control", "no-store").send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UCM - Starting</title>
<style nonce="${nonce}">body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;
font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0}
.c{text-align:center}.spinner{width:40px;height:40px;border:4px solid #334155;
border-top-color:#3b82f6;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}</style>
<script nonce="${nonce}">setTimeout(()=>location.reload(),5000)</script>
</head><body><div class="c"><div class="spinner"></div><p>Starting UCM Platform...</p></div></body></html>`);
    return;
  }
  next();
});

(async () => {
  // Start listening EARLY so Railway/infra healthcheck (/api/health/live) can respond
  // while the rest of boot (migrations, route registration, etc.) completes.
  // Skip for worker mode — workers create their own minimal healthcheck server later.
  const port = parseInt(process.env.PORT || "5000", 10);
  const earlyRunMode = (process.env.RUN_MODE || process.env.ROLE_MODE || "all").toLowerCase().trim();
  if (earlyRunMode !== "worker") {
    httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
      console.log(JSON.stringify({ event: "http_listening", port, ts: new Date().toISOString() }));
    });
  }

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
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_distance_meters INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_duration_seconds INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_fingerprint TEXT`);

    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS working_city_id INTEGER REFERENCES cities(id)`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS working_city_scope TEXT DEFAULT 'CITY'`);

    await bootDb.execute(bootSql`ALTER TABLE clinics ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
    await bootDb.execute(bootSql`ALTER TABLE clinics ADD COLUMN IF NOT EXISTS stripe_default_payment_method_id TEXT`);

    await bootDb.execute(bootSql`
      DO $$ BEGIN
        CREATE TYPE billing_adjustment_kind AS ENUM ('credit', 'debit', 'refund', 'fee_override');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS billing_adjustments (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES billing_cycle_invoices(id) ON DELETE CASCADE,
        kind billing_adjustment_kind NOT NULL,
        reason TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        created_by INTEGER REFERENCES users(id),
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS ba_invoice_idx ON billing_adjustments(invoice_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS ba_created_idx ON billing_adjustments(created_at)`);

    await bootDb.execute(bootSql`
      DO $$ BEGIN
        CREATE TYPE ledger_direction AS ENUM ('debit', 'credit');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        journal_id TEXT NOT NULL,
        ref_type TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        clinic_id INTEGER REFERENCES clinics(id),
        company_id INTEGER REFERENCES companies(id),
        account TEXT NOT NULL,
        direction ledger_direction NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS le_journal_idx ON ledger_entries(journal_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS le_ref_idx ON ledger_entries(ref_type, ref_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS le_clinic_idx ON ledger_entries(clinic_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS le_company_idx ON ledger_entries(company_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS le_account_idx ON ledger_entries(account)`);

    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS payout_reconciliation (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id),
        stripe_account_id TEXT NOT NULL,
        stripe_balance_transaction_id TEXT NOT NULL UNIQUE,
        stripe_transfer_id TEXT,
        stripe_payout_id TEXT,
        stripe_charge_id TEXT,
        amount_cents INTEGER NOT NULL,
        fee_cents INTEGER NOT NULL DEFAULT 0,
        net_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        type TEXT,
        status TEXT,
        available_on TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS pr_company_idx ON payout_reconciliation(company_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS pr_payout_idx ON payout_reconciliation(stripe_payout_id)`);

    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS billing_audit_events (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        actor_user_id INTEGER REFERENCES users(id),
        actor_role TEXT,
        scope_clinic_id INTEGER REFERENCES clinics(id),
        scope_company_id INTEGER REFERENCES companies(id),
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        details JSONB,
        ip TEXT,
        user_agent TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS bae_entity_idx ON billing_audit_events(entity_type, entity_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS bae_action_idx ON billing_audit_events(action)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS bae_created_idx ON billing_audit_events(created_at)`);

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

    await bootDb.execute(bootSql`
      DO $$ BEGIN
        CREATE TYPE fee_rule_scope_type AS ENUM ('global', 'company', 'clinic', 'company_clinic');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await bootDb.execute(bootSql`
      DO $$ BEGIN
        CREATE TYPE fee_rule_fee_type AS ENUM ('percent', 'fixed', 'percent_plus_fixed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS fee_rules (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        scope_type fee_rule_scope_type NOT NULL,
        company_id INTEGER REFERENCES companies(id),
        clinic_id INTEGER REFERENCES clinics(id),
        service_level TEXT,
        fee_type fee_rule_fee_type NOT NULL,
        percent_bps INTEGER NOT NULL DEFAULT 0,
        fixed_fee_cents INTEGER NOT NULL DEFAULT 0,
        min_fee_cents INTEGER,
        max_fee_cents INTEGER,
        is_enabled BOOLEAN NOT NULL DEFAULT true,
        priority INTEGER NOT NULL DEFAULT 100,
        effective_from TIMESTAMP,
        effective_to TIMESTAMP,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS fr_scope_idx ON fee_rules(scope_type)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS fr_company_idx ON fee_rules(company_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS fr_clinic_idx ON fee_rules(clinic_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS fr_enabled_idx ON fee_rules(is_enabled)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS fr_priority_idx ON fee_rules(priority)`);

    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS fee_rule_audit (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        rule_id INTEGER REFERENCES fee_rules(id),
        actor_user_id INTEGER REFERENCES users(id),
        actor_role TEXT,
        action TEXT NOT NULL,
        before JSONB,
        after JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS fra_rule_idx ON fee_rule_audit(rule_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS fra_created_idx ON fee_rule_audit(created_at)`);

    await bootDb.execute(bootSql`
      DO $$ BEGIN
        CREATE TYPE staff_pay_type AS ENUM ('HOURLY', 'FIXED', 'PER_TRIP');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS staff_pay_configs (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id),
        driver_id INTEGER REFERENCES drivers(id),
        pay_type staff_pay_type NOT NULL DEFAULT 'HOURLY',
        hourly_rate_cents INTEGER,
        fixed_salary_cents INTEGER,
        fixed_period TEXT DEFAULT 'MONTHLY',
        per_trip_flat_cents INTEGER,
        per_trip_percent_bps INTEGER,
        notes TEXT DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE UNIQUE INDEX IF NOT EXISTS spc_company_driver_idx ON staff_pay_configs(company_id, driver_id)`);

    await bootDb.execute(bootSql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_assign_v2_enabled BOOLEAN NOT NULL DEFAULT false`);
    await bootDb.execute(bootSql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_assign_offer_timeout_seconds INTEGER NOT NULL DEFAULT 120`);
    await bootDb.execute(bootSql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_assign_max_rounds INTEGER NOT NULL DEFAULT 6`);
    await bootDb.execute(bootSql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_assign_max_distance_meters INTEGER NOT NULL DEFAULT 20000`);
    await bootDb.execute(bootSql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_assign_weight_distance INTEGER NOT NULL DEFAULT 45`);
    await bootDb.execute(bootSql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_assign_weight_reliability INTEGER NOT NULL DEFAULT 25`);
    await bootDb.execute(bootSql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_assign_weight_load INTEGER NOT NULL DEFAULT 20`);
    await bootDb.execute(bootSql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_assign_weight_fatigue INTEGER NOT NULL DEFAULT 10`);
    await bootDb.execute(bootSql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS zero_touch_dialysis_enabled BOOLEAN NOT NULL DEFAULT false`);

    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS auto_assign_status TEXT NOT NULL DEFAULT 'IDLE'`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS auto_assign_last_run_at TIMESTAMPTZ`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS auto_assign_failure_reason TEXT`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS auto_assign_selected_driver_id INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS auto_assign_run_id INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS original_eta_seconds INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS eta_last_checked_at TIMESTAMPTZ`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS eta_variance_seconds INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS eta_escalation_level TEXT NOT NULL DEFAULT 'NONE'`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS eta_escalation_last_at TIMESTAMPTZ`);

    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS auto_assign_runs (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        trip_id INTEGER NOT NULL REFERENCES trips(id),
        company_id INTEGER NOT NULL REFERENCES companies(id),
        city_id INTEGER NOT NULL REFERENCES cities(id),
        round INTEGER NOT NULL DEFAULT 1,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        result TEXT NOT NULL DEFAULT 'RUNNING',
        selected_driver_id INTEGER,
        reason TEXT,
        config_snapshot JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS aar_trip_idx ON auto_assign_runs(trip_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS aar_company_idx ON auto_assign_runs(company_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS aar_result_idx ON auto_assign_runs(result)`);

    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS auto_assign_run_candidates (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES auto_assign_runs(id),
        driver_id INTEGER NOT NULL REFERENCES drivers(id),
        distance_meters INTEGER,
        distance_score DOUBLE PRECISION NOT NULL DEFAULT 0,
        reliability_score DOUBLE PRECISION NOT NULL DEFAULT 0,
        load_score DOUBLE PRECISION NOT NULL DEFAULT 0,
        fatigue_score DOUBLE PRECISION NOT NULL DEFAULT 0,
        final_score DOUBLE PRECISION NOT NULL DEFAULT 0,
        rank INTEGER NOT NULL DEFAULT 0,
        eligible BOOLEAN NOT NULL DEFAULT true,
        ineligible_reason TEXT,
        offered_at TIMESTAMPTZ,
        response TEXT,
        responded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS aarc_run_idx ON auto_assign_run_candidates(run_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS aarc_driver_idx ON auto_assign_run_candidates(driver_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS aarc_rank_idx ON auto_assign_run_candidates(rank)`);

    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS automation_events (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        event_type TEXT NOT NULL,
        trip_id INTEGER REFERENCES trips(id),
        driver_id INTEGER REFERENCES drivers(id),
        clinic_id INTEGER REFERENCES clinics(id),
        company_id INTEGER REFERENCES companies(id),
        run_id INTEGER REFERENCES auto_assign_runs(id),
        payload JSONB,
        actor_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS ae_event_type_idx ON automation_events(event_type)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS ae_trip_idx ON automation_events(trip_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS ae_company_idx ON automation_events(company_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS ae_created_idx ON automation_events(created_at)`);

    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS trips_driver_status_idx ON trips(driver_id, status) WHERE driver_id IS NOT NULL AND status IN ('ASSIGNED','EN_ROUTE_TO_PICKUP','ARRIVED_PICKUP','PICKED_UP','EN_ROUTE_TO_DROPOFF','IN_PROGRESS','ARRIVED_DROPOFF')`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS trips_company_status_idx ON trips(company_id, status)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS trips_clinic_status_idx ON trips(clinic_id, status) WHERE clinic_id IS NOT NULL`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS trips_city_status_idx ON trips(city_id, status)`);

    // ── Scalability indexes (P0) ──
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_trips_company_status_created ON trips(company_id, status, created_at)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_trips_city_status_date ON trips(city_id, status, scheduled_date)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_trips_driver_status ON trips(driver_id, status, created_at)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_trips_patient_created ON trips(patient_id, created_at)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_trips_scheduled_date ON trips(scheduled_date, status)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_drivers_company_status ON drivers(company_id, status)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_drivers_city_status ON drivers(city_id, status)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_drivers_company_dispatch ON drivers(company_id, dispatch_status)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_vehicles_company_status ON vehicles(company_id, status)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_vehicles_city_status ON vehicles(city_id, status)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_patients_company ON patients(company_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_patients_clinic ON patients(clinic_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_patients_city ON patients(city_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_clinics_company ON clinics(company_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_clinics_city ON clinics(city_id)`);

    try {
      await bootDb.execute(bootSql`
        CREATE UNIQUE INDEX IF NOT EXISTS cities_state_name_unique_idx ON cities(state, lower(name))
      `);
    } catch (idxErr: any) {
      if (!idxErr.message?.includes("already exists")) {
        console.warn("[BOOT] cities unique index skipped:", idxErr.message);
      }
    }

    await bootDb.execute(bootSql`
      DO $$ BEGIN
        CREATE TYPE on_time_bonus_mode AS ENUM ('PER_TRIP','WEEKLY');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await bootDb.execute(bootSql`
      DO $$ BEGIN
        CREATE TYPE earnings_adjustment_type AS ENUM ('DAILY_MIN_TOPUP','ON_TIME_BONUS','NO_SHOW_PENALTY','MANUAL_ADJUSTMENT');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await bootDb.execute(bootSql`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'CLINIC_ADMIN'`);
    await bootDb.execute(bootSql`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'CLINIC_VIEWER'`);

    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS driver_pay_rules (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        company_id INTEGER NOT NULL UNIQUE REFERENCES companies(id),
        daily_min_enabled BOOLEAN NOT NULL DEFAULT false,
        daily_min_cents INTEGER,
        daily_min_applies_days TEXT[],
        on_time_bonus_enabled BOOLEAN NOT NULL DEFAULT false,
        on_time_bonus_mode on_time_bonus_mode,
        on_time_bonus_cents INTEGER,
        on_time_threshold_minutes INTEGER DEFAULT 5,
        on_time_requires_confirmed_pickup BOOLEAN NOT NULL DEFAULT true,
        no_show_penalty_enabled BOOLEAN NOT NULL DEFAULT false,
        no_show_penalty_cents INTEGER,
        no_show_penalty_reason_codes TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS driver_earnings_adjustments (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id),
        driver_id INTEGER NOT NULL REFERENCES drivers(id),
        related_trip_id INTEGER REFERENCES trips(id),
        period_date TEXT,
        week_start TEXT,
        type earnings_adjustment_type NOT NULL,
        amount_cents INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS dea_company_driver_created_idx ON driver_earnings_adjustments(company_id, driver_id, created_at)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS dea_company_driver_week_idx ON driver_earnings_adjustments(company_id, driver_id, week_start)`);

    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_provider TEXT DEFAULT 'google'`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_status TEXT DEFAULT 'missing'`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_version INTEGER DEFAULT 1`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_updated_at TIMESTAMPTZ`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS actual_distance_meters INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS actual_distance_source TEXT DEFAULT 'estimated'`);
    await bootDb.execute(bootSql`ALTER TABLE trip_events ADD COLUMN IF NOT EXISTS payload JSONB`);

    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS trip_routes (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        trip_id INTEGER NOT NULL REFERENCES trips(id),
        version INTEGER NOT NULL DEFAULT 1,
        polyline TEXT NOT NULL,
        distance_meters INTEGER,
        duration_seconds INTEGER,
        provider TEXT DEFAULT 'google',
        reason TEXT,
        fingerprint TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by INTEGER REFERENCES users(id)
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS trip_routes_trip_id_idx ON trip_routes(trip_id, version)`);

    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS actual_duration_seconds INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS waiting_seconds INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_source TEXT`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_quality_score INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS actual_polyline TEXT`);

    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS trip_location_points (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        trip_id INTEGER NOT NULL REFERENCES trips(id),
        driver_id INTEGER NOT NULL,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        accuracy_m DOUBLE PRECISION,
        speed_mps DOUBLE PRECISION,
        heading_deg DOUBLE PRECISION,
        source TEXT NOT NULL DEFAULT 'gps',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_trip_location_points_trip_ts ON trip_location_points(trip_id, ts)`);

    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS dispatch_at TIMESTAMPTZ`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS notify_at TIMESTAMPTZ`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS dispatch_stage TEXT NOT NULL DEFAULT 'NONE'`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS planned_dropoff_arrival_at TIMESTAMPTZ`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS eta_pickup_to_dropoff_min INTEGER`);

    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS is_round_trip BOOLEAN NOT NULL DEFAULT false`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS return_required BOOLEAN NOT NULL DEFAULT true`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS return_note TEXT`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS paired_trip_id INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS preferred_driver_id INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS auto_assign_reason TEXT`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS eta_driver_to_pickup_min INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS service_buffer_min INTEGER NOT NULL DEFAULT 10`);

    await bootDb.execute(bootSql`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'OFFLINE'`);
    await bootDb.execute(bootSql`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS tracking_status TEXT NOT NULL DEFAULT 'UNKNOWN'`);

    await bootDb.execute(bootSql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_frequent BOOLEAN NOT NULL DEFAULT false`);
    await bootDb.execute(bootSql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS preferred_driver_id INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS default_pickup_place_id TEXT`);
    await bootDb.execute(bootSql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS default_dropoff_place_id TEXT`);

    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS trip_route_events (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        trip_id INTEGER NOT NULL REFERENCES trips(id),
        event_type TEXT NOT NULL,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        meta_json JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_trip_route_events_trip ON trip_route_events(trip_id, ts)`);

    // Service type enum + column for trips (NEMT service types)
    await bootDb.execute(bootSql`
      DO $$ BEGIN
        CREATE TYPE service_type AS ENUM ('transport','delivery');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    // Add new NEMT service types to existing enum
    await bootDb.execute(bootSql`
      DO $$ BEGIN
        ALTER TYPE service_type ADD VALUE IF NOT EXISTS 'ambulatory';
        ALTER TYPE service_type ADD VALUE IF NOT EXISTS 'wheelchair';
        ALTER TYPE service_type ADD VALUE IF NOT EXISTS 'stretcher';
        ALTER TYPE service_type ADD VALUE IF NOT EXISTS 'bariatric';
        ALTER TYPE service_type ADD VALUE IF NOT EXISTS 'gurney';
        ALTER TYPE service_type ADD VALUE IF NOT EXISTS 'long_distance';
        ALTER TYPE service_type ADD VALUE IF NOT EXISTS 'multi_load';
      END $$
    `);
    await bootDb.execute(bootSql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS service_type service_type NOT NULL DEFAULT 'transport'`);

    // Pharmacy & Broker module — users FK columns
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pharmacy_id INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS broker_id INTEGER`);

    // Audit log indexes for HIPAA compliance queries
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS audit_log_user_created_idx ON audit_log(user_id, created_at)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS audit_log_action_created_idx ON audit_log(action, created_at)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log(entity, entity_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS audit_log_company_created_idx ON audit_log(company_id, created_at)`);

    // Add idempotency_key column to jobs table with unique index for TOCTOU protection
    await bootDb.execute(bootSql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
    await bootDb.execute(bootSql`CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency_key_unique_idx ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL`);

    // FIX 10: Email case normalization — lowercase all existing emails and create unique lower index
    await bootDb.execute(bootSql`UPDATE users SET email = LOWER(email) WHERE email != LOWER(email)`);
    await bootDb.execute(bootSql`CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email))`);

    // Missing users columns that the schema expects
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
    // public_id: generate unique IDs for existing rows that lack one
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS public_id VARCHAR(20)`);
    await bootDb.execute(bootSql`
      UPDATE users SET public_id = 'UCM-' || LPAD(id::TEXT, 6, '0')
      WHERE public_id IS NULL
    `);
    await bootDb.execute(bootSql`
      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN public_id SET NOT NULL;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$
    `);
    await bootDb.execute(bootSql`CREATE UNIQUE INDEX IF NOT EXISTS users_public_id_unique_idx ON users(public_id)`);

    // MFA columns on users table
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_method TEXT`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_phone TEXT`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMP`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_failed_attempts INTEGER NOT NULL DEFAULT 0`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_locked_until TIMESTAMP`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by INTEGER`);
    await bootDb.execute(bootSql`ALTER TABLE users ADD COLUMN IF NOT EXISTS delete_reason TEXT`);

    // MFA backup codes table
    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS mfa_backup_codes (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // MFA audit log table
    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS mfa_audit_log (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        event_type TEXT NOT NULL,
        method TEXT,
        ip_address TEXT,
        user_agent TEXT,
        portal TEXT,
        metadata TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Refresh tokens table (H-1: single-use rotation)
    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        family TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        revoked_at TIMESTAMP,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash)`);
    await bootDb.execute(bootSql`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family)`);

    // Feature flags table
    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id),
        flag_key TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT false,
        updated_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await bootDb.execute(bootSql`CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_company_key_idx ON feature_flags(company_id, flag_key)`);

    // Driver devices table (device binding)
    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS driver_devices (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        driver_id INTEGER NOT NULL REFERENCES drivers(id),
        company_id INTEGER REFERENCES companies(id),
        device_fingerprint_hash TEXT NOT NULL,
        device_label TEXT,
        last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Session revocations table
    await bootDb.execute(bootSql`
      CREATE TABLE IF NOT EXISTS session_revocations (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        company_id INTEGER REFERENCES companies(id),
        revoked_after TIMESTAMP NOT NULL,
        reason TEXT,
        created_by_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    console.log("[BOOT] Schema migrations applied successfully");
  } catch (migErr: any) {
    console.warn("[BOOT] Schema migration warning:", migErr.message);
  }

  const { getRoleMode, shouldRunServer, shouldRunSchedulers, initSchedulers, stopSchedulers } = await import("./lib/schedulerInit");
  const roleMode = getRoleMode();
  const runModeRaw = process.env.RUN_MODE || process.env.ROLE_MODE || "all";

  console.log(JSON.stringify({
    event: "boot_mode_resolved",
    RUN_MODE: runModeRaw,
    resolvedRole: roleMode,
    willStartHttp: shouldRunServer(),
    willStartSchedulers: shouldRunSchedulers(),
    pid: process.pid,
    ts: new Date().toISOString(),
  }));

  if (roleMode === "worker") {
    console.log(JSON.stringify({
      event: "worker_boot_start",
      msg: "Worker-only mode: starting schedulers/orchestrator/route-worker. No HTTP server.",
      ts: new Date().toISOString(),
    }));

    // Start healthcheck HTTP server FIRST so Railway healthcheck passes while schedulers init
    const workerPort = Number(process.env.PORT) || 5000;
    const workerHttp = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "worker-alive", uptime: Math.round(process.uptime()), pid: process.pid }));
    });
    workerHttp.listen(workerPort, "0.0.0.0", () => {
      console.log(JSON.stringify({ event: "worker_healthcheck_server", port: workerPort, ts: new Date().toISOString() }));
    });

    await initSchedulers();

    const { startMemoryLogger } = await import("./lib/schedulerHarness");
    startMemoryLogger(5 * 60 * 1000);

    const { getSchedulerStates } = await import("./lib/schedulerHarness");
    const activeSchedulers = Object.keys(getSchedulerStates());

    console.log(JSON.stringify({
      event: "boot_complete",
      roleMode: "worker",
      db: "connected",
      dbSource: getDbSource(),
      redis: process.env.UPSTASH_REDIS_REST_URL ? "configured" : "not_configured",
      schedulers: activeSchedulers,
      schedulerCount: activeSchedulers.length,
      httpServer: "disabled",
      websocket: "disabled",
      nodeEnv: process.env.NODE_ENV || "development",
      pid: process.pid,
      uptime: process.uptime(),
      ts: new Date().toISOString(),
    }));

    const WORKER_HEARTBEAT_MS = 60_000;
    setInterval(() => {
      console.log(JSON.stringify({
        event: "worker_heartbeat",
        roleMode: "worker",
        uptimeSeconds: Math.round(process.uptime()),
        memMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        ts: new Date().toISOString(),
      }));
    }, WORKER_HEARTBEAT_MS).unref();

    let shuttingDown = false;
    async function gracefulShutdownWorker(signal: string) {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(JSON.stringify({ event: "shutdown_start", signal, roleMode: "worker", ts: new Date().toISOString() }));
      workerHttp.close();
      await stopSchedulers();
      try {
        const { pool: dbPool } = await import("./db");
        await dbPool.end();
        console.log(JSON.stringify({ event: "db_pool_closed", ts: new Date().toISOString() }));
      } catch {}
      setTimeout(() => {
        console.log(JSON.stringify({ event: "forced_exit", ts: new Date().toISOString() }));
        process.exit(1);
      }, 10_000).unref();
    }

    process.on("SIGTERM", () => gracefulShutdownWorker("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdownWorker("SIGINT"));
    process.on("unhandledRejection", (reason: any) => {
      console.error(JSON.stringify({ event: "unhandled_rejection", error: reason?.message || String(reason), stack: reason?.stack?.slice(0, 1000), ts: new Date().toISOString() }));
    });
    process.on("uncaughtException", (err: Error) => {
      console.error(JSON.stringify({ event: "uncaught_exception", error: err.message, stack: err.stack?.slice(0, 1000), ts: new Date().toISOString() }));
      gracefulShutdownWorker("uncaughtException");
    });

    return;
  }

  const jwtSecretSource = process.env.JWT_SECRET ? "env" : "fallback";
  const jwtSecretMasked = process.env.JWT_SECRET
    ? `${process.env.JWT_SECRET.slice(0, 4)}***${process.env.JWT_SECRET.slice(-4)}`
    : "(dev-fallback)";
  console.log(`[AUTH] JWT_SECRET loaded — source: ${jwtSecretSource}, fingerprint: ${jwtSecretMasked}`);
  console.log(`[AUTH] SESSION_SECRET loaded — present: ${!!process.env.SESSION_SECRET}`);

  const bootConfig = {
    event: "boot_config",
    nodeEnv: process.env.NODE_ENV || "undefined",
    appBaseUrl: process.env.PUBLIC_BASE_URL || "(not set)",
    dbSource: getDbSource(),
    jwtSecret: jwtSecretSource,
    sessionSecret: !!process.env.SESSION_SECRET,
    sessionCookie: { secure: IS_PROD, sameSite: IS_PROD ? "none" : "lax", domain: ".unitedcaremobility.com (auto)", path: "/" },
  };
  console.log(JSON.stringify(bootConfig));

  const { APP_VERSION } = await import("./controllers/health.controller");
  console.log(`[BOOT] UCM version: ${APP_VERSION}, env: ${process.env.NODE_ENV || "development"}`);

  app.get("/api/boot", (_req: any, res) => {
    if (!_req.user || _req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Forbidden: SUPER_ADMIN role required" });
    }
    res.json({
      nodeEnv: process.env.NODE_ENV || "undefined",
      appBaseUrl: process.env.PUBLIC_BASE_URL || "(not set)",
      dbSource: getDbSource(),
      roleMode,
      allowedAppOrigins: Array.from(allowedAppOrigins).map(o => o.replace(/https?:\/\//, "***")),
      allowedPublicOrigins: Array.from(allowedPublicOrigins).map(o => o.replace(/https?:\/\//, "***")),
      cookieMode: { secure: IS_PROD, sameSite: IS_PROD ? "none" : "lax" },
      trustProxy: IS_PROD,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/system/origins", (_req: any, res) => {
    if (!_req.user || _req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Forbidden: SUPER_ADMIN role required" });
    }
    const origin = _req.headers.origin || "(none)";
    const host = _req.hostname || "(none)";
    res.json({
      requestOrigin: origin,
      requestHost: host,
      isAppOrigin: isAppOrigin(origin),
      isPublicOrigin: isPublicOrigin(origin),
      isReplitDev: /\.replit\.dev$/.test(origin),
      allowedAppDomains: Array.from(allowedAppOrigins).map(o => new URL(o).hostname),
      allowedPublicDomains: Array.from(allowedPublicOrigins).map(o => { try { return new URL(o).hostname; } catch { return o; } }),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/system/auth-health", (req: any, res) => {
    if (!req.user || req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Forbidden: SUPER_ADMIN role required" });
    }
    const origin = req.headers.origin || "(none)";
    const hasSession = !!(req as any).session?.userId;
    const hasBearer = !!req.headers.authorization?.startsWith("Bearer ");
    const cookieNames = Object.keys(req.cookies || {});
    res.json({
      origin,
      host: req.hostname,
      hasSession,
      hasBearer,
      cookies: cookieNames,
      jwtConfigured: !!process.env.JWT_SECRET,
      sessionConfigured: !!process.env.SESSION_SECRET,
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

  // Initialize domain events table and start periodic DB flush
  try {
    const { ensureDomainEventsTable, startFlushTimer } = await import("./lib/domainEvents");
    await ensureDomainEventsTable();
    startFlushTimer();
  } catch (err: any) {
    console.warn(JSON.stringify({
      event: "domain_events_init_error",
      error: err.message?.slice(0, 300),
      ts: new Date().toISOString(),
    }));
  }

  await registerRoutes(httpServer, app);

  const { initWebSocket } = await import("./lib/realtime");
  initWebSocket(httpServer);

  const { registerDriverLocationRoutes } = await import("./lib/driverLocationIngest");
  registerDriverLocationRoutes(app);

  const { registerAdminMetricsRoutes } = await import("./lib/adminMetricsRoutes");
  registerAdminMetricsRoutes(app);

  if (shouldRunSchedulers()) {
    await initSchedulers();
  } else {
    console.log(JSON.stringify({
      event: "schedulers_skipped",
      reason: `RUN_MODE=${runModeRaw} resolved to '${roleMode}' — schedulers disabled for api-only process`,
      ts: new Date().toISOString(),
    }));
  }

  const { registerIntegrityRoutes } = await import("./lib/integrityReport");
  registerIntegrityRoutes(app);

  const searchRouter = (await import("./controllers/search.controller")).default;
  app.use(searchRouter);

  const { validateTwilioAtBoot } = await import("./lib/sms/twilioClient");
  validateTwilioAtBoot();

  const { registerSmsAdminRoutes } = await import("./lib/sms/smsAdminRoutes");
  registerSmsAdminRoutes(app);


  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    // Structured error logging for monitoring/alerting — full details, internal only
    const errorEntry: Record<string, unknown> = {
      event: "unhandled_error",
      severity: status >= 500 ? "ERROR" : "WARN",
      status,
      method: req.method,
      path: req.path,
      requestId: req.requestId,
      error: err.message,
      stack: status >= 500 ? err.stack?.slice(0, 2000) : undefined,
      userId: (req as any).user?.userId,
      companyId: (req as any).user?.companyId,
      dbCode: err.code,
      ts: new Date().toISOString(),
    };
    if (status >= 500) {
      console.error(JSON.stringify(errorEntry));
    } else {
      console.warn(JSON.stringify(errorEntry));
    }

    if (res.headersSent) {
      return next(err);
    }

    // NEVER leak internal error details, DB schema, or stack traces to client.
    // Map known DB error codes to safe messages.
    let safeMessage: string;
    if (err.code === "23505") {
      // PostgreSQL unique violation — safe to tell client
      safeMessage = "This record already exists";
      return res.status(409).json({ error: safeMessage, requestId: req.requestId });
    } else if (err.name === "ValidationError" || err.name === "ZodError") {
      // Validation errors are safe to expose
      safeMessage = err.message;
      return res.status(400).json({ error: safeMessage, requestId: req.requestId });
    } else if (status >= 500) {
      safeMessage = "An unexpected error occurred";
    } else if (status === 400) {
      safeMessage = "Bad request";
    } else if (status === 401) {
      safeMessage = "Unauthorized";
    } else if (status === 403) {
      safeMessage = "Forbidden";
    } else if (status === 404) {
      safeMessage = "Not found";
    } else {
      safeMessage = "An unexpected error occurred";
    }

    return res.status(status).json({
      message: safeMessage,
      code: err.code || (status >= 500 ? "INTERNAL_ERROR" : undefined),
      requestId: req.requestId,
    });
  });

  // Mark boot complete — the pre-boot loading handler will now pass through
  bootReady = true;

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 15_000;
  httpServer.keepAliveTimeout = 65_000;

  const { startMemoryLogger } = await import("./lib/schedulerHarness");
  startMemoryLogger(5 * 60 * 1000);

  const { getSchedulerStates } = await import("./lib/schedulerHarness");
  const activeSchedulers = shouldRunSchedulers()
    ? Object.keys(getSchedulerStates())
    : [];

  console.log(JSON.stringify({
    event: "boot_complete",
    roleMode,
    db: "connected",
    dbSource: getDbSource(),
    redis: process.env.UPSTASH_REDIS_REST_URL ? "configured" : "not_configured",
    schedulers: activeSchedulers,
    schedulerCount: activeSchedulers.length,
    httpServer: "active",
    httpPort: port,
    websocket: "active",
    memoryLogger: "active",
    nodeEnv: process.env.NODE_ENV || "development",
    pid: process.pid,
    uptime: process.uptime(),
    ts: new Date().toISOString(),
  }));

  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ event: "shutdown_start", signal, ts: new Date().toISOString() }));

    await stopSchedulers();

    try {
      const { getWss } = await import("./lib/realtime");
      const wss = getWss();
      if (wss) {
        for (const client of wss.clients) {
          client.close(1001, "Server shutting down");
        }
        wss.close();
        console.log(JSON.stringify({ event: "websocket_closed", ts: new Date().toISOString() }));
      }
    } catch {}

    // Flush pending domain events before closing DB
    try {
      const { stopFlushTimer } = await import("./lib/domainEvents");
      await stopFlushTimer();
      console.log(JSON.stringify({ event: "domain_events_flushed", ts: new Date().toISOString() }));
    } catch {}

    httpServer.close(() => {
      console.log(JSON.stringify({ event: "http_server_closed", ts: new Date().toISOString() }));
    });

    try {
      const { pool: dbPool } = await import("./db");
      await dbPool.end();
      console.log(JSON.stringify({ event: "db_pool_closed", ts: new Date().toISOString() }));
    } catch {}

    setTimeout(() => {
      console.log(JSON.stringify({ event: "forced_exit", ts: new Date().toISOString() }));
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  process.on("unhandledRejection", (reason: any) => {
    console.error(JSON.stringify({
      event: "unhandled_rejection",
      error: reason?.message || String(reason),
      stack: reason?.stack?.slice(0, 1000),
      ts: new Date().toISOString(),
    }));
  });

  process.on("uncaughtException", (err: Error) => {
    console.error(JSON.stringify({
      event: "uncaught_exception",
      error: err.message,
      stack: err.stack?.slice(0, 1000),
      ts: new Date().toISOString(),
    }));
    gracefulShutdown("uncaughtException");
  });
})();
