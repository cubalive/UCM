import { getDb } from "../db/index.js";
import { tenants } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getStripe } from "../lib/stripe.js";
import { recordAudit } from "./auditService.js";
import logger from "../lib/logger.js";

export async function createConnectAccount(tenantId: string, email: string) {
  const stripe = getStripe();
  const db = getDb();

  const account = await stripe.accounts.create({
    type: "express",
    email,
    metadata: { tenantId },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });

  await db
    .update(tenants)
    .set({
      stripeAccountId: account.id,
      stripeOnboardingComplete: false,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  await recordAudit({
    tenantId,
    action: "stripe.account_created",
    resource: "tenant",
    resourceId: tenantId,
    details: { stripeAccountId: account.id },
  });

  return account;
}

export async function createOnboardingLink(tenantId: string, returnUrl: string, refreshUrl: string) {
  const stripe = getStripe();
  const db = getDb();

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant?.stripeAccountId) throw new Error("No Stripe account for tenant");

  const accountLink = await stripe.accountLinks.create({
    account: tenant.stripeAccountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return accountLink;
}

export async function getConnectAccountStatus(tenantId: string) {
  const stripe = getStripe();
  const db = getDb();

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant?.stripeAccountId) return null;

  const account = await stripe.accounts.retrieve(tenant.stripeAccountId);

  const isComplete = account.charges_enabled && account.payouts_enabled;

  if (isComplete && !tenant.stripeOnboardingComplete) {
    await db
      .update(tenants)
      .set({ stripeOnboardingComplete: true, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
  }

  return {
    accountId: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    onboardingComplete: isComplete,
    dashboardUrl: `https://dashboard.stripe.com/connect/accounts/${account.id}`,
  };
}
