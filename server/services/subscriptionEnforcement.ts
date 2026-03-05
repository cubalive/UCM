/**
 * Subscription enforcement service.
 *
 * Provides quota checking with Redis-cached usage counts,
 * grace period logic for past_due subscriptions,
 * and audit logging for enforcement actions.
 */

import { getJson, setJson, isRedisConnected } from "../lib/redis";
import { logSystemEvent } from "../lib/systemEvents";
import { getEnvironment, getRunMode, getVersion } from "../lib/env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubscriptionQuotas {
  maxDrivers: number;
  maxActiveTrips: number;
  maxClinics: number;
}

export interface UsageCounts {
  driversCount: number;
  activeTripsCount: number;
  clinicsCount: number;
}

export interface EnforcementResult {
  allowed: boolean;
  code?: "SUBSCRIPTION_INACTIVE" | "QUOTA_EXCEEDED";
  reason?: string;
  metadata?: {
    companyId: number;
    status?: string;
    limitName?: string;
    currentUsage?: number;
    limitValue?: number;
    graceDaysRemaining?: number;
  };
}

// ---------------------------------------------------------------------------
// Default quotas (can be overridden per-company via settings)
// ---------------------------------------------------------------------------

export const DEFAULT_QUOTAS: SubscriptionQuotas = {
  maxDrivers: 50,
  maxActiveTrips: 200,
  maxClinics: 20,
};

export const GRACE_PERIOD_DAYS = 7;

// ---------------------------------------------------------------------------
// Subscription status helpers
// ---------------------------------------------------------------------------

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "paused" | "incomplete" | string;

export function isStatusActive(status: SubscriptionStatus): boolean {
  return status === "active" || status === "trialing";
}

export function isStatusGracePeriod(status: SubscriptionStatus): boolean {
  return status === "past_due";
}

/**
 * Calculate days remaining in grace period.
 * Returns 0 if grace has expired.
 */
export function graceDaysRemaining(
  status: string,
  currentPeriodEnd: Date | null,
  graceDays: number = GRACE_PERIOD_DAYS
): number {
  if (status !== "past_due") return 0;
  if (!currentPeriodEnd) return graceDays; // no period end → full grace
  const graceEnd = new Date(currentPeriodEnd.getTime() + graceDays * 24 * 60 * 60 * 1000);
  const remaining = Math.ceil((graceEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return Math.max(0, remaining);
}

/**
 * Check if a past_due subscription is still within grace period.
 */
export function isWithinGrace(
  status: string,
  currentPeriodEnd: Date | null,
  graceDays: number = GRACE_PERIOD_DAYS
): boolean {
  if (status !== "past_due") return false;
  return graceDaysRemaining(status, currentPeriodEnd, graceDays) > 0;
}

// ---------------------------------------------------------------------------
// Usage counting (with Redis cache)
// ---------------------------------------------------------------------------

const USAGE_CACHE_TTL = 30; // seconds

function usageCacheKey(companyId: number): string {
  return `company:${companyId}:usage_counts`;
}

/**
 * Get usage counts for a company.
 * Uses Redis cache with 30s TTL. Falls back to provided DB query function.
 */
export async function getUsageCounts(
  companyId: number,
  dbQueryFn: (companyId: number) => Promise<UsageCounts>
): Promise<UsageCounts> {
  const cacheKey = usageCacheKey(companyId);

  if (isRedisConnected()) {
    try {
      const cached = await getJson<UsageCounts>(cacheKey);
      if (cached) return cached;
    } catch {}
  }

  const counts = await dbQueryFn(companyId);

  // Cache in background — don't block response
  setJson(cacheKey, counts, USAGE_CACHE_TTL).catch(() => {});

  return counts;
}

/**
 * Invalidate usage cache for a company (call after writes).
 */
export async function invalidateUsageCache(companyId: number): Promise<void> {
  if (!isRedisConnected()) return;
  try {
    const { del } = await import("../lib/redis");
    await del(usageCacheKey(companyId));
  } catch {}
}

// ---------------------------------------------------------------------------
// Enforcement logic
// ---------------------------------------------------------------------------

export interface SubscriptionContext {
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  quotas: SubscriptionQuotas;
  enabled: boolean;           // is subscription enforcement enabled for this company
  required: boolean;          // is subscription required for access
}

/**
 * Check if a write operation is allowed for a given company.
 *
 * @param resourceType - "driver" | "trip" | "clinic"
 * @param context - subscription state
 * @param usage - current usage counts
 * @param companyId - for metadata
 */
export function checkWriteAllowed(
  resourceType: "driver" | "trip" | "clinic",
  context: SubscriptionContext,
  usage: UsageCounts,
  companyId: number
): EnforcementResult {
  // If enforcement is not enabled, allow everything
  if (!context.enabled || !context.required) {
    return { allowed: true };
  }

  const status = context.status;

  // Active/trialing — check quotas only
  if (isStatusActive(status)) {
    return checkQuota(resourceType, context.quotas, usage, companyId, status);
  }

  // Past_due within grace — allow limited operations but check quotas
  if (isWithinGrace(status, context.currentPeriodEnd)) {
    return checkQuota(resourceType, context.quotas, usage, companyId, status);
  }

  // Past_due beyond grace, canceled, paused, etc. — block new resources
  return {
    allowed: false,
    code: "SUBSCRIPTION_INACTIVE",
    reason: `Subscription is ${status}. Cannot create new ${resourceType}s.`,
    metadata: {
      companyId,
      status,
      graceDaysRemaining: graceDaysRemaining(status, context.currentPeriodEnd),
    },
  };
}

function checkQuota(
  resourceType: "driver" | "trip" | "clinic",
  quotas: SubscriptionQuotas,
  usage: UsageCounts,
  companyId: number,
  status: string
): EnforcementResult {
  const limitMap: Record<string, { current: number; max: number; limitName: string }> = {
    driver: { current: usage.driversCount, max: quotas.maxDrivers, limitName: "max_drivers" },
    trip: { current: usage.activeTripsCount, max: quotas.maxActiveTrips, limitName: "max_active_trips" },
    clinic: { current: usage.clinicsCount, max: quotas.maxClinics, limitName: "max_clinics" },
  };

  const check = limitMap[resourceType];
  if (!check) return { allowed: true };

  if (check.current >= check.max) {
    return {
      allowed: false,
      code: "QUOTA_EXCEEDED",
      reason: `${check.limitName} quota exceeded (${check.current}/${check.max}).`,
      metadata: {
        companyId,
        status,
        limitName: check.limitName,
        currentUsage: check.current,
        limitValue: check.max,
      },
    };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Audit logging for enforcement actions
// ---------------------------------------------------------------------------

export async function logEnforcementAction(
  companyId: number,
  userId: number | null,
  endpoint: string,
  result: EnforcementResult,
  usage?: UsageCounts
): Promise<void> {
  try {
    await logSystemEvent({
      companyId,
      actorUserId: userId,
      eventType: "subscription_enforcement",
      entityType: result.code || "enforcement",
      entityId: endpoint,
      payload: {
        allowed: result.allowed,
        code: result.code,
        reason: result.reason,
        metadata: result.metadata,
        usage,
        environment: getEnvironment(),
        service: getRunMode(),
        version: getVersion(),
      },
    });
  } catch {
    // Silent — don't block request for audit failure
  }
}
