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
    return { success: false, error: "Twilio not configured" };
  }
  if (!TWILIO_FROM_NUMBER) {
    return { success: false, error: "TWILIO_FROM_NUMBER not set" };
  }
  if (!isValidE164(to)) {
    return { success: false, error: "Invalid E.164 phone number" };
  }

  try {
    const msg = await client.messages.create({
      to,
      from: TWILIO_FROM_NUMBER,
      body: message,
    });
    console.log(`[SMS] Sent to ${to}, SID: ${msg.sid}`);
    return { success: true, sid: msg.sid };
  } catch (err: any) {
    console.error(`[SMS] Failed to send to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

export type TripNotifyStatus =
  | "scheduled"
  | "driver_assigned"
  | "en_route"
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
}

const TEMPLATES: Record<TripNotifyStatus, (v: TemplateVars) => string> = {
  scheduled: (v) =>
    `Your ride is scheduled for ${v.pickup_time || "your appointment time"}. Reply STOP to opt out.`,
  driver_assigned: (v) =>
    `${v.driver_name || "Your driver"} is assigned. Vehicle: ${v.vehicle_label || "TBD"}.`,
  en_route: (v) => {
    const eta = v.eta_minutes != null ? ` ETA: ${v.eta_minutes} minutes.` : "";
    return `${v.driver_name || "Your driver"} is on the way.${eta}`;
  },
  arrived: (v) =>
    `${v.driver_name || "Your driver"} has arrived.`,
  picked_up: () =>
    `You are now picked up.`,
  completed: () =>
    `Trip completed. Thank you.`,
  canceled: (v) =>
    `Trip canceled. Call dispatch: ${v.dispatch_phone || "your dispatch office"}.`,
};

export function buildNotifyMessage(status: TripNotifyStatus, vars: TemplateVars): string {
  const fn = TEMPLATES[status];
  return fn(vars);
}
