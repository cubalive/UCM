import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { checkCompanyAccess, getCompanySubscription, getCompanySubSettings } from "../services/subscriptionService";
import {
  checkWriteAllowed,
  getUsageCounts,
  logEnforcementAction,
  isWithinGrace,
  graceDaysRemaining,
  DEFAULT_QUOTAS,
  type SubscriptionContext,
  type UsageCounts,
  type EnforcementResult,
} from "../services/subscriptionEnforcement";

// ---------------------------------------------------------------------------
// Exempt paths — never enforced
// ---------------------------------------------------------------------------

const EXEMPT_PREFIXES = [
  "/health",
  "/api/auth",
  "/api/health",
  "/api/healthz",
  "/api/readyz",
  "/api/public",
  "/api/boot",
  "/api/stripe",
  "/api/webhooks",
];

function isExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some((p) => path.startsWith(p));
}

// ---------------------------------------------------------------------------
// Resource type detection from route path
// ---------------------------------------------------------------------------

const RESOURCE_WRITE_PATTERNS: Array<{ pattern: RegExp; resource: "driver" | "trip" | "clinic" }> = [
  { pattern: /^\/api\/drivers\/?$/, resource: "driver" },
  { pattern: /^\/api\/trips\/?$/, resource: "trip" },
  { pattern: /^\/api\/clinics\/?$/, resource: "clinic" },
];

function detectResourceWrite(method: string, path: string): "driver" | "trip" | "clinic" | null {
  if (method !== "POST") return null;
  for (const { pattern, resource } of RESOURCE_WRITE_PATTERNS) {
    if (pattern.test(path)) return resource;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Trip completion paths that MUST be allowed even with inactive subscription
// ---------------------------------------------------------------------------

const TRIP_COMPLETION_PATTERN = /^\/api\/trips\/\d+\/(status|complete|arrive|pickup|dropoff)/;

function isTripCompletionPath(method: string, path: string): boolean {
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return false;
  return TRIP_COMPLETION_PATTERN.test(path);
}

// ---------------------------------------------------------------------------
// DB query function for usage counts (injected to keep middleware testable)
// ---------------------------------------------------------------------------

let dbQueryFn: ((companyId: number) => Promise<UsageCounts>) | null = null;

/** Register the DB query function at boot time (avoids circular imports). */
export function registerUsageQueryFn(fn: (companyId: number) => Promise<UsageCounts>): void {
  dbQueryFn = fn;
}

async function queryUsageCounts(companyId: number): Promise<UsageCounts> {
  if (dbQueryFn) return dbQueryFn(companyId);
  // Fallback: return high counts so quotas don't accidentally block
  return { driversCount: 0, activeTripsCount: 0, clinicsCount: 0 };
}

// ---------------------------------------------------------------------------
// Middleware: basic subscription check (existing behavior, enhanced)
// ---------------------------------------------------------------------------

/**
 * Basic subscription gate — blocks all API access when subscription is inactive.
 * Use on routes that require an active subscription to function at all.
 */
export async function requireSubscription(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    if (req.user.role === "SUPER_ADMIN") return next();
    if (isExempt(req.path)) return next();

    const companyId = req.user.companyId;
    if (!companyId) return next();

    const access = await checkCompanyAccess(companyId);
    if (access.allowed) return next();

    // Allow trip completion even with inactive subscription
    if (isTripCompletionPath(req.method, req.path)) return next();

    // past_due within grace → allow reads, limited writes
    if (access.subscription && isWithinGrace(access.subscription.status, access.subscription.currentPeriodEnd)) {
      return next();
    }

    const result: EnforcementResult = {
      allowed: false,
      code: "SUBSCRIPTION_INACTIVE",
      reason: access.reason,
      metadata: {
        companyId,
        status: access.subscription?.status,
        graceDaysRemaining: access.subscription
          ? graceDaysRemaining(access.subscription.status, access.subscription.currentPeriodEnd)
          : 0,
      },
    };

    logEnforcementAction(companyId, req.user.userId, req.path, result).catch(() => {});

    return res.status(403).json({
      message: "Subscription required. Your company does not have an active subscription.",
      code: result.code,
      reason: result.reason,
      metadata: result.metadata,
    });
  } catch (err: any) {
    console.error("[SUBSCRIPTION GUARD] Error:", err.message);
    return next(); // fail open
  }
}

// ---------------------------------------------------------------------------
// Middleware: quota enforcement on resource creation
// ---------------------------------------------------------------------------

/**
 * Enforces quotas on resource creation (POST to /api/drivers, /api/trips, /api/clinics).
 * Must be used AFTER auth middleware. Reads are always allowed.
 */
export async function enforceQuota(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) return next(); // auth middleware will catch
    if (req.user.role === "SUPER_ADMIN") return next();
    if (isExempt(req.path)) return next();

    // Always allow trip completion
    if (isTripCompletionPath(req.method, req.path)) return next();

    const companyId = req.user.companyId;
    if (!companyId) return next();

    const resourceType = detectResourceWrite(req.method, req.path);
    if (!resourceType) return next(); // not a resource creation → allow

    // Build subscription context
    const [sub, settings] = await Promise.all([
      getCompanySubscription(companyId),
      getCompanySubSettings(companyId),
    ]);

    const context: SubscriptionContext = {
      status: sub?.status || "incomplete",
      currentPeriodEnd: sub?.currentPeriodEnd || null,
      quotas: {
        maxDrivers: (settings as any)?.maxDrivers ?? DEFAULT_QUOTAS.maxDrivers,
        maxActiveTrips: (settings as any)?.maxActiveTrips ?? DEFAULT_QUOTAS.maxActiveTrips,
        maxClinics: (settings as any)?.maxClinics ?? DEFAULT_QUOTAS.maxClinics,
      },
      enabled: settings?.subscriptionEnabled ?? false,
      required: settings?.subscriptionRequiredForAccess ?? false,
    };

    const usage = await getUsageCounts(companyId, queryUsageCounts);
    const result = checkWriteAllowed(resourceType, context, usage, companyId);

    if (result.allowed) return next();

    // Log enforcement
    logEnforcementAction(companyId, req.user.userId, req.path, result, usage).catch(() => {});

    return res.status(403).json({
      message: result.reason,
      code: result.code,
      metadata: result.metadata,
    });
  } catch (err: any) {
    console.error("[QUOTA GUARD] Error:", err.message);
    return next(); // fail open
  }
}
