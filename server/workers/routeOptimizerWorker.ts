import { optimizeDailyRoutes } from "../services/route-optimizer/optimizeDailyRoutes";

const SCHEDULE_HOUR = 2;
const SCHEDULE_MINUTE = 0;
const CHECK_INTERVAL_MS = 60_000;

let running = false;
let lastRunDate: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

async function checkAndRun() {
  const now = new Date();
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  const todayKey = now.toISOString().split("T")[0];

  if (hour === SCHEDULE_HOUR && minute >= SCHEDULE_MINUTE && minute < SCHEDULE_MINUTE + 2) {
    if (lastRunDate === todayKey) return;

    lastRunDate = todayKey;
    console.log(`[ROUTE-OPTIMIZER-WORKER] Triggered daily optimization for ${todayKey}`);

    try {
      const result = await optimizeDailyRoutes({ date: todayKey });
      console.log(
        `[ROUTE-OPTIMIZER-WORKER] Complete: ${result.routesCreated} routes created, ${result.tripsAssigned} trips assigned, ${result.failedClusters} failed clusters`
      );
      if (result.errors.length > 0) {
        console.warn(`[ROUTE-OPTIMIZER-WORKER] Errors: ${result.errors.join("; ")}`);
      }
    } catch (err: any) {
      console.error(`[ROUTE-OPTIMIZER-WORKER] Failed: ${err.message}`);
      lastRunDate = null;
    }
  }
}

export function startRouteOptimizerWorker() {
  if (running) return;
  running = true;

  console.log(`[ROUTE-OPTIMIZER-WORKER] Started (scheduled daily at ${SCHEDULE_HOUR}:${String(SCHEDULE_MINUTE).padStart(2, "0")} UTC)`);
  timer = setInterval(checkAndRun, CHECK_INTERVAL_MS);
}

export function stopRouteOptimizerWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
  console.log("[ROUTE-OPTIMIZER-WORKER] Stopped");
}
