/**
 * Dunning Email Service
 *
 * Sends payment reminder emails at configurable intervals:
 * - New invoice notification (on generation)
 * - 7 days before due date (gentle reminder)
 * - On due date (urgent reminder)
 * - 7 days past due (overdue notice)
 * - 30 days past due (final notice)
 * - 60 days past due (collection warning)
 */
import { db } from "../db";
import {
  billingCycleInvoices,
  billingAuditEvents,
  clinics,
  companies,
  users,
} from "@shared/schema";
import { eq, and, lte, inArray, sql, desc, isNull } from "drizzle-orm";
import { sendEmail } from "../lib/email";
import { writeBillingAudit } from "./billingAuditService";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "../lib/schedulerHarness";

const DUNNING_EMAIL_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface DunningEmailResult {
  sent: number;
  skipped: number;
  errors: number;
}

type ReminderLevel = "new_invoice" | "upcoming_due" | "due_today" | "overdue_7" | "overdue_30" | "overdue_60" | "final_notice";

function getReminderLevel(dueDate: Date, now: Date): ReminderLevel | null {
  const diffMs = dueDate.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays >= 6 && diffDays <= 8) return "upcoming_due";
  if (diffDays >= -1 && diffDays <= 1) return "due_today";
  if (diffDays >= -8 && diffDays <= -6) return "overdue_7";
  if (diffDays >= -31 && diffDays <= -29) return "overdue_30";
  if (diffDays >= -61 && diffDays <= -59) return "overdue_60";
  if (diffDays <= -89) return "final_notice";

  return null;
}

function getEmailSubject(level: ReminderLevel, invoiceNumber: string, amountFormatted: string): string {
  switch (level) {
    case "new_invoice":
      return `New Invoice ${invoiceNumber} - ${amountFormatted} Due`;
    case "upcoming_due":
      return `Reminder: Invoice ${invoiceNumber} Due Soon - ${amountFormatted}`;
    case "due_today":
      return `Invoice ${invoiceNumber} Due Today - ${amountFormatted}`;
    case "overdue_7":
      return `OVERDUE: Invoice ${invoiceNumber} - ${amountFormatted} Past Due`;
    case "overdue_30":
      return `URGENT: Invoice ${invoiceNumber} - 30 Days Past Due`;
    case "overdue_60":
      return `FINAL WARNING: Invoice ${invoiceNumber} - 60 Days Past Due`;
    case "final_notice":
      return `FINAL NOTICE: Invoice ${invoiceNumber} - Account at Risk`;
  }
}

function getEmailBody(
  level: ReminderLevel,
  clinicName: string,
  companyName: string,
  invoiceNumber: string,
  amountFormatted: string,
  periodStart: string,
  periodEnd: string,
  dueDate: string,
  payUrl: string
): string {
  const urgencyColor = level === "new_invoice" || level === "upcoming_due"
    ? "#1a1a2e"
    : level === "due_today"
    ? "#f59e0b"
    : "#ef4444";

  const messages: Record<ReminderLevel, string> = {
    new_invoice: `A new invoice has been generated for your medical transportation services.`,
    upcoming_due: `This is a friendly reminder that your invoice is due in 7 days.`,
    due_today: `Your invoice is due today. Please arrange payment to avoid late fees.`,
    overdue_7: `Your invoice is now 7 days past due. Please make payment immediately to avoid service interruption.`,
    overdue_30: `Your invoice is 30 days past due. Continued non-payment may result in service suspension and late fees.`,
    overdue_60: `Your invoice is 60 days past due. Your account is at risk of being sent to collections.`,
    final_notice: `This is your final notice. Your account will be escalated to collections if payment is not received within 10 business days.`,
  };

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h2 style="color: #1a1a2e; margin: 0;">${companyName}</h2>
    <p style="color: #666; font-size: 14px;">Medical Transportation Services</p>
  </div>

  <div style="background: #f8f9fa; border-radius: 8px; padding: 24px; margin-bottom: 24px; border-left: 4px solid ${urgencyColor};">
    <p>Dear ${clinicName},</p>
    <p>${messages[level]}</p>

    <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 16px; margin: 16px 0;">
      <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
        <tr><td style="padding: 6px 0; color: #666;">Invoice #</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${invoiceNumber}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Billing Period</td><td style="padding: 6px 0; text-align: right;">${periodStart} to ${periodEnd}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Due Date</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${dueDate}</td></tr>
        <tr style="border-top: 1px solid #eee;"><td style="padding: 10px 0; font-weight: 600; font-size: 16px;">Balance Due</td><td style="padding: 10px 0; font-weight: 700; font-size: 18px; text-align: right; color: ${urgencyColor};">${amountFormatted}</td></tr>
      </table>
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${payUrl}" style="display: inline-block; background: ${urgencyColor}; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 6px; font-weight: 600; font-size: 16px;">
        Pay Now
      </a>
    </div>
  </div>

  <p style="font-size: 12px; color: #999; text-align: center;">
    If you have already made this payment, please disregard this notice.
    For questions, contact ${companyName} directly.
  </p>
</body>
</html>`;
}

async function hasRecentDunningEmail(invoiceId: number, level: ReminderLevel): Promise<boolean> {
  const events = await db
    .select({ id: billingAuditEvents.id })
    .from(billingAuditEvents)
    .where(
      and(
        eq(billingAuditEvents.entityType, "invoice"),
        eq(billingAuditEvents.entityId, String(invoiceId)),
        eq(billingAuditEvents.action, `dunning_email_${level}`)
      )
    )
    .limit(1);
  return events.length > 0;
}

export async function sendInvoiceNotificationEmail(
  invoiceId: number,
  clinicId: number,
  companyId: number
): Promise<boolean> {
  return sendDunningEmail(invoiceId, clinicId, companyId, "new_invoice");
}

async function sendDunningEmail(
  invoiceId: number,
  clinicId: number,
  companyId: number,
  level: ReminderLevel
): Promise<boolean> {
  try {
    const [invoice] = await db.select().from(billingCycleInvoices).where(eq(billingCycleInvoices.id, invoiceId));
    if (!invoice) return false;

    const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId));
    if (!clinic) return false;

    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (!company) return false;

    // Find clinic admin email
    const clinicAdmins = await db
      .select({ email: users.email })
      .from(users)
      .where(
        and(
          eq(users.clinicId, clinicId),
          eq(users.active, true),
          inArray(users.role, ["CLINIC_ADMIN", "CLINIC_USER"])
        )
      )
      .limit(3);

    if (clinicAdmins.length === 0) return false;

    const amountCents = invoice.balanceDueCents || invoice.totalCents;
    const amountFormatted = (amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
    const baseUrl = process.env.APP_PUBLIC_URL || "https://clinic.unitedcaremobility.com";
    const payUrl = `${baseUrl}/billing?invoice=${invoiceId}`;
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString("en-US") : "N/A";

    const html = getEmailBody(
      level,
      clinic.name,
      company.name,
      invoice.invoiceNumber || `#${invoiceId}`,
      amountFormatted,
      invoice.periodStart,
      invoice.periodEnd,
      dueDate,
      payUrl
    );

    const subject = getEmailSubject(
      level,
      invoice.invoiceNumber || `#${invoiceId}`,
      amountFormatted
    );

    // Send to all clinic admins
    for (const admin of clinicAdmins) {
      await sendEmail({ to: admin.email, subject, html });
    }

    await writeBillingAudit({
      action: `dunning_email_${level}`,
      entityType: "invoice",
      entityId: invoiceId,
      scopeClinicId: clinicId,
      scopeCompanyId: companyId,
      details: {
        level,
        recipients: clinicAdmins.map((a) => a.email),
        amountCents,
      },
    });

    return true;
  } catch (err: any) {
    console.error(`[DunningEmail] Error sending ${level} for invoice ${invoiceId}:`, err.message);
    return false;
  }
}

export async function runDunningEmailCycle(): Promise<DunningEmailResult> {
  const result: DunningEmailResult = { sent: 0, skipped: 0, errors: 0 };

  try {
    // Find all unpaid/overdue finalized invoices
    const invoices = await db
      .select()
      .from(billingCycleInvoices)
      .where(
        and(
          inArray(billingCycleInvoices.paymentStatus, ["unpaid", "partial", "overdue"]),
          inArray(billingCycleInvoices.status, ["finalized"]),
          sql`${billingCycleInvoices.dueDate} IS NOT NULL`
        )
      )
      .limit(100);

    const now = new Date();

    for (const invoice of invoices) {
      try {
        if (!invoice.dueDate || !invoice.companyId) continue;
        const dueDate = new Date(invoice.dueDate);
        const level = getReminderLevel(dueDate, now);

        if (!level) {
          result.skipped++;
          continue;
        }

        // Check if we already sent this level
        const alreadySent = await hasRecentDunningEmail(invoice.id, level);
        if (alreadySent) {
          result.skipped++;
          continue;
        }

        const success = await sendDunningEmail(invoice.id, invoice.clinicId, invoice.companyId, level);
        if (success) {
          // Update payment status to overdue if past due
          const diffDays = Math.round((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays < 0 && invoice.paymentStatus === "unpaid") {
            await db
              .update(billingCycleInvoices)
              .set({ paymentStatus: "overdue", updatedAt: new Date() })
              .where(eq(billingCycleInvoices.id, invoice.id));
          }

          result.sent++;
        } else {
          result.errors++;
        }
      } catch (err: any) {
        console.error(`[DunningEmail] Error processing invoice ${invoice.id}:`, err.message);
        result.errors++;
      }
    }
  } catch (err: any) {
    console.error("[DunningEmail] Fatal error:", err.message);
  }

  console.log(`[DunningEmail] Cycle complete: sent=${result.sent} skipped=${result.skipped} errors=${result.errors}`);
  return result;
}

// Scheduler integration
let dunningEmailTask: HarnessedTask | null = null;

export function startDunningEmailScheduler() {
  if (dunningEmailTask) return;

  dunningEmailTask = createHarnessedTask({
    name: "dunning_email",
    lockKey: "scheduler:lock:dunning_email",
    lockTtlSeconds: 30,
    timeoutMs: 120_000,
    fn: async () => {
      await runDunningEmailCycle();
    },
  });

  registerInterval("dunning_email", DUNNING_EMAIL_INTERVAL_MS, dunningEmailTask, 60_000);
  console.log("[DunningEmail] Scheduler started (interval: 4h)");
}

export function stopDunningEmailScheduler() {
  if (dunningEmailTask) {
    dunningEmailTask.stop();
    dunningEmailTask = null;
    console.log("[DunningEmail] Stopped");
  }
}
