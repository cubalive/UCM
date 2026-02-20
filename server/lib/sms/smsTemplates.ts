import type { SmsEventType } from "./smsService";

export interface TemplateData {
  patientFirstName?: string;
  driverName?: string;
  vehicleSummary?: string;
  pickupTime?: string;
  pickupDate?: string;
  etaMinutes?: number | null;
  trackingUrl?: string;
  dispatchPhone?: string;
}

const BRAND = "United Care Mobility";
const OPT_OUT = "\nReply STOP to opt out.";

function dispatchLine(phone?: string): string {
  if (!phone) return "";
  return `\nNeed help? Call dispatch: ${phone}`;
}

function trackLine(url?: string): string {
  if (!url) return "";
  return `\nTrack your ride: ${url}`;
}

function vehicleLine(summary?: string): string {
  if (!summary) return "";
  return ` Vehicle: ${summary}.`;
}

function greeting(name?: string): string {
  if (!name) return "";
  return `Hi ${name}! `;
}

const templates: Record<SmsEventType, (d: TemplateData) => string> = {
  TRIP_CONFIRMED: (d) =>
    `${greeting(d.patientFirstName)}${BRAND}: Your ride is confirmed for ${d.pickupDate || "your appointment"} at ${d.pickupTime || "the scheduled time"}.${trackLine(d.trackingUrl)}${dispatchLine(d.dispatchPhone)}${OPT_OUT}`,

  REMINDER_24H: (d) =>
    `${greeting(d.patientFirstName)}${BRAND} Reminder: Your ride is tomorrow at ${d.pickupTime || "your scheduled time"}.${d.driverName ? ` Driver: ${d.driverName}.` : ""}${vehicleLine(d.vehicleSummary)}${trackLine(d.trackingUrl)}${dispatchLine(d.dispatchPhone)}${OPT_OUT}`,

  DRIVER_ASSIGNED: (d) =>
    `${greeting(d.patientFirstName)}${BRAND}: ${d.driverName || "Your driver"} has been assigned to your ride.${vehicleLine(d.vehicleSummary)} Pickup: ${d.pickupTime || "as scheduled"}.${trackLine(d.trackingUrl)}${dispatchLine(d.dispatchPhone)}${OPT_OUT}`,

  EN_ROUTE: (d) => {
    const eta = d.etaMinutes != null ? ` ETA: ${d.etaMinutes} min.` : "";
    return `${greeting(d.patientFirstName)}${BRAND}: ${d.driverName || "Your driver"} is on the way!${eta}${vehicleLine(d.vehicleSummary)}${trackLine(d.trackingUrl)}${dispatchLine(d.dispatchPhone)}${OPT_OUT}`;
  },

  ARRIVED_PICKUP: (d) =>
    `${greeting(d.patientFirstName)}${BRAND}: ${d.driverName || "Your driver"} has arrived at your pickup location.${vehicleLine(d.vehicleSummary)}${dispatchLine(d.dispatchPhone)}${OPT_OUT}`,

  TRIP_STARTED: (d) =>
    `${BRAND}: Your ride has started. Have a safe trip!${dispatchLine(d.dispatchPhone)}${OPT_OUT}`,

  TRIP_COMPLETED: (d) =>
    `${BRAND}: Your trip is complete. Thank you for riding with us!${dispatchLine(d.dispatchPhone)}${OPT_OUT}`,

  TRIP_CANCELLED: (d) =>
    `${BRAND}: Your scheduled ride has been cancelled. Please contact dispatch if you need to reschedule.${dispatchLine(d.dispatchPhone)}${OPT_OUT}`,

  NO_SHOW: (d) =>
    `${BRAND}: We were unable to locate you at the pickup. Please contact dispatch to reschedule.${dispatchLine(d.dispatchPhone)}${OPT_OUT}`,

  TEST: () =>
    `${BRAND}: Test message verified successfully. SMS is working.${OPT_OUT}`,
};

export function buildSmsBody(eventType: SmsEventType, data: TemplateData): string {
  const fn = templates[eventType];
  if (!fn) return `${BRAND}: Notification for your trip.${OPT_OUT}`;
  return fn(data);
}

export function previewSmsBody(eventType: SmsEventType, data: TemplateData): { body: string; charCount: number; segments: number } {
  const body = buildSmsBody(eventType, data);
  const segments = Math.ceil(body.length / 160);
  return { body, charCount: body.length, segments };
}
