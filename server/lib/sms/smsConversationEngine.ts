/**
 * SMS Conversation Engine — two-way conversational SMS with intent parsing.
 *
 * Handles inbound patient messages beyond simple YES/NO confirmations:
 *   CONFIRM, DECLINE, OPT_OUT, OPT_IN, STATUS_CHECK, ETA_QUERY,
 *   HELP, RESCHEDULE, UNKNOWN
 */

import { db } from "../../db";
import { trips, patients, drivers, companies, smsEvents } from "@shared/schema";
import { eq, and, gte, inArray, isNull, desc, sql, or } from "drizzle-orm";
import { normalizePhone, getDispatchPhone, maskPhone } from "./twilioClient";
import { processConfirmationResponse } from "../smsConfirmationEngine";
import { storage } from "../../storage";

// ── Intent types ────────────────────────────────────────────────────────────

export type SmsIntent =
  | "CONFIRM"
  | "DECLINE"
  | "OPT_OUT"
  | "OPT_IN"
  | "STATUS_CHECK"
  | "ETA_QUERY"
  | "HELP"
  | "RESCHEDULE"
  | "UNKNOWN";

export interface ParsedIntent {
  intent: SmsIntent;
  /** The original body text, trimmed */
  raw: string;
}

export interface InboundSmsResult {
  intent: SmsIntent;
  responseText: string;
  tripId?: number;
  handled: boolean;
}

// ── Keyword dictionaries ────────────────────────────────────────────────────

const OPT_OUT_WORDS = ["STOP", "UNSUBSCRIBE", "CANCEL SMS", "QUIT", "END", "OPTOUT", "OPT OUT"];
const OPT_IN_WORDS = ["START", "UNSTOP", "SUBSCRIBE", "OPTIN", "OPT IN"];

const CONFIRM_WORDS = ["YES", "Y", "CONFIRM", "SI", "YEP", "YA", "YEAH", "OK", "OKAY"];
const DECLINE_WORDS = ["NO", "N", "DECLINE", "CANCEL", "CANCEL RIDE", "CANCEL TRIP"];

const STATUS_KEYWORDS = [
  "STATUS", "WHERE", "TRIP STATUS", "MY RIDE", "MY TRIP",
  "RIDE STATUS", "TRIP INFO", "UPDATE", "CHECK", "WHERES MY RIDE",
  "WHERE IS MY RIDE", "WHERE IS MY DRIVER", "WHERE'S MY RIDE",
];

const ETA_KEYWORDS = [
  "ETA", "HOW LONG", "HOW FAR", "WHEN", "ARRIVAL",
  "WHEN WILL", "WHEN IS", "TIME", "WHAT TIME", "HOW MANY MINUTES",
  "HOW MUCH LONGER", "ALMOST HERE", "ARE YOU CLOSE",
];

const HELP_KEYWORDS = [
  "HELP", "COMMANDS", "MENU", "OPTIONS", "INFO", "SUPPORT",
  "WHAT CAN I DO", "WHAT CAN I SAY", "?",
];

const RESCHEDULE_KEYWORDS = [
  "RESCHEDULE", "CHANGE TIME", "CHANGE DATE", "MOVE RIDE",
  "MOVE TRIP", "DIFFERENT TIME", "DIFFERENT DAY", "CHANGE MY RIDE",
  "POSTPONE", "DELAY", "LATER",
];

// ── Intent parser ───────────────────────────────────────────────────────────

export function parseInboundIntent(body: string): ParsedIntent {
  const raw = body.trim();
  const upper = raw.toUpperCase();

  // OPT_OUT — check first as these are regulatory / must always work
  if (OPT_OUT_WORDS.some((w) => upper === w)) {
    return { intent: "OPT_OUT", raw };
  }

  // OPT_IN
  if (OPT_IN_WORDS.some((w) => upper === w)) {
    return { intent: "OPT_IN", raw };
  }

  // CONFIRM — exact match only (matches existing confirmation flow)
  if (CONFIRM_WORDS.includes(upper)) {
    return { intent: "CONFIRM", raw };
  }

  // DECLINE — exact match on short words, substring on phrases
  if (DECLINE_WORDS.includes(upper)) {
    return { intent: "DECLINE", raw };
  }

  // HELP — check before status/eta because "?" is common
  if (HELP_KEYWORDS.some((k) => upper === k || upper === k + "?")) {
    return { intent: "HELP", raw };
  }

  // RESCHEDULE — check before status since "change" could overlap
  if (RESCHEDULE_KEYWORDS.some((k) => upper.includes(k))) {
    return { intent: "RESCHEDULE", raw };
  }

  // ETA_QUERY — "eta", "how long", "when" etc.
  if (ETA_KEYWORDS.some((k) => upper.includes(k))) {
    return { intent: "ETA_QUERY", raw };
  }

  // STATUS_CHECK — "status", "where", "my ride" etc.
  if (STATUS_KEYWORDS.some((k) => upper.includes(k))) {
    return { intent: "STATUS_CHECK", raw };
  }

  return { intent: "UNKNOWN", raw };
}

// ── Patient lookup by phone ─────────────────────────────────────────────────

async function findPatientsByPhone(phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];

  const last10 = normalized.slice(-10);

  const rows = await db
    .select({
      id: patients.id,
      firstName: patients.firstName,
      lastName: patients.lastName,
      phone: patients.phone,
      companyId: patients.companyId,
    })
    .from(patients)
    .where(
      and(
        isNull(patients.deletedAt),
        sql`replace(replace(replace(${patients.phone}, '-', ''), ' ', ''), '(', '') LIKE ${"%" + last10}`
      )
    )
    .limit(10);

  return rows;
}

// ── Trip lookup helpers ─────────────────────────────────────────────────────

/** Active statuses where a trip is "in progress" */
const ACTIVE_STATUSES = [
  "EN_ROUTE_TO_PICKUP",
  "ARRIVED_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_TO_DROPOFF",
  "ARRIVED_DROPOFF",
  "IN_PROGRESS",
] as const;

/** Upcoming statuses where a trip hasn't started yet */
const UPCOMING_STATUSES = ["SCHEDULED", "ASSIGNED"] as const;

async function getActiveTrip(patientIds: number[]) {
  if (patientIds.length === 0) return null;

  const rows = await db
    .select({
      id: trips.id,
      status: trips.status,
      pickupTime: trips.pickupTime,
      scheduledDate: trips.scheduledDate,
      scheduledTime: trips.scheduledTime,
      pickupAddress: trips.pickupAddress,
      dropoffAddress: trips.dropoffAddress,
      driverId: trips.driverId,
      lastEtaMinutes: trips.lastEtaMinutes,
      companyId: trips.companyId,
    })
    .from(trips)
    .where(
      and(
        inArray(trips.patientId, patientIds),
        inArray(trips.status, [...ACTIVE_STATUSES]),
        isNull(trips.deletedAt)
      )
    )
    .orderBy(desc(trips.updatedAt))
    .limit(1);

  return rows[0] || null;
}

async function getNextUpcomingTrip(patientIds: number[]) {
  if (patientIds.length === 0) return null;

  const today = new Date().toISOString().split("T")[0];

  const rows = await db
    .select({
      id: trips.id,
      status: trips.status,
      pickupTime: trips.pickupTime,
      scheduledDate: trips.scheduledDate,
      scheduledTime: trips.scheduledTime,
      pickupAddress: trips.pickupAddress,
      dropoffAddress: trips.dropoffAddress,
      driverId: trips.driverId,
      lastEtaMinutes: trips.lastEtaMinutes,
      companyId: trips.companyId,
      confirmationStatus: trips.confirmationStatus,
    })
    .from(trips)
    .where(
      and(
        inArray(trips.patientId, patientIds),
        inArray(trips.status, [...UPCOMING_STATUSES]),
        gte(trips.scheduledDate, today),
        isNull(trips.deletedAt)
      )
    )
    .orderBy(trips.scheduledDate, trips.pickupTime)
    .limit(1);

  return rows[0] || null;
}

async function getDriverName(driverId: number | null): Promise<string | null> {
  if (!driverId) return null;
  try {
    const driver = await storage.getDriver(driverId);
    if (driver) return `${driver.firstName} ${driver.lastName}`;
  } catch {}
  return null;
}

async function getCompanyDispatchPhone(companyId: number | null): Promise<string> {
  if (companyId) {
    try {
      const company = await storage.getCompany(companyId);
      if (company?.dispatchPhone) return company.dispatchPhone;
    } catch {}
  }
  return getDispatchPhone() || "your transport provider";
}

// ── Status formatting ───────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  ASSIGNED: "Assigned to a driver",
  EN_ROUTE_TO_PICKUP: "Driver is on the way to pick you up",
  ARRIVED_PICKUP: "Driver has arrived at pickup",
  PICKED_UP: "You have been picked up",
  EN_ROUTE_TO_DROPOFF: "On the way to your destination",
  ARRIVED_DROPOFF: "Arrived at destination",
  IN_PROGRESS: "Trip in progress",
  COMPLETED: "Trip completed",
  CANCELLED: "Trip was cancelled",
  NO_SHOW: "No show recorded",
};

function formatTripStatus(trip: {
  status: string;
  scheduledDate: string;
  pickupTime: string;
  pickupAddress: string;
  dropoffAddress: string;
  driverId: number | null;
  lastEtaMinutes: number | null;
}, driverName: string | null): string {
  const statusLabel = STATUS_LABELS[trip.status] || trip.status;
  let msg = `Your ride on ${trip.scheduledDate} at ${trip.pickupTime}:\n`;
  msg += `Status: ${statusLabel}\n`;
  msg += `From: ${trip.pickupAddress}\n`;
  msg += `To: ${trip.dropoffAddress}`;
  if (driverName) {
    msg += `\nDriver: ${driverName}`;
  }
  if (trip.lastEtaMinutes !== null && trip.lastEtaMinutes > 0) {
    msg += `\nETA: ~${trip.lastEtaMinutes} min`;
  }
  return msg;
}

// ── Help text ───────────────────────────────────────────────────────────────

function buildHelpText(dispatchPhone: string): string {
  return (
    `United Care Mobility - Available commands:\n` +
    `STATUS - Check your next ride status\n` +
    `ETA - Get estimated arrival time\n` +
    `YES - Confirm your ride\n` +
    `NO - Cancel your ride\n` +
    `RESCHEDULE - Request a time change\n` +
    `HELP - Show this menu\n` +
    `STOP - Opt out of SMS\n` +
    `\nNeed a person? Call dispatch: ${dispatchPhone}`
  );
}

// ── Inbound message logging ─────────────────────────────────────────────────

async function logInboundMessage(
  fromPhone: string,
  intent: SmsIntent,
  body: string,
  companyId: number | null,
  tripId: number | null,
  messageSid?: string
) {
  try {
    const { pool } = await import("../../db");
    await pool.query(
      `INSERT INTO sms_events (company_id, trip_id, patient_id, driver_id, to_phone, from_phone, purpose, status, twilio_sid, error_code, error_message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        companyId || 0,
        tripId,
        null,
        null,
        "", // to_phone (inbound has no outbound target)
        fromPhone,
        `INBOUND_${intent}`,
        "received",
        messageSid || null,
        null,
        null,
        JSON.stringify({ direction: "inbound", rawBody: body.substring(0, 500) }),
      ]
    );
  } catch (err: any) {
    console.error("[SMS-CONV] Failed to log inbound message:", err.message);
  }
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function handleInboundSms(
  fromPhone: string,
  body: string,
  messageSid?: string,
  companyId?: number
): Promise<InboundSmsResult> {
  const parsed = parseInboundIntent(body);
  const from = normalizePhone(fromPhone) || fromPhone;

  console.log(`[SMS-CONV] from=${maskPhone(from)} intent=${parsed.intent} body="${parsed.raw.substring(0, 40)}"`);

  // Look up patients associated with this phone for most intents
  let patientRows: Awaited<ReturnType<typeof findPatientsByPhone>> = [];
  let resolvedCompanyId = companyId || null;

  if (!["OPT_OUT", "OPT_IN", "HELP"].includes(parsed.intent)) {
    patientRows = await findPatientsByPhone(from);
    if (patientRows.length > 0 && !resolvedCompanyId) {
      resolvedCompanyId = patientRows[0].companyId;
    }
  }

  const patientIds = patientRows.map((p) => p.id);
  let result: InboundSmsResult;

  switch (parsed.intent) {
    case "OPT_OUT":
      result = await handleOptOut(from);
      break;

    case "OPT_IN":
      result = await handleOptIn(from);
      break;

    case "CONFIRM":
    case "DECLINE":
      result = await handleConfirmDecline(from, body, parsed.intent, messageSid);
      break;

    case "STATUS_CHECK":
      result = await handleStatusCheck(from, patientIds, resolvedCompanyId);
      break;

    case "ETA_QUERY":
      result = await handleEtaQuery(from, patientIds, resolvedCompanyId);
      break;

    case "HELP":
      result = await handleHelp(resolvedCompanyId);
      break;

    case "RESCHEDULE":
      result = await handleReschedule(from, patientIds, resolvedCompanyId);
      break;

    default:
      result = await handleUnknown(resolvedCompanyId);
      break;
  }

  // Log all inbound messages
  await logInboundMessage(
    from,
    parsed.intent,
    parsed.raw,
    resolvedCompanyId,
    result.tripId || null,
    messageSid
  );

  return result;
}

// ── Intent handlers ─────────────────────────────────────────────────────────

async function handleOptOut(from: string): Promise<InboundSmsResult> {
  await storage.setPhoneOptOut(from, true);
  console.log(`[SMS-CONV] Opt-out received from ${maskPhone(from)}`);
  return {
    intent: "OPT_OUT",
    responseText: "You have been unsubscribed. Reply START to re-subscribe.",
    handled: true,
  };
}

async function handleOptIn(from: string): Promise<InboundSmsResult> {
  await storage.setPhoneOptOut(from, false);
  console.log(`[SMS-CONV] Opt-in received from ${maskPhone(from)}`);
  return {
    intent: "OPT_IN",
    responseText: "You have been re-subscribed to notifications. Reply HELP for available commands.",
    handled: true,
  };
}

async function handleConfirmDecline(
  from: string,
  body: string,
  intent: "CONFIRM" | "DECLINE",
  messageSid?: string
): Promise<InboundSmsResult> {
  try {
    const confirmResult = await processConfirmationResponse(from, body, messageSid);
    if (confirmResult.handled) {
      if (confirmResult.action === "confirmed") {
        return {
          intent: "CONFIRM",
          responseText: "Thank you! Your ride is confirmed. We look forward to serving you.",
          tripId: confirmResult.tripId,
          handled: true,
        };
      } else if (confirmResult.action === "declined") {
        return {
          intent: "DECLINE",
          responseText: "Your ride cancellation request has been noted. A dispatcher will follow up with you.",
          tripId: confirmResult.tripId,
          handled: true,
        };
      }
    }
  } catch (err: any) {
    console.error(`[SMS-CONV] Confirmation processing error:`, err.message);
  }

  // No pending confirmation found — provide helpful fallback
  const fallbackMsg =
    intent === "CONFIRM"
      ? "We don't have a pending ride confirmation for your number. Reply STATUS to check your ride, or HELP for options."
      : "We don't have a pending ride to cancel for your number. Reply STATUS to check your ride, or call dispatch for help.";

  return {
    intent,
    responseText: fallbackMsg,
    handled: true,
  };
}

async function handleStatusCheck(
  from: string,
  patientIds: number[],
  companyId: number | null
): Promise<InboundSmsResult> {
  if (patientIds.length === 0) {
    return {
      intent: "STATUS_CHECK",
      responseText: "We couldn't find an account for this phone number. Please contact dispatch for assistance.",
      handled: true,
    };
  }

  // Check for active trip first
  const activeTrip = await getActiveTrip(patientIds);
  if (activeTrip) {
    const driverName = await getDriverName(activeTrip.driverId);
    const statusMsg = formatTripStatus(activeTrip, driverName);
    return {
      intent: "STATUS_CHECK",
      responseText: statusMsg,
      tripId: activeTrip.id,
      handled: true,
    };
  }

  // Fall back to next upcoming trip
  const upcomingTrip = await getNextUpcomingTrip(patientIds);
  if (upcomingTrip) {
    const driverName = await getDriverName(upcomingTrip.driverId);
    const statusMsg = formatTripStatus(upcomingTrip, driverName);
    return {
      intent: "STATUS_CHECK",
      responseText: statusMsg,
      tripId: upcomingTrip.id,
      handled: true,
    };
  }

  return {
    intent: "STATUS_CHECK",
    responseText: "You have no upcoming rides scheduled. Contact dispatch to book a ride.",
    handled: true,
  };
}

async function handleEtaQuery(
  from: string,
  patientIds: number[],
  companyId: number | null
): Promise<InboundSmsResult> {
  if (patientIds.length === 0) {
    return {
      intent: "ETA_QUERY",
      responseText: "We couldn't find an account for this phone number. Please contact dispatch for assistance.",
      handled: true,
    };
  }

  // Look for active trip with ETA
  const activeTrip = await getActiveTrip(patientIds);
  if (activeTrip) {
    const driverName = await getDriverName(activeTrip.driverId);
    const statusLabel = STATUS_LABELS[activeTrip.status] || activeTrip.status;

    if (activeTrip.lastEtaMinutes !== null && activeTrip.lastEtaMinutes > 0) {
      let etaMsg = `Your driver is ~${activeTrip.lastEtaMinutes} minutes away.`;
      etaMsg += `\nStatus: ${statusLabel}`;
      if (driverName) etaMsg += `\nDriver: ${driverName}`;
      return {
        intent: "ETA_QUERY",
        responseText: etaMsg,
        tripId: activeTrip.id,
        handled: true,
      };
    }

    // Active trip but no ETA data
    let msg = `Your ride is currently: ${statusLabel}`;
    if (driverName) msg += `\nDriver: ${driverName}`;
    msg += "\nETA is not yet available. We'll text you when your driver is close.";
    return {
      intent: "ETA_QUERY",
      responseText: msg,
      tripId: activeTrip.id,
      handled: true,
    };
  }

  // Check upcoming trip
  const upcomingTrip = await getNextUpcomingTrip(patientIds);
  if (upcomingTrip) {
    return {
      intent: "ETA_QUERY",
      responseText: `Your next ride is scheduled for ${upcomingTrip.scheduledDate} at ${upcomingTrip.pickupTime}. ETA will be available once your driver is on the way.`,
      tripId: upcomingTrip.id,
      handled: true,
    };
  }

  return {
    intent: "ETA_QUERY",
    responseText: "You have no active rides right now. Reply STATUS to check upcoming rides.",
    handled: true,
  };
}

async function handleHelp(companyId: number | null): Promise<InboundSmsResult> {
  const dispatchPhone = await getCompanyDispatchPhone(companyId);
  return {
    intent: "HELP",
    responseText: buildHelpText(dispatchPhone),
    handled: true,
  };
}

async function handleReschedule(
  from: string,
  patientIds: number[],
  companyId: number | null
): Promise<InboundSmsResult> {
  if (patientIds.length === 0) {
    return {
      intent: "RESCHEDULE",
      responseText: "We couldn't find an account for this phone number. Please contact dispatch for assistance.",
      handled: true,
    };
  }

  // Find the next upcoming trip to flag for reschedule
  const upcomingTrip = await getNextUpcomingTrip(patientIds);
  const activeTrip = await getActiveTrip(patientIds);

  const tripToFlag = upcomingTrip || activeTrip;

  if (!tripToFlag) {
    return {
      intent: "RESCHEDULE",
      responseText: "You have no upcoming rides to reschedule. Contact dispatch to book a new ride.",
      handled: true,
    };
  }

  // Flag the trip for dispatcher review by adding a note
  try {
    await db
      .update(trips)
      .set({
        approvalStatus: "cancel_requested",
        cancelledReason: `Patient requested reschedule via SMS at ${new Date().toISOString()}. Original message: "${from}"`,
      })
      .where(eq(trips.id, tripToFlag.id));

    // Create an audit log entry so dispatch sees it
    await storage.createAuditLog({
      userId: null,
      action: "SMS_RESCHEDULE_REQUEST",
      entity: "trip",
      entityId: tripToFlag.id,
      details: `Patient requested ride reschedule via SMS from ${maskPhone(from)}`,
      cityId: null,
    });

    console.log(`[SMS-CONV] Reschedule request flagged for trip ${tripToFlag.id} from ${maskPhone(from)}`);
  } catch (err: any) {
    console.error(`[SMS-CONV] Failed to flag trip for reschedule:`, err.message);
  }

  const dispatchPhone = await getCompanyDispatchPhone(tripToFlag.companyId);

  return {
    intent: "RESCHEDULE",
    responseText:
      `Your reschedule request for the ride on ${tripToFlag.scheduledDate} at ${tripToFlag.pickupTime} has been sent to our dispatch team. ` +
      `A dispatcher will contact you shortly.\n` +
      `Or call dispatch directly: ${dispatchPhone}`,
    tripId: tripToFlag.id,
    handled: true,
  };
}

async function handleUnknown(companyId: number | null): Promise<InboundSmsResult> {
  const dispatchPhone = await getCompanyDispatchPhone(companyId);
  return {
    intent: "UNKNOWN",
    responseText:
      `Sorry, we didn't understand your message. ` +
      `Reply HELP for available commands or call dispatch: ${dispatchPhone}`,
    handled: true,
  };
}
