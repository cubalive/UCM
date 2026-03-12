import { startJobEngine, stopJobEngine } from "./jobEngine";
import { isRedisConnected } from "./redis";
import { registerJobHandler } from "./jobProcessor";
import { tickJob, failJob } from "./jobHeartbeat";

export type RoleMode = "server" | "worker" | "all";

export function getRoleMode(): RoleMode {
  const mode = (process.env.RUN_MODE || process.env.ROLE_MODE || "all").toLowerCase().trim();
  if (mode === "api" || mode === "server") return "server";
  if (mode === "worker") return "worker";
  return "all";
}

export function shouldRunSchedulers(): boolean {
  const role = getRoleMode();
  return role === "worker" || role === "all";
}

export function shouldRunServer(): boolean {
  const role = getRoleMode();
  return role === "server" || role === "all";
}

let schedulersStarted = false;
let schedulersRunning = false;

async function startAllSchedulerLoops(): Promise<void> {
  if (schedulersRunning) return;
  schedulersRunning = true;

  const { startOpsAlertScheduler } = await import("./opsRoutes");
  const { startRouteScheduler } = await import("./routeEngine");
  const { startNoShowScheduler } = await import("./noShowEngine");
  const { startRecurringScheduleScheduler } = await import("./recurringScheduleEngine");
  const { startAiEngine } = await import("./aiEngine");
  const { startOpsScheduler } = await import("./opsScheduler");
  const { startPayrollScheduler } = await import("./payrollRoutes");
  const { startDunningScheduler } = await import("../routes/enterpriseFinance.routes");
  const { startAutoInvoiceScheduler } = await import("../services/autoInvoiceScheduler");
  const { startDunningEmailScheduler } = await import("../services/dunningEmailService");
  const { startAutoReconciliationScheduler } = await import("../services/autoReconciliationScheduler");
  const { startDialysisScheduler } = await import("./zeroTouchDialysisEngine");
  const { startSmsReminderScheduler } = await import("./smsReminderScheduler");
  const { startDispatchWindowScheduler } = await import("./dispatchWindowEngine");
  const { startAutoAssignRetryScheduler } = await import("./autoAssignV2Engine");
  const { startTrackingHealthScheduler } = await import("./driverTrackingHealth");
  const { startRouteOptimizerWorker } = await import("../workers/routeOptimizerWorker");
  const { startTripGroupingScheduler } = await import("./tripGroupingScheduler");
  const { startMedicaidAutoSubmitScheduler } = await import("./medicaidBillingEngine");
  const { startDriverPreferenceLearningScheduler } = await import("./driverPreferenceLearning");

  startOpsAlertScheduler();
  startRouteScheduler();
  startNoShowScheduler();
  startRecurringScheduleScheduler();
  startAiEngine();
  startOpsScheduler();
  startPayrollScheduler();
  startDunningScheduler();
  startAutoInvoiceScheduler();
  startDunningEmailScheduler();
  startAutoReconciliationScheduler();
  startDialysisScheduler();
  // Register job handlers so the processor can execute eta_cycle and autoassign_cycle jobs
  registerJobHandler("eta_cycle", async (payload) => {
    const { executeEtaCycleForCity } = await import("./etaEngine");
    const cityId = payload.cityId as number;
    tickJob("eta");
    try {
      const result = await executeEtaCycleForCity(cityId);
      return { cityId, tripsProcessed: result.tripsProcessed };
    } catch (err: any) {
      failJob("eta", err.message);
      throw err;
    }
  });

  registerJobHandler("autoassign_cycle", async (payload) => {
    const { runVehicleAutoAssignForCity } = await import("./vehicleAutoAssign");
    const { storage } = await import("../storage");
    const cityId = payload.cityId as number;
    tickJob("autoAssign");
    try {
      const cities = await storage.getCities();
      const city = cities.find((c: any) => c.id === cityId);
      if (!city) return { skipped: true, reason: "city_not_found" };
      const allSettings = await storage.getAllCitySettings();
      const settings = allSettings.find((s: any) => s.cityId === cityId);
      if (!settings) return { skipped: true, reason: "no_settings" };
      const result = await runVehicleAutoAssignForCity(city, settings);
      return { cityId, ...result };
    } catch (err: any) {
      failJob("autoAssign", err.message);
      throw err;
    }
  });

  startJobEngine();
  startSmsReminderScheduler();
  startDispatchWindowScheduler();
  startAutoAssignRetryScheduler();
  startTrackingHealthScheduler();
  startRouteOptimizerWorker();
  startTripGroupingScheduler();
  startMedicaidAutoSubmitScheduler();
  startDriverPreferenceLearningScheduler();

  const { startJobProcessor } = await import("./jobProcessor");
  startJobProcessor();

  const { startOrchestrator } = await import("../orchestrator/index");
  const { startRoutesWorker } = await import("../workers/routesWorker");
  const { startBreadcrumbFlusher } = await import("./breadcrumbBuffer");
  startOrchestrator().catch(err => console.warn(`[INIT] Orchestrator start error: ${err.message}`));
  startRoutesWorker().catch(err => console.warn(`[INIT] Routes worker start error: ${err.message}`));
  startBreadcrumbFlusher();

  console.log(JSON.stringify({
    event: "schedulers_initialized",
    role: getRoleMode(),
    schedulers: [
      "ops_alert", "route_engine", "no_show", "recurring_schedule",
      "ai_engine", "ai_sentinel", "ops_anomaly", "ops_score",
      "payroll", "dunning", "auto_invoice", "dunning_email", "auto_reconciliation",
      "dialysis", "sms_reminder",
      "job_engine_eta", "job_engine_autoassign",
      "orchestrator", "routes_worker", "breadcrumb_flusher", "route_optimizer", "trip_grouping",
      "medicaid_auto_submit", "driver_preference_learning",
    ],
    ts: new Date().toISOString(),
  }));
}

async function stopAllSchedulerLoops(): Promise<void> {
  if (!schedulersRunning) return;
  schedulersRunning = false;
  const { stopAllSchedulers } = await import("./schedulerHarness");
  stopAllSchedulers();
  stopJobEngine();
}

export async function initSchedulers(): Promise<void> {
  if (schedulersStarted) return;
  schedulersStarted = true;

  const role = getRoleMode();
  if (!shouldRunSchedulers()) {
    console.log(JSON.stringify({
      event: "schedulers_skipped",
      reason: `ROLE_MODE=${role}`,
      ts: new Date().toISOString(),
    }));
    return;
  }

  const useLeaderElection = isRedisConnected() && process.env.LEADER_ELECTION !== "false";

  if (useLeaderElection) {
    const { startLeaderElection, isCurrentLeader, onLeadershipAcquired, onLeadershipLost } = await import("./leaderElection");

    onLeadershipAcquired(() => {
      startAllSchedulerLoops().catch(err => {
        console.error(JSON.stringify({
          event: "scheduler_start_error_on_leader_acquire",
          error: err.message,
          ts: new Date().toISOString(),
        }));
      });
    });

    onLeadershipLost(() => {
      console.warn(JSON.stringify({
        event: "stopping_schedulers_leader_lost",
        ts: new Date().toISOString(),
      }));
      stopAllSchedulerLoops().catch(() => {});
    });

    await startLeaderElection();

    if (isCurrentLeader()) {
      await startAllSchedulerLoops();
    } else {
      console.log(JSON.stringify({
        event: "schedulers_waiting_for_leadership",
        role,
        ts: new Date().toISOString(),
      }));
    }
  } else {
    if (!isRedisConnected()) {
      console.warn(JSON.stringify({
        event: "leader_election_disabled",
        reason: "redis_not_connected",
        warning: "Running schedulers without leader election. NOT safe for multi-instance.",
        ts: new Date().toISOString(),
      }));
    }
    await startAllSchedulerLoops();
  }
}

export async function stopSchedulers(): Promise<void> {
  const { stopMemoryLogger } = await import("./schedulerHarness");
  stopMemoryLogger();

  await stopAllSchedulerLoops();

  try {
    const { stopOrchestrator } = await import("../orchestrator/index");
    const { stopRoutesWorker } = await import("../workers/routesWorker");
    const { stopBreadcrumbFlusher } = await import("./breadcrumbBuffer");
    stopOrchestrator();
    stopRoutesWorker();
    stopBreadcrumbFlusher();
  } catch {}

  try {
    const { stopLeaderElection } = await import("./leaderElection");
    await stopLeaderElection();
  } catch {}

  schedulersStarted = false;
}
