import { db } from "../db";
import { billingCycleInvoices, trips, clinics, companies } from "@shared/schema";
import { eq, and, sql, isNull, between, gte, lte } from "drizzle-orm";

/**
 * Invoice Worker — generates billing cycle invoices from completed trips.
 *
 * Called by the job queue with either:
 *   1) { invoiceId }            → recalculate totals for an existing invoice
 *   2) { clinicId, companyId, cycleStart, cycleEnd } → generate a new invoice
 */
export async function generateInvoiceForJob(job: any): Promise<Record<string, unknown>> {
  const { invoiceId, clinicId, companyId, cycleStart, cycleEnd } = (job.payload || {}) as any;

  if (invoiceId) {
    return recalculateInvoice(invoiceId);
  }

  if (!clinicId || !companyId) {
    throw new Error("invoice_generate requires invoiceId or (clinicId + companyId) in payload");
  }

  return generateNewInvoice(clinicId, companyId, cycleStart, cycleEnd);
}

// ── Recalculate existing invoice from its linked trips ─────────────────────

async function recalculateInvoice(invoiceId: number) {
  const [invoice] = await db
    .select()
    .from(billingCycleInvoices)
    .where(eq(billingCycleInvoices.id, invoiceId))
    .limit(1);

  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  if (invoice.locked) throw new Error(`Invoice ${invoiceId} is locked and cannot be recalculated`);

  // Sum all billable trips linked to this invoice
  const result = await db
    .select({
      tripCount: sql<number>`count(*)`.as("tripCount"),
      totalCents: sql<number>`coalesce(sum(${trips.priceTotalCents}), 0)`.as("totalCents"),
    })
    .from(trips)
    .where(
      and(
        eq(trips.invoiceId, invoiceId),
        eq(trips.billable, true),
        isNull(trips.deletedAt),
      ),
    );

  const { tripCount, totalCents } = result[0] ?? { tripCount: 0, totalCents: 0 };
  const subtotalCents = Number(totalCents);

  // Platform fee calculation
  const platformFeeCents = invoice.platformFeeRate
    ? Math.round(subtotalCents * Number(invoice.platformFeeRate))
    : invoice.platformFeeCents ?? 0;

  const netTotal = subtotalCents + (invoice.taxCents ?? 0) + (invoice.feesCents ?? 0);
  const netToCompany = netTotal - platformFeeCents;

  await db
    .update(billingCycleInvoices)
    .set({
      subtotalCents,
      totalCents: netTotal,
      platformFeeCents,
      netToCompanyCents: netToCompany,
      balanceDueCents: netTotal - (invoice.amountPaidCents ?? 0),
    })
    .where(eq(billingCycleInvoices.id, invoiceId));

  console.log(
    `[WORKER] Recalculated invoice ${invoiceId}: ${tripCount} trips, $${(netTotal / 100).toFixed(2)}`,
  );

  return { status: "completed", invoiceId, tripCount, totalCents: netTotal };
}

// ── Generate a new invoice for a clinic/company billing period ──────────────

async function generateNewInvoice(
  clinicId: number,
  companyId: number,
  cycleStart: string,
  cycleEnd: string,
) {
  // Validate the clinic and company exist
  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);
  if (!clinic) throw new Error(`Clinic ${clinicId} not found`);

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw new Error(`Company ${companyId} not found`);

  // Find all billable, completed trips in the billing period not yet invoiced
  const billableTrips = await db
    .select({
      id: trips.id,
      priceTotalCents: trips.priceTotalCents,
    })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        eq(trips.clinicId, clinicId),
        eq(trips.billable, true),
        isNull(trips.invoiceId),
        isNull(trips.deletedAt),
        sql`${trips.status} IN ('COMPLETED', 'NO_SHOW')`,
        gte(trips.scheduledDate, cycleStart),
        lte(trips.scheduledDate, cycleEnd),
      ),
    );

  if (billableTrips.length === 0) {
    console.log(
      `[WORKER] No billable trips for clinic=${clinicId} company=${companyId} period=${cycleStart}-${cycleEnd}`,
    );
    return { status: "completed", tripCount: 0, message: "No billable trips found" };
  }

  // Calculate totals
  const subtotalCents = billableTrips.reduce(
    (sum, t) => sum + (t.priceTotalCents ?? 0),
    0,
  );

  // Generate invoice number: INV-{companyId}-{YYYYMMDD}-{random}
  const dateStr = cycleEnd.replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const invoiceNumber = `INV-${companyId}-${dateStr}-${rand}`;

  // Determine due date (net 30)
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  // Create the invoice record
  const [newInvoice] = await db
    .insert(billingCycleInvoices)
    .values({
      companyId,
      clinicId,
      periodStart: cycleStart,
      periodEnd: cycleEnd,
      status: "draft",
      currency: "USD",
      subtotalCents,
      taxCents: 0,
      feesCents: 0,
      totalCents: subtotalCents,
      balanceDueCents: subtotalCents,
      invoiceNumber,
      dueDate,
      notes: `Auto-generated for ${billableTrips.length} trips (${cycleStart} to ${cycleEnd})`,
    })
    .returning({ id: billingCycleInvoices.id });

  // Link all trips to this invoice
  const tripIds = billableTrips.map((t) => t.id);
  await db
    .update(trips)
    .set({ invoiceId: newInvoice.id })
    .where(sql`${trips.id} = ANY(ARRAY[${sql.raw(tripIds.join(","))}]::int[])`);

  console.log(
    `[WORKER] Generated invoice ${invoiceNumber} (id=${newInvoice.id}): ${billableTrips.length} trips, $${(subtotalCents / 100).toFixed(2)}`,
  );

  return {
    status: "completed",
    invoiceId: newInvoice.id,
    invoiceNumber,
    tripCount: billableTrips.length,
    totalCents: subtotalCents,
  };
}
