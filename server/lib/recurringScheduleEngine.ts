import { storage } from "../storage";
import { generatePublicId } from "../public-id";
import type { RecurringSchedule, Patient } from "@shared/schema";
import { db } from "../db";
import { trips, patients, clinics } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

const DAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function getDatesInRollingWindow(days: string[], timezone: string, startDate: string, endDate?: string | null): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const dayName = d.toLocaleDateString("en-US", { timeZone: timezone, weekday: "short" }).substring(0, 3);
    if (days.includes(dayName)) {
      const dateStr = d.toLocaleDateString("en-CA", { timeZone: timezone });
      if (dateStr < startDate) continue;
      if (endDate && dateStr > endDate) continue;
      dates.push(dateStr);
    }
  }
  return dates;
}

async function tripExistsForDate(patientId: number, date: string, pickupTime: string): Promise<boolean> {
  const existing = await db.select({ id: trips.id }).from(trips).where(
    and(
      eq(trips.patientId, patientId),
      eq(trips.scheduledDate, date),
      eq(trips.pickupTime, pickupTime),
      isNull(trips.deletedAt),
    )
  ).limit(1);
  return existing.length > 0;
}

async function getClinicForPatient(patient: Patient): Promise<{ address: string; lat: number | null; lng: number | null } | null> {
  if (!patient.clinicId) return null;
  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, patient.clinicId)).limit(1);
  if (!clinic || !clinic.address) return null;
  return { address: clinic.address, lat: clinic.lat, lng: clinic.lng };
}

export async function generateTripsForSchedule(
  schedule: RecurringSchedule,
  patient: Patient,
  timezone: string
): Promise<number> {
  if (!patient.address) {
    console.log(`[RECURRING-SCHEDULE] Skipping schedule #${schedule.id}: patient ${patient.id} has no address`);
    return 0;
  }

  const endDate = schedule.endDate || null;
  const dates = getDatesInRollingWindow(schedule.days, timezone, schedule.startDate, endDate);
  let created = 0;

  const clinicData = await getClinicForPatient(patient);
  const dropoffAddress = clinicData?.address || "TBD - Clinic";
  const dropoffLat = clinicData?.lat || null;
  const dropoffLng = clinicData?.lng || null;

  for (const date of dates) {
    const exists = await tripExistsForDate(patient.id, date, schedule.pickupTime);
    if (exists) continue;

    const publicId = await generatePublicId();

    await db.insert(trips).values({
      publicId,
      cityId: schedule.cityId,
      patientId: patient.id,
      pickupAddress: patient.address || "TBD",
      pickupStreet: patient.addressStreet,
      pickupCity: patient.addressCity,
      pickupState: patient.addressState,
      pickupZip: patient.addressZip,
      pickupPlaceId: patient.addressPlaceId,
      pickupLat: patient.lat,
      pickupLng: patient.lng,
      dropoffAddress,
      dropoffLat,
      dropoffLng,
      scheduledDate: date,
      scheduledTime: schedule.pickupTime,
      pickupTime: schedule.pickupTime,
      estimatedArrivalTime: schedule.pickupTime,
      tripType: "recurring",
      recurringDays: schedule.days,
      status: "SCHEDULED",
      notes: `Auto-generated from recurring schedule #${schedule.id}`,
    });
    created++;
  }

  return created;
}

export async function runRecurringScheduleGenerator(): Promise<{ total: number; schedules: number }> {
  const schedules = await storage.getActiveRecurringSchedules();
  let totalCreated = 0;
  let processedSchedules = 0;

  for (const schedule of schedules) {
    try {
      const [patient] = await db.select().from(patients).where(eq(patients.id, schedule.patientId)).limit(1);
      if (!patient || !patient.active || patient.deletedAt) continue;

      const cities = await storage.getCities();
      const city = cities.find(c => c.id === schedule.cityId);
      const timezone = (city as any)?.timezone || "America/Los_Angeles";

      const created = await generateTripsForSchedule(schedule, patient, timezone);
      totalCreated += created;
      processedSchedules++;

      if (created > 0) {
        console.log(`[RECURRING-SCHEDULE] Generated ${created} trips for patient ${patient.publicId} (schedule #${schedule.id})`);
      }
    } catch (err: any) {
      console.error(`[RECURRING-SCHEDULE] Error processing schedule #${schedule.id}:`, err.message);
    }
  }

  console.log(`[RECURRING-SCHEDULE] Processed ${processedSchedules} schedules, created ${totalCreated} trips`);
  return { total: totalCreated, schedules: processedSchedules };
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastRunDate: string | null = null;

export function startRecurringScheduleScheduler() {
  if (schedulerInterval) return;

  const INTERVAL = 60_000;

  schedulerInterval = setInterval(async () => {
    try {
      const cities = await storage.getActiveCities();
      for (const city of cities) {
        const timezone = (city as any)?.timezone || "America/Los_Angeles";
        const localTime = new Date().toLocaleTimeString("en-US", { timeZone: timezone, hour12: false, hour: "2-digit", minute: "2-digit" });
        const localDate = new Date().toLocaleDateString("en-CA", { timeZone: timezone });

        if (localTime >= "00:00" && localTime <= "00:05" && lastRunDate !== localDate) {
          lastRunDate = localDate;
          await runRecurringScheduleGenerator();
          break;
        }
      }
    } catch (err: any) {
      console.error("[RECURRING-SCHEDULE] Scheduler error:", err.message);
    }
  }, INTERVAL);

  console.log("[RECURRING-SCHEDULE] Scheduler started (checks every 60s for midnight window)");
}

export function stopRecurringScheduleScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[RECURRING-SCHEDULE] Scheduler stopped");
  }
}
