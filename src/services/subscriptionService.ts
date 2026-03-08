import { getDb } from "../db/index.js";
import { tenants, users } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { recordAudit } from "./auditService.js";
import { sendEmail } from "./emailService.js";
import logger from "../lib/logger.js";

const TIER_LIMITS: Record<string, { maxTrips: number; maxDrivers: number; maxUsers: number }> = {
  starter: { maxTrips: 100, maxDrivers: 5, maxUsers: 10 },
  professional: { maxTrips: 1000, maxDrivers: 50, maxUsers: 100 },
  enterprise: { maxTrips: -1, maxDrivers: -1, maxUsers: -1 }, // unlimited
};

const VALID_TIERS = ["starter", "professional", "enterprise"] as const;
type SubscriptionTier = typeof VALID_TIERS[number];

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

/**
 * Handle subscription tier change from Stripe webhook.
 * Maps Stripe subscription data to internal tier + status.
 */
export async function handleSubscriptionUpdate(
  tenantId: string,
  newTier: SubscriptionTier,
  stripeStatus: string,
  currentPeriodEnd?: Date
): Promise<void> {
  const db = getDb();

  // Map Stripe status to internal status
  const statusMap: Record<string, string> = {
    active: "active",
    trialing: "active",
    past_due: "active", // still allow access during grace period
    canceled: "canceled",
    unpaid: "suspended",
    incomplete: "pending",
    incomplete_expired: "canceled",
    paused: "suspended",
  };

  const internalStatus = statusMap[stripeStatus] || "active";

  // Validate tier downgrade feasibility
  if (newTier !== "enterprise") {
    const limits = getTierLimits(newTier);
    const [driverCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "driver"), eq(users.active, true)));

    if (limits.maxDrivers !== -1 && Number(driverCount.count) > limits.maxDrivers) {
      logger.warn("Subscription downgrade exceeds driver limit", {
        tenantId,
        newTier,
        currentDrivers: Number(driverCount.count),
        limit: limits.maxDrivers,
      });
      // Still apply the change - admin can manage excess drivers
    }
  }

  await db
    .update(tenants)
    .set({
      subscriptionTier: newTier,
      subscriptionStatus: internalStatus,
      subscriptionExpiresAt: currentPeriodEnd || null,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  await recordAudit({
    tenantId,
    action: "subscription.updated",
    resource: "tenant",
    resourceId: tenantId,
    details: { newTier, stripeStatus, internalStatus },
  });

  logger.info("Subscription updated", { tenantId, newTier, stripeStatus, internalStatus });

  // Notify admin(s)
  const admins = await db
    .select({ email: users.email, firstName: users.firstName })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, "admin"), eq(users.active, true)));

  for (const admin of admins) {
    sendEmail({
      to: admin.email,
      subject: `Subscription Updated - ${newTier.charAt(0).toUpperCase() + newTier.slice(1)} Plan`,
      html: `
        <h2>Subscription Updated</h2>
        <p>Hi ${admin.firstName},</p>
        <p>Your subscription has been updated to the <strong>${newTier}</strong> plan.</p>
        <p><strong>Status:</strong> ${internalStatus}</p>
        ${currentPeriodEnd ? `<p><strong>Current period ends:</strong> ${currentPeriodEnd.toLocaleDateString()}</p>` : ""}
        <p>Log in to your admin dashboard to review your plan details.</p>
      `,
      text: `Subscription updated to ${newTier} plan. Status: ${internalStatus}.`,
    }).catch(err => logger.warn("Failed to send subscription notification", { error: err.message }));
  }
}

/**
 * Resolve Stripe plan/price ID to internal tier name.
 */
export function resolveStripeTier(subscription: {
  items?: { data?: Array<{ price?: { id?: string; lookup_key?: string; product?: string | { id: string; name?: string; metadata?: Record<string, string> } } }> };
  metadata?: Record<string, string>;
}): SubscriptionTier {
  // First: check subscription metadata for explicit tier
  if (subscription.metadata?.tier && VALID_TIERS.includes(subscription.metadata.tier as SubscriptionTier)) {
    return subscription.metadata.tier as SubscriptionTier;
  }

  // Second: check price lookup_key
  const item = subscription.items?.data?.[0];
  const lookupKey = item?.price?.lookup_key || "";
  for (const tier of VALID_TIERS) {
    if (lookupKey.includes(tier)) return tier;
  }

  // Third: check product name/metadata
  const product = item?.price?.product;
  if (product && typeof product === "object") {
    const productName = (product.name || "").toLowerCase();
    const productTier = product.metadata?.tier;
    if (productTier && VALID_TIERS.includes(productTier as SubscriptionTier)) {
      return productTier as SubscriptionTier;
    }
    for (const tier of VALID_TIERS) {
      if (productName.includes(tier)) return tier;
    }
  }

  // Default
  return "starter";
}
