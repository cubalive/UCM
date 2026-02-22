import { db } from "../db";
import { jobs } from "@shared/schema";
import { eq, and, lt, or, sql, isNull, desc } from "drizzle-orm";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "./schedulerHarness";
import { isCurrentLeader } from "./leaderElection";
import { isCircuitOpen, recordError as cbRecordError, recordSuccess as cbRecordSuccess } from "./circuitBreaker";

export enum JobPriority {
  P0_CRITICAL = 10,
  P1_NORMAL = 5,
  P2_LOW = 1,
}

export const JOB_PRIORITY_MAP: Record<string, JobPriority> = {
  eta_cycle: JobPriority.P0_CRITICAL,
  autoassign_cycle: JobPriority.P0_CRITICAL,
  score_recompute: JobPriority.P1_NORMAL,
  anomaly_sweep: JobPriority.P1_NORMAL,
  invoice_generate: JobPriority.P0_CRITICAL,
  billing_rollup: JobPriority.P0_CRITICAL,
  email_send: JobPriority.P1_NORMAL,
  pdf_trip_details: JobPriority.P2_LOW,
  pdf_batch_zip: JobPriority.P2_LOW,
  map_snapshot: JobPriority.P2_LOW,
};

const MAX_JOBS_PER_TICK = parseInt(process.env.MAX_JOBS_PER_TICK || "50", 10);
const MAX_JOB_RUNTIME_MS = parseInt(process.env.MAX_JOB_RUNTIME_MS || "60000", 10);
const PROCESSOR_INTERVAL_MS = parseInt(process.env.JOB_PROCESSOR_INTERVAL_MS || "5000", 10);
const DLQ_ENABLED = process.env.DLQ_ENABLED !== "false";

let processorTask: HarnessedTask | null = null;
let running = false;

type JobHandler = (payload: Record<string, unknown>, jobId: string) => Promise<Record<string, unknown>>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

function getMinPriorityForLoad(): number {
  const dbOverloaded = isCircuitOpen("db");
  const redisOverloaded = isCircuitOpen("redis");

  if (dbOverloaded && redisOverloaded) {
    return JobPriority.P0_CRITICAL;
  }
  if (dbOverloaded || redisOverloaded) {
    return JobPriority.P1_NORMAL;
  }
  return 0;
}

async function dequeueAndProcess(): Promise<void> {
  if (!isCurrentLeader()) return;

  const now = new Date();
  let processed = 0;
  const minPriority = getMinPriorityForLoad();

  if (minPriority > 0) {
    console.warn(JSON.stringify({
      event: "load_shedding_active",
      minPriority,
      reason: minPriority >= JobPriority.P0_CRITICAL ? "db+redis_overloaded" : "partial_overload",
      ts: new Date().toISOString(),
    }));
  }

  while (processed < MAX_JOBS_PER_TICK) {
    const candidates = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.status, "queued"),
          or(isNull(jobs.lockedUntil), lt(jobs.lockedUntil, now))
        )
      )
      .orderBy(desc(jobs.priority), jobs.createdAt)
      .limit(1);

    if (candidates.length === 0) break;

    const job = candidates[0];

    if (job.priority < minPriority) {
      break;
    }
    const lockUntil = new Date(now.getTime() + MAX_JOB_RUNTIME_MS);

    const updated = await db
      .update(jobs)
      .set({
        status: "working",
        lockedUntil: lockUntil,
        attempts: job.attempts + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(jobs.id, job.id),
          eq(jobs.status, "queued")
        )
      )
      .returning();

    if (updated.length === 0) continue;

    const lockedJob = updated[0];
    processed++;

    const handler = handlers.get(lockedJob.type);
    if (!handler) {
      await db
        .update(jobs)
        .set({
          status: "failed",
          lastError: `No handler registered for job type: ${lockedJob.type}`,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, lockedJob.id));
      continue;
    }

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Job ${lockedJob.id} timed out after ${MAX_JOB_RUNTIME_MS}ms`)), MAX_JOB_RUNTIME_MS);
      });

      const result = await Promise.race([
        handler(lockedJob.payload as Record<string, unknown>, lockedJob.id),
        timeoutPromise,
      ]);
      cbRecordSuccess("db");

      await db
        .update(jobs)
        .set({
          status: "succeeded",
          result: result || {},
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, lockedJob.id));

    } catch (err: any) {
      cbRecordError("db");
      const isRetryable = lockedJob.attempts < lockedJob.maxAttempts;

      if (isRetryable) {
        const backoffMs = Math.min(1000 * Math.pow(2, lockedJob.attempts), 60000);
        const retryAt = new Date(Date.now() + backoffMs);

        await db
          .update(jobs)
          .set({
            status: "queued",
            lastError: err.message?.slice(0, 1000) || "unknown",
            lockedUntil: retryAt,
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, lockedJob.id));

        console.log(JSON.stringify({
          event: "job_retry",
          jobId: lockedJob.id,
          type: lockedJob.type,
          attempt: lockedJob.attempts,
          maxAttempts: lockedJob.maxAttempts,
          nextRetryMs: backoffMs,
          error: err.message?.slice(0, 200),
          ts: new Date().toISOString(),
        }));
      } else {
        await db
          .update(jobs)
          .set({
            status: "failed",
            lastError: `[DLQ] ${err.message?.slice(0, 1000) || "unknown"}`,
            lockedUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, lockedJob.id));

        console.error(JSON.stringify({
          event: "job_dlq",
          jobId: lockedJob.id,
          type: lockedJob.type,
          attempts: lockedJob.attempts,
          maxAttempts: lockedJob.maxAttempts,
          error: err.message?.slice(0, 200),
          ts: new Date().toISOString(),
        }));
      }
    }
  }

  if (processed > 0) {
    console.log(JSON.stringify({
      event: "job_processor_tick",
      processed,
      ts: new Date().toISOString(),
    }));
  }
}

async function releaseStaleJobs(): Promise<void> {
  const now = new Date();
  const result = await db
    .update(jobs)
    .set({
      status: "queued",
      lockedUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.status, "working"),
        lt(jobs.lockedUntil, now)
      )
    )
    .returning();

  if (result.length > 0) {
    console.log(JSON.stringify({
      event: "stale_jobs_released",
      count: result.length,
      jobIds: result.map(j => j.id),
      ts: new Date().toISOString(),
    }));
  }
}

export function startJobProcessor(): void {
  if (running) return;
  running = true;

  processorTask = createHarnessedTask({
    name: "job_processor",
    lockKey: "scheduler:lock:job_processor",
    lockTtlSeconds: 30,
    timeoutMs: 120_000,
    fn: async () => {
      await releaseStaleJobs();
      await dequeueAndProcess();
    },
  });

  registerInterval("job_processor", PROCESSOR_INTERVAL_MS, processorTask, 2000);

  console.log(JSON.stringify({
    event: "job_processor_started",
    interval: PROCESSOR_INTERVAL_MS,
    maxPerTick: MAX_JOBS_PER_TICK,
    maxRuntimeMs: MAX_JOB_RUNTIME_MS,
    dlqEnabled: DLQ_ENABLED,
    ts: new Date().toISOString(),
  }));
}

export function stopJobProcessor(): void {
  if (processorTask) {
    processorTask.stop();
    processorTask = null;
  }
  running = false;
}

export async function getQueueDepths(): Promise<Record<string, number>> {
  const rows = await db
    .select({
      status: jobs.status,
      cnt: sql<number>`count(*)::int`,
    })
    .from(jobs)
    .groupBy(jobs.status);

  const depths: Record<string, number> = {};
  for (const r of rows) {
    depths[r.status] = r.cnt;
  }
  return depths;
}

export async function getQueueDetailsByType(): Promise<Array<{ type: string; status: string; count: number }>> {
  const rows = await db
    .select({
      type: jobs.type,
      status: jobs.status,
      cnt: sql<number>`count(*)::int`,
    })
    .from(jobs)
    .groupBy(jobs.type, jobs.status);

  return rows.map(r => ({ type: r.type, status: r.status, count: r.cnt }));
}

export async function getDlqJobs(limit = 50): Promise<Array<typeof jobs.$inferSelect>> {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "failed"))
    .orderBy(desc(jobs.updatedAt))
    .limit(limit);
}

export async function retryDlqJob(jobId: string): Promise<boolean> {
  const result = await db
    .update(jobs)
    .set({
      status: "queued",
      attempts: 0,
      lockedUntil: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.id, jobId),
        or(eq(jobs.status, "dead" as any), eq(jobs.status, "failed"))
      )
    )
    .returning();

  return result.length > 0;
}
