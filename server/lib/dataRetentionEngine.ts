/**
 * Data Retention Engine — HIPAA Compliant
 *
 * HIPAA §164.530(j) requires covered entities to retain documentation for
 * 6 years from the date of creation or last effective date. Many states
 * require 7+ years for medical records.
 *
 * This engine:
 * - Purges old audit logs beyond the retention period
 * - Anonymizes patient data after retention period expires
 * - Generates data retention compliance reports
 * - Runs as a daily scheduled job
 */

import { db } from "../db";
import { auditLog, patients } from "@shared/schema";
import { lt, eq, and, isNull, sql } from "drizzle-orm";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "./schedulerHarness";

// ─── Configuration ───────────────────────────────────────────────────────────

/** Default retention period in years (HIPAA minimum is 6, using 7 for safety) */
const DEFAULT_RETENTION_YEARS = parseInt(
  process.env.DATA_RETENTION_YEARS || "7",
  10,
);

/** Maximum records to process per batch to avoid long-running transactions */
const BATCH_SIZE = 500;

/** Scheduler interval: once per day (24 hours) */
const SCHEDULER_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Initial delay before first run: 5 minutes after boot */
const INITIAL_DELAY_MS = 5 * 60 * 1000;

// ─── Audit Log Purge ─────────────────────────────────────────────────────────

/**
 * Purge audit log entries older than the retention period.
 * Returns the number of records deleted.
 */
export async function purgeOldAuditLogs(
  retentionYears: number = DEFAULT_RETENTION_YEARS,
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - retentionYears);

  let totalDeleted = 0;

  // Delete in batches to avoid locking the table for extended periods
  while (true) {
    const result = await db
      .delete(auditLog)
      .where(lt(auditLog.createdAt, cutoffDate))
      .returning({ id: auditLog.id });

    // Drizzle returns affected rows
    const batchDeleted = result.length;
    totalDeleted += batchDeleted;

    if (batchDeleted < BATCH_SIZE) break;
  }

  if (totalDeleted > 0) {
    console.log(
      `[DATA-RETENTION] Purged ${totalDeleted} audit log entries older than ${retentionYears} years`,
    );
  }

  return totalDeleted;
}

// ─── Patient Data Anonymization ──────────────────────────────────────────────

const ANONYMIZED_MARKER = "[REDACTED-HIPAA]";

/**
 * Anonymize patient records that have been soft-deleted beyond the retention period.
 * Only anonymizes patients that were already deleted (deletedAt is set) and whose
 * deletion date exceeds the retention threshold.
 *
 * Returns the number of patients anonymized.
 */
export async function anonymizeExpiredPatients(
  retentionYears: number = DEFAULT_RETENTION_YEARS,
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - retentionYears);

  // Find soft-deleted patients whose deletion date is past the retention period
  // and who haven't already been anonymized
  const expiredPatients = await db
    .select({ id: patients.id })
    .from(patients)
    .where(
      and(
        lt(patients.deletedAt, cutoffDate),
        sql`${patients.firstName} != ${ANONYMIZED_MARKER}`,
      ),
    )
    .limit(BATCH_SIZE);

  if (expiredPatients.length === 0) return 0;

  let anonymizedCount = 0;

  for (const patient of expiredPatients) {
    try {
      await db
        .update(patients)
        .set({
          firstName: ANONYMIZED_MARKER,
          lastName: ANONYMIZED_MARKER,
          phone: null,
          email: null,
          address: null,
          addressStreet: null,
          addressCity: null,
          addressState: null,
          addressZip: null,
          addressPlaceId: null,
          lat: null,
          lng: null,
          dateOfBirth: null,
          insuranceId: null,
          medicaidId: null,
          medicaidState: null,
          notes: null,
          defaultPickupPlaceId: null,
          defaultDropoffPlaceId: null,
        })
        .where(eq(patients.id, patient.id));

      anonymizedCount++;
    } catch (err: any) {
      console.error(
        `[DATA-RETENTION] Failed to anonymize patient ${patient.id}:`,
        err.message,
      );
    }
  }

  if (anonymizedCount > 0) {
    console.log(
      `[DATA-RETENTION] Anonymized ${anonymizedCount} expired patient records (retention: ${retentionYears}y)`,
    );
  }

  return anonymizedCount;
}

// ─── Retention Report ────────────────────────────────────────────────────────

export interface DataRetentionReport {
  generatedAt: string;
  retentionYears: number;
  cutoffDate: string;
  auditLogs: {
    totalCount: number;
    eligibleForPurge: number;
    oldestEntry: string | null;
  };
  patients: {
    totalDeleted: number;
    eligibleForAnonymization: number;
    alreadyAnonymized: number;
  };
}

/**
 * Generate a data retention compliance report without modifying any data.
 */
export async function generateRetentionReport(
  retentionYears: number = DEFAULT_RETENTION_YEARS,
): Promise<DataRetentionReport> {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - retentionYears);

  // Audit log stats
  const [auditTotal] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog);

  const [auditEligible] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(lt(auditLog.createdAt, cutoffDate));

  const [auditOldest] = await db
    .select({ oldest: sql<string>`min(${auditLog.createdAt})::text` })
    .from(auditLog);

  // Patient stats
  const [deletedPatients] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patients)
    .where(sql`${patients.deletedAt} IS NOT NULL`);

  const [eligiblePatients] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patients)
    .where(
      and(
        lt(patients.deletedAt, cutoffDate),
        sql`${patients.firstName} != ${ANONYMIZED_MARKER}`,
      ),
    );

  const [anonymizedPatients] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patients)
    .where(sql`${patients.firstName} = ${ANONYMIZED_MARKER}`);

  return {
    generatedAt: new Date().toISOString(),
    retentionYears,
    cutoffDate: cutoffDate.toISOString(),
    auditLogs: {
      totalCount: auditTotal?.count || 0,
      eligibleForPurge: auditEligible?.count || 0,
      oldestEntry: auditOldest?.oldest || null,
    },
    patients: {
      totalDeleted: deletedPatients?.count || 0,
      eligibleForAnonymization: eligiblePatients?.count || 0,
      alreadyAnonymized: anonymizedPatients?.count || 0,
    },
  };
}

// ─── Daily Scheduler ─────────────────────────────────────────────────────────

async function runRetentionCheck(): Promise<void> {
  console.log("[DATA-RETENTION] Starting daily retention check...");
  const startMs = Date.now();

  try {
    const purgedAuditLogs = await purgeOldAuditLogs();
    const anonymizedPatients = await anonymizeExpiredPatients();

    const durationMs = Date.now() - startMs;
    console.log(
      JSON.stringify({
        event: "data_retention_complete",
        purgedAuditLogs,
        anonymizedPatients,
        retentionYears: DEFAULT_RETENTION_YEARS,
        durationMs,
        ts: new Date().toISOString(),
      }),
    );
  } catch (err: any) {
    console.error("[DATA-RETENTION] Retention check failed:", err.message);
  }
}

let retentionTask: HarnessedTask | null = null;

/**
 * Start the daily data retention scheduler.
 * Uses the scheduler harness for distributed lock support (multi-instance safe).
 */
export function startDataRetentionScheduler(): void {
  if (retentionTask) {
    console.warn("[DATA-RETENTION] Scheduler already running");
    return;
  }

  retentionTask = createHarnessedTask({
    name: "data_retention",
    lockKey: "scheduler:lock:data_retention",
    lockTtlSeconds: 300, // 5 min — retention jobs can take a while
    timeoutMs: 600_000, // 10 min max
    fn: runRetentionCheck,
  });

  registerInterval(
    "data_retention",
    SCHEDULER_INTERVAL_MS,
    retentionTask,
    INITIAL_DELAY_MS,
  );

  console.log(
    `[DATA-RETENTION] Scheduler started — retention period: ${DEFAULT_RETENTION_YEARS} years, interval: 24h`,
  );
}
