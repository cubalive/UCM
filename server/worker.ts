import { dequeueJob, completeJob, failJob, releaseStaleJobs, cleanupOldJobs } from "./lib/jobQueue";
import { processPdfJob } from "./lib/pdfJobProcessor";
import { processBatchPdfJob } from "./lib/batchPdfProcessor";
import { logSystemEvent } from "./lib/systemEvents";
import { setWorkerHeartbeat } from "./lib/deepHealth";
import { computeScoresForCompany, runAnomalySweep } from "./lib/opsIntelligence";
import { acquireLock } from "./lib/jobEngine";
import { executeEtaCycleForCity } from "./lib/etaEngine";
import { runVehicleAutoAssignForCity } from "./lib/vehicleAutoAssign";
import { storage } from "./storage";

const POLL_INTERVAL = 2000;
const STALE_CHECK_INTERVAL = 60000;
const CLEANUP_INTERVAL = 3600000;
const HEARTBEAT_INTERVAL = 10000;

let running = true;

async function processJob(job: any): Promise<void> {
  console.log(`[WORKER] Processing job ${job.id} type=${job.type} attempt=${job.attempts}`);

  await logSystemEvent({
    companyId: job.companyId,
    eventType: "job_started",
    entityType: "job",
    entityId: job.id,
    payload: { type: job.type, attempt: job.attempts },
  }).catch(() => {});

  try {
    let result: Record<string, unknown>;

    switch (job.type) {
      case "pdf_trip_details":
        result = await processPdfJob(job);
        break;
      case "pdf_batch_zip":
        result = await processBatchPdfJob(job);
        break;
      case "invoice_generate": {
        const { generateInvoiceForJob } = await import("./lib/invoiceWorker");
        result = await generateInvoiceForJob(job);
        break;
      }
      case "billing_rollup": {
        const { runBillingRollupJob } = await import("./lib/billingRollupWorker");
        result = await runBillingRollupJob(job);
        break;
      }
      case "email_send": {
        const { sendEmail } = await import("./lib/email");
        const { to, subject, html } = (job.payload || {}) as { to?: string; subject?: string; html?: string };
        if (!to || !subject || !html) throw new Error("email_send requires to, subject, html in payload");
        const emailResult = await sendEmail({ to, subject, html });
        result = { status: emailResult.success ? "completed" : "failed", ...emailResult };
        break;
      }
      case "map_snapshot": {
        console.warn(`[WORKER] map_snapshot job ${job.id} — not yet implemented (requires headless browser)`);
        result = { status: "skipped", message: "Map snapshot requires headless browser — not yet available in worker" };
        break;
      }
      case "score_recompute": {
        const companyId = (job.payload as any)?.companyId;
        const window = (job.payload as any)?.window || "7d";
        if (!companyId) throw new Error("score_recompute requires companyId");
        const scored = await computeScoresForCompany(companyId, window);
        result = { status: "completed", scored, companyId, window };
        break;
      }
      case "anomaly_sweep": {
        const sweepCompanyId = (job.payload as any)?.companyId;
        if (!sweepCompanyId) throw new Error("anomaly_sweep requires companyId");
        const sweepResult = await runAnomalySweep(sweepCompanyId);
        result = { status: "completed", ...sweepResult, companyId: sweepCompanyId };
        break;
      }
      case "eta_cycle": {
        const cityId = (job.payload as any)?.cityId;
        if (!cityId) throw new Error("eta_cycle requires cityId");

        const lockKey = `eta:city:${cityId}`;
        const lock = await acquireLock(lockKey, 180);

        if (!lock.acquired) {
          console.log(`[WORKER] ETA cycle for city ${cityId} skipped — lock held by another instance`);
          result = { status: "skipped_locked", cityId };
          break;
        }

        try {
          const etaResult = await executeEtaCycleForCity(cityId);
          result = { status: "completed", cityId, tripsProcessed: etaResult.tripsProcessed };
        } finally {
          await lock.release();
        }
        break;
      }
      case "autoassign_cycle": {
        const aaCityId = (job.payload as any)?.cityId;
        const aaDate = (job.payload as any)?.date;
        if (!aaCityId) throw new Error("autoassign_cycle requires cityId");

        const aaLockKey = `autoassign:city:${aaCityId}:date:${aaDate || "unknown"}`;
        const aaLock = await acquireLock(aaLockKey, 600);

        if (!aaLock.acquired) {
          console.log(`[WORKER] Auto-assign for city ${aaCityId} date ${aaDate} skipped — lock held`);
          result = { status: "skipped_locked", cityId: aaCityId, date: aaDate };
          break;
        }

        try {
          const city = await storage.getCity(aaCityId);
          if (!city) throw new Error(`City ${aaCityId} not found`);
          const allSettings = await storage.getAllCitySettings();
          const settings = allSettings.find((s: any) => s.cityId === aaCityId);
          if (!settings) throw new Error(`Settings not found for city ${aaCityId}`);

          const aaResult = await runVehicleAutoAssignForCity(city, settings);
          result = {
            status: "completed",
            cityId: aaCityId,
            date: aaDate,
            assigned: aaResult.assigned,
            skipped: aaResult.skipped,
            reused: aaResult.reused,
            tripsAssigned: aaResult.tripsAssigned,
            tripsIssues: aaResult.tripsIssues,
          };
        } finally {
          await aaLock.release();
        }
        break;
      }
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    await completeJob(job.id, result);
    console.log(`[WORKER] Job ${job.id} succeeded`);

    await logSystemEvent({
      companyId: job.companyId,
      eventType: "job_succeeded",
      entityType: "job",
      entityId: job.id,
      payload: { type: job.type, result },
    }).catch(() => {});
  } catch (err: any) {
    console.error(`[WORKER] Job ${job.id} failed: ${err.message}`);
    await failJob(job.id, err.message);

    await logSystemEvent({
      companyId: job.companyId,
      eventType: "job_failed",
      entityType: "job",
      entityId: job.id,
      payload: { type: job.type, error: err.message, attempt: job.attempts },
    }).catch(() => {});
  }
}

async function workerLoop(): Promise<void> {
  console.log("[WORKER] Starting job processor...");

  let staleCheckAt = Date.now();
  let cleanupAt = Date.now();
  let heartbeatAt = 0;

  while (running) {
    try {
      if (Date.now() - heartbeatAt > HEARTBEAT_INTERVAL) {
        await setWorkerHeartbeat().catch(() => {});
        heartbeatAt = Date.now();
      }

      if (Date.now() - staleCheckAt > STALE_CHECK_INTERVAL) {
        const released = await releaseStaleJobs();
        if (released > 0) {
          console.log(`[WORKER] Released ${released} stale jobs`);
        }
        staleCheckAt = Date.now();
      }

      if (Date.now() - cleanupAt > CLEANUP_INTERVAL) {
        const cleaned = await cleanupOldJobs(30);
        if (cleaned > 0) {
          console.log(`[WORKER] Cleaned up ${cleaned} old jobs`);
        }
        cleanupAt = Date.now();
      }

      const job = await dequeueJob();
      if (job) {
        await processJob(job);
      } else {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      }
    } catch (err: any) {
      console.error(`[WORKER] Loop error: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  console.log("[WORKER] Shutting down...");
}

process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});

workerLoop().catch((err) => {
  console.error("[WORKER] Fatal error:", err);
  process.exit(1);
});
