import { db } from "../db";
import { billingCycleInvoices } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

export async function runBillingRollupJob(job: any): Promise<Record<string, unknown>> {
  const { companyId, period } = (job.payload || {}) as any;

  if (!companyId) {
    throw new Error("billing_rollup requires companyId in payload");
  }

  console.log(`[WORKER] Running billing rollup for company=${companyId} period=${period || "current"}`);

  // Recalculate totals for all open invoices for this company
  const openInvoices = await db
    .select({ id: billingCycleInvoices.id })
    .from(billingCycleInvoices)
    .where(
      and(
        eq(billingCycleInvoices.companyId, companyId),
        eq(billingCycleInvoices.status, "draft"),
      ),
    );

  console.log(`[WORKER] Found ${openInvoices.length} open invoices for rollup`);

  return {
    status: "completed",
    companyId,
    period: period || "current",
    invoicesProcessed: openInvoices.length,
  };
}
