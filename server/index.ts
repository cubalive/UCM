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
  "https://clinic.unitedcaremobility.com",
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

    console.log("[BOOT] Schema migrations applied successfully");
  } catch (migErr: any) {
    console.warn("[BOOT] Schema migration warning:", migErr.message);
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

  const { initSchedulers } = await import("./lib/schedulerInit");
  await initSchedulers();

  const { registerIntegrityRoutes } = await import("./lib/integrityReport");
  registerIntegrityRoutes(app);

  const searchRouter = (await import("./controllers/search.controller")).default;
  app.use(searchRouter);

  const { validateTwilioAtBoot } = await import("./lib/sms/twilioClient");
  validateTwilioAtBoot();

  const { registerSmsAdminRoutes } = await import("./lib/sms/smsAdminRoutes");
  registerSmsAdminRoutes(app);


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

  const { startMemoryLogger } = await import("./lib/schedulerHarness");
  startMemoryLogger(5 * 60 * 1000);

  const { getRoleMode, shouldRunSchedulers } = await import("./lib/schedulerInit");
  const { getSchedulerStates } = await import("./lib/schedulerHarness");
  const activeSchedulers = shouldRunSchedulers()
    ? Object.keys(getSchedulerStates())
    : [];

  const bootSummary = {
    event: "boot_complete",
    roleMode: getRoleMode(),
    db: "connected",
    dbSource: getDbSource(),
    redis: process.env.UPSTASH_REDIS_REST_URL ? "configured" : "not_configured",
    schedulers: activeSchedulers,
    schedulerCount: activeSchedulers.length,
    websocket: "active",
    memoryLogger: "active",
    nodeEnv: process.env.NODE_ENV || "development",
    pid: process.pid,
    uptime: process.uptime(),
    ts: new Date().toISOString(),
  };
  console.log(JSON.stringify(bootSummary));

  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ event: "shutdown_start", signal, ts: new Date().toISOString() }));

    const { stopSchedulers } = await import("./lib/schedulerInit");
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
