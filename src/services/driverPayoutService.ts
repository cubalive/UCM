import { getDb } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { getStripe } from "../lib/stripe.js";
import { withStripeProtection } from "../lib/circuitBreaker.js";
import { recordAudit } from "./auditService.js";
import logger from "../lib/logger.js";

/**
 * DRIVER PAYOUT ARCHITECTURE - Stripe Connect Express
 *
 * WHY Express (not Standard or Custom):
 * - Express: Stripe hosts the onboarding, dashboard, KYC — lowest operational burden
 * - Standard: Too much driver-facing complexity, drivers aren't businesses
 * - Custom: Maximum control but massive compliance burden — overkill for NEMT drivers
 *
 * FLOW:
 * 1. Driver signs up in UCM
 * 2. Dispatch/admin triggers Stripe onboarding for driver
 * 3. Driver completes Stripe Express onboarding (KYC, bank account)
 * 4. When a trip is completed and paid, platform transfers driver share
 * 5. Stripe handles payouts to driver's bank account
 *
 * IMPLEMENTATION STATUS:
 * - [x] Create Express account for driver
 * - [x] Generate onboarding link
 * - [x] Check onboarding/KYC status
 * - [x] Create transfer to driver after trip payment
 * - [x] Get driver's Stripe dashboard link
 * - [ ] Webhook handler for account.updated (already in webhookService)
 * - [ ] UI for driver onboarding flow (frontend needed)
 * - [ ] Admin UI to view driver payout status
 *
 * REQUIRED ENV:
 * - STRIPE_SECRET_KEY (platform account)
 *
 * REMAINING DECISIONS:
 * - Payout percentage/split (fixed amount vs percentage per trip)
 * - Payout timing (immediate vs batched daily/weekly)
 * - Minimum payout threshold
 */

export interface DriverPayoutAccount {
  driverId: string;
  stripeAccountId: string | null;
  onboardingComplete: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  kycStatus: string;
  dashboardUrl: string | null;
}

export async function createDriverStripeAccount(
  driverId: string,
  tenantId: string,
  email: string,
  firstName: string,
  lastName: string
): Promise<{ accountId: string; onboardingUrl: string }> {
  const stripe = getStripe();
  const db = getDb();

  // Verify driver
  const [driver] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, driverId), eq(users.tenantId, tenantId), eq(users.role, "driver")));

  if (!driver) throw new Error("Driver not found");

  // Create Express connected account (circuit breaker protected)
  const account = await withStripeProtection(() =>
    stripe.accounts.create({
      type: "express",
      country: "US",
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: "individual",
      individual: {
        first_name: firstName,
        last_name: lastName,
        email,
      },
      metadata: {
        driverId,
        tenantId,
        platform: "ucm",
      },
    })
  );

  // Store account ID on user
  await db.update(users).set({
    stripeAccountId: account.id,
    updatedAt: new Date(),
  }).where(eq(users.id, driverId));

  await recordAudit({
    tenantId,
    userId: driverId,
    action: "driver.stripe_account_created",
    resource: "driver",
    resourceId: driverId,
    details: { stripeAccountId: account.id },
  });

  // Generate onboarding link
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const accountLink = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: `${appUrl}/driver/stripe/refresh`,
    return_url: `${appUrl}/driver/stripe/complete`,
    type: "account_onboarding",
  });

  logger.info("Driver Stripe account created", {
    driverId,
    stripeAccountId: account.id,
  });

  return {
    accountId: account.id,
    onboardingUrl: accountLink.url,
  };
}

export async function getDriverOnboardingLink(
  stripeAccountId: string
): Promise<string> {
  const stripe = getStripe();
  const appUrl = process.env.APP_URL || "http://localhost:3000";

  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${appUrl}/driver/stripe/refresh`,
    return_url: `${appUrl}/driver/stripe/complete`,
    type: "account_onboarding",
  });

  return accountLink.url;
}

export async function getDriverPayoutStatus(
  stripeAccountId: string
): Promise<DriverPayoutAccount & { requirements: any }> {
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(stripeAccountId);

  const kycStatus = account.requirements?.currently_due?.length
    ? "pending"
    : account.requirements?.past_due?.length
      ? "action_required"
      : "verified";

  return {
    driverId: account.metadata?.driverId || "",
    stripeAccountId: account.id,
    onboardingComplete: account.details_submitted || false,
    chargesEnabled: account.charges_enabled || false,
    payoutsEnabled: account.payouts_enabled || false,
    kycStatus,
    dashboardUrl: `https://dashboard.stripe.com/connect/accounts/${account.id}`,
    requirements: {
      currentlyDue: account.requirements?.currently_due || [],
      pastDue: account.requirements?.past_due || [],
      eventuallyDue: account.requirements?.eventually_due || [],
    },
  };
}

export async function getDriverDashboardLink(stripeAccountId: string): Promise<string> {
  const stripe = getStripe();
  const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
  return loginLink.url;
}

export async function transferToDriver(
  stripeAccountId: string,
  amountCents: number,
  currency: string = "usd",
  metadata?: Record<string, string>
): Promise<string> {
  const stripe = getStripe();

  const transfer = await withStripeProtection(() =>
    stripe.transfers.create({
      amount: amountCents,
      currency,
      destination: stripeAccountId,
      metadata: {
        ...metadata,
        platform: "ucm",
      },
    })
  );

  logger.info("Transfer to driver created", {
    transferId: transfer.id,
    stripeAccountId,
    amount: amountCents,
  });

  return transfer.id;
}
