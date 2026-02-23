import { startJobEngine, stopJobEngine } from "./jobEngine";
import { isRedisConnected } from "./redis";

export type RoleMode = "server" | "worker" | "all";

export function getRoleMode(): RoleMode {
  const mode = (process.env.ROLE_MODE || "all").toLowerCase().trim();
  if (mode === "server" || mode === "worker") return mode;
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
  const { startDialysisScheduler } = await import("./zeroTouchDialysisEngine");
  const { startSmsReminderScheduler } = await import("./smsReminderScheduler");
  const { startDispatchWindowScheduler } = await import("./dispatchWindowEngine");
  const { startAutoAssignRetryScheduler } = await import("./autoAssignV2Engine");

  startOpsAlertScheduler();
  startRouteScheduler();
  startNoShowScheduler();
  startRecurringScheduleScheduler();
  startAiEngine();
  startOpsScheduler();
  startPayrollScheduler();
  startDunningScheduler();
  startDialysisScheduler();
  startJobEngine();
  startSmsReminderScheduler();
  startDispatchWindowScheduler();
  startAutoAssignRetryScheduler();

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
      "payroll", "dunning", "dialysis", "sms_reminder",
      "job_engine_eta", "job_engine_autoassign",
      "orchestrator", "routes_worker", "breadcrumb_flusher",
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
