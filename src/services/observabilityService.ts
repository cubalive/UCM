import { getDb } from "../db/index.js";
import { invoices, ledgerEntries, webhookEvents, billingCycles } from "../db/schema.js";
import { sql, eq } from "drizzle-orm";
import logger from "../lib/logger.js";

export interface BillingReport {
  generatedAt: Date;
  invoices: {
    total: number;
    byStatus: Record<string, number>;
    totalRevenue: number;
    totalOutstanding: number;
  };
  ledger: {
    totalCharges: number;
    totalPayments: number;
    totalAdjustments: number;
    totalRefunds: number;
    netBalance: number;
  };
  billingCycles: {
    open: number;
    closed: number;
    invoiced: number;
  };
  webhooks: {
    total: number;
    processed: number;
    failed: number;
    deadLetter: number;
    processingRate: string;
  };
}

export async function generateBillingReport(tenantId?: string): Promise<BillingReport> {
  const db = getDb();
  const generatedAt = new Date();

  const tenantFilter = tenantId ? eq(invoices.tenantId, tenantId) : undefined;

  // Invoice stats
  const invoiceStats = await db
    .select({
      status: invoices.status,
      count: sql<number>`count(*)`,
      totalAmount: sql<number>`coalesce(sum(cast(${invoices.total} as numeric)), 0)`,
      totalPaid: sql<number>`coalesce(sum(cast(${invoices.amountPaid} as numeric)), 0)`,
    })
    .from(invoices)
    .where(tenantFilter)
    .groupBy(invoices.status);

  const byStatus: Record<string, number> = {};
  let totalRevenue = 0;
  let totalOutstanding = 0;
  let totalInvoices = 0;

  for (const stat of invoiceStats) {
    byStatus[stat.status] = Number(stat.count);
    totalInvoices += Number(stat.count);
    totalRevenue += Number(stat.totalPaid);
    if (stat.status !== "paid" && stat.status !== "void") {
      totalOutstanding += Number(stat.totalAmount) - Number(stat.totalPaid);
    }
  }

  // Ledger stats
  const ledgerStats = await db
    .select({
      type: ledgerEntries.type,
      total: sql<number>`coalesce(sum(cast(${ledgerEntries.amount} as numeric)), 0)`,
    })
    .from(ledgerEntries)
    .where(tenantId ? eq(ledgerEntries.tenantId, tenantId) : undefined)
    .groupBy(ledgerEntries.type);

  const ledgerByType: Record<string, number> = {};
  for (const entry of ledgerStats) {
    ledgerByType[entry.type] = Number(entry.total);
  }

  // Billing cycle stats
  const cycleStats = await db
    .select({
      status: billingCycles.status,
      count: sql<number>`count(*)`,
    })
    .from(billingCycles)
    .where(tenantId ? eq(billingCycles.tenantId, tenantId) : undefined)
    .groupBy(billingCycles.status);

  const cyclesByStatus: Record<string, number> = {};
  for (const stat of cycleStats) {
    cyclesByStatus[stat.status] = Number(stat.count);
  }

  // Webhook stats
  const webhookStats = await db
    .select({
      status: webhookEvents.status,
      count: sql<number>`count(*)`,
    })
    .from(webhookEvents)
    .groupBy(webhookEvents.status);

  let webhookTotal = 0;
  let webhookProcessed = 0;
  let webhookFailed = 0;
  let webhookDeadLetter = 0;

  for (const stat of webhookStats) {
    const count = Number(stat.count);
    webhookTotal += count;
    if (stat.status === "processed") webhookProcessed = count;
    if (stat.status === "failed") webhookFailed = count;
    if (stat.status === "dead_letter") webhookDeadLetter = count;
  }

  const processingRate = webhookTotal > 0
    ? ((webhookProcessed / webhookTotal) * 100).toFixed(1) + "%"
    : "N/A";

  return {
    generatedAt,
    invoices: {
      total: totalInvoices,
      byStatus,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    },
    ledger: {
      totalCharges: ledgerByType.charge || 0,
      totalPayments: ledgerByType.payment || 0,
      totalAdjustments: ledgerByType.adjustment || 0,
      totalRefunds: ledgerByType.refund || 0,
      netBalance: (ledgerByType.charge || 0) - (ledgerByType.payment || 0) - (ledgerByType.refund || 0),
    },
    billingCycles: {
      open: cyclesByStatus.open || 0,
      closed: cyclesByStatus.closed || 0,
      invoiced: cyclesByStatus.invoiced || 0,
    },
    webhooks: {
      total: webhookTotal,
      processed: webhookProcessed,
      failed: webhookFailed,
      deadLetter: webhookDeadLetter,
      processingRate,
    },
  };
}
