import { dequeueJob, completeJob, failJob, releaseStaleJobs, cleanupOldJobs } from "./lib/jobQueue";
import { processPdfJob } from "./lib/pdfJobProcessor";
import { processBatchPdfJob } from "./lib/batchPdfProcessor";
import { logSystemEvent } from "./lib/systemEvents";
import { setWorkerHeartbeat } from "./lib/deepHealth";

const POLL_INTERVAL = 2000;
const STALE_CHECK_INTERVAL = 60000;
const CLEANUP_INTERVAL = 3600000;
const HEARTBEAT_INTERVAL = 10000;

let running = true;

async function processJob(job: any): Promise<void> {
  console.log(`[WORKER] Processing job ${job.id} type=${job.type} attempt=${job.attempts}`);

  try {
    let result: Record<string, unknown>;

    switch (job.type) {
      case "pdf_trip_details":
        result = await processPdfJob(job);
        break;
      case "pdf_batch_zip":
        result = await processBatchPdfJob(job);
        break;
      case "invoice_generate":
        result = { status: "completed", message: "Invoice generation not yet implemented in worker" };
        break;
      case "billing_rollup":
        result = { status: "completed", message: "Billing rollup not yet implemented in worker" };
        break;
      case "email_send":
        result = { status: "completed", message: "Email send not yet implemented in worker" };
        break;
      case "map_snapshot":
        result = { status: "completed", message: "Map snapshot not yet implemented in worker" };
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    await completeJob(job.id, result);
    console.log(`[WORKER] Job ${job.id} succeeded`);
  } catch (err: any) {
    console.error(`[WORKER] Job ${job.id} failed: ${err.message}`);
    await failJob(job.id, err.message);
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
