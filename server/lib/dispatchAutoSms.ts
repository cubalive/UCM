import { sendTripSms } from "./sms/tripNotifier";
import type { SmsEventType } from "./sms/smsService";

const STATUS_TO_EVENT: Record<string, SmsEventType> = {
  scheduled: "TRIP_CONFIRMED",
  driver_assigned: "DRIVER_ASSIGNED",
  en_route: "EN_ROUTE",
  arriving_soon: "EN_ROUTE",
  arrived: "ARRIVED_PICKUP",
  picked_up: "TRIP_STARTED",
  completed: "TRIP_COMPLETED",
  canceled: "TRIP_CANCELLED",
  reminder_24h: "REMINDER_24H",
  no_show: "NO_SHOW",
  eta_10: "EN_ROUTE",
  eta_5: "EN_ROUTE",
  cascade_delay: "EN_ROUTE",
};

export async function autoNotifyPatient(
  tripId: number,
  status: string,
  extraVars?: { eta_minutes?: number | null; base_url?: string }
) {
  const eventType = STATUS_TO_EVENT[status];
  if (!eventType) {
    console.warn(`[SMS-AUTO] Unknown status "${status}" for trip ${tripId}, skipping`);
    return;
  }
  await sendTripSms(tripId, eventType, { etaMinutes: extraVars?.eta_minutes ?? null });
}
