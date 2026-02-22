import { db } from "../db";
import { trips } from "@shared/schema";
import { and, gte, lte, inArray, isNull } from "drizzle-orm";
import { storage } from "../storage";
import { autoNotifyPatient } from "./dispatchAutoSms";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "./schedulerHarness";

const INTERVAL_MS = parseInt(process.env.SMS_SCHEDULER_INTERVAL_SECONDS || "60") * 1000;
const WINDOW_MINUTES = parseInt(process.env.SMS_T24_WINDOW_MINUTES || "20");
const ENABLED = process.env.SMS_REMINDER_ENABLED === "true";

let smsTask: HarnessedTask | null = null;

async function runReminderCycle() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const windowStart = new Date(tomorrow.getTime() - WINDOW_MINUTES * 60 * 1000);
  const windowEnd = new Date(tomorrow.getTime() + WINDOW_MINUTES * 60 * 1000);

  const dateStart = windowStart.toISOString().split("T")[0];
  const dateEnd = windowEnd.toISOString().split("T")[0];

  const eligibleTrips = await db
    .select()
    .from(trips)
    .where(
      and(
        gte(trips.scheduledDate, dateStart),
        lte(trips.scheduledDate, dateEnd),
        inArray(trips.status, ["SCHEDULED", "ASSIGNED"]),
        isNull(trips.deletedAt)
      )
    );

  if (eligibleTrips.length === 0) return;

  const baseUrl = process.env.PUBLIC_BASE_URL_APP
    || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://app.unitedcaremobility.com");

  let sent = 0;
  for (const trip of eligibleTrips) {
    try {
      const pickupTimeStr = trip.pickupTime || trip.scheduledTime;
      if (!pickupTimeStr) continue;

      const [hours, minutes] = pickupTimeStr.split(":").map(Number);
      if (isNaN(hours) || isNaN(minutes)) continue;

      const tripDateTime = new Date(`${trip.scheduledDate}T${pickupTimeStr}`);
      const diffMs = tripDateTime.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours < 23.5 || diffHours > 24.5) continue;

      const alreadySent = await storage.hasSmsBeenSent(trip.id, "reminder_24h");
      if (alreadySent) continue;

      await autoNotifyPatient(trip.id, "reminder_24h", { base_url: baseUrl });
      sent++;
    } catch (err: any) {
      console.error(`[SMS-REMINDER] Error processing trip ${trip.id}:`, err.message);
    }
  }

  if (sent > 0) {
    console.log(`[SMS-REMINDER] Sent ${sent} T-24H reminders`);
  }
}

export function startSmsReminderScheduler() {
  if (!ENABLED) {
    console.log("[SMS-REMINDER] Disabled via SMS_REMINDER_ENABLED=false");
    return;
  }

  if (smsTask) return;

  smsTask = createHarnessedTask({
    name: "sms_reminder",
    lockKey: "scheduler:lock:sms_reminder",
    lockTtlSeconds: 30,
    timeoutMs: 60_000,
    fn: runReminderCycle,
  });

  registerInterval("sms_reminder", INTERVAL_MS, smsTask, 5000);
  console.log(`[SMS-REMINDER] Started, interval=${INTERVAL_MS}ms, window=${WINDOW_MINUTES}min`);
}

export function stopSmsReminderScheduler() {
  if (smsTask) {
    smsTask.stop();
    smsTask = null;
    console.log("[SMS-REMINDER] Stopped");
  }
}
