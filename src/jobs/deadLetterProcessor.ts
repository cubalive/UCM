import { CronJob } from "cron";
import { getDb } from "../db/index.js";
import { webhookEvents } from "../db/schema.js";
import { eq, sql, lt } from "drizzle-orm";
import logger from "../lib/logger.js";

let job: CronJob | null = null;

export async function getDeadLetterStats() {
  const db = getDb();

  const [result] = await db
    .select({
      total: sql<number>`count(*)`,
      oldest: sql<string>`min(${webhookEvents.deadLetteredAt})`,
      newest: sql<string>`max(${webhookEvents.deadLetteredAt})`,
    })
    .from(webhookEvents)
    .where(eq(webhookEvents.status, "dead_letter"));

  const byType = await db
    .select({
      eventType: webhookEvents.eventType,
      count: sql<number>`count(*)`,
    })
    .from(webhookEvents)
    .where(eq(webhookEvents.status, "dead_letter"))
    .groupBy(webhookEvents.eventType);

  return {
    total: Number(result.total),
    oldest: result.oldest,
    newest: result.newest,
    byType: Object.fromEntries(byType.map((r) => [r.eventType, Number(r.count)])),
  };
}

export async function purgeOldDeadLetterEvents(olderThanDays: number = 90): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(webhookEvents)
    .where(
      sql`${webhookEvents.status} = 'dead_letter' AND ${webhookEvents.deadLetteredAt} < ${cutoff}`
    )
    .returning();

  const count = result.length;
  if (count > 0) {
    logger.info(`Purged ${count} dead letter events older than ${olderThanDays} days`);
  }
  return count;
}

export function startDeadLetterMonitorJob(): CronJob {
  // Run daily at 2 AM
  job = new CronJob("0 2 * * *", async () => {
    logger.info("Running dead letter monitor");
    try {
      const stats = await getDeadLetterStats();

      if (stats.total > 0) {
        logger.warn("Dead letter queue status", stats);
      }

      // Auto-purge events older than 90 days
      await purgeOldDeadLetterEvents(90);
    } catch (err: any) {
      logger.error("Dead letter monitor failed", { error: err.message });
    }
  });

  job.start();
  logger.info("Dead letter monitor job scheduled (daily at 2 AM)");
  return job;
}

export function stopDeadLetterMonitorJob(): void {
  if (job) {
    job.stop();
    job = null;
  }
}
