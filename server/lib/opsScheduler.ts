import { enqueueJob } from "./jobQueue";
import { getAllCompanyIds, runAnomalySweep, computeScoresForCompany } from "./opsIntelligence";
import { setNx, setWithTtl } from "./redis";

const ANOMALY_INTERVAL_MS = parseInt(process.env.UCM_OPS_ANOMALY_INTERVAL_MS || "60000");
const SCORE_INTERVAL_MS = parseInt(process.env.UCM_SCORE_RECOMPUTE_INTERVAL_MS || "900000");
const LEADER_LOCK_KEY = "ops_scheduler:leader";
const LEADER_TTL_SECONDS = 30;

let anomalyTimer: ReturnType<typeof setInterval> | null = null;
let scoreTimer: ReturnType<typeof setInterval> | null = null;
let isLeader = false;

async function acquireLeadership(): Promise<boolean> {
  try {
    const acquired = await setNx(LEADER_LOCK_KEY, `leader:${Date.now()}`, LEADER_TTL_SECONDS);
    return acquired;
  } catch {
    return false;
  }
}

async function renewLeadership(): Promise<boolean> {
  try {
    return await setWithTtl(LEADER_LOCK_KEY, `leader:${Date.now()}`, LEADER_TTL_SECONDS);
  } catch {
    return false;
  }
}

async function runAnomalyCycle() {
  if (!isLeader) {
    isLeader = await acquireLeadership();
    if (!isLeader) return;
    console.log("[OPS-SCHEDULER] Acquired leader lock for anomaly sweep");
  }

  const renewed = await renewLeadership();
  if (!renewed) {
    isLeader = false;
    return;
  }

  try {
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
  } catch (err: any) {
    console.error(`[OPS-SCHEDULER] Anomaly cycle error: ${err.message}`);
  }
}

async function runScoreCycle() {
  if (!isLeader) {
    isLeader = await acquireLeadership();
    if (!isLeader) return;
    console.log("[OPS-SCHEDULER] Acquired leader lock for score recompute");
  }

  const renewed = await renewLeadership();
  if (!renewed) {
    isLeader = false;
    return;
  }

  try {
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
  } catch (err: any) {
    console.error(`[OPS-SCHEDULER] Score cycle error: ${err.message}`);
  }
}

export function startOpsScheduler() {
  if (process.env.UCM_OPS_SCHEDULER === "false") {
    console.log("[OPS-SCHEDULER] Disabled via UCM_OPS_SCHEDULER=false");
    return;
  }

  console.log(`[OPS-SCHEDULER] Starting (anomaly: ${ANOMALY_INTERVAL_MS / 1000}s, score: ${SCORE_INTERVAL_MS / 1000}s)`);

  setTimeout(() => runAnomalyCycle(), 10_000);
  setTimeout(() => runScoreCycle(), 20_000);

  anomalyTimer = setInterval(runAnomalyCycle, ANOMALY_INTERVAL_MS);
  scoreTimer = setInterval(runScoreCycle, SCORE_INTERVAL_MS);
}

export function stopOpsScheduler() {
  if (anomalyTimer) clearInterval(anomalyTimer);
  if (scoreTimer) clearInterval(scoreTimer);
  anomalyTimer = null;
  scoreTimer = null;
  isLeader = false;
}
