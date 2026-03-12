import crypto from "crypto";
import { db } from "../db";
import { jobs } from "@shared/schema";
import { eq, and, lt, or, sql, isNull, desc } from "drizzle-orm";
import { setJson, getJson, del } from "./redis";
import { logSystemEvent } from "./systemEvents";

export type JobType =
  | "pdf_trip_details"
  | "pdf_batch_zip"
  | "invoice_generate"
  | "billing_rollup"
  | "email_send"
  | "map_snapshot"
  | "score_recompute"
  | "anomaly_sweep"
  | "eta_cycle"
  | "autoassign_cycle";

export interface EnqueueOptions {
  companyId?: number | null;
  priority?: number;
  maxAttempts?: number;
  idempotencyKey?: string;
}

export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {}
): Promise<string> {
  const jobId = `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const { companyId = null, priority = 0, maxAttempts = 3 } = opts;

  // Fast path: check Redis cache for idempotency (distributed, but not race-proof alone)
  if (opts.idempotencyKey) {
    const existing = await getJson<string>(`idempo:job:${opts.idempotencyKey}`);
    if (existing) return existing;
  }

  try {
    await db.insert(jobs).values({
      id: jobId,
      companyId,
      type,
      status: "queued",
      attempts: 0,
      maxAttempts,
      priority,
      payload,
      idempotencyKey: opts.idempotencyKey ?? null,
    });
  } catch (err: any) {
    // If the insert fails due to a duplicate idempotency_key (unique constraint violation),
    // another process already inserted the job between our Redis check and insert (TOCTOU).
    // Return the existing job ID instead of throwing.
    if (opts.idempotencyKey && (err.code === "23505" || err.message?.includes("duplicate") || err.message?.includes("unique"))) {
      const existing = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.idempotencyKey, opts.idempotencyKey))
        .limit(1);
      if (existing.length > 0) {
        // Also populate Redis cache so future checks hit the fast path
        await setJson(`idempo:job:${opts.idempotencyKey}`, existing[0].id, 86400);
        return existing[0].id;
      }
    }
    throw err;
  }

  const redisKey = companyId
    ? `company:${companyId}:queue:${type}`
    : `global:queue:${type}`;
  await setJson(redisKey + `:${jobId}`, { jobId, type, priority }, 86400);

  if (opts.idempotencyKey) {
    await setJson(`idempo:job:${opts.idempotencyKey}`, jobId, 86400);
  }

  logSystemEvent({
    companyId,
    eventType: "job_enqueued",
    entityType: "job",
    entityId: jobId,
    payload: { type, priority },
  }).catch(() => {});

  return jobId;
}

export async function dequeueJob(): Promise<typeof jobs.$inferSelect | null> {
  const now = new Date();

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

  if (candidates.length === 0) return null;

  const job = candidates[0];
  const lockUntil = new Date(now.getTime() + 5 * 60 * 1000);

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

  if (updated.length === 0) return null;
  return updated[0];
}

export async function completeJob(
  jobId: string,
  result: Record<string, unknown>
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "succeeded",
      result,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));

  const job = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (job.length > 0) {
    logSystemEvent({
      companyId: job[0].companyId,
      eventType: "job_succeeded",
      entityType: "job",
      entityId: jobId,
      payload: { type: job[0].type },
    }).catch(() => {});
  }
}

export async function failJob(
  jobId: string,
  error: string
): Promise<void> {
  const job = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (job.length === 0) return;

  const j = job[0];
  const isRetryable = j.attempts < j.maxAttempts;

  if (isRetryable) {
    const backoffMs = Math.min(1000 * Math.pow(2, j.attempts), 60000);
    const retryAt = new Date(Date.now() + backoffMs);

    await db
      .update(jobs)
      .set({
        status: "queued",
        lastError: error,
        lockedUntil: retryAt,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  } else {
    await db
      .update(jobs)
      .set({
        status: "failed",
        lastError: error,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    logSystemEvent({
      companyId: j.companyId,
      eventType: "job_failed",
      entityType: "job",
      entityId: jobId,
      payload: { type: j.type, error, attempts: j.attempts },
    }).catch(() => {});
  }
}

export async function getJobStatus(jobId: string): Promise<typeof jobs.$inferSelect | null> {
  const rows = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return rows.length > 0 ? rows[0] : null;
}

export async function releaseStaleJobs(): Promise<number> {
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
  return result.length;
}

export async function cleanupOldJobs(olderThanDays: number = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(jobs)
    .where(
      and(
        or(eq(jobs.status, "succeeded"), eq(jobs.status, "failed")),
        lt(jobs.createdAt, cutoff)
      )
    )
    .returning();
  return result.length;
}

export async function getQueueStats(): Promise<{
  queued: number;
  working: number;
  succeeded: number;
  failed: number;
}> {
  const rows = await db
    .select({
      status: jobs.status,
      count: sql<number>`count(*)::int`,
    })
    .from(jobs)
    .groupBy(jobs.status);

  const stats = { queued: 0, working: 0, succeeded: 0, failed: 0 };
  for (const r of rows) {
    if (r.status in stats) {
      stats[r.status as keyof typeof stats] = r.count;
    }
  }
  return stats;
}
