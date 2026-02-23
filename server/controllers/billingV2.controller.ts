import { type Response } from "express";
import { type AuthRequest, getActorContext, getCompanyIdFromAuth } from "../auth";
import { db } from "../db";
import { storage } from "../storage";
import {
  trips,
  clinicTariffs,
  tripBilling,
  clinicBillingSettings,
  billingCycleInvoices,
  billingCycleInvoiceItems,
  clinics,
  patients,
  companies,
  supportThreads,
  supportMessages,
  users,
} from "@shared/schema";
import { eq, and, gte, lte, desc, asc, inArray, isNull, sql } from "drizzle-orm";
import { computeTripBilling, upsertTripBillingRows } from "../services/billingEngine";

function requireCompanyOrFail(req: AuthRequest, res: Response): number | null {
  const cid = getCompanyIdFromAuth(req);
  if (!cid) {
    res.status(403).json({ message: "Company context required" });
    return null;
  }
  return cid;
}

async function getClinicCompanyId(clinicId: number): Promise<number | null> {
  const clinic = await db
    .select({ companyId: clinics.companyId })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .then((r) => r[0]);
  return clinic?.companyId || null;
}

async function getActorClinicContext(req: AuthRequest, res: Response): Promise<{ clinicId: number; companyId: number } | null> {
  const actor = await getActorContext(req);
  if (!actor) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  const clinicId = actor.clinicId || (req as any).clinicScopeId || null;
  if (!clinicId) {
    res.status(403).json({ message: "Clinic context required" });
    return null;
  }
  const companyId = await getClinicCompanyId(clinicId);
  if (!companyId) {
    res.status(403).json({ message: "Clinic not associated with a company" });
    return null;
  }
  return { clinicId, companyId };
}

export async function listTariffsHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const clinicIdParam = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
    const conditions: any[] = [eq(clinicTariffs.companyId, companyId)];
    if (clinicIdParam) conditions.push(eq(clinicTariffs.clinicId, clinicIdParam));

    const rows = await db
      .select()
      .from(clinicTariffs)
      .where(and(...conditions))
      .orderBy(desc(clinicTariffs.effectiveFrom));

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function createTariffHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const { clinicId, cityId, name, pricingModel, baseFeeCents, perMileCents, perMinuteCents, waitMinuteCents,
      wheelchairExtraCents, sharedTripMode, sharedTripDiscountPct, noShowFeeCents, cancelFeeCents,
      minimumFareCents, currency, effectiveFrom } = req.body;

    if (clinicId) {
      const clinic = await db.select({ companyId: clinics.companyId }).from(clinics).where(eq(clinics.id, clinicId)).then(r => r[0]);
      if (!clinic || clinic.companyId !== companyId) {
        return res.status(403).json({ message: "Clinic not in your company" });
      }
    }

    const [tariff] = await db.insert(clinicTariffs).values({
      companyId,
      clinicId: clinicId || null,
      cityId: cityId || null,
      name: name || "Default",
      pricingModel: pricingModel || "MILES_TIME",
      baseFeeCents: baseFeeCents || 0,
      perMileCents: perMileCents || 0,
      perMinuteCents: perMinuteCents || 0,
      waitMinuteCents: waitMinuteCents || 0,
      wheelchairExtraCents: wheelchairExtraCents || 0,
      sharedTripMode: sharedTripMode || "PER_PATIENT",
      sharedTripDiscountPct: String(sharedTripDiscountPct || 0),
      noShowFeeCents: noShowFeeCents || 0,
      cancelFeeCents: cancelFeeCents || 0,
      minimumFareCents: minimumFareCents || 0,
      currency: currency || "USD",
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
      active: true,
    }).returning();

    res.status(201).json(tariff);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function updateTariffHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;
    const tariffId = parseInt(req.params.id);

    const existing = await db.select().from(clinicTariffs).where(eq(clinicTariffs.id, tariffId)).then(r => r[0]);
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ message: "Tariff not found" });
    }

    const updates: any = {};
    const fields = ["name", "pricingModel", "baseFeeCents", "perMileCents", "perMinuteCents",
      "waitMinuteCents", "wheelchairExtraCents", "sharedTripMode", "sharedTripDiscountPct",
      "noShowFeeCents", "cancelFeeCents", "minimumFareCents", "currency", "active"];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        if (f === "sharedTripDiscountPct") {
          updates[f] = String(req.body[f]);
        } else {
          updates[f] = req.body[f];
        }
      }
    }

    const [updated] = await db.update(clinicTariffs).set(updates).where(eq(clinicTariffs.id, tariffId)).returning();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function upsertClinicBillingSettingsHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;
    const clinicId = parseInt(req.params.clinicId);

    const clinic = await db.select({ companyId: clinics.companyId }).from(clinics).where(eq(clinics.id, clinicId)).then(r => r[0]);
    if (!clinic || clinic.companyId !== companyId) {
      return res.status(403).json({ message: "Clinic not in your company" });
    }

    const { billingCycle, timezone, autoGenerate, graceDays, lateFeePct } = req.body;

    const existing = await db.select().from(clinicBillingSettings).where(eq(clinicBillingSettings.clinicId, clinicId)).then(r => r[0]);
    if (existing) {
      const [updated] = await db.update(clinicBillingSettings).set({
        billingCycle: billingCycle || existing.billingCycle,
        timezone: timezone || existing.timezone,
        autoGenerate: autoGenerate !== undefined ? autoGenerate : existing.autoGenerate,
        graceDays: graceDays !== undefined ? graceDays : existing.graceDays,
        lateFeePct: lateFeePct !== undefined ? String(lateFeePct) : existing.lateFeePct,
        updatedAt: new Date(),
      }).where(eq(clinicBillingSettings.clinicId, clinicId)).returning();
      res.json(updated);
    } else {
      const [created] = await db.insert(clinicBillingSettings).values({
        clinicId,
        billingCycle: billingCycle || "weekly",
        timezone: timezone || "America/Los_Angeles",
        autoGenerate: autoGenerate || false,
        graceDays: graceDays || 0,
        lateFeePct: String(lateFeePct || 0),
      }).returning();
      res.json(created);
    }
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function backfillBillingHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const from = req.query.from as string;
    const to = req.query.to as string;
    if (!from || !to) {
      return res.status(400).json({ message: "from and to query params required (YYYY-MM-DD)" });
    }

    const finalizedStatuses = ["COMPLETED", "CANCELLED", "NO_SHOW", "ARRIVED_DROPOFF"];

    const tripsToProcess = await db
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.companyId, companyId),
          gte(trips.scheduledDate, from),
          lte(trips.scheduledDate, to),
          inArray(trips.status, finalizedStatuses)
        )
      );

    let processed = 0;
    let errors = 0;
    for (const t of tripsToProcess) {
      try {
        const lines = await computeTripBilling(t.id);
        if (lines.length > 0) {
          await upsertTripBillingRows(lines);
          processed++;
        }
      } catch {
        errors++;
      }
    }

    res.json({ processed, errors, total: tripsToProcess.length });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function generateInvoiceHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const { clinicId, periodStart, periodEnd } = req.body;
    if (!clinicId || !periodStart || !periodEnd) {
      return res.status(400).json({ message: "clinicId, periodStart, periodEnd required" });
    }

    const clinic = await db.select({ companyId: clinics.companyId }).from(clinics).where(eq(clinics.id, clinicId)).then(r => r[0]);
    if (!clinic || clinic.companyId !== companyId) {
      return res.status(403).json({ message: "Clinic not in your company" });
    }

    const billingRows = await db
      .select()
      .from(tripBilling)
      .where(
        and(
          eq(tripBilling.companyId, companyId),
          eq(tripBilling.clinicId, clinicId),
          gte(tripBilling.serviceDate, periodStart),
          lte(tripBilling.serviceDate, periodEnd)
        )
      );

    if (billingRows.length === 0) {
      return res.status(400).json({ message: "No billing rows found for this period" });
    }

    const totalCents = billingRows.reduce((sum, r) => sum + r.totalCents, 0);
    const invoiceNumber = `INV-${companyId}-${clinicId}-${periodStart.replace(/-/g, "")}`;

    const settings = await db.select().from(clinicBillingSettings).where(eq(clinicBillingSettings.clinicId, clinicId)).then(r => r[0]);
    const graceDays = settings?.graceDays || 7;
    const dueDate = new Date(periodEnd);
    dueDate.setDate(dueDate.getDate() + graceDays);

    const [invoice] = await db.insert(billingCycleInvoices).values({
      companyId,
      clinicId,
      periodStart,
      periodEnd,
      status: "draft",
      currency: "USD",
      subtotalCents: totalCents,
      totalCents,
      invoiceNumber,
      dueDate,
      createdBy: req.user!.userId,
    }).returning();

    for (const row of billingRows) {
      const patient = row.patientId
        ? await db.select({ firstName: patients.firstName, lastName: patients.lastName }).from(patients).where(eq(patients.id, row.patientId)).then(r => r[0])
        : null;
      const patientName = patient ? `${patient.firstName} ${patient.lastName}` : "Unknown";
      const desc = `${patientName} - ${row.serviceDate} - ${row.statusAtBill} (${row.pricingMode})`;

      await db.insert(billingCycleInvoiceItems).values({
        invoiceId: invoice.id,
        tripId: row.tripId,
        patientId: row.patientId,
        description: desc,
        amountCents: row.totalCents,
        metadata: row.components,
      });
    }

    res.status(201).json(invoice);
  } catch (err: any) {
    if (err.message?.includes("duplicate")) {
      return res.status(409).json({ message: "Invoice already exists for this period" });
    }
    res.status(500).json({ message: err.message });
  }
}

export async function clinicListInvoicesHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = await getActorClinicContext(req, res);
    if (!ctx) return;

    const rows = await db
      .select()
      .from(billingCycleInvoices)
      .where(eq(billingCycleInvoices.clinicId, ctx.clinicId))
      .orderBy(desc(billingCycleInvoices.createdAt));

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicGetInvoiceHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = await getActorClinicContext(req, res);
    if (!ctx) return;
    const invoiceId = parseInt(req.params.id);

    const invoice = await db.select().from(billingCycleInvoices)
      .where(and(eq(billingCycleInvoices.id, invoiceId), eq(billingCycleInvoices.clinicId, ctx.clinicId)))
      .then(r => r[0]);

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const items = await db.select().from(billingCycleInvoiceItems)
      .where(eq(billingCycleInvoiceItems.invoiceId, invoiceId))
      .orderBy(asc(billingCycleInvoiceItems.createdAt));

    const enrichedItems = [];
    for (const item of items) {
      let tripRow = null;
      if (item.tripId) {
        tripRow = await db.select({
          publicId: trips.publicId,
          pickupAddress: trips.pickupAddress,
          dropoffAddress: trips.dropoffAddress,
          scheduledDate: trips.scheduledDate,
          pickupTime: trips.pickupTime,
          status: trips.status,
          distanceMiles: trips.distanceMiles,
          durationMinutes: trips.durationMinutes,
          mobilityRequirement: trips.mobilityRequirement,
          sharedGroupId: trips.sharedGroupId,
          sharedPassengerCount: trips.sharedPassengerCount,
        }).from(trips).where(eq(trips.id, item.tripId)).then(r => r[0]);
      }
      let patientName = "Unknown";
      if (item.patientId) {
        const p = await db.select({ firstName: patients.firstName, lastName: patients.lastName })
          .from(patients).where(eq(patients.id, item.patientId)).then(r => r[0]);
        if (p) patientName = `${p.firstName} ${p.lastName}`;
      }
      enrichedItems.push({ ...item, trip: tripRow, patientName });
    }

    const company = await db.select({ dispatchPhone: companies.dispatchPhone, dispatchChatEnabled: companies.dispatchChatEnabled, dispatchCallEnabled: companies.dispatchCallEnabled })
      .from(companies).where(eq(companies.id, ctx.companyId)).then(r => r[0]);

    res.json({ invoice, items: enrichedItems, dispatchContact: company || {} });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicExportInvoiceCsvHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = await getActorClinicContext(req, res);
    if (!ctx) return;
    const invoiceId = parseInt(req.params.id);

    const invoice = await db.select().from(billingCycleInvoices)
      .where(and(eq(billingCycleInvoices.id, invoiceId), eq(billingCycleInvoices.clinicId, ctx.clinicId)))
      .then(r => r[0]);

    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const items = await db.select().from(billingCycleInvoiceItems)
      .where(eq(billingCycleInvoiceItems.invoiceId, invoiceId));

    const headers = ["Line #", "Trip ID", "Patient", "Description", "Amount ($)"];
    let csv = headers.join(",") + "\n";

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let patientName = "";
      if (item.patientId) {
        const p = await db.select({ firstName: patients.firstName, lastName: patients.lastName })
          .from(patients).where(eq(patients.id, item.patientId)).then(r => r[0]);
        if (p) patientName = `${p.firstName} ${p.lastName}`;
      }
      let tripPublicId = "";
      if (item.tripId) {
        const t = await db.select({ publicId: trips.publicId }).from(trips).where(eq(trips.id, item.tripId)).then(r => r[0]);
        if (t) tripPublicId = t.publicId;
      }
      const amount = (item.amountCents / 100).toFixed(2);
      const descEscaped = `"${item.description.replace(/"/g, '""')}"`;
      csv += `${i + 1},${tripPublicId},"${patientName}",${descEscaped},${amount}\n`;
    }

    const totalAmount = (invoice.totalCents / 100).toFixed(2);
    csv += `,,,,\n`;
    csv += `,,,"Total",${totalAmount}\n`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="invoice_${invoice.invoiceNumber || invoiceId}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(csv);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicExportInvoiceJsonHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = await getActorClinicContext(req, res);
    if (!ctx) return;
    const invoiceId = parseInt(req.params.id);

    const invoice = await db.select().from(billingCycleInvoices)
      .where(and(eq(billingCycleInvoices.id, invoiceId), eq(billingCycleInvoices.clinicId, ctx.clinicId)))
      .then(r => r[0]);

    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const items = await db.select().from(billingCycleInvoiceItems)
      .where(eq(billingCycleInvoiceItems.invoiceId, invoiceId));

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="invoice_${invoice.invoiceNumber || invoiceId}.json"`);
    res.setHeader("Cache-Control", "no-store");
    res.json({ invoice, items });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicPayInvoiceHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = await getActorClinicContext(req, res);
    if (!ctx) return;
    const invoiceId = parseInt(req.params.id);

    const invoice = await db.select().from(billingCycleInvoices)
      .where(and(eq(billingCycleInvoices.id, invoiceId), eq(billingCycleInvoices.clinicId, ctx.clinicId)))
      .then(r => r[0]);

    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    if (invoice.paymentStatus === "paid") {
      return res.json({ alreadyPaid: true, receiptUrl: invoice.receiptUrl });
    }

    const amountCents = invoice.totalCents;
    if (!amountCents || amountCents <= 0) {
      return res.status(400).json({ message: "Invoice has no billable amount" });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ message: "Payment processing is not configured. Please contact support." });
    }

    const companyId = invoice.companyId || ctx.companyId;
    if (!companyId) {
      return res.status(409).json({ message: "Company billing not configured" });
    }

    const stripeAccount = await storage.getCompanyStripeAccount(companyId);
    if (!stripeAccount || stripeAccount.onboardingStatus !== "ACTIVE") {
      return res.status(409).json({ message: "Company payment account not ready. Contact your provider." });
    }

    const Stripe = require("stripe").default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const { ensureClinicStripeCustomer } = await import("../services/stripeCustomerService");
    const { writeBillingAudit } = await import("../services/billingAuditService");

    const [clinic] = await db.select().from(clinics).where(eq(clinics.id, ctx.clinicId));
    const clinicName = clinic?.name || "Clinic";

    const stripeCustomerId = await ensureClinicStripeCustomer(ctx.clinicId);

    const actor = await getActorContext(req);
    const user = actor ? await storage.getUser(actor.userId) : null;

    const { resolveFeeRule } = await import("../services/feeRules");
    const feeResult = await resolveFeeRule({
      companyId,
      clinicId: ctx.clinicId,
      amountCents,
      serviceLevel: null,
    });
    const applicationFeeAmount = feeResult.feeCents;

    const paymentMetadata: Record<string, string> = {
      billing_cycle_invoice_id: String(invoice.id),
      company_id: String(companyId),
      clinic_id: String(ctx.clinicId),
      type: "billing_cycle_invoice",
      period: `${invoice.periodStart}_${invoice.periodEnd}`,
    };

    if (applicationFeeAmount > 0) {
      paymentMetadata.platform_fee_cents = String(applicationFeeAmount);
      paymentMetadata.fee_source = feeResult.source;
      if (feeResult.details.ruleId) paymentMetadata.fee_rule_id = String(feeResult.details.ruleId);
      if (feeResult.details.feeType) paymentMetadata.fee_type = feeResult.details.feeType;
      if (feeResult.details.percentBps) paymentMetadata.percent_bps = String(feeResult.details.percentBps);
      if (feeResult.details.fixedFeeCents) paymentMetadata.fixed_fee_cents = String(feeResult.details.fixedFeeCents);
    }

    const baseUrl = process.env.APP_PUBLIC_URL || process.env.PUBLIC_BASE_URL || process.env.APP_URL || "https://clinic.unitedcaremobility.com";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: invoice.currency?.toLowerCase() || "usd",
            product_data: {
              name: `Invoice ${invoice.invoiceNumber || `#${invoice.id}`} — ${clinicName}`,
              description: `Billing period: ${invoice.periodStart} to ${invoice.periodEnd}`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${baseUrl}/billing?paid=1&invoice=${invoice.id}`,
      cancel_url: `${baseUrl}/billing?canceled=1&invoice=${invoice.id}`,
      payment_intent_data: {
        setup_future_usage: "off_session",
        transfer_data: {
          destination: stripeAccount.stripeAccountId,
        },
        application_fee_amount: applicationFeeAmount,
        metadata: paymentMetadata,
      },
      metadata: paymentMetadata,
    });

    await db.update(billingCycleInvoices).set({
      stripeCheckoutSessionId: session.id,
      stripeCheckoutUrl: session.url,
      platformFeeCents: applicationFeeAmount,
      platformFeeType: feeResult.source !== "none" ? (feeResult.details.feeType || null) : null,
      platformFeeRate: feeResult.source !== "none" && feeResult.details.percentBps
        ? String(feeResult.details.percentBps)
        : null,
      netToCompanyCents: amountCents - applicationFeeAmount,
      updatedAt: new Date(),
    }).where(eq(billingCycleInvoices.id, invoiceId));

    await writeBillingAudit({
      actorUserId: actor?.userId,
      actorRole: actor?.role,
      scopeClinicId: ctx.clinicId,
      scopeCompanyId: companyId,
      action: "checkout_started",
      entityType: "invoice",
      entityId: invoiceId,
      details: { amountCents, sessionId: session.id, platformFeeCents: applicationFeeAmount },
      req,
    });

    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (err: any) {
    console.error("[ClinicBilling] Pay error:", err.message);
    res.status(500).json({ message: err.message });
  }
}

export async function batchGenerateInvoicesHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const { periodStart, periodEnd } = req.body;
    if (!periodStart || !periodEnd) {
      return res.status(400).json({ message: "periodStart and periodEnd required (YYYY-MM-DD)" });
    }

    const allClinics = await db
      .select({ id: clinics.id, name: clinics.name })
      .from(clinics)
      .where(eq(clinics.companyId, companyId));

    const generated: any[] = [];
    const skipped: any[] = [];
    const errors: any[] = [];

    for (const clinic of allClinics) {
      try {
        const existingInvoice = await db
          .select({ id: billingCycleInvoices.id })
          .from(billingCycleInvoices)
          .where(
            and(
              eq(billingCycleInvoices.clinicId, clinic.id),
              lte(billingCycleInvoices.periodStart, periodEnd),
              gte(billingCycleInvoices.periodEnd, periodStart),
              sql`${billingCycleInvoices.status} != 'void'`
            )
          )
          .then((r) => r[0]);

        if (existingInvoice) {
          skipped.push({ clinicId: clinic.id, clinicName: clinic.name, reason: "invoice_exists" });
          continue;
        }

        const billingRows = await db
          .select()
          .from(tripBilling)
          .where(
            and(
              eq(tripBilling.companyId, companyId),
              eq(tripBilling.clinicId, clinic.id),
              gte(tripBilling.serviceDate, periodStart),
              lte(tripBilling.serviceDate, periodEnd)
            )
          );

        if (billingRows.length === 0) {
          skipped.push({ clinicId: clinic.id, clinicName: clinic.name, reason: "no_billing_rows" });
          continue;
        }

        const totalCents = billingRows.reduce((sum, r) => sum + r.totalCents, 0);
        const invoiceNumber = `INV-${companyId}-${clinic.id}-${periodStart.replace(/-/g, "")}`;

        const settings = await db
          .select()
          .from(clinicBillingSettings)
          .where(eq(clinicBillingSettings.clinicId, clinic.id))
          .then((r) => r[0]);
        const graceDays = settings?.graceDays || 7;

        const dueDate = new Date(periodEnd);
        dueDate.setDate(dueDate.getDate() + graceDays);

        const [invoice] = await db.insert(billingCycleInvoices).values({
          companyId,
          clinicId: clinic.id,
          periodStart,
          periodEnd,
          status: "draft",
          paymentStatus: "unpaid",
          currency: "USD",
          subtotalCents: totalCents,
          totalCents,
          invoiceNumber,
          dueDate,
          createdBy: req.user!.userId,
        }).returning();

        for (const row of billingRows) {
          const patient = row.patientId
            ? await db
                .select({ firstName: patients.firstName, lastName: patients.lastName })
                .from(patients)
                .where(eq(patients.id, row.patientId))
                .then((r) => r[0])
            : null;
          const patientName = patient ? `${patient.firstName} ${patient.lastName}` : "Unknown";
          const description = `${patientName} - ${row.serviceDate} - ${row.statusAtBill} (${row.pricingMode})`;

          await db.insert(billingCycleInvoiceItems).values({
            invoiceId: invoice.id,
            tripId: row.tripId,
            patientId: row.patientId,
            description,
            amountCents: row.totalCents,
            metadata: row.components,
          });
        }

        generated.push({
          clinicId: clinic.id,
          clinicName: clinic.name,
          invoiceId: invoice.id,
          invoiceNumber,
          totalCents,
          lineItems: billingRows.length,
        });
      } catch (err: any) {
        errors.push({ clinicId: clinic.id, clinicName: clinic.name, error: err.message });
      }
    }

    res.json({ generated, skipped, errors, total: allClinics.length });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function finalizeInvoiceHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const invoiceId = parseInt(req.params.id);
    if (isNaN(invoiceId)) {
      return res.status(400).json({ message: "Invalid invoice ID" });
    }

    const invoice = await db
      .select()
      .from(billingCycleInvoices)
      .where(
        and(
          eq(billingCycleInvoices.id, invoiceId),
          eq(billingCycleInvoices.companyId, companyId)
        )
      )
      .then((r) => r[0]);

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    if (invoice.status !== "draft") {
      return res.status(400).json({ message: `Invoice is already ${invoice.status}, cannot finalize` });
    }

    const [updated] = await db
      .update(billingCycleInvoices)
      .set({
        status: "finalized",
        finalizedAt: new Date(),
        locked: true,
        balanceDueCents: invoice.totalCents,
        updatedAt: new Date(),
      })
      .where(eq(billingCycleInvoices.id, invoiceId))
      .returning();

    const { writeBillingAudit } = await import("../services/billingAuditService");
    await writeBillingAudit({
      actorUserId: req.user!.userId,
      actorRole: (req.user as any)?.role || null,
      scopeCompanyId: companyId,
      scopeClinicId: invoice.clinicId,
      action: "invoice_finalized",
      entityType: "invoice",
      entityId: invoiceId,
      details: { invoiceNumber: invoice.invoiceNumber, totalCents: invoice.totalCents },
      req,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function batchFinalizeInvoicesHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const { clinicId, periodStart, periodEnd } = req.body;

    const conditions: any[] = [
      eq(billingCycleInvoices.companyId, companyId),
      eq(billingCycleInvoices.status, "draft"),
    ];

    if (clinicId) conditions.push(eq(billingCycleInvoices.clinicId, clinicId));
    if (periodStart) conditions.push(gte(billingCycleInvoices.periodStart, periodStart));
    if (periodEnd) conditions.push(lte(billingCycleInvoices.periodEnd, periodEnd));

    const draftInvoices = await db
      .select()
      .from(billingCycleInvoices)
      .where(and(...conditions));

    if (draftInvoices.length === 0) {
      return res.json({ finalized: 0, message: "No draft invoices found matching filters" });
    }

    const now = new Date();
    const invoiceIds = draftInvoices.map((inv) => inv.id);

    await db
      .update(billingCycleInvoices)
      .set({
        status: "finalized",
        finalizedAt: now,
        locked: true,
        balanceDueCents: sql`${billingCycleInvoices.totalCents}`,
        updatedAt: now,
      })
      .where(inArray(billingCycleInvoices.id, invoiceIds));

    const { writeBillingAudit } = await import("../services/billingAuditService");
    for (const inv of draftInvoices) {
      await writeBillingAudit({
        actorUserId: req.user!.userId,
        actorRole: (req.user as any)?.role || null,
        scopeCompanyId: companyId,
        scopeClinicId: inv.clinicId,
        action: "invoice_finalized",
        entityType: "invoice",
        entityId: inv.id,
        details: { invoiceNumber: inv.invoiceNumber, totalCents: inv.totalCents, batch: true },
        req,
      });
    }

    res.json({ finalized: draftInvoices.length, invoiceIds });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function companyListInvoicesHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const clinicIdParam = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
    const conditions: any[] = [eq(billingCycleInvoices.companyId, companyId)];
    if (clinicIdParam) conditions.push(eq(billingCycleInvoices.clinicId, clinicIdParam));

    const rows = await db.select().from(billingCycleInvoices)
      .where(and(...conditions))
      .orderBy(desc(billingCycleInvoices.createdAt));

    const enriched = [];
    for (const inv of rows) {
      const clinic = await db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, inv.clinicId)).then(r => r[0]);
      enriched.push({ ...inv, clinicName: clinic?.name || "Unknown" });
    }
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicCreateSupportThreadHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = await getActorClinicContext(req, res);
    if (!ctx) return;

    const { subject } = req.body;

    const existing = await db.select().from(supportThreads)
      .where(and(
        eq(supportThreads.companyId, ctx.companyId),
        eq(supportThreads.clinicId, ctx.clinicId),
        eq(supportThreads.status, "OPEN")
      ))
      .then(r => r[0]);

    if (existing) {
      return res.json(existing);
    }

    const [thread] = await db.insert(supportThreads).values({
      companyId: ctx.companyId,
      clinicId: ctx.clinicId,
      subject: subject || "Support Request",
      status: "OPEN",
    }).returning();

    res.status(201).json(thread);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicGetSupportThreadHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = await getActorClinicContext(req, res);
    if (!ctx) return;

    const threads = await db.select().from(supportThreads)
      .where(eq(supportThreads.clinicId, ctx.clinicId))
      .orderBy(desc(supportThreads.lastMessageAt));

    res.json(threads);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicPostMessageHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = await getActorClinicContext(req, res);
    if (!ctx) return;

    const { threadId, body } = req.body;
    if (!body) return res.status(400).json({ message: "body is required" });

    let resolvedThreadId = threadId;
    if (!resolvedThreadId) {
      const thread = await db.select().from(supportThreads)
        .where(and(eq(supportThreads.clinicId, ctx.clinicId), eq(supportThreads.status, "OPEN")))
        .then(r => r[0]);
      if (!thread) return res.status(404).json({ message: "No open thread found. Create one first." });
      resolvedThreadId = thread.id;
    }

    const thread = await db.select().from(supportThreads)
      .where(and(eq(supportThreads.id, resolvedThreadId), eq(supportThreads.clinicId, ctx.clinicId)))
      .then(r => r[0]);

    if (!thread) return res.status(404).json({ message: "Thread not found" });
    if (thread.status !== "OPEN") return res.status(400).json({ message: "Thread is closed" });

    const [msg] = await db.insert(supportMessages).values({
      threadId: resolvedThreadId,
      companyId: ctx.companyId,
      clinicId: ctx.clinicId,
      senderRole: "CLINIC",
      senderUserId: req.user!.userId,
      body,
    }).returning();

    await db.update(supportThreads).set({ lastMessageAt: new Date() }).where(eq(supportThreads.id, resolvedThreadId));

    res.status(201).json(msg);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function companyListSupportThreadsHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const statusFilter = req.query.status as string | undefined;
    const conditions: any[] = [eq(supportThreads.companyId, companyId)];
    if (statusFilter) conditions.push(eq(supportThreads.status, statusFilter));

    const threads = await db.select().from(supportThreads)
      .where(and(...conditions))
      .orderBy(desc(supportThreads.lastMessageAt));

    const enriched = [];
    for (const t of threads) {
      const clinic = await db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, t.clinicId)).then(r => r[0]);
      enriched.push({ ...t, clinicName: clinic?.name || "Unknown" });
    }

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function companyGetThreadMessagesHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;
    const threadId = parseInt(req.params.id);

    const thread = await db.select().from(supportThreads)
      .where(and(eq(supportThreads.id, threadId), eq(supportThreads.companyId, companyId)))
      .then(r => r[0]);

    if (!thread) return res.status(404).json({ message: "Thread not found" });

    const messages = await db.select().from(supportMessages)
      .where(eq(supportMessages.threadId, threadId))
      .orderBy(asc(supportMessages.createdAt));

    const enriched = [];
    for (const m of messages) {
      const sender = await db.select({ email: users.email }).from(users).where(eq(users.id, m.senderUserId)).then(r => r[0]);
      enriched.push({ ...m, senderEmail: sender?.email || "" });
    }

    res.json({ thread, messages: enriched });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function companyPostThreadMessageHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;
    const threadId = parseInt(req.params.id);
    const { body } = req.body;
    if (!body) return res.status(400).json({ message: "body is required" });

    const thread = await db.select().from(supportThreads)
      .where(and(eq(supportThreads.id, threadId), eq(supportThreads.companyId, companyId)))
      .then(r => r[0]);

    if (!thread) return res.status(404).json({ message: "Thread not found" });
    if (thread.status !== "OPEN") return res.status(400).json({ message: "Thread is closed" });

    const [msg] = await db.insert(supportMessages).values({
      threadId,
      companyId,
      clinicId: thread.clinicId,
      senderRole: "DISPATCH",
      senderUserId: req.user!.userId,
      body,
    }).returning();

    await db.update(supportThreads).set({ lastMessageAt: new Date() }).where(eq(supportThreads.id, threadId));

    res.status(201).json(msg);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function companyCloseThreadHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;
    const threadId = parseInt(req.params.id);

    const thread = await db.select().from(supportThreads)
      .where(and(eq(supportThreads.id, threadId), eq(supportThreads.companyId, companyId)))
      .then(r => r[0]);

    if (!thread) return res.status(404).json({ message: "Thread not found" });

    const [updated] = await db.update(supportThreads).set({ status: "CLOSED" }).where(eq(supportThreads.id, threadId)).returning();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getClinicBillingSettingsHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;
    const clinicId = parseInt(req.params.clinicId);

    const clinic = await db.select({ companyId: clinics.companyId }).from(clinics).where(eq(clinics.id, clinicId)).then(r => r[0]);
    if (!clinic || clinic.companyId !== companyId) {
      return res.status(403).json({ message: "Clinic not in your company" });
    }

    const settings = await db.select().from(clinicBillingSettings).where(eq(clinicBillingSettings.clinicId, clinicId)).then(r => r[0]);
    res.json(settings || { clinicId, billingCycle: "weekly", timezone: "America/Los_Angeles", autoGenerate: false, graceDays: 0, lateFeePct: "0" });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDispatchContactHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = await getActorClinicContext(req, res);
    if (!ctx) return;

    const company = await db.select({
      dispatchPhone: companies.dispatchPhone,
      dispatchChatEnabled: companies.dispatchChatEnabled,
      dispatchCallEnabled: companies.dispatchCallEnabled,
      name: companies.name,
    }).from(companies).where(eq(companies.id, ctx.companyId)).then(r => r[0]);

    res.json(company || {});
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicGetThreadMessagesHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = await getActorClinicContext(req, res);
    if (!ctx) return;
    const threadId = parseInt(req.params.id);

    const thread = await db.select().from(supportThreads)
      .where(and(eq(supportThreads.id, threadId), eq(supportThreads.clinicId, ctx.clinicId)))
      .then(r => r[0]);

    if (!thread) return res.status(404).json({ message: "Thread not found" });

    const messages = await db.select().from(supportMessages)
      .where(eq(supportMessages.threadId, threadId))
      .orderBy(asc(supportMessages.createdAt));

    const enriched = [];
    for (const m of messages) {
      const sender = await db.select({ email: users.email }).from(users).where(eq(users.id, m.senderUserId)).then(r => r[0]);
      enriched.push({ ...m, senderEmail: sender?.email || "" });
    }

    res.json({ thread, messages: enriched });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
