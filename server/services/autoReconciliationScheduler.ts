/**
 * Auto-Reconciliation Scheduler
 *
 * Automatically runs payment reconciliation for all companies daily.
 * Matches invoices to Stripe payments, updates aging, and flags discrepancies.
 */
import { db } from "../db";
import { companies, companyStripeAccounts } from "@shared/schema";
import { eq, isNull } from "drizzle-orm";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "../lib/schedulerHarness";

const RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface ReconciliationResult {
  companiesProcessed: number;
  reconciliationsRun: number;
  payoutsReconciled: number;
  errors: number;
}

export async function runAutoReconciliation(): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    companiesProcessed: 0,
    reconciliationsRun: 0,
    payoutsReconciled: 0,
    errors: 0,
  };

  try {
    // Get all active companies
    const activeCompanies = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(isNull(companies.deletedAt));

    for (const company of activeCompanies) {
      result.companiesProcessed++;

      try {
        // Run invoice-to-payment reconciliation for the last 90 days
        const { runReconciliation } = await import("../lib/paymentReconciliationEngine");
        const now = new Date();
        const periodEnd = now.toISOString().slice(0, 10);
        const periodStartDate = new Date(now);
        periodStartDate.setDate(periodStartDate.getDate() - 90);
        const periodStart = periodStartDate.toISOString().slice(0, 10);
        await runReconciliation(company.id, periodStart, periodEnd);
        result.reconciliationsRun++;
      } catch (err: any) {
        console.warn(`[AutoRecon] Invoice reconciliation failed for company ${company.id}:`, err.message);
        result.errors++;
      }

      try {
        // Run Stripe payout reconciliation if company has Stripe Connect
        const { reconcileCompanyPayouts } = await import("./payoutReconciliationService");
        const stripeAccount = await db
          .select()
          .from(companyStripeAccounts)
          .where(eq(companyStripeAccounts.companyId, company.id))
          .then((r) => r[0]);

        if (stripeAccount?.stripeAccountId && stripeAccount.onboardingStatus === "ACTIVE") {
          await reconcileCompanyPayouts(company.id);
          result.payoutsReconciled++;
        }
      } catch (err: any) {
        // Payout reconciliation is non-critical
        console.warn(`[AutoRecon] Payout reconciliation skipped for company ${company.id}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error("[AutoRecon] Fatal error:", err.message);
  }

  console.log(
    `[AutoRecon] Cycle complete: companies=${result.companiesProcessed} reconciled=${result.reconciliationsRun} payouts=${result.payoutsReconciled} errors=${result.errors}`
  );
  return result;
}

// Scheduler integration
let reconciliationTask: HarnessedTask | null = null;

export function startAutoReconciliationScheduler() {
  if (reconciliationTask) return;

  reconciliationTask = createHarnessedTask({
    name: "auto_reconciliation",
    lockKey: "scheduler:lock:auto_reconciliation",
    lockTtlSeconds: 60,
    timeoutMs: 600_000, // 10 min max
    fn: async () => {
      await runAutoReconciliation();
    },
  });

  // Run daily, start after 2 minutes
  registerInterval("auto_reconciliation", RECONCILIATION_INTERVAL_MS, reconciliationTask, 120_000);
  console.log("[AutoRecon] Scheduler started (interval: 24h)");
}

export function stopAutoReconciliationScheduler() {
  if (reconciliationTask) {
    reconciliationTask.stop();
    reconciliationTask = null;
    console.log("[AutoRecon] Stopped");
  }
}
