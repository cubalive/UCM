interface JobStatus {
  running: boolean;
  lastTickAt: string | null;
  lastError: string | null;
  tickCount: number;
  failCount: number;
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

const jobs: Record<string, JobStatus> = {};

export function tickJob(name: string): void {
  if (!jobs[name]) {
    jobs[name] = { running: true, lastTickAt: null, lastError: null, tickCount: 0, failCount: 0 };
  }
  jobs[name].running = true;
  jobs[name].lastTickAt = new Date().toISOString();
  jobs[name].lastError = null;
  jobs[name].tickCount++;
  jobs[name].failCount = 0;
}

export function failJob(name: string, error: string): void {
  if (!jobs[name]) {
    jobs[name] = { running: true, lastTickAt: null, lastError: null, tickCount: 0, failCount: 0 };
  }
  jobs[name].lastError = error;
  jobs[name].lastTickAt = new Date().toISOString();
  jobs[name].failCount++;
  if (jobs[name].failCount >= 3) {
    jobs[name].running = false;
  }
}

export function markJobStopped(name: string): void {
  if (!jobs[name]) {
    jobs[name] = { running: false, lastTickAt: null, lastError: null, tickCount: 0, failCount: 0 };
  }
  jobs[name].running = false;
}

export function isJobHealthy(name: string): boolean {
  const job = jobs[name];
  if (!job || !job.running) return false;
  if (job.lastError) return false;
  if (job.lastTickAt) {
    const elapsed = Date.now() - new Date(job.lastTickAt).getTime();
    if (elapsed > STALE_THRESHOLD_MS) return false;
  }
  return true;
}

export function getJobStatus(name: string): JobStatus & { ok: boolean } {
  const raw = jobs[name] || { running: false, lastTickAt: null, lastError: null, tickCount: 0, failCount: 0 };
  return { ...raw, ok: isJobHealthy(name) };
}

export function getAllJobStatuses(): Record<string, JobStatus & { ok: boolean }> {
  const result: Record<string, JobStatus & { ok: boolean }> = {};
  for (const name of Object.keys(jobs)) {
    result[name] = getJobStatus(name);
  }
  return result;
}
