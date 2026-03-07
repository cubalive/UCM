export {
  isTwilioConfigured,
  getDispatchPhone,
  isValidE164,
  normalizePhone,
  maskPhone,
} from "./sms/twilioClient";

export { sendSms as sendSmsRaw } from "./sms/smsService";

import { getTwilioClient, getTwilioFromNumber, normalizePhone, isValidE164 } from "./sms/twilioClient";

export interface SendSmsResult {
  success: boolean;
  sid?: string;
  error?: string;
}

let _twilioNotConfiguredLogged = false;

export async function sendSms(to: string, message: string): Promise<SendSmsResult> {
  const client = getTwilioClient();
  if (!client) {
    if (!_twilioNotConfiguredLogged) {
      console.warn("[SMS] Twilio not configured — SMS sending disabled. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER to enable.");
      _twilioNotConfiguredLogged = true;
    }
    return { success: false, error: "Twilio not configured" };
  }
  const fromNumber = getTwilioFromNumber();
  if (!fromNumber) {
    console.error("[SMS] TWILIO_FROM_NUMBER not set");
    return { success: false, error: "TWILIO_FROM_NUMBER not set" };
  }

  const normalized = normalizePhone(to) || to;
  if (!isValidE164(normalized)) {
    console.error(`[SMS] Invalid phone after normalization: ${to}`);
    return { success: false, error: "Invalid phone number" };
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const msg = await client.messages.create({
        to: normalized,
        from: fromNumber,
        body: message,
      });
      console.log(`[SMS] Sent to ***${normalized.slice(-4)}, SID: ${msg.sid}, attempt: ${attempt}`);
      return { success: true, sid: msg.sid };
    } catch (err: any) {
      console.error(`[SMS] Attempt ${attempt} failed for ***${normalized.slice(-4)}: ${err.message}`);
      if (attempt === 2) {
        return { success: false, error: err.message };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return { success: false, error: "SMS send failed after retries" };
}

export type TripNotifyStatus =
  | "scheduled"
  | "driver_assigned"
  | "en_route"
  | "arriving_soon"
  | "eta_10"
  | "eta_5"
  | "arrived"
  | "picked_up"
  | "completed"
  | "canceled"
  | "reminder_24h"
  | "no_show";

interface TemplateVars {
  pickup_time?: string;
  driver_name?: string;
  vehicle_label?: string;
  eta_minutes?: number | null;
  dispatch_phone?: string;
  tracking_url?: string;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
}

const PREFIX = "United Care Mobility:";
const OPT_OUT = "\nReply STOP to opt out.";

const TEMPLATES: Record<TripNotifyStatus, (v: TemplateVars) => string> = {
  scheduled: (v) =>
    `${PREFIX} Your ride is scheduled for ${v.pickup_time || "your appointment time"}.${OPT_OUT}`,
  driver_assigned: (v) =>
    `${PREFIX} ${v.driver_name || "Your driver"} has been assigned to your trip.${v.vehicle_label ? ` Vehicle: ${v.vehicle_label}.` : ""}${v.tracking_url ? ` Track: ${v.tracking_url}` : ""}${v.dispatch_phone ? `\nNeed help? Call: ${v.dispatch_phone}` : ""}${OPT_OUT}`,
  en_route: (v) => {
    const eta = v.eta_minutes != null ? ` ETA ${v.eta_minutes} min.` : "";
    const track = v.tracking_url ? ` Track: ${v.tracking_url}` : "";
    return `${PREFIX} ${v.driver_name || "Your driver"} is on the way.${eta}${track}${v.dispatch_phone ? `\nNeed help? Call: ${v.dispatch_phone}` : ""}${OPT_OUT}`;
  },
  arriving_soon: (v) => {
    const eta = v.eta_minutes != null ? `about ${v.eta_minutes} minutes` : "about 5 minutes";
    return `${PREFIX} Your driver will arrive in ${eta}.${OPT_OUT}`;
  },
  eta_10: (v) =>
    `${PREFIX} ${v.driver_name || "Your driver"} is about 10 minutes away.${OPT_OUT}`,
  eta_5: (v) =>
    `${PREFIX} ${v.driver_name || "Your driver"} is about 5 minutes away.${OPT_OUT}`,
  arrived: (v) =>
    `${PREFIX} ${v.driver_name || "Your driver"} has arrived.${v.dispatch_phone ? `\nNeed help? Call: ${v.dispatch_phone}` : ""}${OPT_OUT}`,
  picked_up: () =>
    `${PREFIX} You are now picked up.${OPT_OUT}`,
  completed: () =>
    `${PREFIX} Trip completed. Thank you.${OPT_OUT}`,
  canceled: (v) => {
    const dispatch = v.dispatch_phone || "your dispatch office";
    return `${PREFIX} Trip cancelled. Call dispatch ${dispatch}.${OPT_OUT}`;
  },
  reminder_24h: (v) => {
    const trackLink = v.tracking_url ? ` Track: ${v.tracking_url}` : "";
    const driverInfo = v.driver_name ? ` Driver: ${v.driver_name}.` : "";
    return `${PREFIX} Reminder: your ride is tomorrow at ${v.pickup_time || "your appointment time"}.${driverInfo}${trackLink}${OPT_OUT}`;
  },
  no_show: (v) => {
    const dispatch = v.dispatch_phone || "your dispatch office";
    return `${PREFIX} We couldn't locate you at pickup. Contact dispatch: ${dispatch}.${OPT_OUT}`;
  },
};

export function buildNotifyMessage(status: TripNotifyStatus, vars: TemplateVars): string {
  const fn = TEMPLATES[status];
  if (!fn) return `${PREFIX} Notification for your trip.${OPT_OUT}`;
  return fn(vars);
}
