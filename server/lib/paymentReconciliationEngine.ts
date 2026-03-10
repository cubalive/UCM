import { db } from "../db";
import {
  billingCycleInvoices,
  invoicePayments,
  clinics,
  paymentReconciliationRuns,
  paymentReconciliationItems,
  paymentReconciliationWriteOffs,
} from "@shared/schema";
import { eq, and, gte, lte, sql, isNull, inArray } from "drizzle-orm";

/**
 * Payment Reconciliation Engine
 * Matches invoices to payments, identifies discrepancies, tracks aging
 */

function calculateAgingBucket(dueDateStr: string | null, now: Date): { agingDays: number; agingBucket: string } {
  if (!dueDateStr) return { agingDays: 0, agingBucket: "current" };
  const dueDate = new Date(dueDateStr);
  const diffMs = now.getTime() - dueDate.getTime();
  const agingDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  let agingBucket = "current";
  if (agingDays > 120) agingBucket = "120+";
  else if (agingDays > 90) agingBucket = "90";
  else if (agingDays > 60) agingBucket = "60";
  else if (agingDays > 30) agingBucket = "30";
  return { agingDays, agingBucket };
}

export async function runReconciliation(companyId: number, periodStart: string, periodEnd: string, runByUserId?: number) {
  // Create a reconciliation run
  const [run] = await db.insert(paymentReconciliationRuns).values({
    companyId,
    periodStart,
    periodEnd,
    status: "running",
    runBy: runByUserId ?? null,
  }).returning();

  try {
    // Get all invoices in the period
    const invoices = await db.select()
      .from(billingCycleInvoices)
      .where(
        and(
          eq(billingCycleInvoices.companyId, companyId),
          gte(billingCycleInvoices.periodStart, periodStart),
          lte(billingCycleInvoices.periodEnd, periodEnd),
          inArray(billingCycleInvoices.status, ["finalized", "draft"]),
        )
      );

    const now = new Date();
    let matchedCount = 0;
    let partialCount = 0;
    let unmatchedCount = 0;
    let overpaidCount = 0;
    let totalInvoicedCents = 0;
    let totalCollectedCents = 0;

    for (const invoice of invoices) {
      // Get payments for this invoice
      const payments = await db.select()
        .from(invoicePayments)
        .where(eq(invoicePayments.invoiceId, invoice.id));

      const invoiceAmountCents = invoice.totalCents || 0;
      const paidAmountCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
      const outstandingCents = Math.max(0, invoiceAmountCents - paidAmountCents);
      const overpaidCents = Math.max(0, paidAmountCents - invoiceAmountCents);

      totalInvoicedCents += invoiceAmountCents;
      totalCollectedCents += Math.min(paidAmountCents, invoiceAmountCents);

      let status: "matched" | "partial" | "unmatched" | "overpaid" = "unmatched";
      if (paidAmountCents >= invoiceAmountCents && invoiceAmountCents > 0) {
        if (paidAmountCents > invoiceAmountCents) {
          status = "overpaid";
          overpaidCount++;
        } else {
          status = "matched";
          matchedCount++;
        }
      } else if (paidAmountCents > 0) {
        status = "partial";
        partialCount++;
      } else {
        unmatchedCount++;
      }

      const dueDate = invoice.dueDate ? invoice.dueDate.toISOString().split("T")[0] : null;
      const { agingDays, agingBucket } = calculateAgingBucket(dueDate, now);

      const paymentRefs = payments.map(p => ({
        paymentId: p.id,
        amountCents: p.amountCents,
        method: p.method,
        date: p.paidAt?.toISOString().split("T")[0] || null,
        reference: p.reference,
      }));

      await db.insert(paymentReconciliationItems).values({
        runId: run.id,
        companyId,
        clinicId: invoice.clinicId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceAmountCents,
        paidAmountCents,
        outstandingCents,
        overpaidCents,
        status,
        paymentRefs,
        agingDays,
        agingBucket,
      });
    }

    const totalOutstandingCents = totalInvoicedCents - totalCollectedCents;
    const totalOverpaidCents = invoices.reduce((sum, inv) => {
      const payments_total = 0; // already calculated per-item
      return sum;
    }, 0);

    // Update run with results
    await db.update(paymentReconciliationRuns)
      .set({
        status: "completed",
        totalInvoices: invoices.length,
        matchedCount,
        partialCount,
        unmatchedCount,
        overpaidCount,
        totalInvoicedCents,
        totalCollectedCents,
        totalOutstandingCents,
        totalOverpaidCents: 0,
        completedAt: new Date(),
      })
      .where(eq(paymentReconciliationRuns.id, run.id));

    console.log(`[RECONCILIATION] Run ${run.id}: ${invoices.length} invoices, matched=${matchedCount}, partial=${partialCount}, unmatched=${unmatchedCount}`);
    return {
      runId: run.id,
      totalInvoices: invoices.length,
      matchedCount,
      partialCount,
      unmatchedCount,
      overpaidCount,
      totalInvoicedCents,
      totalCollectedCents,
      totalOutstandingCents,
    };
  } catch (err: any) {
    await db.update(paymentReconciliationRuns)
      .set({ status: "failed" })
      .where(eq(paymentReconciliationRuns.id, run.id));
    throw err;
  }
}

export async function getReconciliationRuns(companyId: number, limit = 20) {
  return db.select()
    .from(paymentReconciliationRuns)
    .where(eq(paymentReconciliationRuns.companyId, companyId))
    .orderBy(sql`${paymentReconciliationRuns.createdAt} DESC`)
    .limit(limit);
}

export async function getReconciliationRunDetails(runId: number) {
  const [run] = await db.select()
    .from(paymentReconciliationRuns)
    .where(eq(paymentReconciliationRuns.id, runId));

  if (!run) return null;

  const items = await db.select()
    .from(paymentReconciliationItems)
    .where(eq(paymentReconciliationItems.runId, runId))
    .orderBy(sql`${paymentReconciliationItems.outstandingCents} DESC`);

  return { run, items };
}

export async function getAgingReport(companyId: number) {
  // Get the latest completed run
  const [latestRun] = await db.select()
    .from(paymentReconciliationRuns)
    .where(and(
      eq(paymentReconciliationRuns.companyId, companyId),
      eq(paymentReconciliationRuns.status, "completed"),
    ))
    .orderBy(sql`${paymentReconciliationRuns.createdAt} DESC`)
    .limit(1);

  if (!latestRun) return null;

  const items = await db.select()
    .from(paymentReconciliationItems)
    .where(eq(paymentReconciliationItems.runId, latestRun.id));

  const buckets: Record<string, { count: number; outstandingCents: number; invoicedCents: number }> = {
    current: { count: 0, outstandingCents: 0, invoicedCents: 0 },
    "30": { count: 0, outstandingCents: 0, invoicedCents: 0 },
    "60": { count: 0, outstandingCents: 0, invoicedCents: 0 },
    "90": { count: 0, outstandingCents: 0, invoicedCents: 0 },
    "120+": { count: 0, outstandingCents: 0, invoicedCents: 0 },
  };

  for (const item of items) {
    if (item.outstandingCents > 0) {
      const bucket = buckets[item.agingBucket] || buckets["current"];
      bucket.count++;
      bucket.outstandingCents += item.outstandingCents;
      bucket.invoicedCents += item.invoiceAmountCents;
    }
  }

  // Clinic-level breakdown
  const clinicBreakdown: Record<number, { clinicId: number; totalOutstanding: number; totalInvoiced: number; oldestDays: number }> = {};
  for (const item of items) {
    if (item.clinicId && item.outstandingCents > 0) {
      if (!clinicBreakdown[item.clinicId]) {
        clinicBreakdown[item.clinicId] = { clinicId: item.clinicId, totalOutstanding: 0, totalInvoiced: 0, oldestDays: 0 };
      }
      clinicBreakdown[item.clinicId].totalOutstanding += item.outstandingCents;
      clinicBreakdown[item.clinicId].totalInvoiced += item.invoiceAmountCents;
      clinicBreakdown[item.clinicId].oldestDays = Math.max(clinicBreakdown[item.clinicId].oldestDays, item.agingDays);
    }
  }

  return {
    runId: latestRun.id,
    runDate: latestRun.createdAt,
    period: { start: latestRun.periodStart, end: latestRun.periodEnd },
    buckets,
    clinicBreakdown: Object.values(clinicBreakdown).sort((a, b) => b.totalOutstanding - a.totalOutstanding),
    totals: {
      invoiced: latestRun.totalInvoicedCents,
      collected: latestRun.totalCollectedCents,
      outstanding: latestRun.totalOutstandingCents,
      collectionRate: latestRun.totalInvoicedCents > 0
        ? Math.round((latestRun.totalCollectedCents / latestRun.totalInvoicedCents) * 10000) / 100
        : 100,
    },
  };
}

export async function writeOffItem(
  reconciliationItemId: number,
  reason: string,
  approvedByUserId: number,
) {
  const [item] = await db.select()
    .from(paymentReconciliationItems)
    .where(eq(paymentReconciliationItems.id, reconciliationItemId));

  if (!item || item.outstandingCents <= 0) {
    throw new Error("Item not found or has no outstanding balance");
  }

  await db.insert(paymentReconciliationWriteOffs).values({
    companyId: item.companyId,
    clinicId: item.clinicId,
    invoiceId: item.invoiceId,
    reconciliationItemId: item.id,
    amountCents: item.outstandingCents,
    reason,
    approvedBy: approvedByUserId,
  });

  await db.update(paymentReconciliationItems)
    .set({
      status: "written_off",
      notes: `Written off: ${reason}`,
      resolvedBy: approvedByUserId,
      resolvedAt: new Date(),
    })
    .where(eq(paymentReconciliationItems.id, reconciliationItemId));

  return { amountWrittenOff: item.outstandingCents };
}

export async function getReconciliationDashboard(companyId: number) {
  // Get latest run
  const agingReport = await getAgingReport(companyId);

  // Get write-offs total
  const writeOffs = await db.select({
    total: sql<number>`COALESCE(SUM(${paymentReconciliationWriteOffs.amountCents}), 0)`,
    count: sql<number>`COUNT(*)`,
  })
    .from(paymentReconciliationWriteOffs)
    .where(eq(paymentReconciliationWriteOffs.companyId, companyId));

  // Get recent runs
  const recentRuns = await getReconciliationRuns(companyId, 5);

  return {
    aging: agingReport,
    writeOffs: {
      totalCents: Number(writeOffs[0]?.total || 0),
      count: Number(writeOffs[0]?.count || 0),
    },
    recentRuns,
  };
}

export async function getClinicReconciliation(companyId: number, clinicId: number) {
  // Get all reconciliation items for this clinic from latest run
  const [latestRun] = await db.select()
    .from(paymentReconciliationRuns)
    .where(and(
      eq(paymentReconciliationRuns.companyId, companyId),
      eq(paymentReconciliationRuns.status, "completed"),
    ))
    .orderBy(sql`${paymentReconciliationRuns.createdAt} DESC`)
    .limit(1);

  if (!latestRun) return { items: [], summary: null };

  const items = await db.select()
    .from(paymentReconciliationItems)
    .where(and(
      eq(paymentReconciliationItems.runId, latestRun.id),
      eq(paymentReconciliationItems.clinicId, clinicId),
    ))
    .orderBy(sql`${paymentReconciliationItems.agingDays} DESC`);

  const summary = {
    totalInvoiced: items.reduce((s, i) => s + i.invoiceAmountCents, 0),
    totalPaid: items.reduce((s, i) => s + i.paidAmountCents, 0),
    totalOutstanding: items.reduce((s, i) => s + i.outstandingCents, 0),
    matched: items.filter(i => i.status === "matched").length,
    partial: items.filter(i => i.status === "partial").length,
    unmatched: items.filter(i => i.status === "unmatched").length,
  };

  return { items, summary };
}
