/**
 * Auto-Invoice Generation Scheduler
 *
 * Automatically generates invoices for clinics based on their billing cycle settings.
 * Runs every hour, checks which clinics have billing windows that have closed,
 * and generates invoices for unbilled trips in those periods.
 */
import { db } from "../db";
import {
  clinicBillingSettings,
  clinics,
  tripBilling,
  billingCycleInvoices,
  billingCycleInvoiceItems,
  patients,
  companies,
} from "@shared/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { computeBillingWindow } from "../lib/billingCycleUtils";
import { computeTripBilling, upsertTripBillingRows } from "./billingEngine";
import { writeBillingAudit } from "./billingAuditService";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "../lib/schedulerHarness";

const AUTO_INVOICE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

interface AutoInvoiceResult {
  clinicsProcessed: number;
  invoicesGenerated: number;
  invoicesSkipped: number;
  errors: number;
  details: Array<{
    clinicId: number;
    clinicName: string;
    action: string;
    invoiceId?: number;
    totalCents?: number;
    error?: string;
  }>;
}

export async function runAutoInvoiceGeneration(): Promise<AutoInvoiceResult> {
  const result: AutoInvoiceResult = {
    clinicsProcessed: 0,
    invoicesGenerated: 0,
    invoicesSkipped: 0,
    errors: 0,
    details: [],
  };

  try {
    // Find all clinics with auto-generate enabled
    const settingsRows = await db
      .select({
        clinicId: clinicBillingSettings.clinicId,
        billingCycle: clinicBillingSettings.billingCycle,
        timezone: clinicBillingSettings.timezone,
        autoGenerate: clinicBillingSettings.autoGenerate,
        graceDays: clinicBillingSettings.graceDays,
        lateFeePct: clinicBillingSettings.lateFeePct,
        anchorDow: clinicBillingSettings.anchorDow,
        anchorDom: clinicBillingSettings.anchorDom,
        anchorDate: clinicBillingSettings.anchorDate,
        biweeklyMode: clinicBillingSettings.biweeklyMode,
      })
      .from(clinicBillingSettings)
      .where(eq(clinicBillingSettings.autoGenerate, true));

    for (const settings of settingsRows) {
      result.clinicsProcessed++;

      try {
        const [clinic] = await db
          .select({ id: clinics.id, name: clinics.name, companyId: clinics.companyId })
          .from(clinics)
          .where(eq(clinics.id, settings.clinicId));

        if (!clinic || !clinic.companyId) {
          result.details.push({
            clinicId: settings.clinicId,
            clinicName: "Unknown",
            action: "skipped",
            error: "Clinic not found or no company",
          });
          result.invoicesSkipped++;
          continue;
        }

        // Compute the PREVIOUS billing window (the one that just closed)
        const currentWindow = computeBillingWindow(settings as any);
        const previousPeriodEnd = currentWindow.periodStart;

        // Calculate previous period start based on cycle
        let previousPeriodStart: string;
        const endDate = new Date(previousPeriodEnd);
        if (settings.billingCycle === "weekly") {
          const startDate = new Date(endDate);
          startDate.setDate(startDate.getDate() - 7);
          previousPeriodStart = startDate.toISOString().slice(0, 10);
        } else if (settings.billingCycle === "biweekly") {
          const startDate = new Date(endDate);
          startDate.setDate(startDate.getDate() - 14);
          previousPeriodStart = startDate.toISOString().slice(0, 10);
        } else {
          const startDate = new Date(endDate);
          startDate.setMonth(startDate.getMonth() - 1);
          previousPeriodStart = startDate.toISOString().slice(0, 10);
        }

        // Check if invoice already exists for this period
        const existingInvoice = await db
          .select({ id: billingCycleInvoices.id })
          .from(billingCycleInvoices)
          .where(
            and(
              eq(billingCycleInvoices.clinicId, clinic.id),
              eq(billingCycleInvoices.companyId, clinic.companyId),
              lte(billingCycleInvoices.periodStart, previousPeriodEnd),
              gte(billingCycleInvoices.periodEnd, previousPeriodStart),
              sql`${billingCycleInvoices.status} != 'void'`
            )
          )
          .then((r) => r[0]);

        if (existingInvoice) {
          result.details.push({
            clinicId: clinic.id,
            clinicName: clinic.name,
            action: "skipped",
            error: "Invoice already exists for this period",
          });
          result.invoicesSkipped++;
          continue;
        }

        // First, ensure all completed trips have billing rows
        const { trips } = await import("@shared/schema");
        const { inArray } = await import("drizzle-orm");
        const unbilledTrips = await db
          .select({ id: trips.id })
          .from(trips)
          .where(
            and(
              eq(trips.companyId, clinic.companyId),
              eq(trips.clinicId, clinic.id),
              gte(trips.scheduledDate, previousPeriodStart),
              lte(trips.scheduledDate, previousPeriodEnd),
              inArray(trips.status, ["COMPLETED", "CANCELLED", "NO_SHOW", "ARRIVED_DROPOFF"])
            )
          );

        // Compute billing for any unbilled trips
        for (const t of unbilledTrips) {
          try {
            const lines = await computeTripBilling(t.id);
            if (lines.length > 0) {
              await upsertTripBillingRows(lines);
            }
          } catch {
            // Individual trip billing failure shouldn't stop the invoice
          }
        }

        // Now get all billing rows for this period
        const billingRows = await db
          .select()
          .from(tripBilling)
          .where(
            and(
              eq(tripBilling.companyId, clinic.companyId),
              eq(tripBilling.clinicId, clinic.id),
              gte(tripBilling.serviceDate, previousPeriodStart),
              lte(tripBilling.serviceDate, previousPeriodEnd)
            )
          );

        if (billingRows.length === 0) {
          result.details.push({
            clinicId: clinic.id,
            clinicName: clinic.name,
            action: "skipped",
            error: "No billable trips in period",
          });
          result.invoicesSkipped++;
          continue;
        }

        // Calculate totals
        const subtotalCents = billingRows.reduce((sum, r) => sum + r.totalCents, 0);

        // Apply late fee if applicable
        const lateFeePct = settings.lateFeePct ? parseFloat(settings.lateFeePct) : 0;
        const taxCents = 0; // Tax handled separately if needed
        const feesCents = 0;
        const totalCents = subtotalCents + taxCents + feesCents;

        const invoiceNumber = `INV-${clinic.companyId}-${clinic.id}-${previousPeriodStart.replace(/-/g, "")}`;
        const graceDays = settings.graceDays || 7;
        const dueDate = new Date(previousPeriodEnd);
        dueDate.setDate(dueDate.getDate() + graceDays);

        // Create the invoice
        const [invoice] = await db.insert(billingCycleInvoices).values({
          companyId: clinic.companyId,
          clinicId: clinic.id,
          periodStart: previousPeriodStart,
          periodEnd: previousPeriodEnd,
          status: "draft",
          paymentStatus: "unpaid",
          currency: "USD",
          subtotalCents,
          taxCents,
          feesCents,
          totalCents,
          invoiceNumber,
          dueDate,
          createdBy: null,
        }).returning();

        // Create line items
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

        // Auto-finalize the invoice
        await db
          .update(billingCycleInvoices)
          .set({
            status: "finalized",
            finalizedAt: new Date(),
            locked: true,
            balanceDueCents: totalCents,
            updatedAt: new Date(),
          })
          .where(eq(billingCycleInvoices.id, invoice.id));

        // Write audit
        await writeBillingAudit({
          action: "auto_invoice_generated",
          entityType: "invoice",
          entityId: invoice.id,
          scopeClinicId: clinic.id,
          scopeCompanyId: clinic.companyId,
          details: {
            invoiceNumber,
            periodStart: previousPeriodStart,
            periodEnd: previousPeriodEnd,
            totalCents,
            lineItems: billingRows.length,
            autoGenerated: true,
          },
        });

        // Send invoice email notification
        try {
          const { sendInvoiceNotificationEmail } = await import("./dunningEmailService");
          await sendInvoiceNotificationEmail(invoice.id, clinic.id, clinic.companyId);
        } catch {
          // Email failure shouldn't fail the invoice generation
        }

        result.invoicesGenerated++;
        result.details.push({
          clinicId: clinic.id,
          clinicName: clinic.name,
          action: "generated",
          invoiceId: invoice.id,
          totalCents,
        });

        console.log(`[AutoInvoice] Generated invoice ${invoiceNumber} for clinic ${clinic.name}: $${(totalCents / 100).toFixed(2)}`);
      } catch (err: any) {
        result.errors++;
        result.details.push({
          clinicId: settings.clinicId,
          clinicName: "Unknown",
          action: "error",
          error: err.message,
        });
        console.error(`[AutoInvoice] Error processing clinic ${settings.clinicId}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error("[AutoInvoice] Fatal error:", err.message);
  }

  console.log(
    `[AutoInvoice] Cycle complete: processed=${result.clinicsProcessed} generated=${result.invoicesGenerated} skipped=${result.invoicesSkipped} errors=${result.errors}`
  );
  return result;
}

// Scheduler integration
let autoInvoiceTask: HarnessedTask | null = null;

export function startAutoInvoiceScheduler() {
  if (autoInvoiceTask) return;

  autoInvoiceTask = createHarnessedTask({
    name: "auto_invoice",
    lockKey: "scheduler:lock:auto_invoice",
    lockTtlSeconds: 60,
    timeoutMs: 300_000, // 5 min max
    fn: async () => {
      await runAutoInvoiceGeneration();
    },
  });

  registerInterval("auto_invoice", AUTO_INVOICE_INTERVAL_MS, autoInvoiceTask, 30_000);
  console.log("[AutoInvoice] Scheduler started (interval: 1h)");
}

export function stopAutoInvoiceScheduler() {
  if (autoInvoiceTask) {
    autoInvoiceTask.stop();
    autoInvoiceTask = null;
    console.log("[AutoInvoice] Stopped");
  }
}
