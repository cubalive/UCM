import { db } from "../db";
import { eq, and } from "drizzle-orm";
import {
  stripeCustomers,
  companySubscriptions,
  platformBillingSettings,
  companies,
  type StripeCustomer,
  type CompanySubscription,
} from "@shared/schema";

function getStripe() {
  const Stripe = require("stripe").default;
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

const APP_URL = () =>
  process.env.APP_PUBLIC_URL ||
  process.env.PUBLIC_BASE_URL ||
  process.env.APP_URL ||
  "https://app.unitedcaremobility.com";

export async function getSubscriptionSettings() {
  const [row] = await db
    .select({
      monthlySubscriptionEnabled: platformBillingSettings.monthlySubscriptionEnabled,
      monthlySubscriptionPriceId: platformBillingSettings.monthlySubscriptionPriceId,
      subscriptionRequiredForAccess: platformBillingSettings.subscriptionRequiredForAccess,
      gracePeriodDays: platformBillingSettings.gracePeriodDays,
    })
    .from(platformBillingSettings)
    .where(eq(platformBillingSettings.id, 1));
  return row || {
    monthlySubscriptionEnabled: false,
    monthlySubscriptionPriceId: null,
    subscriptionRequiredForAccess: false,
    gracePeriodDays: 0,
  };
}

async function ensureSettingsRow(): Promise<void> {
  const existing = await db.select().from(platformBillingSettings).where(eq(platformBillingSettings.id, 1));
  if (existing.length === 0) {
    await db.insert(platformBillingSettings).values({
      id: 1,
      enabled: false,
      defaultFeeType: "PERCENT",
      defaultFeePercent: "0",
      defaultFeeCents: 0,
    }).onConflictDoNothing();
  }
}

export async function updateSubscriptionSettings(data: {
  monthlySubscriptionEnabled?: boolean;
  monthlySubscriptionPriceId?: string | null;
  subscriptionRequiredForAccess?: boolean;
  gracePeriodDays?: number;
}) {
  await ensureSettingsRow();
  const setData: Record<string, any> = { updatedAt: new Date() };
  if (data.monthlySubscriptionEnabled !== undefined) setData.monthlySubscriptionEnabled = data.monthlySubscriptionEnabled;
  if (data.monthlySubscriptionPriceId !== undefined) setData.monthlySubscriptionPriceId = data.monthlySubscriptionPriceId;
  if (data.subscriptionRequiredForAccess !== undefined) setData.subscriptionRequiredForAccess = data.subscriptionRequiredForAccess;
  if (data.gracePeriodDays !== undefined) setData.gracePeriodDays = data.gracePeriodDays;

  await db
    .update(platformBillingSettings)
    .set(setData)
    .where(eq(platformBillingSettings.id, 1));
  return getSubscriptionSettings();
}

export async function getOrCreateStripeCustomer(companyId: number): Promise<StripeCustomer> {
  const [existing] = await db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.companyId, companyId));
  if (existing) return existing;

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw new Error("Company not found");

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: company.name,
    metadata: { ucm_company_id: String(companyId) },
  });

  const [created] = await db
    .insert(stripeCustomers)
    .values({ companyId, stripeCustomerId: customer.id })
    .returning();
  return created;
}

export async function getCompanySubscription(companyId: number): Promise<CompanySubscription | null> {
  const [row] = await db
    .select()
    .from(companySubscriptions)
    .where(eq(companySubscriptions.companyId, companyId));
  return row || null;
}

export async function getAllSubscriptions() {
  return db
    .select({
      subscription: companySubscriptions,
      companyName: companies.name,
    })
    .from(companySubscriptions)
    .innerJoin(companies, eq(companies.id, companySubscriptions.companyId));
}

export async function createCheckoutSession(companyId: number): Promise<string> {
  const settings = await getSubscriptionSettings();
  if (!settings.monthlySubscriptionEnabled || !settings.monthlySubscriptionPriceId) {
    throw new Error("Monthly subscriptions are not enabled or no price configured");
  }

  const existing = await getCompanySubscription(companyId);
  if (existing && ["active", "trialing"].includes(existing.status)) {
    throw new Error("Company already has an active subscription");
  }

  const stripeCustomer = await getOrCreateStripeCustomer(companyId);
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomer.stripeCustomerId,
    mode: "subscription",
    line_items: [{ price: settings.monthlySubscriptionPriceId, quantity: 1 }],
    success_url: `${APP_URL()}/admin/subscriptions?success=true&company=${companyId}`,
    cancel_url: `${APP_URL()}/admin/subscriptions?canceled=true&company=${companyId}`,
    metadata: { ucm_company_id: String(companyId) },
    subscription_data: {
      metadata: { ucm_company_id: String(companyId) },
    },
  });

  return session.url!;
}

export async function createPortalSession(companyId: number): Promise<string> {
  const stripeCustomer = await getOrCreateStripeCustomer(companyId);
  const stripe = getStripe();

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomer.stripeCustomerId,
    return_url: `${APP_URL()}/admin/subscriptions`,
  });

  return session.url;
}

export async function cancelSubscription(companyId: number): Promise<CompanySubscription> {
  const sub = await getCompanySubscription(companyId);
  if (!sub || !sub.stripeSubscriptionId) {
    throw new Error("No active subscription found");
  }

  const stripe = getStripe();
  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  const [updated] = await db
    .update(companySubscriptions)
    .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(eq(companySubscriptions.companyId, companyId))
    .returning();
  return updated;
}

export async function handleSubscriptionWebhook(event: any): Promise<void> {
  const stripe = getStripe();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription") return;

      const companyId = parseInt(session.metadata?.ucm_company_id);
      if (isNaN(companyId)) {
        console.error("[SUBSCRIPTION] checkout.session.completed missing ucm_company_id");
        return;
      }

      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await upsertSubscriptionFromStripe(companyId, subscription, event.id);
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const companyId = parseInt(subscription.metadata?.ucm_company_id);
      if (isNaN(companyId)) {
        const [sc] = await db
          .select()
          .from(stripeCustomers)
          .where(eq(stripeCustomers.stripeCustomerId, subscription.customer));
        if (!sc) {
          console.error("[SUBSCRIPTION] Cannot resolve company for subscription", subscription.id);
          return;
        }
        await upsertSubscriptionFromStripe(sc.companyId, subscription, event.id);
      } else {
        await upsertSubscriptionFromStripe(companyId, subscription, event.id);
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      console.warn("[SUBSCRIPTION] Payment failed for invoice", invoice.id, "subscription", invoice.subscription);
      break;
    }
  }
}

async function upsertSubscriptionFromStripe(
  companyId: number,
  stripeSubscription: any,
  eventId: string
): Promise<void> {
  const existing = await getCompanySubscription(companyId);

  if (existing && existing.lastEventId === eventId) return;

  const data = {
    stripeSubscriptionId: stripeSubscription.id,
    stripePriceId: stripeSubscription.items?.data?.[0]?.price?.id || "unknown",
    status: stripeSubscription.status,
    currentPeriodStart: stripeSubscription.current_period_start
      ? new Date(stripeSubscription.current_period_start * 1000)
      : null,
    currentPeriodEnd: stripeSubscription.current_period_end
      ? new Date(stripeSubscription.current_period_end * 1000)
      : null,
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end || false,
    canceledAt: stripeSubscription.canceled_at
      ? new Date(stripeSubscription.canceled_at * 1000)
      : null,
    lastEventId: eventId,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(companySubscriptions)
      .set(data)
      .where(eq(companySubscriptions.companyId, companyId));
  } else {
    await db.insert(companySubscriptions).values({
      companyId,
      ...data,
    });
  }

  console.log(
    JSON.stringify({
      event: "subscription_upserted",
      companyId,
      status: data.status,
      subscriptionId: data.stripeSubscriptionId,
    })
  );
}

export function isSubscriptionActive(sub: CompanySubscription | null): boolean {
  if (!sub) return false;
  return ["active", "trialing"].includes(sub.status);
}

export async function checkCompanyAccess(companyId: number): Promise<{
  allowed: boolean;
  reason?: string;
  subscription?: CompanySubscription | null;
}> {
  const settings = await getSubscriptionSettings();
  if (!settings.subscriptionRequiredForAccess) {
    return { allowed: true };
  }

  const sub = await getCompanySubscription(companyId);
  if (isSubscriptionActive(sub)) {
    return { allowed: true, subscription: sub };
  }

  if (sub && sub.status === "past_due" && settings.gracePeriodDays > 0) {
    const periodEnd = sub.currentPeriodEnd;
    if (periodEnd) {
      const graceEnd = new Date(periodEnd.getTime() + settings.gracePeriodDays * 86400000);
      if (new Date() <= graceEnd) {
        return { allowed: true, reason: "grace_period", subscription: sub };
      }
    }
  }

  return {
    allowed: false,
    reason: sub ? `subscription_${sub.status}` : "no_subscription",
    subscription: sub,
  };
}
