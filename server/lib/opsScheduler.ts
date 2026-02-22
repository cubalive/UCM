import { enqueueJob } from "./jobQueue";
import { getAllCompanyIds, runAnomalySweep, computeScoresForCompany } from "./opsIntelligence";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "./schedulerHarness";

const ANOMALY_INTERVAL_MS = parseInt(process.env.UCM_OPS_ANOMALY_INTERVAL_MS || "60000");
const SCORE_INTERVAL_MS = parseInt(process.env.UCM_SCORE_RECOMPUTE_INTERVAL_MS || "900000");

let anomalyTask: HarnessedTask | null = null;
let scoreTask: HarnessedTask | null = null;

export function startOpsScheduler() {
  if (process.env.UCM_OPS_SCHEDULER === "false") {
    console.log("[OPS-SCHEDULER] Disabled via UCM_OPS_SCHEDULER=false");
    return;
  }

  if (anomalyTask) return;

  anomalyTask = createHarnessedTask({
    name: "ops_anomaly",
    lockKey: "scheduler:lock:ops_anomaly",
    lockTtlSeconds: 30,
    timeoutMs: 60_000,
    fn: async () => {
      const companyIds = await getAllCompanyIds();
      for (const companyId of companyIds) {
        try {
          const result = await runAnomalySweep(companyId);
          if (result.detected > 0 || result.resolved > 0) {
            console.log(`[OPS-SCHEDULER] Anomaly sweep company=${companyId}: detected=${result.detected} resolved=${result.resolved}`);
          }
        } catch (err: any) {
          console.error(`[OPS-SCHEDULER] Anomaly sweep error company=${companyId}: ${err.message}`);
        }
      }
    },
  });

  scoreTask = createHarnessedTask({
    name: "ops_score",
    lockKey: "scheduler:lock:ops_score",
    lockTtlSeconds: 30,
    timeoutMs: 120_000,
    fn: async () => {
      const companyIds = await getAllCompanyIds();
      for (const companyId of companyIds) {
        for (const window of ["7d", "30d"] as const) {
          try {
            await enqueueJob("score_recompute", { companyId, window }, {
              companyId,
              priority: -1,
              idempotencyKey: `score:${companyId}:${window}:${Math.floor(Date.now() / SCORE_INTERVAL_MS)}`,
            });
          } catch (err: any) {
            console.error(`[OPS-SCHEDULER] Score enqueue error company=${companyId} window=${window}: ${err.message}`);
          }
        }
      }
      console.log(`[OPS-SCHEDULER] Score recompute jobs enqueued for ${companyIds.length} companies`);
    },
  });

  console.log(`[OPS-SCHEDULER] Starting (anomaly: ${ANOMALY_INTERVAL_MS / 1000}s, score: ${SCORE_INTERVAL_MS / 1000}s)`);

  registerInterval("ops_anomaly", ANOMALY_INTERVAL_MS, anomalyTask, 10_000);
  registerInterval("ops_score", SCORE_INTERVAL_MS, scoreTask, 20_000);
}

export function stopOpsScheduler() {
  if (anomalyTask) { anomalyTask.stop(); anomalyTask = null; }
  if (scoreTask) { scoreTask.stop(); scoreTask = null; }
}
