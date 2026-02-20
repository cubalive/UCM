import crypto from "crypto";
import { getTwilioClient, getTwilioFromNumber, isTwilioConfigured, normalizePhone, maskPhone, getDispatchPhone, isValidE164 } from "./twilioClient";
import { storage } from "../../storage";

export type SmsEventType =
  | "TRIP_CONFIRMED"
  | "REMINDER_24H"
  | "DRIVER_ASSIGNED"
  | "EN_ROUTE"
  | "ARRIVED_PICKUP"
  | "TRIP_STARTED"
  | "TRIP_COMPLETED"
  | "TRIP_CANCELLED"
  | "NO_SHOW"
  | "TEST";

export interface SendSmsParams {
  companyId: number;
  to: string;
  body: string;
  purpose: SmsEventType;
  tripId?: number;
  patientId?: number;
  driverId?: number;
  idempotencyKey?: string;
}

export interface SendSmsResult {
  success: boolean;
  status: "sent" | "failed" | "skipped" | "rate_limited" | "duplicate" | "not_configured";
  sid?: string;
  errorCode?: string;
  errorMessage?: string;
}

const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.SMS_RATE_LIMIT_WINDOW_SEC || "3600", 10) * 1000;
const RATE_LIMIT_MAX = parseInt(process.env.SMS_RATE_LIMIT_MAX || "20", 10);
const MAX_BODY_LENGTH = 1600;
const WARN_BODY_LENGTH = 320;

const recentIdempotencyKeys = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of recentIdempotencyKeys) {
    if (now - ts > IDEMPOTENCY_TTL_MS) recentIdempotencyKeys.delete(key);
  }
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

function buildIdempotencyKey(params: SendSmsParams): string {
  if (params.idempotencyKey) return params.idempotencyKey;
  const bucket = new Date().toISOString().slice(0, 16);
  return `${params.companyId}|${params.purpose}|${params.tripId || ""}|${params.to}|${bucket}`;
}

function checkRateLimit(phone: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(phone);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(phone, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

function mapTwilioError(err: any): { code: string; message: string; retryable: boolean } {
  const code = String(err.code || err.status || "UNKNOWN");
  const message = err.message || "Unknown Twilio error";
  const retryableCodes = ["20003", "20429", "52009", "30008"];
  return {
    code,
    message,
    retryable: retryableCodes.includes(code) || code === "UNKNOWN",
  };
}

export async function sendSms(params: SendSmsParams): Promise<SendSmsResult> {
  const phoneMasked = maskPhone(params.to);
  const logPrefix = `[SMS] company=${params.companyId} purpose=${params.purpose} trip=${params.tripId || "n/a"}`;

  if (!isTwilioConfigured()) {
    console.warn(`${logPrefix} to=${phoneMasked} status=not_configured`);
    await logSmsEvent(params, "skipped", undefined, undefined, "Twilio not configured");
    return { success: false, status: "not_configured", errorMessage: "Twilio not configured" };
  }

  const normalized = normalizePhone(params.to);
  if (!normalized || !isValidE164(normalized)) {
    console.warn(`${logPrefix} to=${phoneMasked} status=skipped reason=invalid_phone`);
    await logSmsEvent(params, "skipped", undefined, undefined, "Invalid phone number");
    return { success: false, status: "skipped", errorMessage: "Invalid phone number" };
  }
  params.to = normalized;

  if (params.body.length > MAX_BODY_LENGTH) {
    params.body = params.body.slice(0, MAX_BODY_LENGTH);
    console.warn(`${logPrefix} body truncated to ${MAX_BODY_LENGTH} chars`);
  } else if (params.body.length > WARN_BODY_LENGTH) {
    console.warn(`${logPrefix} body length ${params.body.length} exceeds ${WARN_BODY_LENGTH} (multi-segment SMS)`);
  }

  const idempKey = buildIdempotencyKey(params);
  if (recentIdempotencyKeys.has(idempKey)) {
    console.log(`${logPrefix} to=${phoneMasked} status=duplicate key=${idempKey.slice(0, 30)}`);
    await logSmsEvent(params, "skipped", undefined, undefined, "Duplicate (idempotency)");
    return { success: false, status: "duplicate", errorMessage: "Duplicate send prevented" };
  }

  if (params.tripId && params.purpose !== "TEST") {
    try {
      const alreadySent = await storage.hasSmsBeenSent(params.tripId, purposeToKind(params.purpose));
      if (alreadySent) {
        console.log(`${logPrefix} to=${phoneMasked} status=duplicate (DB)`);
        recentIdempotencyKeys.set(idempKey, Date.now());
        return { success: false, status: "duplicate", errorMessage: "Already sent for this trip+event" };
      }
    } catch {}
  }

  if (!checkRateLimit(normalized)) {
    console.warn(`${logPrefix} to=${phoneMasked} status=rate_limited`);
    await logSmsEvent(params, "rate_limited", undefined, undefined, `Rate limit exceeded (${RATE_LIMIT_MAX}/${RATE_LIMIT_WINDOW_MS / 1000}s)`);
    return { success: false, status: "rate_limited", errorMessage: "Rate limit exceeded" };
  }

  try {
    const optedOut = await storage.isPhoneOptedOut(normalized);
    if (optedOut) {
      console.log(`${logPrefix} to=${phoneMasked} status=skipped reason=opted_out`);
      await logSmsEvent(params, "skipped", undefined, undefined, "Patient opted out");
      return { success: false, status: "skipped", errorMessage: "Patient opted out of SMS" };
    }
  } catch {}

  const client = getTwilioClient();
  if (!client) {
    await logSmsEvent(params, "failed", undefined, undefined, "Twilio client init failed");
    return { success: false, status: "failed", errorMessage: "Twilio client init failed" };
  }

  const fromNumber = getTwilioFromNumber();
  let lastError: { code: string; message: string; retryable: boolean } | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const msg = await client.messages.create({
        to: normalized,
        from: fromNumber,
        body: params.body,
      });

      console.log(`${logPrefix} to=${phoneMasked} status=sent sid=${msg.sid} attempt=${attempt}`);
      recentIdempotencyKeys.set(idempKey, Date.now());

      await logSmsEvent(params, "sent", msg.sid);

      if (params.tripId && params.purpose !== "TEST") {
        try {
          await storage.createTripSmsLog({
            tripId: params.tripId,
            kind: purposeToKind(params.purpose),
            toPhone: normalized,
            providerSid: msg.sid,
          });
        } catch {}
      }

      updateSmsMetrics(true);
      return { success: true, status: "sent", sid: msg.sid };
    } catch (err: any) {
      lastError = mapTwilioError(err);
      console.error(`${logPrefix} to=${phoneMasked} attempt=${attempt} error=${lastError.code}: ${lastError.message}`);

      if (!lastError.retryable || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 500));
    }
  }

  const errorCode = lastError?.code || "UNKNOWN";
  const errorMessage = lastError?.message || "SMS send failed after retries";

  await logSmsEvent(params, "failed", undefined, errorCode, errorMessage);

  if (params.tripId && params.purpose !== "TEST") {
    try {
      await storage.createTripSmsLog({
        tripId: params.tripId,
        kind: purposeToKind(params.purpose),
        toPhone: normalized,
        error: `${errorCode}: ${errorMessage}`,
      });
    } catch {}
  }

  updateSmsMetrics(false);
  return { success: false, status: "failed", errorCode, errorMessage };
}

function purposeToKind(purpose: SmsEventType): string {
  const map: Record<SmsEventType, string> = {
    TRIP_CONFIRMED: "scheduled",
    REMINDER_24H: "reminder_24h",
    DRIVER_ASSIGNED: "driver_assigned",
    EN_ROUTE: "en_route",
    ARRIVED_PICKUP: "arrived",
    TRIP_STARTED: "picked_up",
    TRIP_COMPLETED: "completed",
    TRIP_CANCELLED: "canceled",
    NO_SHOW: "no_show",
    TEST: "test",
  };
  return map[purpose] || purpose.toLowerCase();
}

async function logSmsEvent(
  params: SendSmsParams,
  status: string,
  twilioSid?: string,
  errorCode?: string,
  errorMessage?: string,
) {
  try {
    const { pool } = await import("../../db");
    await pool.query(
      `INSERT INTO sms_events (company_id, trip_id, patient_id, driver_id, to_phone, from_phone, purpose, status, twilio_sid, error_code, error_message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        params.companyId,
        params.tripId || null,
        params.patientId || null,
        params.driverId || null,
        maskPhone(params.to),
        maskPhone(getTwilioFromNumber()),
        params.purpose,
        status,
        twilioSid || null,
        errorCode || null,
        errorMessage || null,
        JSON.stringify({ timestamp: new Date().toISOString() }),
      ]
    );
  } catch (err: any) {
    console.error(`[SMS-AUDIT] Failed to log sms_event: ${err.message}`);
  }
}

let smsMetrics = { sent: 0, failed: 0, lastSendAt: null as string | null, lastError: null as string | null, lastTwilioSid: null as string | null };

function updateSmsMetrics(success: boolean) {
  if (success) {
    smsMetrics.sent++;
    smsMetrics.lastSendAt = new Date().toISOString();
  } else {
    smsMetrics.failed++;
  }
}

export function getSmsMetrics() {
  return { ...smsMetrics };
}

export function resetSmsMetrics() {
  smsMetrics = { sent: 0, failed: 0, lastSendAt: null, lastError: null, lastTwilioSid: null };
}

export { normalizePhone, maskPhone, isValidE164, getDispatchPhone, isTwilioConfigured };
