import { setNx, compareAndRenew, compareAndDelete } from "./redis";

const DEFAULT_LOCK_TTL_SECONDS = 30;
const DEFAULT_TIMEOUT_MS = 60_000;

interface SchedulerState {
  name: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  failureCount: number;
  successCount: number;
  totalRuns: number;
  avgDurationMs: number;
  lockRenewalFailures: number;
  isRunning: boolean;
  intervalHandle: ReturnType<typeof setInterval> | null;
}

const registry = new Map<string, SchedulerState>();
const intervalHandles: ReturnType<typeof setInterval>[] = [];

function getOrCreate(name: string): SchedulerState {
  let state = registry.get(name);
  if (!state) {
    state = {
      name,
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      failureCount: 0,
      successCount: 0,
      totalRuns: 0,
      avgDurationMs: 0,
      lockRenewalFailures: 0,
      isRunning: false,
      intervalHandle: null,
    };
    registry.set(name, state);
  }
  return state;
}

export interface HarnessedTask {
  run: () => Promise<void>;
  stop: () => void;
}

export function createHarnessedTask(opts: {
  name: string;
  lockKey?: string;
  lockTtlSeconds?: number;
  timeoutMs?: number;
  fn: () => Promise<void>;
}): HarnessedTask {
  const {
    name,
    lockKey = `scheduler:lock:${name}`,
    lockTtlSeconds = DEFAULT_LOCK_TTL_SECONDS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts;

  const state = getOrCreate(name);

  const run = async () => {
    if (state.isRunning) {
      return;
    }

    let lockAcquired = false;
    const lockValue = `${process.pid}:${Date.now()}`;

    try {
      lockAcquired = await setNx(lockKey, lockValue, lockTtlSeconds);
    } catch (err: any) {
      console.warn(JSON.stringify({
        event: "scheduler_lock_error",
        scheduler: name,
        error: err.message,
        ts: new Date().toISOString(),
      }));
      return;
    }

    if (!lockAcquired) {
      return;
    }

    state.isRunning = true;
    state.lastRunAt = new Date().toISOString();
    state.totalRuns++;
    const startMs = Date.now();

    let renewalTimer: ReturnType<typeof setInterval> | null = null;
    let lockLost = false;

    try {
      const renewIntervalMs = Math.max((lockTtlSeconds * 1000) / 2, 5000);
      renewalTimer = setInterval(async () => {
        try {
          const renewed = await compareAndRenew(lockKey, lockValue, lockTtlSeconds);
          if (!renewed) {
            lockLost = true;
            state.lockRenewalFailures++;
            console.warn(JSON.stringify({
              event: "scheduler_lock_renewal_failed",
              scheduler: name,
              reason: "lock_ownership_lost",
              ts: new Date().toISOString(),
            }));
            if (renewalTimer) {
              clearInterval(renewalTimer);
              renewalTimer = null;
            }
          }
        } catch {}
      }, renewIntervalMs);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Scheduler "${name}" timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      await Promise.race([opts.fn(), timeoutPromise]);

      if (lockLost) {
        console.warn(JSON.stringify({
          event: "scheduler_completed_after_lock_lost",
          scheduler: name,
          durationMs: Date.now() - startMs,
          ts: new Date().toISOString(),
        }));
      }

      const durationMs = Date.now() - startMs;
      state.successCount++;
      state.lastSuccessAt = new Date().toISOString();
      state.avgDurationMs = Math.round(
        ((state.avgDurationMs * (state.successCount - 1)) + durationMs) / state.successCount
      );

      console.log(JSON.stringify({
        event: "scheduler_success",
        scheduler: name,
        durationMs,
        ts: new Date().toISOString(),
      }));
    } catch (err: any) {
      const durationMs = Date.now() - startMs;
      state.failureCount++;
      state.lastErrorAt = new Date().toISOString();
      state.lastError = err.message?.slice(0, 500) || "unknown";

      console.error(JSON.stringify({
        event: "scheduler_error",
        scheduler: name,
        error: state.lastError,
        durationMs,
        failureCount: state.failureCount,
        ts: new Date().toISOString(),
      }));
    } finally {
      if (renewalTimer) clearInterval(renewalTimer);
      state.isRunning = false;
      if (!lockLost) {
        try {
          await compareAndDelete(lockKey, lockValue);
        } catch {}
      }
    }
  };

  const stop = () => {
    if (state.intervalHandle) {
      clearInterval(state.intervalHandle);
      state.intervalHandle = null;
    }
  };

  return { run, stop };
}

export function registerInterval(
  name: string,
  intervalMs: number,
  task: HarnessedTask,
  initialDelayMs?: number,
): ReturnType<typeof setInterval> {
  const state = getOrCreate(name);

  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
  }

  if (initialDelayMs !== undefined) {
    setTimeout(() => task.run(), initialDelayMs);
  }

  const handle = setInterval(() => task.run(), intervalMs);
  state.intervalHandle = handle;
  intervalHandles.push(handle);
  return handle;
}

export function getSchedulerStates(): Record<string, Omit<SchedulerState, "intervalHandle">> {
  const result: Record<string, any> = {};
  for (const [key, state] of registry) {
    const { intervalHandle, ...rest } = state;
    result[key] = { ...rest, active: intervalHandle !== null };
  }
  return result;
}

export function stopAllSchedulers(): void {
  for (const [, state] of registry) {
    if (state.intervalHandle) {
      clearInterval(state.intervalHandle);
      state.intervalHandle = null;
    }
  }
  for (const h of intervalHandles) {
    clearInterval(h);
  }
  intervalHandles.length = 0;
  console.log(JSON.stringify({ event: "all_schedulers_stopped", ts: new Date().toISOString() }));
}

let memoryLogTimer: ReturnType<typeof setInterval> | null = null;

export function startMemoryLogger(intervalMs = 5 * 60 * 1000): void {
  if (memoryLogTimer) return;

  const logMemory = () => {
    const mem = process.memoryUsage();
    console.log(JSON.stringify({
      event: "memory_usage",
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      external_mb: Math.round(mem.external / 1024 / 1024),
      array_buffers_mb: Math.round(mem.arrayBuffers / 1024 / 1024),
      uptime_s: Math.round(process.uptime()),
      ts: new Date().toISOString(),
    }));
  };

  logMemory();
  memoryLogTimer = setInterval(logMemory, intervalMs);
}

export function stopMemoryLogger(): void {
  if (memoryLogTimer) {
    clearInterval(memoryLogTimer);
    memoryLogTimer = null;
  }
}
