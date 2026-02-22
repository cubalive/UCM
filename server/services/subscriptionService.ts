import { db } from "../db";
import { eq, and } from "drizzle-orm";
import {
  stripeCustomers,
  companySubscriptions,
  companySubscriptionSettings,
  companies,
  type StripeCustomer,
  type CompanySubscription,
  type CompanySubscriptionSettings,
} from "@shared/schema";

function getStripe() {
  const Stripe = require("stripe").default;
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

const APP_URL = () =>
  process.env.APP_BASE_URL ||
  process.env.APP_PUBLIC_URL ||
  process.env.PUBLIC_BASE_URL ||
  process.env.APP_URL ||
  "https://app.unitedcaremobility.com";

const PRICE_ID = () =>
  process.env.STRIPE_PRICE_ID_PLATFORM_1200 || null;

export async function getCompanySubSettings(companyId: number): Promise<CompanySubscriptionSettings | null> {
  const [row] = await db
    .select()
    .from(companySubscriptionSettings)
    .where(eq(companySubscriptionSettings.companyId, companyId));
  return row || null;
}

export async function upsertCompanySubSettings(
  companyId: number,
  data: { subscriptionEnabled?: boolean; subscriptionRequiredForAccess?: boolean; monthlyFeeCents?: number }
): Promise<CompanySubscriptionSettings> {
  const existing = await getCompanySubSettings(companyId);
  if (existing) {
    const setData: Record<string, any> = { updatedAt: new Date() };
    if (data.subscriptionEnabled !== undefined) setData.subscriptionEnabled = data.subscriptionEnabled;
    if (data.subscriptionRequiredForAccess !== undefined) setData.subscriptionRequiredForAccess = data.subscriptionRequiredForAccess;
    if (data.monthlyFeeCents !== undefined) setData.monthlyFeeCents = data.monthlyFeeCents;
    const [updated] = await db
      .update(companySubscriptionSettings)
      .set(setData)
      .where(eq(companySubscriptionSettings.companyId, companyId))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(companySubscriptionSettings)
    .values({
      companyId,
      subscriptionEnabled: data.subscriptionEnabled ?? false,
      subscriptionRequiredForAccess: data.subscriptionRequiredForAccess ?? true,
      monthlyFeeCents: data.monthlyFeeCents ?? 120000,
    })
    .returning();
  return created;
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

export async function createSubscription(companyId: number): Promise<string> {
  const existing = await getCompanySubscription(companyId);
  if (existing && ["active", "trialing"].includes(existing.status)) {
    throw new Error("Company already has an active subscription");
  }

  const settings = await getCompanySubSettings(companyId);
  const monthlyFeeCents = settings?.monthlyFeeCents ?? 120000;

  const stripeCustomer = await getOrCreateStripeCustomer(companyId);
  const stripe = getStripe();

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const companyName = company?.name || `Company #${companyId}`;

  const priceId = PRICE_ID();
  const lineItems: any[] = priceId
    ? [{ price: priceId, quantity: 1 }]
    : [{
        price_data: {
          currency: "usd",
          product_data: { name: `UCM Platform Subscription – ${companyName}` },
          unit_amount: monthlyFeeCents,
          recurring: { interval: "month" as const },
        },
        quantity: 1,
      }];

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomer.stripeCustomerId,
    mode: "subscription",
    line_items: lineItems,
    success_url: `${APP_URL()}/platform-fees?tab=subscription&success=true&company=${companyId}`,
    cancel_url: `${APP_URL()}/platform-fees?tab=subscription&canceled=true&company=${companyId}`,
    metadata: { ucm_company_id: String(companyId) },
    subscription_data: {
      metadata: { ucm_company_id: String(companyId) },
    },
  });

  await upsertCompanySubSettings(companyId, { subscriptionEnabled: true });

  return session.url!;
}

export async function createPortalSession(companyId: number): Promise<string> {
  const stripeCustomer = await getOrCreateStripeCustomer(companyId);
  const stripe = getStripe();

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomer.stripeCustomerId,
    return_url: `${APP_URL()}/platform-fees?tab=subscription`,
  });

  return session.url;
}

export async function cancelSubscriptionAtPeriodEnd(companyId: number): Promise<CompanySubscription> {
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

export async function reactivateSubscription(companyId: number): Promise<CompanySubscription> {
  const sub = await getCompanySubscription(companyId);
  if (!sub || !sub.stripeSubscriptionId) {
    throw new Error("No subscription found to reactivate");
  }
  if (sub.status === "canceled") {
    throw new Error("Cannot reactivate a fully canceled subscription. Please start a new one.");
  }

  const stripe = getStripe();
  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });

  const [updated] = await db
    .update(companySubscriptions)
    .set({ cancelAtPeriodEnd: false, canceledAt: null, updatedAt: new Date() })
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
      await upsertCompanySubSettings(companyId, { subscriptionEnabled: true });
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const companyId = await resolveCompanyId(subscription);
      if (companyId === null) return;
      await upsertSubscriptionFromStripe(companyId, subscription, event.id);
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object;
      if (!invoice.subscription) return;
      const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription.id;
      const sub = await findSubscriptionByStripeId(subId);
      if (sub) {
        console.log(JSON.stringify({
          event: "invoice_paid",
          companyId: sub.companyId,
          invoiceId: invoice.id,
        }));
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      console.warn(JSON.stringify({
        event: "invoice_payment_failed",
        invoiceId: invoice.id,
        subscription: invoice.subscription,
      }));
      break;
    }
  }
}

async function resolveCompanyId(subscription: any): Promise<number | null> {
  const fromMeta = parseInt(subscription.metadata?.ucm_company_id);
  if (!isNaN(fromMeta)) return fromMeta;

  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (!customerId) {
    console.error("[SUBSCRIPTION] Cannot resolve company: no metadata or customer", subscription.id);
    return null;
  }

  const [sc] = await db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.stripeCustomerId, customerId));
  if (!sc) {
    console.error("[SUBSCRIPTION] Cannot resolve company for customer", customerId);
    return null;
  }
  return sc.companyId;
}

async function findSubscriptionByStripeId(stripeSubId: string): Promise<CompanySubscription | null> {
  const [row] = await db
    .select()
    .from(companySubscriptions)
    .where(eq(companySubscriptions.stripeSubscriptionId, stripeSubId));
  return row || null;
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
  settings?: CompanySubscriptionSettings | null;
}> {
  const settings = await getCompanySubSettings(companyId);

  if (!settings || !settings.subscriptionEnabled || !settings.subscriptionRequiredForAccess) {
    return { allowed: true, settings };
  }

  const sub = await getCompanySubscription(companyId);
  if (isSubscriptionActive(sub)) {
    return { allowed: true, subscription: sub, settings };
  }

  if (sub && sub.status === "past_due") {
    return {
      allowed: false,
      reason: "subscription_past_due",
      subscription: sub,
      settings,
    };
  }

  return {
    allowed: false,
    reason: sub ? `subscription_${sub.status}` : "no_subscription",
    subscription: sub,
    settings,
  };
}

export async function getStripeSubscriptionCheck(companyId: number) {
  const [sc] = await db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.companyId, companyId));

  const sub = await getCompanySubscription(companyId);
  const settings = await getCompanySubSettings(companyId);
  const access = await checkCompanyAccess(companyId);

  return {
    customerExists: !!sc,
    stripeCustomerId: sc?.stripeCustomerId || null,
    subscriptionExists: !!sub,
    stripeSubscriptionId: sub?.stripeSubscriptionId || null,
    status: sub?.status || null,
    currentPeriodEnd: sub?.currentPeriodEnd || null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd || false,
    subscriptionEnabled: settings?.subscriptionEnabled ?? false,
    enforcementActive: !!(settings?.subscriptionEnabled && settings?.subscriptionRequiredForAccess),
    allowedAccess: access.allowed,
    accessReason: access.reason || null,
  };
}
