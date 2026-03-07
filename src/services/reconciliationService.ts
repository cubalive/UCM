import { getDb } from "../db/index.js";
import { invoices, ledgerEntries, webhookEvents } from "../db/schema.js";
import { eq, and, sql, lt, ne } from "drizzle-orm";
import { getStripe } from "../lib/stripe.js";
import logger from "../lib/logger.js";

export interface ReconciliationResult {
  checkedAt: Date;
  stuckInvoices: StuckInvoice[];
  ledgerMismatches: LedgerMismatch[];
  unprocessedWebhooks: number;
  deadLetterCount: number;
  summary: string;
}

interface StuckInvoice {
  invoiceId: string;
  tenantId: string;
  invoiceNumber: string;
  status: string;
  total: string;
  amountPaid: string;
  stripePaymentIntentId: string | null;
  issue: string;
}

interface LedgerMismatch {
  invoiceId: string;
  invoiceNumber: string;
  invoiceTotal: string;
  ledgerChargeTotal: number;
  ledgerPaymentTotal: number;
  issue: string;
}

export async function runReconciliation(): Promise<ReconciliationResult> {
  const db = getDb();
  const checkedAt = new Date();

  // 1. Find stuck invoices — pending/sent for more than 48 hours
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const stuckInvoiceRows = await db
    .select()
    .from(invoices)
    .where(
      and(
        sql`${invoices.status} IN ('pending', 'sent')`,
        lt(invoices.updatedAt, cutoff)
      )
    );

  const stuckInvoices: StuckInvoice[] = [];

  for (const inv of stuckInvoiceRows) {
    let issue = "Invoice stuck in non-terminal state for >48h";

    // Check Stripe if we have a payment intent
    if (inv.stripePaymentIntentId) {
      try {
        const stripe = getStripe();
        const pi = await stripe.paymentIntents.retrieve(inv.stripePaymentIntentId);
        if (pi.status === "succeeded") {
          issue = "Stripe PaymentIntent succeeded but invoice not marked paid — needs manual reconciliation";
        } else if (pi.status === "canceled") {
          issue = "Stripe PaymentIntent canceled — invoice may need to be voided";
        }
      } catch (err: any) {
        issue = `Cannot verify Stripe status: ${err.message}`;
      }
    }

    stuckInvoices.push({
      invoiceId: inv.id,
      tenantId: inv.tenantId,
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      total: inv.total,
      amountPaid: inv.amountPaid || "0",
      stripePaymentIntentId: inv.stripePaymentIntentId,
      issue,
    });
  }

  // 2. Check ledger consistency — batch query instead of N+1
  const allPaidInvoices = await db
    .select()
    .from(invoices)
    .where(eq(invoices.status, "paid"));

  const ledgerMismatches: LedgerMismatch[] = [];

  if (allPaidInvoices.length > 0) {
    // Single query for all ledger entries related to paid invoices
    const paidInvoiceIds = allPaidInvoices.map(inv => inv.id);
    const allEntries = await db
      .select()
      .from(ledgerEntries)
      .where(sql`${ledgerEntries.invoiceId} = ANY(ARRAY[${sql.join(paidInvoiceIds.map(id => sql`${id}::uuid`), sql`, `)}])`);

    // Group entries by invoiceId
    const entriesByInvoice = new Map<string, typeof allEntries>();
    for (const entry of allEntries) {
      if (!entry.invoiceId) continue;
      if (!entriesByInvoice.has(entry.invoiceId)) entriesByInvoice.set(entry.invoiceId, []);
      entriesByInvoice.get(entry.invoiceId)!.push(entry);
    }

    for (const inv of allPaidInvoices) {
      const entries = entriesByInvoice.get(inv.id) || [];

      const chargeTotal = entries
        .filter((e) => e.type === "charge")
        .reduce((sum, e) => sum + Number(e.amount), 0);

      const paymentTotal = entries
        .filter((e) => e.type === "payment")
        .reduce((sum, e) => sum + Number(e.amount), 0);

      const invoiceTotal = Number(inv.total);

      if (Math.abs(chargeTotal - invoiceTotal) > 0.01) {
        ledgerMismatches.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceTotal: inv.total,
          ledgerChargeTotal: chargeTotal,
          ledgerPaymentTotal: paymentTotal,
          issue: `Ledger charge total ($${chargeTotal}) doesn't match invoice total ($${invoiceTotal})`,
        });
      }

      if (Math.abs(paymentTotal - invoiceTotal) > 0.01) {
        ledgerMismatches.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceTotal: inv.total,
          ledgerChargeTotal: chargeTotal,
          ledgerPaymentTotal: paymentTotal,
          issue: `Ledger payment total ($${paymentTotal}) doesn't match invoice total ($${invoiceTotal})`,
        });
      }
    }
  }

  // 3. Count unprocessed/dead-letter webhooks
  const [unprocessedResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(webhookEvents)
    .where(sql`${webhookEvents.status} IN ('received', 'failed')`);

  const [deadLetterResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(webhookEvents)
    .where(eq(webhookEvents.status, "dead_letter"));

  const unprocessedWebhooks = Number(unprocessedResult?.count || 0);
  const deadLetterCount = Number(deadLetterResult?.count || 0);

  const result: ReconciliationResult = {
    checkedAt,
    stuckInvoices,
    ledgerMismatches,
    unprocessedWebhooks,
    deadLetterCount,
    summary: [
      `Stuck invoices: ${stuckInvoices.length}`,
      `Ledger mismatches: ${ledgerMismatches.length}`,
      `Unprocessed webhooks: ${unprocessedWebhooks}`,
      `Dead letter webhooks: ${deadLetterCount}`,
    ].join(", "),
  };

  logger.info("Reconciliation complete", { summary: result.summary });
  return result;
}
