import { db } from "../db";
import { trips } from "@shared/schema";
import { and, gte, lte, inArray, isNull, eq } from "drizzle-orm";
import { storage } from "../storage";
import { autoNotifyPatient } from "./dispatchAutoSms";
import { sendConfirmationRequest24h, sendConfirmationReminder2h, flagNoShowRisk } from "./smsConfirmationEngine";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "./schedulerHarness";

const INTERVAL_MS = parseInt(process.env.SMS_SCHEDULER_INTERVAL_SECONDS || "60") * 1000;
const WINDOW_MINUTES = parseInt(process.env.SMS_T24_WINDOW_MINUTES || "20");
const ENABLED = process.env.SMS_REMINDER_ENABLED === "true";

let smsTask: HarnessedTask | null = null;

async function runReminderCycle() {
  const now = new Date();

  // ── T-24H Confirmation Requests ──────────────────────────────────────────
  await run24hConfirmationCycle(now);

  // ── T-2H Urgent Confirmation Reminders ───────────────────────────────────
  await run2hReminderCycle(now);

  // ── No-Show Risk Flagging (T-30min) ──────────────────────────────────────
  try {
    await flagNoShowRisk();
  } catch (err: any) {
    console.error(`[SMS-REMINDER] Error in flagNoShowRisk:`, err.message);
  }
}

/**
 * Send 24h confirmation requests for trips scheduled ~24 hours from now.
 * Replaces the old notification-only reminder with a confirmation request.
 */
async function run24hConfirmationCycle(now: Date) {
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

      // Use confirmation request instead of plain reminder
      const alreadySent = await storage.hasSmsBeenSent(trip.id, "reminder_24h");
      if (alreadySent) continue;

      const success = await sendConfirmationRequest24h(trip.id);
      if (success) sent++;
    } catch (err: any) {
      console.error(`[SMS-REMINDER] Error processing 24h for trip ${trip.id}:`, err.message);
    }
  }

  if (sent > 0) {
    console.log(`[SMS-REMINDER] Sent ${sent} T-24H confirmation requests`);
  }
}

/**
 * Send 2h urgent reminders for trips scheduled ~2 hours from now
 * that have not yet been confirmed.
 */
async function run2hReminderCycle(now: Date) {
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const windowStart2h = new Date(twoHoursFromNow.getTime() - WINDOW_MINUTES * 60 * 1000);
  const windowEnd2h = new Date(twoHoursFromNow.getTime() + WINDOW_MINUTES * 60 * 1000);

  const dateStart2h = windowStart2h.toISOString().split("T")[0];
  const dateEnd2h = windowEnd2h.toISOString().split("T")[0];

  const eligibleTrips2h = await db
    .select()
    .from(trips)
    .where(
      and(
        gte(trips.scheduledDate, dateStart2h),
        lte(trips.scheduledDate, dateEnd2h),
        inArray(trips.status, ["SCHEDULED", "ASSIGNED"]),
        eq(trips.confirmationStatus, "unconfirmed"),
        isNull(trips.deletedAt)
      )
    );

  if (eligibleTrips2h.length === 0) return;

  let sent2h = 0;
  for (const trip of eligibleTrips2h) {
    try {
      const pickupTimeStr = trip.pickupTime || trip.scheduledTime;
      if (!pickupTimeStr) continue;

      const [hours, minutes] = pickupTimeStr.split(":").map(Number);
      if (isNaN(hours) || isNaN(minutes)) continue;

      const tripDateTime = new Date(`${trip.scheduledDate}T${pickupTimeStr}`);
      const diffMs = tripDateTime.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      // 2h window: between 1.5 and 2.5 hours before pickup
      if (diffHours < 1.5 || diffHours > 2.5) continue;

      const success = await sendConfirmationReminder2h(trip.id);
      if (success) sent2h++;
    } catch (err: any) {
      console.error(`[SMS-REMINDER] Error processing 2h for trip ${trip.id}:`, err.message);
    }
  }

  if (sent2h > 0) {
    console.log(`[SMS-REMINDER] Sent ${sent2h} T-2H urgent confirmation reminders`);
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
