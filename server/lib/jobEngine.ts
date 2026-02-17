import { setNx, setWithTtl, del, getJson } from "./redis";
import { enqueueJob, type JobType } from "./jobQueue";
import { logSystemEvent } from "./systemEvents";
import { storage } from "../storage";

const LOCK_DEFAULT_TTL = 300;

export interface DistributedLock {
  key: string;
  acquired: boolean;
  release: () => Promise<void>;
  renew: (ttlSeconds?: number) => Promise<boolean>;
}

export async function acquireLock(
  key: string,
  ttlSeconds: number = LOCK_DEFAULT_TTL
): Promise<DistributedLock> {
  const lockValue = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const acquired = await setNx(key, lockValue, ttlSeconds);

  return {
    key,
    acquired,
    release: async () => {
      if (!acquired) return;
      const current = await getJson<string>(key);
      if (current === lockValue) {
        await del(key);
      }
    },
    renew: async (renewTtl?: number) => {
      if (!acquired) return false;
      const current = await getJson<string>(key);
      if (current !== lockValue) return false;
      return setWithTtl(key, lockValue, renewTtl ?? ttlSeconds);
    },
  };
}

export async function isLocked(key: string): Promise<boolean> {
  const val = await getJson<string>(key);
  return val !== null;
}

const ETA_ENQUEUE_INTERVAL_MS = parseInt(process.env.UCM_ETA_ENQUEUE_INTERVAL_MS || "120000", 10);
const AUTOASSIGN_ENQUEUE_INTERVAL_MS = parseInt(process.env.UCM_AUTOASSIGN_ENQUEUE_INTERVAL_MS || "60000", 10);

let etaIntervalHandle: ReturnType<typeof setInterval> | null = null;
let autoAssignIntervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

async function enqueueEtaCycles(): Promise<void> {
  try {
    const cities = await storage.getCities();
    const activeCities = cities.filter(c => c.active);

    if (activeCities.length === 0) return;

    const cycleKey = `eta:${Math.floor(Date.now() / ETA_ENQUEUE_INTERVAL_MS)}`;

    for (const city of activeCities) {
      const idempotencyKey = `${cycleKey}:city:${city.id}`;
      await enqueueJob(
        "eta_cycle" as JobType,
        { cityId: city.id, cityName: city.name },
        { priority: 5, maxAttempts: 1, idempotencyKey }
      );
    }
  } catch (err: any) {
    console.error(`[JOB-ENGINE] Failed to enqueue ETA cycles: ${err.message}`);
  }
}

async function enqueueAutoAssignCycles(): Promise<void> {
  try {
    const cities = await storage.getCities();
    const allSettings = await storage.getAllCitySettings();

    for (const city of cities) {
      if (!city.active) continue;

      const settings = allSettings.find((s: any) => s.cityId === city.id);
      if (!settings || !settings.autoAssignEnabled) continue;

      const timezone = city.timezone || "America/New_York";
      const dayName = new Date().toLocaleDateString("en-US", { timeZone: timezone, weekday: "short" }).substring(0, 3);
      const currentTime = new Date().toLocaleTimeString("en-US", { timeZone: timezone, hour12: false, hour: "2-digit", minute: "2-digit" });

      if (!settings.autoAssignDays?.includes(dayName)) continue;

      const [shiftH, shiftM] = settings.shiftStartTime.split(":").map(Number);
      const triggerMinutes = (shiftH * 60 + shiftM) - settings.autoAssignMinutesBefore;
      const triggerH = Math.floor(triggerMinutes / 60);
      const triggerM = triggerMinutes % 60;
      const triggerTime = `${String(triggerH).padStart(2, "0")}:${String(triggerM).padStart(2, "0")}`;

      if (currentTime !== triggerTime) continue;

      const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
      const idempotencyKey = `autoassign:city:${city.id}:date:${today}`;

      await enqueueJob(
        "autoassign_cycle" as JobType,
        { cityId: city.id, cityName: city.name, date: today },
        { priority: 3, maxAttempts: 2, idempotencyKey }
      );
    }
  } catch (err: any) {
    console.error(`[JOB-ENGINE] Failed to enqueue auto-assign cycles: ${err.message}`);
  }
}

export function startJobEngine(): void {
  if (running) return;
  running = true;

  console.log(`[JOB-ENGINE] Started (eta enqueue: ${ETA_ENQUEUE_INTERVAL_MS / 1000}s, autoassign enqueue: ${AUTOASSIGN_ENQUEUE_INTERVAL_MS / 1000}s)`);

  etaIntervalHandle = setInterval(enqueueEtaCycles, ETA_ENQUEUE_INTERVAL_MS);
  autoAssignIntervalHandle = setInterval(enqueueAutoAssignCycles, AUTOASSIGN_ENQUEUE_INTERVAL_MS);

  setTimeout(enqueueEtaCycles, 5000);
  setTimeout(enqueueAutoAssignCycles, 8000);
}

export function stopJobEngine(): void {
  running = false;
  if (etaIntervalHandle) {
    clearInterval(etaIntervalHandle);
    etaIntervalHandle = null;
  }
  if (autoAssignIntervalHandle) {
    clearInterval(autoAssignIntervalHandle);
    autoAssignIntervalHandle = null;
  }
  console.log("[JOB-ENGINE] Stopped");
}

export function isJobEngineRunning(): boolean {
  return running;
}
