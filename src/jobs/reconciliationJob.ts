import { CronJob } from "cron";
import { runReconciliation } from "../services/reconciliationService.js";
import logger from "../lib/logger.js";

let job: CronJob | null = null;

export function startReconciliationJob(): CronJob {
  // Run every 6 hours (explicit UTC)
  job = CronJob.from({
    cronTime: "0 */6 * * *",
    timeZone: "UTC",
    onTick: async () => {
    logger.info("Starting scheduled reconciliation job");
    try {
      const result = await runReconciliation();
      logger.info("Reconciliation job completed", { summary: result.summary });

      if (result.stuckInvoices.length > 0) {
        logger.warn("Stuck invoices found during reconciliation", {
          count: result.stuckInvoices.length,
          invoices: result.stuckInvoices.map((i) => ({
            id: i.invoiceId,
            number: i.invoiceNumber,
            issue: i.issue,
          })),
        });
      }

      if (result.ledgerMismatches.length > 0) {
        logger.error("Ledger mismatches found during reconciliation", {
          count: result.ledgerMismatches.length,
          mismatches: result.ledgerMismatches.map((m) => ({
            invoiceId: m.invoiceId,
            issue: m.issue,
          })),
        });
      }

      if (result.deadLetterCount > 0) {
        logger.warn("Dead letter webhook events pending review", {
          count: result.deadLetterCount,
        });
      }
    } catch (err: any) {
      logger.error("Reconciliation job failed", { error: err.message, stack: err.stack });
    }
  }});

  job.start();
  logger.info("Reconciliation job scheduled (every 6 hours)");
  return job;
}

export function stopReconciliationJob(): void {
  if (job) {
    job.stop();
    job = null;
    logger.info("Reconciliation job stopped");
  }
}
