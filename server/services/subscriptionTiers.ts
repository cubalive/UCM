/**
 * Subscription Tier System
 *
 * Defines tier limits and enforces usage caps per subscription plan.
 * Tiers: starter, professional, enterprise
 */
import { db } from "../db";
import { companySubscriptions, companySubscriptionSettings, trips, drivers, users } from "@shared/schema";
import { eq, and, gte, isNull, sql } from "drizzle-orm";

export interface TierLimits {
  maxTripsPerMonth: number;
  maxDrivers: number;
  maxUsers: number;
  maxClinics: number;
  features: {
    autoAssign: boolean;
    billingV2: boolean;
    realtimeTracking: boolean;
    apiAccess: boolean;
    customBranding: boolean;
    multiCity: boolean;
    advancedReporting: boolean;
    whiteLabel: boolean;
  };
}

export const TIER_DEFINITIONS: Record<string, TierLimits> = {
  starter: {
    maxTripsPerMonth: 200,
    maxDrivers: 10,
    maxUsers: 15,
    maxClinics: 5,
    features: {
      autoAssign: false,
      billingV2: true,
      realtimeTracking: true,
      apiAccess: false,
      customBranding: false,
      multiCity: false,
      advancedReporting: false,
      whiteLabel: false,
    },
  },
  professional: {
    maxTripsPerMonth: 2000,
    maxDrivers: 75,
    maxUsers: 150,
    maxClinics: 30,
    features: {
      autoAssign: true,
      billingV2: true,
      realtimeTracking: true,
      apiAccess: true,
      customBranding: true,
      multiCity: true,
      advancedReporting: true,
      whiteLabel: false,
    },
  },
  enterprise: {
    maxTripsPerMonth: -1, // unlimited
    maxDrivers: -1,
    maxUsers: -1,
    maxClinics: -1,
    features: {
      autoAssign: true,
      billingV2: true,
      realtimeTracking: true,
      apiAccess: true,
      customBranding: true,
      multiCity: true,
      advancedReporting: true,
      whiteLabel: true,
    },
  },
};

export function resolveTier(priceId: string | null, metadata?: Record<string, any>): string {
  // Check metadata first
  if (metadata?.tier) return metadata.tier;

  // Resolve from price ID patterns
  if (!priceId) return "starter";
  const lower = priceId.toLowerCase();
  if (lower.includes("enterprise") || lower.includes("ent")) return "enterprise";
  if (lower.includes("professional") || lower.includes("pro")) return "professional";
  return "starter";
}

export function getTierLimits(tier: string): TierLimits {
  return TIER_DEFINITIONS[tier] || TIER_DEFINITIONS.starter;
}

export interface UsageSnapshot {
  tier: string;
  limits: TierLimits;
  usage: {
    tripsThisMonth: number;
    activeDrivers: number;
    activeUsers: number;
    activeClinics: number;
  };
  withinLimits: boolean;
  warnings: string[];
}

export async function getCompanyUsage(companyId: number): Promise<UsageSnapshot> {
  // Get subscription tier
  const subscription = await db
    .select()
    .from(companySubscriptions)
    .where(eq(companySubscriptions.companyId, companyId))
    .then((r) => r[0]);

  const tier = subscription ? resolveTier(subscription.stripePriceId) : "starter";
  const limits = getTierLimits(tier);

  // Count trips this month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const [tripsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        gte(trips.scheduledDate, monthStart),
        isNull(trips.deletedAt)
      )
    );

  // Count active drivers
  const [driversCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(drivers)
    .where(
      and(
        eq(drivers.companyId, companyId),
        eq(drivers.status, "ACTIVE"),
        isNull(drivers.deletedAt)
      )
    );

  // Count active users
  const [usersCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.companyId, companyId),
        eq(users.active, true),
        isNull(users.deletedAt)
      )
    );

  // Count clinics
  const { clinics: clinicsTable } = await import("@shared/schema");
  const [clinicsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clinicsTable)
    .where(eq(clinicsTable.companyId, companyId));

  const usage = {
    tripsThisMonth: tripsCount?.count || 0,
    activeDrivers: driversCount?.count || 0,
    activeUsers: usersCount?.count || 0,
    activeClinics: clinicsCount?.count || 0,
  };

  const warnings: string[] = [];
  let withinLimits = true;

  if (limits.maxTripsPerMonth > 0 && usage.tripsThisMonth >= limits.maxTripsPerMonth) {
    warnings.push(`Trip limit reached (${usage.tripsThisMonth}/${limits.maxTripsPerMonth})`);
    withinLimits = false;
  } else if (limits.maxTripsPerMonth > 0 && usage.tripsThisMonth >= limits.maxTripsPerMonth * 0.9) {
    warnings.push(`Approaching trip limit (${usage.tripsThisMonth}/${limits.maxTripsPerMonth})`);
  }

  if (limits.maxDrivers > 0 && usage.activeDrivers >= limits.maxDrivers) {
    warnings.push(`Driver limit reached (${usage.activeDrivers}/${limits.maxDrivers})`);
    withinLimits = false;
  }

  if (limits.maxUsers > 0 && usage.activeUsers >= limits.maxUsers) {
    warnings.push(`User limit reached (${usage.activeUsers}/${limits.maxUsers})`);
    withinLimits = false;
  }

  if (limits.maxClinics > 0 && usage.activeClinics >= limits.maxClinics) {
    warnings.push(`Clinic limit reached (${usage.activeClinics}/${limits.maxClinics})`);
    withinLimits = false;
  }

  return { tier, limits, usage, withinLimits, warnings };
}

/**
 * Check if a company can perform an action based on tier limits.
 * Returns { allowed, reason } — used by middleware and controllers.
 */
export async function checkTierLimit(
  companyId: number,
  resource: "trip" | "driver" | "user" | "clinic"
): Promise<{ allowed: boolean; reason?: string }> {
  const snapshot = await getCompanyUsage(companyId);
  const limits = snapshot.limits;
  const usage = snapshot.usage;

  switch (resource) {
    case "trip":
      if (limits.maxTripsPerMonth > 0 && usage.tripsThisMonth >= limits.maxTripsPerMonth) {
        return { allowed: false, reason: `Monthly trip limit reached (${limits.maxTripsPerMonth}). Upgrade to ${snapshot.tier === "starter" ? "Professional" : "Enterprise"} plan.` };
      }
      break;
    case "driver":
      if (limits.maxDrivers > 0 && usage.activeDrivers >= limits.maxDrivers) {
        return { allowed: false, reason: `Driver limit reached (${limits.maxDrivers}). Upgrade your plan.` };
      }
      break;
    case "user":
      if (limits.maxUsers > 0 && usage.activeUsers >= limits.maxUsers) {
        return { allowed: false, reason: `User limit reached (${limits.maxUsers}). Upgrade your plan.` };
      }
      break;
    case "clinic":
      if (limits.maxClinics > 0 && usage.activeClinics >= limits.maxClinics) {
        return { allowed: false, reason: `Clinic limit reached (${limits.maxClinics}). Upgrade your plan.` };
      }
      break;
  }

  return { allowed: true };
}

export function hasFeature(tier: string, feature: keyof TierLimits["features"]): boolean {
  const limits = getTierLimits(tier);
  return limits.features[feature] || false;
}
