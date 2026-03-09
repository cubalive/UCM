import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { db } from "../db";
import { eq, and, desc, gte, lte, sql, inArray } from "drizzle-orm";
import {
  billingAdjustments,
  billingCycleInvoices,
  ledgerEntries,
  payoutReconciliation,
  billingAuditEvents,
  clinics,
  companies,
  insertBillingAdjustmentSchema,
  type InsertBillingAdjustment,
} from "@shared/schema";
import { writeBillingAudit, auditFromRequest } from "../services/billingAuditService";
import { writeJournal } from "../services/ledgerService";

function requireCompanyScope(req: AuthRequest, res: Response): number | null {
  const role = req.user?.role;
  if (role === "SUPER_ADMIN") {
    const cid = parseInt(String(req.query.company_id || req.params.companyId || "0"));
    return cid || null;
  }
  return req.user?.companyId || null;
}

function requireClinicScope(req: AuthRequest): number | null {
  if (req.user?.role === "CLINIC_STAFF" || req.user?.role === "CLINIC_ADMIN") {
    return req.user?.clinicId || null;
  }
  return null;
}

export async function createAdjustmentHandler(req: AuthRequest, res: Response) {
  try {
    const invoiceId = parseInt(req.params.invoiceId || req.body.invoiceId);
    if (!invoiceId) return res.status(400).json({ message: "invoiceId required" });

    const [invoice] = await db.select().from(billingCycleInvoices)
      .where(eq(billingCycleInvoices.id, invoiceId));
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const role = req.user?.role;
    if (role === "CLINIC_STAFF" || role === "CLINIC_ADMIN") {
      return res.status(403).json({ message: "Clinic users cannot create adjustments" });
    }
    if (role !== "SUPER_ADMIN") {
      const companyId = req.user?.companyId;
      if (!companyId || invoice.companyId !== companyId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    if (invoice.paymentStatus === "paid" && role !== "SUPER_ADMIN") {
      return res.status(400).json({ message: "Cannot adjust a paid invoice" });
    }

    const kind = req.body.kind as string;
    const reason = req.body.reason as string;
    const amountCents = Math.abs(parseInt(req.body.amountCents) || 0);

    if (!kind || !reason || !amountCents) {
      return res.status(400).json({ message: "kind, reason, and amountCents are required" });
    }

    const insertData: InsertBillingAdjustment = {
      invoiceId,
      kind: kind as any,
      reason,
      amountCents,
      createdBy: req.user?.userId || null,
      metadata: req.body.metadata || null,
    };

    const [adjustment] = await db.insert(billingAdjustments).values(insertData).returning();

    const adjustmentSign = kind === "credit" || kind === "refund" ? -1 : 1;
    const newTotal = Math.max(0, (invoice.totalCents || 0) + adjustmentSign * amountCents);
    const newBalance = Math.max(0, newTotal - (invoice.amountPaidCents || 0));

    await db.update(billingCycleInvoices).set({
      totalCents: newTotal,
      balanceDueCents: newBalance,
      updatedAt: new Date(),
    }).where(eq(billingCycleInvoices.id, invoiceId));

    try {
      const direction = adjustmentSign > 0 ? "debit" : "credit";
      const counterDirection = adjustmentSign > 0 ? "credit" : "debit";
      await writeJournal({
        refType: `adjustment_${kind}`,
        refId: String(adjustment.id),
        clinicId: invoice.clinicId,
        companyId: invoice.companyId,
        lines: [
          { account: "AR_CLINIC", direction: direction as any, amountCents },
          { account: "AP_COMPANY", direction: counterDirection as any, amountCents },
        ],
      });
    } catch {}

    await writeBillingAudit({
      ...auditFromRequest(req),
      scopeClinicId: invoice.clinicId,
      scopeCompanyId: invoice.companyId,
      action: `adjustment_${kind}`,
      entityType: "adjustment",
      entityId: adjustment.id,
      details: { invoiceId, kind, amountCents, reason },
    });

    res.json({ adjustment, newTotalCents: newTotal, newBalanceDueCents: newBalance });
  } catch (err: any) {
    console.error("[Adjustment] Create error:", err.message);
    res.status(500).json({ message: err.message });
  }
}

export async function listAdjustmentsHandler(req: AuthRequest, res: Response) {
  try {
    const invoiceId = parseInt(String(req.params.invoiceId || req.query.invoice_id || "0"));
    if (!invoiceId) return res.status(400).json({ message: "invoice_id required" });

    const [invoice] = await db.select().from(billingCycleInvoices)
      .where(eq(billingCycleInvoices.id, invoiceId));
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const role = req.user?.role;
    if (role !== "SUPER_ADMIN") {
      const companyId = req.user?.companyId;
      const clinicId = requireClinicScope(req);
      if (clinicId && invoice.clinicId !== clinicId) return res.status(403).json({ message: "Access denied" });
      if (companyId && invoice.companyId !== companyId) return res.status(403).json({ message: "Access denied" });
    }

    const adjustments = await db.select().from(billingAdjustments)
      .where(eq(billingAdjustments.invoiceId, invoiceId))
      .orderBy(desc(billingAdjustments.createdAt));

    res.json({ adjustments });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getLedgerHandler(req: AuthRequest, res: Response) {
  try {
    const conditions: any[] = [];
    const role = req.user?.role;

    if (role === "SUPER_ADMIN") {
      if (req.query.company_id) conditions.push(eq(ledgerEntries.companyId, parseInt(req.query.company_id as string)));
      if (req.query.clinic_id) conditions.push(eq(ledgerEntries.clinicId, parseInt(req.query.clinic_id as string)));
    } else if (req.user?.companyId) {
      conditions.push(eq(ledgerEntries.companyId, req.user.companyId));
      if (req.query.clinic_id) conditions.push(eq(ledgerEntries.clinicId, parseInt(req.query.clinic_id as string)));
    } else {
      const clinicId = requireClinicScope(req);
      if (!clinicId) return res.status(403).json({ message: "No scope" });
      conditions.push(eq(ledgerEntries.clinicId, clinicId));
    }

    if (req.query.account) conditions.push(eq(ledgerEntries.account, req.query.account as string));
    if (req.query.ref_type) conditions.push(eq(ledgerEntries.refType, req.query.ref_type as string));
    if (req.query.from) conditions.push(gte(ledgerEntries.createdAt, new Date(req.query.from as string)));
    if (req.query.to) conditions.push(lte(ledgerEntries.createdAt, new Date(req.query.to as string)));

    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
    const offset = parseInt(req.query.offset as string) || 0;

    const entries = await db.select().from(ledgerEntries)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ entries, limit, offset });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getLedgerSummaryHandler(req: AuthRequest, res: Response) {
  try {
    const conditions: any[] = [];
    const role = req.user?.role;

    if (role === "SUPER_ADMIN") {
      if (req.query.company_id) conditions.push(eq(ledgerEntries.companyId, parseInt(req.query.company_id as string)));
      if (req.query.clinic_id) conditions.push(eq(ledgerEntries.clinicId, parseInt(req.query.clinic_id as string)));
    } else if (req.user?.companyId) {
      conditions.push(eq(ledgerEntries.companyId, req.user.companyId));
    } else {
      const clinicId = requireClinicScope(req);
      if (!clinicId) return res.status(403).json({ message: "No scope" });
      conditions.push(eq(ledgerEntries.clinicId, clinicId));
    }

    if (req.query.from) conditions.push(gte(ledgerEntries.createdAt, new Date(req.query.from as string)));
    if (req.query.to) conditions.push(lte(ledgerEntries.createdAt, new Date(req.query.to as string)));

    const summary = await db
      .select({
        account: ledgerEntries.account,
        direction: ledgerEntries.direction,
        total: sql<number>`sum(${ledgerEntries.amountCents})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(ledgerEntries)
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(ledgerEntries.account, ledgerEntries.direction);

    res.json({ summary });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getPayoutReconciliationHandler(req: AuthRequest, res: Response) {
  try {
    const conditions: any[] = [];
    const role = req.user?.role;

    if (role === "SUPER_ADMIN") {
      if (req.query.company_id) conditions.push(eq(payoutReconciliation.companyId, parseInt(req.query.company_id as string)));
    } else if (req.user?.companyId) {
      conditions.push(eq(payoutReconciliation.companyId, req.user.companyId));
    } else {
      return res.status(403).json({ message: "Access denied" });
    }

    if (req.query.payout_id) conditions.push(eq(payoutReconciliation.stripePayoutId, req.query.payout_id as string));
    if (req.query.from) conditions.push(gte(payoutReconciliation.createdAt, new Date(req.query.from as string)));
    if (req.query.to) conditions.push(lte(payoutReconciliation.createdAt, new Date(req.query.to as string)));

    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    const records = await db.select().from(payoutReconciliation)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(payoutReconciliation.createdAt))
      .limit(limit);

    res.json({ records });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getAuditLogHandler(req: AuthRequest, res: Response) {
  try {
    const conditions: any[] = [];
    const role = req.user?.role;

    if (role !== "SUPER_ADMIN") {
      if (req.user?.companyId) {
        conditions.push(eq(billingAuditEvents.scopeCompanyId, req.user.companyId));
      } else {
        return res.status(403).json({ message: "Access denied" });
      }
    } else {
      if (req.query.company_id) conditions.push(eq(billingAuditEvents.scopeCompanyId, parseInt(req.query.company_id as string)));
    }

    if (req.query.clinic_id) conditions.push(eq(billingAuditEvents.scopeClinicId, parseInt(req.query.clinic_id as string)));
    if (req.query.action) conditions.push(eq(billingAuditEvents.action, req.query.action as string));
    if (req.query.entity_type) conditions.push(eq(billingAuditEvents.entityType, req.query.entity_type as string));
    if (req.query.from) conditions.push(gte(billingAuditEvents.createdAt, new Date(req.query.from as string)));
    if (req.query.to) conditions.push(lte(billingAuditEvents.createdAt, new Date(req.query.to as string)));

    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    const events = await db.select().from(billingAuditEvents)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(billingAuditEvents.createdAt))
      .limit(limit);

    res.json({ events });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getFinanceDashboardHandler(req: AuthRequest, res: Response) {
  try {
    const role = req.user?.role;
    const companyConditions: any[] = [];

    if (role === "SUPER_ADMIN") {
      if (req.query.company_id) companyConditions.push(eq(billingCycleInvoices.companyId, parseInt(req.query.company_id as string)));
    } else if (req.user?.companyId) {
      companyConditions.push(eq(billingCycleInvoices.companyId, req.user.companyId));
    } else {
      return res.status(403).json({ message: "Access denied" });
    }

    const [invoiceStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        totalCents: sql<number>`coalesce(sum(${billingCycleInvoices.totalCents}), 0)::int`,
        paidCount: sql<number>`count(*) filter (where ${billingCycleInvoices.paymentStatus} = 'paid')::int`,
        paidCents: sql<number>`coalesce(sum(${billingCycleInvoices.totalCents}) filter (where ${billingCycleInvoices.paymentStatus} = 'paid'), 0)::int`,
        overdueCount: sql<number>`count(*) filter (where ${billingCycleInvoices.paymentStatus} = 'overdue')::int`,
        overdueCents: sql<number>`coalesce(sum(${billingCycleInvoices.balanceDueCents}) filter (where ${billingCycleInvoices.paymentStatus} = 'overdue'), 0)::int`,
        pendingCount: sql<number>`count(*) filter (where ${billingCycleInvoices.paymentStatus} = 'pending')::int`,
        pendingCents: sql<number>`coalesce(sum(${billingCycleInvoices.totalCents}) filter (where ${billingCycleInvoices.paymentStatus} = 'pending'), 0)::int`,
        platformFeeCents: sql<number>`coalesce(sum(${billingCycleInvoices.platformFeeCents}) filter (where ${billingCycleInvoices.paymentStatus} = 'paid'), 0)::int`,
      })
      .from(billingCycleInvoices)
      .where(companyConditions.length ? and(...companyConditions) : undefined);

    const recentInvoices = await db.select().from(billingCycleInvoices)
      .where(companyConditions.length ? and(...companyConditions) : undefined)
      .orderBy(desc(billingCycleInvoices.createdAt))
      .limit(10);

    res.json({ stats: invoiceStats, recentInvoices });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicPaymentMethodsHandler(req: AuthRequest, res: Response) {
  try {
    const clinicId = requireClinicScope(req) || parseInt(String(req.params.clinicId || "0"));
    if (!clinicId) return res.status(400).json({ message: "clinicId required" });

    const role = req.user?.role;
    if (role !== "SUPER_ADMIN" && role !== "COMPANY_ADMIN") {
      const userClinicId = requireClinicScope(req);
      if (userClinicId !== clinicId) return res.status(403).json({ message: "Access denied" });
    }

    const { getClinicPaymentMethods } = await import("../services/stripeCustomerService");
    const methods = await getClinicPaymentMethods(clinicId);
    res.json({ paymentMethods: methods });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicSetupIntentHandler(req: AuthRequest, res: Response) {
  try {
    const clinicId = requireClinicScope(req) || parseInt(String(req.params.clinicId || "0"));
    if (!clinicId) return res.status(400).json({ message: "clinicId required" });

    const { createSetupIntent } = await import("../services/stripeCustomerService");
    const result = await createSetupIntent(clinicId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicSetDefaultPMHandler(req: AuthRequest, res: Response) {
  try {
    const clinicId = requireClinicScope(req) || parseInt(String(req.params.clinicId || "0"));
    const pmId = req.body.paymentMethodId;
    if (!clinicId || !pmId) return res.status(400).json({ message: "clinicId and paymentMethodId required" });

    const { setDefaultPaymentMethod } = await import("../services/stripeCustomerService");
    await setDefaultPaymentMethod(clinicId, pmId);

    await writeBillingAudit({
      ...auditFromRequest(req),
      scopeClinicId: clinicId,
      action: "set_default_pm",
      entityType: "payment_method",
      entityId: pmId,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicDetachPMHandler(req: AuthRequest, res: Response) {
  try {
    const clinicId = requireClinicScope(req) || parseInt(String(req.params.clinicId || "0"));
    const pmId = req.params.pmId || req.body.paymentMethodId;
    if (!clinicId || !pmId) return res.status(400).json({ message: "clinicId and paymentMethodId required" });

    const { detachPaymentMethod } = await import("../services/stripeCustomerService");
    await detachPaymentMethod(clinicId, pmId);

    await writeBillingAudit({
      ...auditFromRequest(req),
      scopeClinicId: clinicId,
      action: "detach_pm",
      entityType: "payment_method",
      entityId: pmId,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
