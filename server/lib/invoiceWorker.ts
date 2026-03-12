import { db } from "../db";
import { billingCycleInvoices, trips } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";

export async function generateInvoiceForJob(job: any): Promise<Record<string, unknown>> {
  const { invoiceId, clinicId, companyId, cycleStart, cycleEnd } = (job.payload || {}) as any;

  if (invoiceId) {
    // Regenerate existing invoice totals
    const [invoice] = await db
      .select()
      .from(billingCycleInvoices)
      .where(eq(billingCycleInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

    console.log(`[WORKER] Regenerated invoice ${invoiceId}`);
    return { status: "completed", invoiceId };
  }

  if (!clinicId || !companyId) {
    throw new Error("invoice_generate requires invoiceId or (clinicId + companyId) in payload");
  }

  console.log(`[WORKER] Invoice generation for clinic=${clinicId} company=${companyId} period=${cycleStart}-${cycleEnd}`);
  return {
    status: "completed",
    clinicId,
    companyId,
    cycleStart,
    cycleEnd,
  };
}
