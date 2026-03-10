import crypto from "crypto";
import { db } from "../db";
import { trips, tripConfirmations, patients, companies } from "@shared/schema";
import { eq, and, gte, lte, isNull, inArray, count, sql } from "drizzle-orm";
import { storage } from "../storage";
import { sendSms as sendSmsCentral, normalizePhone, getDispatchPhone, maskPhone } from "./sms/smsService";

const BRAND = "United Care Mobility";
const OPT_OUT = "\nReply STOP to opt out.";

function getBaseUrl(): string {
  return (
    process.env.PUBLIC_BASE_URL_APP ||
    process.env.PUBLIC_BASE_URL ||
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "https://app.unitedcaremobility.com")
  );
}

/**
 * Generate a unique confirmation token for a trip.
 */
function generateConfirmationToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

/**
 * Build the SMS body for a 24h confirmation request.
 */
function buildConfirmation24hBody(opts: {
  patientFirstName?: string;
  pickupTime?: string;
  pickupDate?: string;
  driverName?: string;
  confirmUrl: string;
  dispatchPhone?: string;
}): string {
  const greeting = opts.patientFirstName ? `Hi ${opts.patientFirstName}! ` : "";
  const timeStr = opts.pickupTime || "your scheduled time";
  const dateStr = opts.pickupDate || "tomorrow";
  return (
    `${greeting}${BRAND}: Your ride is scheduled for ${dateStr} at ${timeStr}. ` +
    `Please confirm by replying YES or click: ${opts.confirmUrl}` +
    `\nReply NO if you need to cancel.` +
    (opts.dispatchPhone ? `\nNeed help? Call dispatch: ${opts.dispatchPhone}` : "") +
    OPT_OUT
  );
}

/**
 * Build the SMS body for a 2h urgent confirmation reminder.
 */
function buildConfirmation2hBody(opts: {
  patientFirstName?: string;
  pickupTime?: string;
  confirmUrl: string;
  dispatchPhone?: string;
}): string {
  const greeting = opts.patientFirstName ? `Hi ${opts.patientFirstName}! ` : "";
  const timeStr = opts.pickupTime || "your scheduled time";
  return (
    `${greeting}${BRAND} URGENT: Your ride is in ~2 hours (pickup at ${timeStr}). ` +
    `We have not received your confirmation. ` +
    `Reply YES to confirm or click: ${opts.confirmUrl}` +
    `\nReply NO to cancel.` +
    (opts.dispatchPhone ? `\nCall dispatch: ${opts.dispatchPhone}` : "") +
    OPT_OUT
  );
}

/**
 * Resolve common trip + patient + company data needed for confirmation SMS.
 */
async function resolveTripContext(tripId: number) {
  const trip = await storage.getTrip(tripId);
  if (!trip) return null;
  if (!trip.companyId) return null;

  const patient = await storage.getPatient(trip.patientId);
  if (!patient) return null;

  const phone = patient.phone ? normalizePhone(patient.phone) : null;
  if (!phone) return null;

  let dispatchPhone: string | undefined;
  try {
    const company = await storage.getCompany(trip.companyId);
    if (company?.dispatchPhone) dispatchPhone = company.dispatchPhone;
  } catch {}
  if (!dispatchPhone) dispatchPhone = getDispatchPhone() || undefined;

  let driverName: string | undefined;
  if (trip.driverId) {
    try {
      const driver = await storage.getDriver(trip.driverId);
      if (driver) driverName = `${driver.firstName} ${driver.lastName}`;
    } catch {}
  }

  return { trip, patient, phone, dispatchPhone, driverName };
}

/**
 * Send 24h confirmation request SMS for a trip.
 */
export async function sendConfirmationRequest24h(tripId: number): Promise<boolean> {
  const ctx = await resolveTripContext(tripId);
  if (!ctx) {
    console.warn(`[CONFIRM-24H] tripId=${tripId} skipped: missing context`);
    return false;
  }

  const { trip, patient, phone, dispatchPhone, driverName } = ctx;

  // Check if 24h confirmation already sent
  const existing = await db
    .select({ id: tripConfirmations.id })
    .from(tripConfirmations)
    .where(
      and(
        eq(tripConfirmations.tripId, tripId),
        eq(tripConfirmations.confirmationType, "sms_24h")
      )
    )
    .limit(1);

  if (existing.length > 0) {
    console.log(`[CONFIRM-24H] tripId=${tripId} already sent`);
    return false;
  }

  const token = generateConfirmationToken();
  const baseUrl = getBaseUrl();
  const confirmUrl = `${baseUrl}/api/trip-confirm/${token}`;

  const body = buildConfirmation24hBody({
    patientFirstName: patient.firstName || undefined,
    pickupTime: trip.pickupTime || trip.scheduledTime || undefined,
    pickupDate: trip.scheduledDate || undefined,
    driverName,
    confirmUrl,
    dispatchPhone,
  });

  const result = await sendSmsCentral({
    companyId: trip.companyId,
    to: phone,
    body,
    purpose: "REMINDER_24H",
    tripId: trip.id,
    patientId: trip.patientId,
    idempotencyKey: `confirm_24h_${tripId}`,
  });

  // Record the confirmation request
  await db.insert(tripConfirmations).values({
    tripId: trip.id,
    patientId: trip.patientId,
    companyId: trip.companyId,
    confirmationType: "sms_24h",
    confirmationToken: token,
    sentAt: new Date(),
    smsMessageSid: result.sid || null,
  });

  console.log(
    `[CONFIRM-24H] tripId=${tripId} patient=${maskPhone(phone)} token=${token.slice(0, 8)}... sent=${result.success}`
  );
  return result.success;
}

/**
 * Send 2h urgent confirmation reminder for a trip (only if still unconfirmed).
 */
export async function sendConfirmationReminder2h(tripId: number): Promise<boolean> {
  const ctx = await resolveTripContext(tripId);
  if (!ctx) {
    console.warn(`[CONFIRM-2H] tripId=${tripId} skipped: missing context`);
    return false;
  }

  const { trip, patient, phone, dispatchPhone } = ctx;

  // Only send if trip is still unconfirmed
  if (trip.confirmationStatus === "confirmed") {
    console.log(`[CONFIRM-2H] tripId=${tripId} already confirmed, skipping`);
    return false;
  }

  // Check if 2h reminder already sent
  const existing = await db
    .select({ id: tripConfirmations.id })
    .from(tripConfirmations)
    .where(
      and(
        eq(tripConfirmations.tripId, tripId),
        eq(tripConfirmations.confirmationType, "sms_2h")
      )
    )
    .limit(1);

  if (existing.length > 0) {
    console.log(`[CONFIRM-2H] tripId=${tripId} already sent`);
    return false;
  }

  // Reuse existing token from 24h or create new one
  let token: string;
  const prev = await db
    .select({ confirmationToken: tripConfirmations.confirmationToken })
    .from(tripConfirmations)
    .where(
      and(
        eq(tripConfirmations.tripId, tripId),
        eq(tripConfirmations.confirmationType, "sms_24h"),
        isNull(tripConfirmations.confirmedAt),
        isNull(tripConfirmations.declinedAt)
      )
    )
    .limit(1);

  if (prev.length > 0 && prev[0].confirmationToken) {
    token = prev[0].confirmationToken;
  } else {
    token = generateConfirmationToken();
  }

  const baseUrl = getBaseUrl();
  const confirmUrl = `${baseUrl}/api/trip-confirm/${token}`;

  const body = buildConfirmation2hBody({
    patientFirstName: patient.firstName || undefined,
    pickupTime: trip.pickupTime || trip.scheduledTime || undefined,
    confirmUrl,
    dispatchPhone,
  });

  const result = await sendSmsCentral({
    companyId: trip.companyId,
    to: phone,
    body,
    purpose: "REMINDER_24H", // reuse same event type for logging
    tripId: trip.id,
    patientId: trip.patientId,
    idempotencyKey: `confirm_2h_${tripId}`,
  });

  // Record the 2h reminder
  await db.insert(tripConfirmations).values({
    tripId: trip.id,
    patientId: trip.patientId,
    companyId: trip.companyId,
    confirmationType: "sms_2h",
    confirmationToken: token,
    sentAt: new Date(),
    smsMessageSid: result.sid || null,
  });

  console.log(
    `[CONFIRM-2H] tripId=${tripId} patient=${maskPhone(phone)} sent=${result.success}`
  );
  return result.success;
}

/**
 * Process a patient's SMS reply (YES/NO) to a confirmation request.
 * Called from the inbound Twilio webhook.
 */
export async function processConfirmationResponse(
  fromPhone: string,
  responseBody: string,
  messageSid?: string
): Promise<{ handled: boolean; tripId?: number; action?: string }> {
  const normalized = normalizePhone(fromPhone);
  if (!normalized) return { handled: false };

  const upperBody = responseBody.trim().toUpperCase();
  const isYes = ["YES", "Y", "CONFIRM", "SI"].includes(upperBody);
  const isNo = ["NO", "N", "CANCEL", "DECLINE"].includes(upperBody);

  if (!isYes && !isNo) return { handled: false };

  // Find the most recent unresolved confirmation for this patient phone.
  // Try both normalized and raw formats since patient phones may be stored differently.
  const last10 = normalized.slice(-10);
  const patientRows = await db
    .select({ id: patients.id })
    .from(patients)
    .where(sql`${patients.phone} IS NOT NULL AND replace(replace(replace(${patients.phone}, '-', ''), ' ', ''), '(', '') LIKE ${"%" + last10}`)
    .limit(10);

  if (patientRows.length === 0) {
    return { handled: false };
  }

  const patientIds = patientRows.map((p) => p.id);

  // Find the most recent pending confirmation for any of these patients
  const pending = await db
    .select()
    .from(tripConfirmations)
    .where(
      and(
        inArray(tripConfirmations.patientId, patientIds),
        isNull(tripConfirmations.confirmedAt),
        isNull(tripConfirmations.declinedAt)
      )
    )
    .orderBy(sql`${tripConfirmations.sentAt} DESC`)
    .limit(1);

  if (pending.length === 0) return { handled: false };

  const confirmation = pending[0];
  const now = new Date();

  if (isYes) {
    // Mark confirmation as confirmed
    await db
      .update(tripConfirmations)
      .set({
        confirmedAt: now,
        responseRaw: responseBody,
        smsMessageSid: messageSid || confirmation.smsMessageSid,
      })
      .where(eq(tripConfirmations.id, confirmation.id));

    // Also record a new sms_reply entry
    await db.insert(tripConfirmations).values({
      tripId: confirmation.tripId,
      patientId: confirmation.patientId,
      companyId: confirmation.companyId,
      confirmationType: "sms_reply",
      confirmedAt: now,
      responseRaw: responseBody,
      smsMessageSid: messageSid || null,
      sentAt: now,
    });

    // Update trip confirmation status
    await db
      .update(trips)
      .set({
        confirmationStatus: "confirmed",
        confirmationTime: now,
        noShowRisk: false,
      })
      .where(eq(trips.id, confirmation.tripId));

    console.log(`[CONFIRM-REPLY] tripId=${confirmation.tripId} CONFIRMED via SMS reply`);
    return { handled: true, tripId: confirmation.tripId, action: "confirmed" };
  } else {
    // Mark as declined
    await db
      .update(tripConfirmations)
      .set({
        declinedAt: now,
        declineReason: "Patient replied NO via SMS",
        responseRaw: responseBody,
        smsMessageSid: messageSid || confirmation.smsMessageSid,
      })
      .where(eq(tripConfirmations.id, confirmation.id));

    // Record the decline
    await db.insert(tripConfirmations).values({
      tripId: confirmation.tripId,
      patientId: confirmation.patientId,
      companyId: confirmation.companyId,
      confirmationType: "sms_reply",
      declinedAt: now,
      declineReason: "Patient replied NO via SMS",
      responseRaw: responseBody,
      smsMessageSid: messageSid || null,
      sentAt: now,
    });

    // Update trip — mark for cancellation review, flag as high risk
    await db
      .update(trips)
      .set({
        confirmationStatus: "declined",
        confirmationTime: now,
        noShowRisk: true,
      })
      .where(eq(trips.id, confirmation.tripId));

    console.log(`[CONFIRM-REPLY] tripId=${confirmation.tripId} DECLINED via SMS reply`);
    return { handled: true, tripId: confirmation.tripId, action: "declined" };
  }
}

/**
 * Process a web-based confirmation link click.
 */
export async function processConfirmationLink(
  token: string
): Promise<{
  success: boolean;
  tripId?: number;
  error?: string;
  alreadyConfirmed?: boolean;
  trip?: any;
}> {
  const rows = await db
    .select()
    .from(tripConfirmations)
    .where(eq(tripConfirmations.confirmationToken, token))
    .limit(1);

  if (rows.length === 0) {
    return { success: false, error: "Invalid or expired confirmation link" };
  }

  const confirmation = rows[0];

  // Check if already confirmed
  if (confirmation.confirmedAt) {
    const trip = await storage.getTrip(confirmation.tripId);
    return { success: true, tripId: confirmation.tripId, alreadyConfirmed: true, trip };
  }

  // Check if declined
  if (confirmation.declinedAt) {
    return { success: false, error: "This trip was already declined", tripId: confirmation.tripId };
  }

  const now = new Date();

  // Mark this confirmation and all pending ones for this trip as confirmed
  await db
    .update(tripConfirmations)
    .set({ confirmedAt: now })
    .where(
      and(
        eq(tripConfirmations.tripId, confirmation.tripId),
        isNull(tripConfirmations.confirmedAt),
        isNull(tripConfirmations.declinedAt)
      )
    );

  // Record the link click
  await db.insert(tripConfirmations).values({
    tripId: confirmation.tripId,
    patientId: confirmation.patientId,
    companyId: confirmation.companyId,
    confirmationType: "link_click",
    confirmationToken: null,
    confirmedAt: now,
    sentAt: now,
  });

  // Update trip status
  await db
    .update(trips)
    .set({
      confirmationStatus: "confirmed",
      confirmationTime: now,
      noShowRisk: false,
    })
    .where(eq(trips.id, confirmation.tripId));

  const trip = await storage.getTrip(confirmation.tripId);

  console.log(`[CONFIRM-LINK] tripId=${confirmation.tripId} CONFIRMED via link click`);
  return { success: true, tripId: confirmation.tripId, trip };
}

/**
 * Flag unconfirmed trips approaching pickup as no-show risk.
 * Called 30 minutes before pickup time.
 */
export async function flagNoShowRisk(): Promise<number> {
  const now = new Date();
  const thirtyMinFromNow = new Date(now.getTime() + 30 * 60 * 1000);

  const dateStr = thirtyMinFromNow.toISOString().split("T")[0];
  const timeStr = `${String(thirtyMinFromNow.getHours()).padStart(2, "0")}:${String(thirtyMinFromNow.getMinutes()).padStart(2, "0")}`;

  // Find trips that are:
  // - Scheduled for today
  // - Still unconfirmed
  // - Pickup time is within the next 30 minutes
  // - Not already flagged
  const eligibleTrips = await db
    .select({ id: trips.id, pickupTime: trips.pickupTime, scheduledTime: trips.scheduledTime })
    .from(trips)
    .where(
      and(
        eq(trips.scheduledDate, dateStr),
        inArray(trips.status, ["SCHEDULED", "ASSIGNED"]),
        eq(trips.confirmationStatus, "unconfirmed"),
        eq(trips.noShowRisk, false),
        isNull(trips.deletedAt)
      )
    );

  let flagged = 0;
  for (const trip of eligibleTrips) {
    const pickupTimeStr = trip.pickupTime || trip.scheduledTime;
    if (!pickupTimeStr) continue;

    const [h, m] = pickupTimeStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) continue;

    const tripPickup = new Date(`${dateStr}T${pickupTimeStr}`);
    const diffMs = tripPickup.getTime() - now.getTime();

    // If pickup is within the next 30 minutes
    if (diffMs > 0 && diffMs <= 30 * 60 * 1000) {
      await db
        .update(trips)
        .set({ noShowRisk: true })
        .where(eq(trips.id, trip.id));
      flagged++;
    }
  }

  if (flagged > 0) {
    console.log(`[CONFIRM-NOSHOW] Flagged ${flagged} unconfirmed trips as no-show risk`);
  }

  return flagged;
}

/**
 * Get confirmation statistics for a company within a date range.
 */
export async function getConfirmationStats(
  companyId: number,
  startDate: string,
  endDate: string
): Promise<{
  totalSent: number;
  confirmed: number;
  declined: number;
  pending: number;
  confirmationRate: number;
  byType: Record<string, { sent: number; confirmed: number; declined: number }>;
}> {
  const rows = await db
    .select({
      confirmationType: tripConfirmations.confirmationType,
      total: count(),
      confirmed: sql<number>`count(*) filter (where ${tripConfirmations.confirmedAt} is not null)`,
      declined: sql<number>`count(*) filter (where ${tripConfirmations.declinedAt} is not null)`,
    })
    .from(tripConfirmations)
    .where(
      and(
        eq(tripConfirmations.companyId, companyId),
        gte(tripConfirmations.sentAt, new Date(startDate)),
        lte(tripConfirmations.sentAt, new Date(endDate))
      )
    )
    .groupBy(tripConfirmations.confirmationType);

  let totalSent = 0;
  let confirmed = 0;
  let declined = 0;
  const byType: Record<string, { sent: number; confirmed: number; declined: number }> = {};

  for (const row of rows) {
    const t = row.confirmationType;
    const s = Number(row.total);
    const c = Number(row.confirmed);
    const d = Number(row.declined);

    // Only count outbound confirmation types for totals (not replies/clicks)
    if (t === "sms_24h" || t === "sms_2h") {
      totalSent += s;
    }
    confirmed += c;
    declined += d;

    byType[t] = { sent: s, confirmed: c, declined: d };
  }

  const pending = totalSent - confirmed - declined;
  const confirmationRate = totalSent > 0 ? Math.round((confirmed / totalSent) * 100 * 10) / 10 : 0;

  return { totalSent, confirmed, declined, pending, confirmationRate, byType };
}
