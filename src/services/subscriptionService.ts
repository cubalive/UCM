import { getDb } from "../db/index.js";
import { tenants } from "../db/schema.js";
import { eq } from "drizzle-orm";
import logger from "../lib/logger.js";

const TIER_LIMITS: Record<string, { maxTrips: number; maxDrivers: number; maxUsers: number }> = {
  starter: { maxTrips: 100, maxDrivers: 5, maxUsers: 10 },
  professional: { maxTrips: 1000, maxDrivers: 50, maxUsers: 100 },
  enterprise: { maxTrips: -1, maxDrivers: -1, maxUsers: -1 }, // unlimited
};

export function getTierLimits(tier: string) {
  return TIER_LIMITS[tier] || TIER_LIMITS.starter;
}

export async function checkSubscriptionActive(tenantId: string): Promise<boolean> {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));

  if (!tenant) return false;
  if (tenant.subscriptionStatus !== "active") return false;
  if (tenant.subscriptionExpiresAt && tenant.subscriptionExpiresAt < new Date()) return false;

  return true;
}

export async function enforceSubscription(tenantId: string): Promise<void> {
  const isActive = await checkSubscriptionActive(tenantId);
  if (!isActive) {
    throw new Error("Subscription is not active. Please renew to continue.");
  }
}
