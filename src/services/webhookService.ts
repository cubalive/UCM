import { getDb, getPool } from "../db/index.js";
import { webhookEvents, invoices, ledgerEntries, users, tenants } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { getStripe } from "../lib/stripe.js";
import { recordPayment } from "./invoiceService.js";
import { recordAudit } from "./auditService.js";
import { sendPaymentConfirmedEmail, sendPaymentFailedEmail } from "./emailService.js";
import logger from "../lib/logger.js";
import Stripe from "stripe";

const MAX_RETRY_ATTEMPTS = 5;

export async function verifyAndStoreWebhook(
  rawBody: Buffer,
  signature: string
): Promise<{ event: Stripe.Event; isNew: boolean }> {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");

  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  const db = getDb();
  // Idempotency check
  const existing = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.stripeEventId, event.id));

  if (existing.length > 0) {
    logger.info("Duplicate webhook event received", { eventId: event.id, type: event.type });
    return { event, isNew: false };
  }

  await db.insert(webhookEvents).values({
    stripeEventId: event.id,
    eventType: event.type,
    status: "received",
    payload: event as unknown as Record<string, unknown>,
    attempts: 0,
  });

  return { event, isNew: true };
}

export async function processWebhookEvent(event: Stripe.Event): Promise<void> {
  const db = getDb();

  try {
    await db
      .update(webhookEvents)
      .set({ status: "processing", lastAttemptAt: new Date(), attempts: sql`${webhookEvents.attempts} + 1` })
      .where(eq(webhookEvents.stripeEventId, event.id));

    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event);
        break;
      case "invoice.paid":
        await handleStripeInvoicePaid(event);
        break;
      case "invoice.payment_failed":
        await handleStripeInvoicePaymentFailed(event);
        break;
      case "account.updated":
        await handleAccountUpdated(event);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChange(event);
        break;
      case "checkout.session.completed":
        await handleCheckoutCompleted(event);
        break;
      default:
        logger.info("Unhandled webhook event type", { type: event.type, eventId: event.id });
    }

    await db
      .update(webhookEvents)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(webhookEvents.stripeEventId, event.id));

    logger.info("Webhook event processed", { eventId: event.id, type: event.type });
  } catch (err: any) {
    logger.error("Webhook processing failed", { eventId: event.id, type: event.type, error: err.message });

    const [webhookRecord] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.stripeEventId, event.id));

    const attempts = webhookRecord?.attempts || 0;
    const shouldDeadLetter = attempts >= MAX_RETRY_ATTEMPTS;

    await db
      .update(webhookEvents)
      .set({
        status: shouldDeadLetter ? "dead_letter" : "failed",
        error: err.message,
        deadLetteredAt: shouldDeadLetter ? new Date() : undefined,
      })
      .where(eq(webhookEvents.stripeEventId, event.id));

    if (shouldDeadLetter) {
      logger.error("Webhook event moved to dead letter queue", { eventId: event.id, type: event.type, attempts });
    }

    throw err;
  }
}

async function handlePaymentIntentSucceeded(event: Stripe.Event): Promise<void> {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;
  const invoiceId = paymentIntent.metadata?.invoiceId;
  const tenantId = paymentIntent.metadata?.tenantId;

  if (!invoiceId || !tenantId) {
    logger.warn("Payment intent missing invoice/tenant metadata", { paymentIntentId: paymentIntent.id });
    return;
  }

  const amount = paymentIntent.amount / 100;
  await recordPayment(invoiceId, tenantId, amount, paymentIntent.id);

  // Send payment confirmation email (fire-and-forget)
  const invoiceNumber = paymentIntent.metadata?.invoiceNumber;
  const customerEmail = paymentIntent.receipt_email || paymentIntent.metadata?.customerEmail;
  if (customerEmail && invoiceNumber) {
    sendPaymentConfirmedEmail(customerEmail, invoiceNumber, amount.toFixed(2))
      .catch(err => logger.warn("Failed to send payment confirmation email", { error: err.message }));
  }
}

async function handlePaymentIntentFailed(event: Stripe.Event): Promise<void> {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;
  const invoiceId = paymentIntent.metadata?.invoiceId;
  const tenantId = paymentIntent.metadata?.tenantId;

  if (!invoiceId || !tenantId) return;

  await recordAudit({
    tenantId,
    action: "payment.failed",
    resource: "invoice",
    resourceId: invoiceId,
    details: {
      paymentIntentId: paymentIntent.id,
      error: paymentIntent.last_payment_error?.message,
    },
  });

  logger.warn("Payment failed", { invoiceId, paymentIntentId: paymentIntent.id });

  // Send payment failure email (fire-and-forget)
  const invoiceNumber = paymentIntent.metadata?.invoiceNumber;
  const customerEmail = paymentIntent.receipt_email || paymentIntent.metadata?.customerEmail;
  if (customerEmail && invoiceNumber) {
    sendPaymentFailedEmail(customerEmail, invoiceNumber, paymentIntent.last_payment_error?.message)
      .catch(err => logger.warn("Failed to send payment failure email", { error: err.message }));
  }
}

async function handleStripeInvoicePaid(event: Stripe.Event): Promise<void> {
  const stripeInvoice = event.data.object as Stripe.Invoice;
  const db = getDb();

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.stripeInvoiceId, stripeInvoice.id));

  if (!invoice) {
    logger.info("No matching invoice for Stripe invoice", { stripeInvoiceId: stripeInvoice.id });
    return;
  }

  const amount = (stripeInvoice.amount_paid || 0) / 100;
  await recordPayment(invoice.id, invoice.tenantId, amount, stripeInvoice.payment_intent as string);
}

async function handleStripeInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
  const stripeInvoice = event.data.object as Stripe.Invoice;
  const db = getDb();

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.stripeInvoiceId, stripeInvoice.id));

  if (!invoice) return;

  await db
    .update(invoices)
    .set({ status: "overdue", updatedAt: new Date() })
    .where(eq(invoices.id, invoice.id));

  await recordAudit({
    tenantId: invoice.tenantId,
    action: "payment.failed",
    resource: "invoice",
    resourceId: invoice.id,
    details: { stripeInvoiceId: stripeInvoice.id },
  });
}

async function handleAccountUpdated(event: Stripe.Event): Promise<void> {
  const account = event.data.object as Stripe.Account;
  const db = getDb();

  // Check if this is a driver's connected account
  const driverId = account.metadata?.driverId;
  if (driverId) {
    // Update the driver record with the latest onboarding status
    const kycStatus = account.requirements?.currently_due?.length
      ? "pending"
      : account.requirements?.past_due?.length
        ? "action_required"
        : "verified";

    await recordAudit({
      tenantId: account.metadata?.tenantId,
      action: "driver.stripe_account_updated",
      resource: "driver",
      resourceId: driverId,
      details: {
        stripeAccountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        kycStatus,
      },
    });

    logger.info("Driver Stripe account updated via webhook", {
      driverId,
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      kycStatus,
    });
  } else {
    // Platform/tenant account update
    logger.info("Stripe account updated", {
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
    });
  }
}

async function handleCheckoutCompleted(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const tenantId = session.metadata?.tenantId;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;

  logger.info("Checkout session completed", {
    sessionId: session.id,
    tenantId,
    customerId,
    mode: session.mode,
    paymentStatus: session.payment_status,
  });

  // If this is a subscription checkout, link the customer to the tenant
  if (session.mode === "subscription" && tenantId && customerId) {
    const db = getDb();
    await db
      .update(tenants)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(and(eq(tenants.id, tenantId), sql`${tenants.stripeCustomerId} IS NULL`));

    await recordAudit({
      tenantId,
      action: "stripe.checkout_completed",
      resource: "tenant",
      resourceId: tenantId,
      details: { sessionId: session.id, customerId, mode: session.mode },
    });
  }
}

async function handleSubscriptionChange(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer?.id;

  logger.info("Subscription change webhook received", {
    subscriptionId: subscription.id,
    status: subscription.status,
    type: event.type,
    customerId,
    metadataTenantId: subscription.metadata?.tenantId,
  });

  // Resolve tenant from subscription metadata or customer lookup
  const tenantId = subscription.metadata?.tenantId;
  if (!tenantId) {
    if (customerId) {
      const db = getDb();
      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.stripeCustomerId, customerId));

      if (tenant) {
        const { resolveStripeTier, handleSubscriptionUpdate } = await import("./subscriptionService.js");
        const tier = resolveStripeTier(subscription as any);
        const periodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : undefined;
        await handleSubscriptionUpdate(tenant.id, tier, subscription.status, periodEnd);
        return;
      }
    }

    logger.warn("Subscription webhook missing tenantId, skipping", {
      subscriptionId: subscription.id,
      customerId,
    });
    return;
  }

  const { resolveStripeTier, handleSubscriptionUpdate } = await import("./subscriptionService.js");
  const tier = resolveStripeTier(subscription as any);
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : undefined;

  await handleSubscriptionUpdate(tenantId, tier, subscription.status, periodEnd);
}

export async function replayWebhookEvent(webhookEventId: string): Promise<void> {
  const db = getDb();

  const [webhookRecord] = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.id, webhookEventId));

  if (!webhookRecord) throw new Error("Webhook event not found");
  if (webhookRecord.status === "processed") throw new Error("Event already processed");

  const event = webhookRecord.payload as unknown as Stripe.Event;

  // Reset attempts for replay
  await db
    .update(webhookEvents)
    .set({ status: "received", attempts: 0, error: null, deadLetteredAt: null })
    .where(eq(webhookEvents.id, webhookEventId));

  await processWebhookEvent(event);
}

export async function getWebhookDashboardData(limit: number = 50) {
  const db = getDb();

  const recentEvents = await db
    .select()
    .from(webhookEvents)
    .orderBy(sql`${webhookEvents.createdAt} DESC`)
    .limit(limit);

  const statusCounts = await db
    .select({
      status: webhookEvents.status,
      count: sql<number>`count(*)`,
    })
    .from(webhookEvents)
    .groupBy(webhookEvents.status);

  const typeCounts = await db
    .select({
      eventType: webhookEvents.eventType,
      count: sql<number>`count(*)`,
    })
    .from(webhookEvents)
    .groupBy(webhookEvents.eventType)
    .orderBy(sql`count(*) DESC`)
    .limit(20);

  const failedEvents = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.status, "failed"))
    .orderBy(sql`${webhookEvents.createdAt} DESC`)
    .limit(20);

  const deadLetterEvents = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.status, "dead_letter"))
    .orderBy(sql`${webhookEvents.createdAt} DESC`)
    .limit(20);

  return {
    recentEvents,
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, Number(s.count)])),
    typeCounts: Object.fromEntries(typeCounts.map((t) => [t.eventType, Number(t.count)])),
    failedEvents,
    deadLetterEvents,
  };
}
