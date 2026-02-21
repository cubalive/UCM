import { db } from "../db";
import { billingCycleInvoices, billingAuditEvents, clinics } from "@shared/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { writeBillingAudit } from "./billingAuditService";
import { storage } from "../storage";

function getStripe() {
  const Stripe = require("stripe").default;
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_INTERVALS_DAYS = [3, 7, 14];

async function getDunningRetryCount(invoiceId: number): Promise<{ retryCount: number; lastRetryAt: Date | null }> {
  const events = await db.select({
    createdAt: billingAuditEvents.createdAt,
  }).from(billingAuditEvents)
    .where(and(
      eq(billingAuditEvents.entityType, "invoice"),
      eq(billingAuditEvents.entityId, String(invoiceId)),
      inArray(billingAuditEvents.action, ["dunning_payment_succeeded", "dunning_payment_failed"]),
    ))
    .orderBy(desc(billingAuditEvents.createdAt))
    .limit(MAX_RETRY_ATTEMPTS + 1);

  return {
    retryCount: events.length,
    lastRetryAt: events.length > 0 ? events[0].createdAt : null,
  };
}

export async function runDunningCycle(): Promise<{ attempted: number; succeeded: number; failed: number }> {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log("[Dunning] Stripe not configured, skipping");
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const overdueInvoices = await db.select().from(billingCycleInvoices)
    .where(
      inArray(billingCycleInvoices.paymentStatus, ["overdue", "unpaid", "partial"]),
    )
    .limit(50);

  const now = new Date();
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const invoice of overdueInvoices) {
    if ((invoice.balanceDueCents || 0) <= 0) continue;

    const dunning = await getDunningRetryCount(invoice.id);
    if (dunning.retryCount >= MAX_RETRY_ATTEMPTS) continue;

    if (dunning.lastRetryAt) {
      const retryIntervalDays = RETRY_INTERVALS_DAYS[Math.min(dunning.retryCount, RETRY_INTERVALS_DAYS.length - 1)];
      const nextRetryDate = new Date(dunning.lastRetryAt);
      nextRetryDate.setDate(nextRetryDate.getDate() + retryIntervalDays);
      if (now < nextRetryDate) continue;
    }

    const [clinic] = await db.select().from(clinics).where(eq(clinics.id, invoice.clinicId));
    if (!clinic?.stripeCustomerId || !clinic?.stripeDefaultPaymentMethodId) {
      continue;
    }

    if (!invoice.companyId) continue;
    const stripeAccount = await storage.getCompanyStripeAccount(invoice.companyId);
    if (!stripeAccount?.stripeAccountId || stripeAccount.onboardingStatus !== "ACTIVE") continue;

    attempted++;
    const stripe = getStripe();
    const newRetryCount = dunning.retryCount + 1;

    try {
      const { getEffectivePlatformFee, computeApplicationFee } = await import("./platformFee");
      const effectiveFee = await getEffectivePlatformFee(invoice.companyId);
      const applicationFeeAmount = effectiveFee.enabled ? computeApplicationFee(invoice.balanceDueCents || 0, effectiveFee) : 0;

      const idempotencyKey = `dunning_${invoice.id}_${newRetryCount}`;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: invoice.balanceDueCents || 0,
        currency: invoice.currency?.toLowerCase() || "usd",
        customer: clinic.stripeCustomerId,
        payment_method: clinic.stripeDefaultPaymentMethodId,
        off_session: true,
        confirm: true,
        transfer_data: {
          destination: stripeAccount.stripeAccountId,
        },
        application_fee_amount: applicationFeeAmount,
        metadata: {
          billing_cycle_invoice_id: String(invoice.id),
          company_id: String(invoice.companyId),
          clinic_id: String(invoice.clinicId),
          type: "billing_cycle_invoice",
          dunning_retry: String(newRetryCount),
        },
      }, { idempotencyKey });

      if (paymentIntent.status === "succeeded") {
        await db.update(billingCycleInvoices).set({
          paymentStatus: "paid",
          amountPaidCents: invoice.totalCents,
          balanceDueCents: 0,
          lastPaymentAt: new Date(),
          locked: true,
          stripePaymentIntentId: paymentIntent.id,
          platformFeeCents: applicationFeeAmount,
          netToCompanyCents: (invoice.balanceDueCents || 0) - applicationFeeAmount,
          updatedAt: new Date(),
        }).where(eq(billingCycleInvoices.id, invoice.id));

        try {
          const { writePaymentSucceededJournal } = await import("./ledgerService");
          await writePaymentSucceededJournal({
            paymentIntentId: paymentIntent.id,
            invoiceId: invoice.id,
            clinicId: invoice.clinicId,
            companyId: invoice.companyId,
            totalCents: invoice.balanceDueCents || 0,
            platformFeeCents: applicationFeeAmount,
          });
        } catch {}

        await writeBillingAudit({
          action: "dunning_payment_succeeded",
          entityType: "invoice",
          entityId: invoice.id,
          scopeClinicId: invoice.clinicId,
          scopeCompanyId: invoice.companyId,
          details: { retryCount: newRetryCount, paymentIntentId: paymentIntent.id, amountCents: invoice.balanceDueCents },
        });

        succeeded++;
        console.log(`[Dunning] Invoice ${invoice.id} paid on retry ${newRetryCount}`);
      } else {
        await writeBillingAudit({
          action: "dunning_payment_failed",
          entityType: "invoice",
          entityId: invoice.id,
          scopeClinicId: invoice.clinicId,
          scopeCompanyId: invoice.companyId,
          details: { retryCount: newRetryCount, status: paymentIntent.status },
        });

        failed++;
      }
    } catch (err: any) {
      console.warn(`[Dunning] Invoice ${invoice.id} retry ${newRetryCount} failed:`, err.message);

      await db.update(billingCycleInvoices).set({
        paymentStatus: "overdue",
        updatedAt: new Date(),
      }).where(eq(billingCycleInvoices.id, invoice.id));

      await writeBillingAudit({
        action: "dunning_payment_failed",
        entityType: "invoice",
        entityId: invoice.id,
        scopeClinicId: invoice.clinicId,
        scopeCompanyId: invoice.companyId,
        details: { retryCount: newRetryCount, error: err.message },
      });

      failed++;
    }
  }

  console.log(`[Dunning] Cycle complete: attempted=${attempted} succeeded=${succeeded} failed=${failed}`);
  return { attempted, succeeded, failed };
}
