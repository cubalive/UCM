/**
 * Financial Reporting Controller
 *
 * Provides comprehensive financial reporting endpoints:
 * - Revenue dashboard (company-level P&L)
 * - AR aging report
 * - Clinic-level billing summary
 * - Trip revenue breakdown
 * - Platform fee summary
 */
import { type Response } from "express";
import { type AuthRequest, getCompanyIdFromAuth } from "../auth";
import { db } from "../db";
import {
  billingCycleInvoices,
  tripBilling,
  financialLedger,
  clinics,
  trips,
} from "@shared/schema";
import { eq, and, gte, lte, sql, desc, inArray } from "drizzle-orm";

function requireCompany(req: AuthRequest, res: Response): number | null {
  const cid = getCompanyIdFromAuth(req);
  if (!cid) {
    res.status(403).json({ message: "Company context required" });
    return null;
  }
  return cid;
}

/**
 * GET /api/finance/reporting/revenue
 * Revenue dashboard with P&L summary
 */
export async function revenueReportHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;

    const from = (req.query.from as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);

    // Total revenue from completed trips
    const [tripRevenue] = await db
      .select({
        totalCents: sql<number>`COALESCE(SUM(${tripBilling.totalCents}), 0)::int`,
        tripCount: sql<number>`count(*)::int`,
        avgPerTrip: sql<number>`COALESCE(AVG(${tripBilling.totalCents}), 0)::int`,
      })
      .from(tripBilling)
      .where(
        and(
          eq(tripBilling.companyId, companyId),
          gte(tripBilling.serviceDate, from),
          lte(tripBilling.serviceDate, to)
        )
      );

    // Invoice summary
    const [invoiceSummary] = await db
      .select({
        totalInvoiced: sql<number>`COALESCE(SUM(${billingCycleInvoices.totalCents}), 0)::int`,
        totalPaid: sql<number>`COALESCE(SUM(CASE WHEN ${billingCycleInvoices.paymentStatus} = 'paid' THEN ${billingCycleInvoices.totalCents} ELSE 0 END), 0)::int`,
        totalUnpaid: sql<number>`COALESCE(SUM(CASE WHEN ${billingCycleInvoices.paymentStatus} IN ('unpaid', 'partial', 'overdue') THEN ${billingCycleInvoices.balanceDueCents} ELSE 0 END), 0)::int`,
        invoiceCount: sql<number>`count(*)::int`,
        paidCount: sql<number>`COALESCE(SUM(CASE WHEN ${billingCycleInvoices.paymentStatus} = 'paid' THEN 1 ELSE 0 END), 0)::int`,
      })
      .from(billingCycleInvoices)
      .where(
        and(
          eq(billingCycleInvoices.companyId, companyId),
          gte(billingCycleInvoices.periodStart, from),
          lte(billingCycleInvoices.periodEnd, to),
          sql`${billingCycleInvoices.status} != 'void'`
        )
      );

    // Platform fees paid
    const [platformFees] = await db
      .select({
        totalFeesCents: sql<number>`COALESCE(SUM(${billingCycleInvoices.platformFeeCents}), 0)::int`,
        totalNetCents: sql<number>`COALESCE(SUM(${billingCycleInvoices.netToCompanyCents}), 0)::int`,
      })
      .from(billingCycleInvoices)
      .where(
        and(
          eq(billingCycleInvoices.companyId, companyId),
          eq(billingCycleInvoices.paymentStatus, "paid"),
          gte(billingCycleInvoices.periodStart, from),
          lte(billingCycleInvoices.periodEnd, to)
        )
      );

    // Revenue by service type
    const revenueByService = await db
      .select({
        statusAtBill: tripBilling.statusAtBill,
        totalCents: sql<number>`COALESCE(SUM(${tripBilling.totalCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(tripBilling)
      .where(
        and(
          eq(tripBilling.companyId, companyId),
          gte(tripBilling.serviceDate, from),
          lte(tripBilling.serviceDate, to)
        )
      )
      .groupBy(tripBilling.statusAtBill);

    // Daily revenue trend
    const dailyRevenue = await db
      .select({
        date: tripBilling.serviceDate,
        totalCents: sql<number>`COALESCE(SUM(${tripBilling.totalCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(tripBilling)
      .where(
        and(
          eq(tripBilling.companyId, companyId),
          gte(tripBilling.serviceDate, from),
          lte(tripBilling.serviceDate, to)
        )
      )
      .groupBy(tripBilling.serviceDate)
      .orderBy(tripBilling.serviceDate);

    res.json({
      period: { from, to },
      revenue: {
        totalCents: tripRevenue?.totalCents || 0,
        tripCount: tripRevenue?.tripCount || 0,
        avgPerTripCents: tripRevenue?.avgPerTrip || 0,
      },
      invoices: {
        totalInvoiced: invoiceSummary?.totalInvoiced || 0,
        totalPaid: invoiceSummary?.totalPaid || 0,
        totalUnpaid: invoiceSummary?.totalUnpaid || 0,
        invoiceCount: invoiceSummary?.invoiceCount || 0,
        paidCount: invoiceSummary?.paidCount || 0,
        collectionRate: invoiceSummary?.invoiceCount
          ? Math.round(((invoiceSummary?.paidCount || 0) / invoiceSummary.invoiceCount) * 100)
          : 0,
      },
      platformFees: {
        totalFeesCents: platformFees?.totalFeesCents || 0,
        netRevenueCents: platformFees?.totalNetCents || 0,
      },
      revenueByStatus: revenueByService,
      dailyTrend: dailyRevenue,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

/**
 * GET /api/finance/reporting/ar-aging
 * Accounts Receivable aging buckets
 */
export async function arAgingReportHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;

    const now = new Date();

    // Get all unpaid/overdue invoices
    const unpaidInvoices = await db
      .select({
        id: billingCycleInvoices.id,
        clinicId: billingCycleInvoices.clinicId,
        invoiceNumber: billingCycleInvoices.invoiceNumber,
        totalCents: billingCycleInvoices.totalCents,
        balanceDueCents: billingCycleInvoices.balanceDueCents,
        dueDate: billingCycleInvoices.dueDate,
        paymentStatus: billingCycleInvoices.paymentStatus,
        periodStart: billingCycleInvoices.periodStart,
        periodEnd: billingCycleInvoices.periodEnd,
      })
      .from(billingCycleInvoices)
      .where(
        and(
          eq(billingCycleInvoices.companyId, companyId),
          inArray(billingCycleInvoices.paymentStatus, ["unpaid", "partial", "overdue"]),
          sql`${billingCycleInvoices.status} != 'void'`
        )
      )
      .orderBy(billingCycleInvoices.dueDate);

    const buckets = {
      current: { count: 0, totalCents: 0, invoices: [] as any[] },
      days_1_30: { count: 0, totalCents: 0, invoices: [] as any[] },
      days_31_60: { count: 0, totalCents: 0, invoices: [] as any[] },
      days_61_90: { count: 0, totalCents: 0, invoices: [] as any[] },
      days_90_plus: { count: 0, totalCents: 0, invoices: [] as any[] },
    };

    // Get clinic names
    const clinicMap = new Map<number, string>();
    const clinicIds = [...new Set(unpaidInvoices.map((i) => i.clinicId))];
    if (clinicIds.length > 0) {
      const clinicRows = await db
        .select({ id: clinics.id, name: clinics.name })
        .from(clinics)
        .where(inArray(clinics.id, clinicIds));
      for (const c of clinicRows) clinicMap.set(c.id, c.name);
    }

    for (const invoice of unpaidInvoices) {
      const balanceCents = invoice.balanceDueCents || invoice.totalCents;
      if (balanceCents <= 0) continue;

      const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : now;
      const daysPastDue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));

      const entry = {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        clinicId: invoice.clinicId,
        clinicName: clinicMap.get(invoice.clinicId) || "Unknown",
        balanceCents,
        daysPastDue,
        dueDate: dueDate.toISOString().slice(0, 10),
        period: `${invoice.periodStart} - ${invoice.periodEnd}`,
      };

      if (daysPastDue <= 0) {
        buckets.current.count++;
        buckets.current.totalCents += balanceCents;
        buckets.current.invoices.push(entry);
      } else if (daysPastDue <= 30) {
        buckets.days_1_30.count++;
        buckets.days_1_30.totalCents += balanceCents;
        buckets.days_1_30.invoices.push(entry);
      } else if (daysPastDue <= 60) {
        buckets.days_31_60.count++;
        buckets.days_31_60.totalCents += balanceCents;
        buckets.days_31_60.invoices.push(entry);
      } else if (daysPastDue <= 90) {
        buckets.days_61_90.count++;
        buckets.days_61_90.totalCents += balanceCents;
        buckets.days_61_90.invoices.push(entry);
      } else {
        buckets.days_90_plus.count++;
        buckets.days_90_plus.totalCents += balanceCents;
        buckets.days_90_plus.invoices.push(entry);
      }
    }

    const totalOutstanding = Object.values(buckets).reduce((s, b) => s + b.totalCents, 0);
    const totalInvoices = Object.values(buckets).reduce((s, b) => s + b.count, 0);

    res.json({
      summary: { totalOutstandingCents: totalOutstanding, totalInvoices },
      buckets,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

/**
 * GET /api/finance/reporting/clinic-summary
 * Per-clinic billing summary
 */
export async function clinicBillingSummaryHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;

    const from = (req.query.from as string) || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);

    const clinicSummary = await db
      .select({
        clinicId: billingCycleInvoices.clinicId,
        totalInvoiced: sql<number>`COALESCE(SUM(${billingCycleInvoices.totalCents}), 0)::int`,
        totalPaid: sql<number>`COALESCE(SUM(CASE WHEN ${billingCycleInvoices.paymentStatus} = 'paid' THEN ${billingCycleInvoices.totalCents} ELSE 0 END), 0)::int`,
        totalOutstanding: sql<number>`COALESCE(SUM(CASE WHEN ${billingCycleInvoices.paymentStatus} IN ('unpaid', 'partial', 'overdue') THEN COALESCE(${billingCycleInvoices.balanceDueCents}, ${billingCycleInvoices.totalCents}) ELSE 0 END), 0)::int`,
        invoiceCount: sql<number>`count(*)::int`,
        paidCount: sql<number>`COALESCE(SUM(CASE WHEN ${billingCycleInvoices.paymentStatus} = 'paid' THEN 1 ELSE 0 END), 0)::int`,
        overdueCount: sql<number>`COALESCE(SUM(CASE WHEN ${billingCycleInvoices.paymentStatus} = 'overdue' THEN 1 ELSE 0 END), 0)::int`,
      })
      .from(billingCycleInvoices)
      .where(
        and(
          eq(billingCycleInvoices.companyId, companyId),
          gte(billingCycleInvoices.periodStart, from),
          lte(billingCycleInvoices.periodEnd, to),
          sql`${billingCycleInvoices.status} != 'void'`
        )
      )
      .groupBy(billingCycleInvoices.clinicId);

    // Enrich with clinic names
    const result = [];
    for (const row of clinicSummary) {
      const clinic = await db
        .select({ name: clinics.name })
        .from(clinics)
        .where(eq(clinics.id, row.clinicId))
        .then((r) => r[0]);

      result.push({
        ...row,
        clinicName: clinic?.name || "Unknown",
        collectionRate: row.invoiceCount > 0
          ? Math.round(((row.paidCount || 0) / row.invoiceCount) * 100)
          : 0,
      });
    }

    // Sort by outstanding (highest first)
    result.sort((a, b) => (b.totalOutstanding || 0) - (a.totalOutstanding || 0));

    res.json({ period: { from, to }, clinics: result });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

/**
 * GET /api/finance/reporting/usage
 * Company usage & subscription tier info
 */
export async function usageReportHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;

    const { getCompanyUsage } = await import("../services/subscriptionTiers");
    const usage = await getCompanyUsage(companyId);

    res.json(usage);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
