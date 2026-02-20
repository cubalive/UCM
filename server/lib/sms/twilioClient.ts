import Twilio from "twilio";

const TWILIO_ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID || "").trim();
const TWILIO_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || "").trim();
const TWILIO_FROM_NUMBER = (process.env.TWILIO_FROM_NUMBER || "").trim();

export interface TwilioBootStatus {
  configured: boolean;
  sidValid: boolean;
  tokenPresent: boolean;
  fromNumberValid: boolean;
  fromNumberMasked: string;
  errors: string[];
}

function maskPhone(phone: string): string {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, 4) + "****" + phone.slice(-2);
}

function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

let bootStatus: TwilioBootStatus | null = null;
let client: Twilio.Twilio | null = null;

export function validateTwilioAtBoot(): TwilioBootStatus {
  const errors: string[] = [];

  const sidValid = TWILIO_ACCOUNT_SID.startsWith("AC") && TWILIO_ACCOUNT_SID.length >= 30;
  if (!TWILIO_ACCOUNT_SID) {
    errors.push("TWILIO_ACCOUNT_SID is not set");
  } else if (!sidValid) {
    errors.push(`TWILIO_ACCOUNT_SID does not start with "AC" or is too short`);
  }

  const tokenPresent = TWILIO_AUTH_TOKEN.length >= 20;
  if (!TWILIO_AUTH_TOKEN) {
    errors.push("TWILIO_AUTH_TOKEN is not set");
  } else if (!tokenPresent) {
    errors.push("TWILIO_AUTH_TOKEN appears too short");
  }

  const fromNumberValid = isValidE164(TWILIO_FROM_NUMBER);
  if (!TWILIO_FROM_NUMBER) {
    errors.push("TWILIO_FROM_NUMBER is not set");
  } else if (!fromNumberValid) {
    errors.push(`TWILIO_FROM_NUMBER "${maskPhone(TWILIO_FROM_NUMBER)}" is not valid E.164`);
  }

  const configured = sidValid && tokenPresent && fromNumberValid;

  bootStatus = {
    configured,
    sidValid,
    tokenPresent,
    fromNumberValid,
    fromNumberMasked: maskPhone(TWILIO_FROM_NUMBER),
    errors,
  };

  if (configured) {
    console.log(`[SMS-BOOT] Twilio configured: SID=AC***${TWILIO_ACCOUNT_SID.slice(-4)}, FROM=${maskPhone(TWILIO_FROM_NUMBER)}`);
  } else {
    console.warn(`[SMS-BOOT] Twilio NOT fully configured: ${errors.join("; ")}`);
    console.warn(`[SMS-BOOT] SMS sending will be disabled until secrets are fixed.`);
  }

  return bootStatus;
}

export function getBootStatus(): TwilioBootStatus {
  if (!bootStatus) return validateTwilioAtBoot();
  return bootStatus;
}

export function getTwilioClient(): Twilio.Twilio | null {
  if (client) return client;
  const status = getBootStatus();
  if (!status.configured) return null;
  client = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return client;
}

export function getTwilioFromNumber(): string {
  return TWILIO_FROM_NUMBER;
}

export function isTwilioConfigured(): boolean {
  return getBootStatus().configured;
}

export function getDispatchPhone(): string {
  return process.env.DISPATCH_PHONE_NUMBER || TWILIO_FROM_NUMBER || "";
}

export function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.startsWith("+") && isValidE164(phone)) return phone;
  return null;
}

export { isValidE164, maskPhone };
