import { getDb, getPool } from "../db/index.js";
import { invoices, invoiceLineItems, trips, billingCycles, ledgerEntries } from "../db/schema.js";
import { eq, and, between, sql } from "drizzle-orm";
import { calculateFees } from "./feeService.js";
import { recordAudit } from "./auditService.js";
import { getStripe } from "../lib/stripe.js";
import { withStripeProtection } from "../lib/circuitBreaker.js";
import logger from "../lib/logger.js";
import { v4 as uuidv4 } from "uuid";

export async function generateInvoiceNumber(tenantId: string): Promise<string> {
  const db = getDb();
  // Use MAX-based approach instead of COUNT to avoid gaps/duplicates from deleted invoices
  const result = await db
    .select({
      maxNum: sql<string>`max(${invoices.invoiceNumber})`,
    })
    .from(invoices)
    .where(eq(invoices.tenantId, tenantId));

  const maxInv = result[0]?.maxNum;
  let nextNum = 1;
  if (maxInv) {
    const match = maxInv.match(/INV-(\d+)/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `INV-${nextNum.toString().padStart(6, "0")}`;
}

export interface GenerateInvoiceInput {
  tenantId: string;
  patientId?: string;
  billingCycleId?: string;
  periodStart: Date;
  periodEnd: Date;
  userId?: string;
}

export async function generateInvoice(input: GenerateInvoiceInput) {
  const db = getDb();
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Get completed trips in billing period
    const tripsInPeriod = await db
      .select()
      .from(trips)
      .where(
        and(
          eq(trips.tenantId, input.tenantId),
          eq(trips.status, "completed"),
          between(trips.completedAt!, input.periodStart, input.periodEnd),
          input.patientId ? eq(trips.patientId, input.patientId) : undefined
        )
      );

    if (tripsInPeriod.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const invoiceNumber = await generateInvoiceNumber(input.tenantId);
    let totalAmount = 0;
    const lineItemsToInsert: Array<{
      invoiceId: string;
      tripId: string;
      feeRuleId?: string;
      description: string;
      quantity: string;
      unitPrice: string;
      amount: string;
    }> = [];

    const invoiceId = uuidv4();

    for (const trip of tripsInPeriod) {
      const fees = await calculateFees({
        tenantId: input.tenantId,
        tripId: trip.id,
        mileage: Number(trip.mileage || 0),
        scheduledAt: trip.scheduledAt,
        metadata: trip.metadata as Record<string, unknown>,
      });

      for (const item of fees.lineItems) {
        lineItemsToInsert.push({
          invoiceId,
          tripId: trip.id,
          feeRuleId: item.feeRuleId,
          description: item.description,
          quantity: "1",
          unitPrice: item.amount.toFixed(4),
          amount: item.amount.toFixed(2),
        });
        totalAmount += item.amount;
      }
    }

    totalAmount = Math.round(totalAmount * 100) / 100;

    const [invoice] = await db
      .insert(invoices)
      .values({
        id: invoiceId,
        tenantId: input.tenantId,
        invoiceNumber,
        patientId: input.patientId,
        status: "draft",
        subtotal: totalAmount.toFixed(2),
        tax: "0.00",
        total: totalAmount.toFixed(2),
        amountPaid: "0.00",
        billingPeriodStart: input.periodStart,
        billingPeriodEnd: input.periodEnd,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .returning();

    if (lineItemsToInsert.length > 0) {
      await db.insert(invoiceLineItems).values(lineItemsToInsert);
    }

    // Record ledger entry for the charge
    const idempotencyKey = `charge-${invoiceId}`;
    await db
      .insert(ledgerEntries)
      .values({
        tenantId: input.tenantId,
        invoiceId,
        type: "charge",
        amount: totalAmount.toFixed(2),
        description: `Invoice ${invoiceNumber} generated`,
        referenceId: invoiceId,
        referenceType: "invoice",
        idempotencyKey,
      })
      .onConflictDoNothing({ target: ledgerEntries.idempotencyKey });

    // Update billing cycle if provided
    if (input.billingCycleId) {
      await db
        .update(billingCycles)
        .set({ status: "invoiced", invoiceId, closedAt: new Date() })
        .where(eq(billingCycles.id, input.billingCycleId));
    }

    await client.query("COMMIT");

    await recordAudit({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "invoice.generated",
      resource: "invoice",
      resourceId: invoiceId,
      details: {
        invoiceNumber,
        total: totalAmount,
        lineItems: lineItemsToInsert.length,
        trips: tripsInPeriod.length,
      },
    });

    logger.info("Invoice generated", { invoiceId, invoiceNumber, total: totalAmount });
    return invoice;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function finalizeInvoice(invoiceId: string, tenantId: string) {
  const db = getDb();

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));

  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status !== "draft") throw new Error(`Cannot finalize invoice in status: ${invoice.status}`);

  const [updated] = await db
    .update(invoices)
    .set({ status: "pending", sentAt: new Date(), updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId))
    .returning();

  await recordAudit({
    tenantId,
    action: "invoice.finalized",
    resource: "invoice",
    resourceId: invoiceId,
  });

  return updated;
}

export async function recordPayment(
  invoiceId: string,
  tenantId: string,
  amount: number,
  stripePaymentIntentId?: string
) {
  const pool = getPool();
  const client = await pool.connect();
  const db = getDb();

  try {
    await client.query("BEGIN");

    const [invoice] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));

    if (!invoice) throw new Error("Invoice not found");

    const currentPaid = Number(invoice.amountPaid || 0);
    const newPaid = Math.round((currentPaid + amount) * 100) / 100;
    const total = Number(invoice.total);

    const newStatus = newPaid >= total ? "paid" : "partially_paid";

    await db
      .update(invoices)
      .set({
        amountPaid: newPaid.toFixed(2),
        status: newStatus,
        stripePaymentIntentId: stripePaymentIntentId || invoice.stripePaymentIntentId,
        paidAt: newPaid >= total ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId));

    // Idempotent ledger entry
    const idempotencyKey = `payment-${invoiceId}-${stripePaymentIntentId || uuidv4()}`;
    await db
      .insert(ledgerEntries)
      .values({
        tenantId,
        invoiceId,
        type: "payment",
        amount: amount.toFixed(2),
        description: `Payment received for invoice ${invoice.invoiceNumber}`,
        referenceId: stripePaymentIntentId,
        referenceType: "stripe_payment_intent",
        idempotencyKey,
      })
      .onConflictDoNothing({ target: ledgerEntries.idempotencyKey });

    await client.query("COMMIT");

    await recordAudit({
      tenantId,
      action: "payment.recorded",
      resource: "invoice",
      resourceId: invoiceId,
      details: { amount, newStatus, stripePaymentIntentId },
    });

    logger.info("Payment recorded", { invoiceId, amount, newStatus });
    return { invoiceId, amount, newStatus, newPaid };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function createStripePaymentIntent(invoiceId: string, tenantId: string) {
  const db = getDb();
  const stripe = getStripe();

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));

  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status === "paid") throw new Error("Invoice already paid");

  const remaining = Number(invoice.total) - Number(invoice.amountPaid || 0);
  if (remaining <= 0) throw new Error("No amount remaining");

  const paymentIntent = await withStripeProtection(() =>
    stripe.paymentIntents.create({
      amount: Math.round(remaining * 100),
      currency: invoice.currency,
      metadata: {
        invoiceId: invoice.id,
        tenantId,
        invoiceNumber: invoice.invoiceNumber,
      },
    })
  );

  await db
    .update(invoices)
    .set({
      stripePaymentIntentId: paymentIntent.id,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));

  return paymentIntent;
}
