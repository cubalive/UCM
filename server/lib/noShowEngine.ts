import { storage } from "../storage";
import type { City } from "@shared/schema";

function getCityLocalDate(timezone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}

export async function runConfirmationChecks(city: City): Promise<{ sent24h: number; sent2h: number; risked: number }> {
  const timezone = city.timezone || "America/New_York";
  const today = getCityLocalDate(timezone);

  const unconfirmed = await storage.getUnconfirmedTripsForDate(city.id, today);

  let sent24h = 0;
  let sent2h = 0;
  let risked = 0;

  const nowCity = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
  const nowHour = nowCity.getHours();
  const nowMin = nowCity.getMinutes();
  const nowTotalMin = nowHour * 60 + nowMin;

  for (const trip of unconfirmed) {
    const [ph, pm] = (trip.pickupTime || "08:00").split(":").map(Number);
    const pickupTotalMin = ph * 60 + pm;
    const minutesUntilPickup = pickupTotalMin - nowTotalMin;

    if (trip.confirmationStatus === "unconfirmed" && minutesUntilPickup <= 120 && minutesUntilPickup > 0) {
      await storage.updateTripConfirmation(trip.id, "reminder_sent");
      sent2h++;
      console.log(`[NO-SHOW] T-2h reminder stub for trip ${trip.publicId} (patient ${trip.patientId})`);
    }

    if (trip.confirmationStatus === "unconfirmed" || trip.confirmationStatus === "reminder_sent") {
      if (minutesUntilPickup <= 30 && minutesUntilPickup > 0) {
        await storage.updateTripConfirmation(trip.id, "at_risk");
        risked++;
      }
    }
  }

  return { sent24h, sent2h, risked };
}

export async function checkPatientNoShowStrikes(patientId: number, clinicId: number | null): Promise<{ count: number; alertSent: boolean }> {
  const count = await storage.getPatientNoShowCount(patientId);

  if (count >= 3 && clinicId) {
    console.log(`[NO-SHOW] Patient ${patientId} has ${count} no-shows - alerting clinic ${clinicId}`);
    return { count, alertSent: true };
  }

  return { count, alertSent: false };
}

let noShowSchedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startNoShowScheduler() {
  if (noShowSchedulerInterval) return;

  noShowSchedulerInterval = setInterval(async () => {
    try {
      const cities = await storage.getActiveCities();
      for (const city of cities) {
        await runConfirmationChecks(city);
      }
    } catch (err: any) {
      console.error("[NO-SHOW] Scheduler error:", err.message);
    }
  }, 5 * 60 * 1000);

  console.log("[NO-SHOW] Confirmation scheduler started (checks every 5 min)");
}

export function stopNoShowScheduler() {
  if (noShowSchedulerInterval) {
    clearInterval(noShowSchedulerInterval);
    noShowSchedulerInterval = null;
  }
}
