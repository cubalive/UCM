import Twilio from "twilio";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "";

let twilioClient: Twilio.Twilio | null = null;

function getClient(): Twilio.Twilio | null {
  if (twilioClient) return twilioClient;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return twilioClient;
}

export function isTwilioConfigured(): boolean {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);
}

export function getDispatchPhone(): string {
  return process.env.DISPATCH_PHONE_NUMBER || TWILIO_FROM_NUMBER || "";
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.startsWith("+") && isValidE164(phone)) return phone;
  return null;
}

export interface SendSmsResult {
  success: boolean;
  sid?: string;
  error?: string;
}

export async function sendSms(to: string, message: string): Promise<SendSmsResult> {
  const client = getClient();
  if (!client) {
    console.error("[SMS] Twilio client not configured");
    return { success: false, error: "Twilio not configured" };
  }
  if (!TWILIO_FROM_NUMBER) {
    console.error("[SMS] TWILIO_FROM_NUMBER not set");
    return { success: false, error: "TWILIO_FROM_NUMBER not set" };
  }

  const normalized = normalizePhone(to);
  const dest = normalized || to;
  if (!isValidE164(dest)) {
    console.error(`[SMS] Invalid phone after normalization: ${to} → ${dest}`);
    return { success: false, error: "Invalid phone number" };
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const msg = await client.messages.create({
        to: dest,
        from: TWILIO_FROM_NUMBER,
        body: message,
      });
      console.log(`[SMS] Sent to ${dest}, SID: ${msg.sid}, attempt: ${attempt}`);
      return { success: true, sid: msg.sid };
    } catch (err: any) {
      console.error(`[SMS] Attempt ${attempt} failed for ${dest}: ${err.message}`);
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
  | "canceled";

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
    `${PREFIX} ${v.driver_name || "Your driver"} has been assigned to your trip.${OPT_OUT}`,
  en_route: (v) => {
    const eta = v.eta_minutes != null ? ` ETA ${v.eta_minutes} min.` : "";
    const mapLink = v.pickup_lat && v.pickup_lng
      ? ` Track: https://maps.google.com/?q=${v.pickup_lat},${v.pickup_lng}`
      : v.tracking_url ? ` Track: ${v.tracking_url}` : "";
    return `${PREFIX} ${v.driver_name || "Your driver"} is on the way.${eta}${mapLink}${OPT_OUT}`;
  },
  arriving_soon: (v) => {
    const eta = v.eta_minutes != null ? `about ${v.eta_minutes} minutes` : "about 5 minutes";
    const mapLink = v.pickup_lat && v.pickup_lng
      ? ` Track: https://maps.google.com/?q=${v.pickup_lat},${v.pickup_lng}`
      : v.tracking_url ? ` Track: ${v.tracking_url}` : "";
    return `${PREFIX} Your driver will arrive in ${eta}.${mapLink}${OPT_OUT}`;
  },
  eta_10: (v) => {
    const mapLink = v.pickup_lat && v.pickup_lng
      ? ` Track: https://maps.google.com/?q=${v.pickup_lat},${v.pickup_lng}`
      : "";
    return `${PREFIX} ${v.driver_name || "Your driver"} is about 10 minutes away.${mapLink}${OPT_OUT}`;
  },
  eta_5: (v) => {
    const mapLink = v.pickup_lat && v.pickup_lng
      ? ` Track: https://maps.google.com/?q=${v.pickup_lat},${v.pickup_lng}`
      : "";
    return `${PREFIX} ${v.driver_name || "Your driver"} is about 5 minutes away.${mapLink}${OPT_OUT}`;
  },
  arrived: () =>
    `${PREFIX} Your driver has arrived.${OPT_OUT}`,
  picked_up: () =>
    `${PREFIX} You are now picked up.${OPT_OUT}`,
  completed: () =>
    `${PREFIX} Trip completed. Thank you.${OPT_OUT}`,
  canceled: (v) => {
    const dispatch = v.dispatch_phone || "your dispatch office";
    return `${PREFIX} Trip cancelled. Call dispatch ${dispatch}.${OPT_OUT}`;
  },
};

export function buildNotifyMessage(status: TripNotifyStatus, vars: TemplateVars): string {
  const fn = TEMPLATES[status];
  return fn(vars);
}
