import { CronJob } from "cron";
import { getDb } from "../db/index.js";
import { driverLocations } from "../db/schema.js";
import { sql } from "drizzle-orm";
import logger from "../lib/logger.js";

let job: CronJob | null = null;

/**
 * Clean up old driver location history records.
 * Keeps last 7 days of location data, purges anything older.
 * This prevents unbounded growth of the driver_locations table.
 */
export async function cleanupOldLocationHistory(retentionDays: number = 7): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(driverLocations)
    .where(sql`${driverLocations.recordedAt} < ${cutoff}`)
    .returning({ id: driverLocations.id });

  const count = result.length;
  if (count > 0) {
    logger.info(`Cleaned up ${count} old location history records (older than ${retentionDays} days)`);
  }
  return count;
}

export function startLocationCleanupJob(): CronJob {
  // Run daily at 3 AM UTC
  job = CronJob.from({
    cronTime: "0 3 * * *",
    timeZone: "UTC",
    onTick: async () => {
      try {
        await cleanupOldLocationHistory(7);
      } catch (err: any) {
        logger.error("Location cleanup job failed", { error: err.message });
      }
    },
  });

  job.start();
  logger.info("Location cleanup job scheduled (daily at 3 AM)");
  return job;
}

export function stopLocationCleanupJob(): void {
  if (job) {
    job.stop();
    job = null;
  }
}
