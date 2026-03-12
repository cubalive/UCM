/**
 * AI Dispatch Chatbot Engine
 * Natural language dispatch assistant that handles trip requests,
 * status checks, reassignments, and operational queries via chat/SMS.
 */
import { db } from "../db";
import {
  dispatchChatSessions, dispatchChatMessages,
  trips, patients, drivers, clinics, cities,
} from "@shared/schema";
import { eq, and, desc, isNull, ilike, sql } from "drizzle-orm";
import { cityNowDate, cityNowTime } from "@shared/timeUtils";

// ─── Intent Classification ───────────────────────────────────────────────────

export type Intent =
  | "create_trip"
  | "check_status"
  | "eta_query"
  | "reassign"
  | "cancel_trip"
  | "list_trips"
  | "driver_availability"
  | "patient_lookup"
  | "help"
  | "general";

interface ExtractedEntities {
  patientName?: string;
  patientId?: number;
  driverId?: number;
  driverName?: string;
  tripId?: number;
  address?: string;
  date?: string;
  time?: string;
  clinicName?: string;
  clinicId?: number;
  mobilityType?: string;
}

interface BotResponse {
  message: string;
  intent: Intent;
  entities: ExtractedEntities;
  actions: Array<{ type: string; detail: string; entityId?: number }>;
  confidence: number;
  suggestions?: string[];
  /** Whether the bot is asking a clarifying question */
  needsClarification?: boolean;
  /** Pending action waiting for user confirmation */
  pendingAction?: { type: string; data: Record<string, any> } | null;
}

// ─── Conversation Context Tracking ──────────────────────────────────────────

interface ConversationContext {
  /** Last intent classified */
  lastIntent: Intent | null;
  /** Accumulated entities across conversation turns */
  accumulatedEntities: ExtractedEntities;
  /** Pending action awaiting confirmation (e.g., trip creation, reassignment) */
  pendingAction: { type: string; data: Record<string, any> } | null;
  /** Number of turns in this conversation */
  turnCount: number;
}

const sessionContexts = new Map<number, ConversationContext>();

function getSessionContext(sessionId: number): ConversationContext {
  if (!sessionContexts.has(sessionId)) {
    sessionContexts.set(sessionId, {
      lastIntent: null,
      accumulatedEntities: {},
      pendingAction: null,
      turnCount: 0,
    });
  }
  return sessionContexts.get(sessionId)!;
}

function mergeEntities(existing: ExtractedEntities, incoming: ExtractedEntities): ExtractedEntities {
  return {
    patientName: incoming.patientName || existing.patientName,
    patientId: incoming.patientId || existing.patientId,
    driverId: incoming.driverId || existing.driverId,
    driverName: incoming.driverName || existing.driverName,
    tripId: incoming.tripId || existing.tripId,
    address: incoming.address || existing.address,
    date: incoming.date || existing.date,
    time: incoming.time || existing.time,
    clinicName: incoming.clinicName || existing.clinicName,
    clinicId: incoming.clinicId || existing.clinicId,
    mobilityType: incoming.mobilityType || existing.mobilityType,
  };
}

// ─── Pattern-Based Intent Classifier ─────────────────────────────────────────

const INTENT_PATTERNS: Array<{ intent: Intent; patterns: RegExp[]; weight: number }> = [
  {
    intent: "create_trip",
    patterns: [
      /(?:create|schedule|book|add|new|request)\s+(?:a\s+)?trip/i,
      /(?:necesito|crear|agendar|programar)\s+(?:un\s+)?(?:viaje|trip)/i,
      /pick\s*up\s+(?:from|at)/i,
      /transport(?:ation)?\s+(?:for|to|from)/i,
      /need\s+(?:a\s+)?ride/i,
    ],
    weight: 0.9,
  },
  {
    intent: "check_status",
    patterns: [
      /(?:status|state|where)\s+(?:of|is)\s+trip/i,
      /trip\s*#?\s*\d+/i,
      /(?:what|how)\s+(?:is|about)\s+(?:the\s+)?trip/i,
      /(?:estado|status)\s+(?:del?\s+)?(?:viaje|trip)/i,
    ],
    weight: 0.85,
  },
  {
    intent: "eta_query",
    patterns: [
      /(?:eta|when|arrival|arrive|how long|how far)/i,
      /(?:cuanto|cuando)\s+(?:falta|llega|tarda)/i,
      /estimated\s+(?:time|arrival)/i,
      /(?:on the|on their)\s+way/i,
    ],
    weight: 0.85,
  },
  {
    intent: "reassign",
    patterns: [
      /(?:reassign|change|switch|swap)\s+(?:the\s+)?driver/i,
      /(?:different|another|new)\s+driver/i,
      /(?:cambiar|reasignar)\s+(?:el?\s+)?(?:conductor|driver)/i,
    ],
    weight: 0.9,
  },
  {
    intent: "cancel_trip",
    patterns: [
      /(?:cancel|delete|remove)\s+(?:the\s+)?trip/i,
      /(?:cancelar|eliminar)\s+(?:el?\s+)?(?:viaje|trip)/i,
    ],
    weight: 0.9,
  },
  {
    intent: "list_trips",
    patterns: [
      /(?:list|show|see|view|display)\s+(?:all\s+)?(?:today'?s?\s+)?trips/i,
      /(?:how many|cuantos)\s+trips/i,
      /(?:pending|upcoming|active)\s+trips/i,
      /(?:mostrar|ver)\s+(?:los?\s+)?(?:viajes|trips)/i,
    ],
    weight: 0.8,
  },
  {
    intent: "driver_availability",
    patterns: [
      /(?:available|free|online)\s+drivers?/i,
      /(?:who|which)\s+(?:drivers?\s+)?(?:is|are)\s+available/i,
      /driver\s+(?:availability|status)/i,
      /(?:conductores?|drivers?)\s+(?:disponibles?|libres?)/i,
    ],
    weight: 0.85,
  },
  {
    intent: "patient_lookup",
    patterns: [
      /(?:find|search|look\s*up|locate)\s+patient/i,
      /patient\s+(?:info|details|information)/i,
      /(?:buscar|encontrar)\s+(?:al?\s+)?paciente/i,
    ],
    weight: 0.85,
  },
  {
    intent: "help",
    patterns: [
      /^(?:help|ayuda|\?)$/i,
      /(?:what can you|how do I|what do you)/i,
      /(?:que puedes|como puedo|comandos)/i,
    ],
    weight: 0.95,
  },
];

function classifyIntent(message: string): { intent: Intent; confidence: number } {
  let bestIntent: Intent = "general";
  let bestScore = 0;

  for (const { intent, patterns, weight } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        const score = weight;
        if (score > bestScore) {
          bestScore = score;
          bestIntent = intent;
        }
      }
    }
  }

  return { intent: bestIntent, confidence: bestScore || 0.3 };
}

// ─── Entity Extraction ───────────────────────────────────────────────────────

function extractEntities(message: string): ExtractedEntities {
  const entities: ExtractedEntities = {};

  // Trip ID: "trip 123" or "trip #123" or "#123"
  const tripMatch = message.match(/trip\s*#?\s*(\d+)|#(\d+)/i);
  if (tripMatch) entities.tripId = parseInt(tripMatch[1] || tripMatch[2]);

  // Patient name: "for John Smith" or "patient John Smith"
  const patientMatch = message.match(/(?:for|patient|paciente)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (patientMatch) entities.patientName = patientMatch[1];

  // Time: "at 2:30 PM" or "at 14:30" or "2:30pm"
  const timeMatch = message.match(/(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (timeMatch) {
    let h = parseInt(timeMatch[1]);
    const m = timeMatch[2];
    const ampm = timeMatch[3]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    entities.time = `${String(h).padStart(2, "0")}:${m}`;
  }

  // Date: "tomorrow", "today", or "03/15/2026" or "March 15"
  if (/tomorrow|mañana/i.test(message)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    entities.date = d.toISOString().split("T")[0];
  } else if (/today|hoy/i.test(message)) {
    entities.date = new Date().toISOString().split("T")[0];
  } else {
    const dateMatch = message.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      entities.date = `${dateMatch[3]}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`;
    }
  }

  // Address: "from 123 Main St" or "to 456 Oak Ave"
  const addrMatch = message.match(/(?:from|to|at|pickup|dropoff|recoger en|llevar a)\s+(\d+\s+[A-Za-z\s]+(?:St|Ave|Blvd|Dr|Rd|Ln|Ct|Way|Pl)\b[^,]*)/i);
  if (addrMatch) entities.address = addrMatch[1].trim();

  // Mobility: "wheelchair" or "ambulatory" or "stretcher"
  if (/wheelchair|silla de ruedas|wc/i.test(message)) entities.mobilityType = "WHEELCHAIR";
  if (/stretcher|camilla/i.test(message)) entities.mobilityType = "STRETCHER";
  if (/ambulatory|ambulatorio|walk/i.test(message)) entities.mobilityType = "AMBULATORY";

  return entities;
}

// ─── Response Generators ─────────────────────────────────────────────────────

async function handleCreateTrip(entities: ExtractedEntities, companyId: number, cityId: number | null): Promise<Partial<BotResponse>> {
  const missing: string[] = [];
  if (!entities.patientName && !entities.patientId) missing.push("patient name");
  if (!entities.date) missing.push("date");
  if (!entities.time) missing.push("pickup time");
  if (!entities.address) missing.push("pickup address");

  if (missing.length > 0) {
    return {
      message: `To create a trip, I need: ${missing.join(", ")}. Please provide the missing information.`,
      actions: [],
      suggestions: [
        "Schedule trip for John Smith tomorrow at 9:00 AM from 123 Main St",
        "Book wheelchair trip for Mary Johnson on 03/15 at 2:30 PM",
      ],
    };
  }

  // Try to find the patient
  let patientId = entities.patientId;
  if (!patientId && entities.patientName) {
    const matchedPatients = await db.select().from(patients).where(
      and(
        ilike(patients.firstName, `%${entities.patientName.split(" ")[0]}%`),
        isNull(patients.deletedAt)
      )
    );
    if (matchedPatients.length === 1) {
      patientId = matchedPatients[0].id;
    } else if (matchedPatients.length > 1) {
      const names = matchedPatients.slice(0, 5).map(p => `- ${(p as any).firstName} ${(p as any).lastName} (ID: ${p.id})`).join("\n");
      return {
        message: `Multiple patients match "${entities.patientName}":\n${names}\nPlease specify the patient ID.`,
        actions: [],
      };
    } else {
      return {
        message: `No patient found matching "${entities.patientName}". Please check the name or create the patient first.`,
        actions: [],
      };
    }
  }

  // Create the trip
  try {
    const [patient] = await db.select().from(patients).where(eq(patients.id, patientId!));
    const [newTrip] = await db.insert(trips).values({
      patientId: patientId!,
      companyId,
      clinicId: (patient as any).clinicId,
      scheduledDate: entities.date!,
      scheduledTime: entities.time!,
      pickupTime: entities.time!,
      pickupAddress: entities.address || (patient as any).address || "",
      dropoffAddress: (patient as any).clinicAddress || "",
      status: "SCHEDULED",
      mobilityRequirement: entities.mobilityType || (patient as any).mobilityType || "AMBULATORY",
      tripTimezone: "America/Los_Angeles",
      notes: "Created via AI Dispatch Assistant",
      source: "chatbot",
    } as any).returning();

    return {
      message: `Trip #${newTrip.id} created successfully!\n- Patient: ${(patient as any).firstName} ${(patient as any).lastName}\n- Date: ${entities.date}\n- Pickup: ${entities.time}\n- Status: SCHEDULED\n\nThe trip is now in the dispatch queue for driver assignment.`,
      actions: [{ type: "trip_created", detail: `Trip #${newTrip.id}`, entityId: newTrip.id }],
    };
  } catch (err: any) {
    return {
      message: `Error creating trip: ${err.message}. Please try again or create manually.`,
      actions: [{ type: "error", detail: err.message }],
    };
  }
}

async function handleCheckStatus(entities: ExtractedEntities): Promise<Partial<BotResponse>> {
  if (!entities.tripId) {
    return {
      message: "Please provide a trip ID. Example: \"Status of trip #1234\"",
      actions: [],
    };
  }

  const [trip] = await db.select().from(trips).where(eq(trips.id, entities.tripId));
  if (!trip) {
    return { message: `Trip #${entities.tripId} not found.`, actions: [] };
  }

  const statusEmoji: Record<string, string> = {
    SCHEDULED: "📋", ASSIGNED: "✅", EN_ROUTE_TO_PICKUP: "🚗",
    ARRIVED_PICKUP: "📍", PICKED_UP: "👤", EN_ROUTE_TO_DROPOFF: "🏥",
    ARRIVED_DROPOFF: "🏁", COMPLETED: "✅", CANCELLED: "❌", NO_SHOW: "⚠️",
  };

  let driverInfo = "Not yet assigned";
  if (trip.driverId) {
    const [driver] = await db.select().from(drivers).where(eq(drivers.id, trip.driverId));
    if (driver) driverInfo = `${driver.firstName} ${driver.lastName} (${driver.phone || "no phone"})`;
  }

  const eta = trip.lastEtaMinutes != null ? `${trip.lastEtaMinutes} min` : "N/A";

  return {
    message: `${statusEmoji[trip.status] || ""} Trip #${trip.id}\n- Status: ${trip.status}\n- Driver: ${driverInfo}\n- ETA: ${eta}\n- Pickup: ${trip.pickupAddress || "N/A"}\n- Dropoff: ${trip.dropoffAddress || "N/A"}\n- Scheduled: ${trip.scheduledDate} ${trip.scheduledTime || ""}`,
    actions: [{ type: "status_checked", detail: trip.status, entityId: trip.id }],
  };
}

async function handleListTrips(companyId: number, cityId: number | null): Promise<Partial<BotResponse>> {
  const today = new Date().toISOString().split("T")[0];
  const todayTrips = await db.select({
    id: trips.id,
    status: trips.status,
    scheduledTime: trips.scheduledTime,
    patientId: trips.patientId,
    driverId: trips.driverId,
  }).from(trips).where(
    and(
      eq(trips.companyId, companyId),
      eq(trips.scheduledDate, today),
      isNull(trips.deletedAt)
    )
  );

  if (todayTrips.length === 0) {
    return { message: "No trips scheduled for today.", actions: [] };
  }

  const statusCounts: Record<string, number> = {};
  for (const t of todayTrips) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }

  const summary = Object.entries(statusCounts)
    .map(([s, c]) => `  ${s}: ${c}`)
    .join("\n");

  const unassigned = todayTrips.filter(t => !t.driverId && t.status === "SCHEDULED");

  return {
    message: `Today's trips (${todayTrips.length} total):\n${summary}${
      unassigned.length > 0 ? `\n\n⚠️ ${unassigned.length} unassigned trips need attention!` : ""
    }`,
    actions: [{ type: "trips_listed", detail: `${todayTrips.length} trips` }],
  };
}

async function handleDriverAvailability(companyId: number): Promise<Partial<BotResponse>> {
  const allDrivers = await db.select({
    id: drivers.id,
    firstName: drivers.firstName,
    lastName: drivers.lastName,
    dispatchStatus: drivers.dispatchStatus,
    lastSeenAt: drivers.lastSeenAt,
  }).from(drivers).where(
    and(
      eq(drivers.companyId, companyId),
      eq(drivers.status, "ACTIVE"),
      isNull(drivers.deletedAt)
    )
  );

  const now = Date.now();
  const online = allDrivers.filter(d => {
    if (!d.lastSeenAt) return false;
    const seenAgo = now - new Date(d.lastSeenAt).getTime();
    return seenAgo < 5 * 60 * 1000; // 5 min threshold
  });

  const available = online.filter(d => d.dispatchStatus === "available");
  const onTrip = online.filter(d => d.dispatchStatus === "enroute");

  const availableList = available.slice(0, 10).map(d =>
    `  ✅ ${d.firstName} ${d.lastName} (ID: ${d.id})`
  ).join("\n") || "  None";

  return {
    message: `Driver Status:\n- Online: ${online.length}\n- Available: ${available.length}\n- On trip: ${onTrip.length}\n- Offline: ${allDrivers.length - online.length}\n\nAvailable drivers:\n${availableList}`,
    actions: [{ type: "drivers_checked", detail: `${available.length} available` }],
  };
}

async function handlePatientLookup(entities: ExtractedEntities, companyId: number): Promise<Partial<BotResponse>> {
  if (!entities.patientName) {
    return { message: "Please provide a patient name. Example: \"Find patient John Smith\"", actions: [] };
  }

  const nameParts = entities.patientName.split(" ");
  const matchedPatients = await db.select().from(patients).where(
    and(
      ilike(patients.firstName, `%${nameParts[0]}%`),
      isNull(patients.deletedAt)
    )
  );

  if (matchedPatients.length === 0) {
    return { message: `No patients found matching "${entities.patientName}".`, actions: [] };
  }

  const list = matchedPatients.slice(0, 8).map(p => {
    const pa = p as any;
    return `  - ${pa.firstName} ${pa.lastName} (ID: ${p.id}) | ${pa.phone || "no phone"} | ${pa.mobilityType || "AMB"}`;
  }).join("\n");

  return {
    message: `Found ${matchedPatients.length} patient(s):\n${list}`,
    actions: [{ type: "patient_searched", detail: `${matchedPatients.length} results` }],
  };
}

function handleHelp(): Partial<BotResponse> {
  return {
    message: `🤖 UCM Dispatch Assistant — I can help with:\n
• **Create trip**: "Schedule trip for John Smith tomorrow at 9 AM from 123 Main St"
• **Check status**: "Status of trip #1234"
• **ETA query**: "ETA for trip #1234"
• **List trips**: "Show today's trips"
• **Driver availability**: "Available drivers"
• **Find patient**: "Find patient Mary Johnson"
• **Cancel trip**: "Cancel trip #1234"
• **Reassign driver**: "Reassign driver for trip #1234"

I understand English and Spanish. Just type naturally!`,
    actions: [],
    suggestions: [
      "Show today's trips",
      "Available drivers",
      "Schedule a new trip",
    ],
  };
}

// ─── Reassignment Handler ────────────────────────────────────────────────────

async function handleReassign(entities: ExtractedEntities, companyId: number): Promise<Partial<BotResponse>> {
  if (!entities.tripId) {
    return { message: "Please specify a trip ID. Example: \"Reassign driver for trip #1234\"", actions: [] };
  }

  const [trip] = await db.select().from(trips).where(eq(trips.id, entities.tripId));
  if (!trip) {
    return { message: `Trip #${entities.tripId} not found.`, actions: [] };
  }

  if (!trip.driverId) {
    return {
      message: `Trip #${entities.tripId} has no driver assigned yet. Use auto-assign or specify a driver.`,
      actions: [],
      suggestions: ["Available drivers", `Status of trip #${entities.tripId}`],
    };
  }

  // If a target driver is specified, perform the reassignment
  if (entities.driverId) {
    const [newDriver] = await db.select().from(drivers).where(eq(drivers.id, entities.driverId));
    if (!newDriver) {
      return { message: `Driver #${entities.driverId} not found.`, actions: [] };
    }

    try {
      await db.update(trips).set({
        driverId: entities.driverId,
        assignmentSource: "chatbot_reassign",
        assignmentReason: `Reassigned via AI chatbot from driver #${trip.driverId}`,
        updatedAt: new Date(),
      } as any).where(eq(trips.id, entities.tripId!));

      return {
        message: `Trip #${entities.tripId} reassigned to ${newDriver.firstName} ${newDriver.lastName} (ID: ${newDriver.id}).`,
        actions: [{ type: "trip_reassigned", detail: `Reassigned to driver #${entities.driverId}`, entityId: entities.tripId }],
      };
    } catch (err: any) {
      return {
        message: `Error reassigning trip: ${err.message}`,
        actions: [{ type: "error", detail: err.message }],
      };
    }
  }

  // No target driver specified - show available drivers and return pending action
  const availableDrivers = await db.select({
    id: drivers.id,
    firstName: drivers.firstName,
    lastName: drivers.lastName,
    dispatchStatus: drivers.dispatchStatus,
  }).from(drivers).where(
    and(
      eq(drivers.companyId, companyId),
      eq(drivers.status, "ACTIVE"),
      eq(drivers.dispatchStatus, "available"),
      isNull(drivers.deletedAt)
    )
  );

  const driverList = availableDrivers.slice(0, 8).map(d =>
    `  - ${d.firstName} ${d.lastName} (ID: ${d.id})`
  ).join("\n") || "  None available";

  return {
    message: `Trip #${entities.tripId} is currently assigned. Available drivers:\n${driverList}\n\nTo reassign, say "Reassign trip #${entities.tripId} to driver #<ID>"`,
    actions: [],
    pendingAction: { type: "reassign", data: { tripId: entities.tripId } },
    suggestions: availableDrivers.slice(0, 3).map(d => `Reassign trip #${entities.tripId} to driver #${d.id}`),
  };
}

// ─── Trip Creation Confirmation Flow ─────────────────────────────────────────

async function handleTripCreationConfirmation(
  context: ConversationContext,
  userMessage: string,
  companyId: number,
  cityId: number | null
): Promise<Partial<BotResponse> | null> {
  if (!context.pendingAction || context.pendingAction.type !== "confirm_trip") return null;

  const isYes = /^(yes|y|si|confirm|ok|sure|go|do it|create)/i.test(userMessage.trim());
  const isNo = /^(no|n|cancel|nevermind|abort|stop)/i.test(userMessage.trim());

  if (isYes) {
    const entities = context.pendingAction.data as ExtractedEntities;
    context.pendingAction = null;
    return handleCreateTrip(entities, companyId, cityId);
  }

  if (isNo) {
    context.pendingAction = null;
    return {
      message: "Trip creation cancelled.",
      actions: [{ type: "trip_cancelled", detail: "User cancelled trip creation" }],
    };
  }

  return null; // Not a confirmation response
}

// ─── Enhanced Help Handler ───────────────────────────────────────────────────

function handleHelpEnhanced(): Partial<BotResponse> {
  return {
    message: `UCM Dispatch Assistant -- Here's what I can help with:

**Trip Management:**
- "Schedule trip for John Smith tomorrow at 9:00 AM from 123 Main St"
- "Book wheelchair trip for Mary Johnson on 03/15 at 2:30 PM"
- "Cancel trip #1234"

**Status & ETA:**
- "Status of trip #1234"
- "ETA for trip #1234"
- "Show today's trips"

**Driver Operations:**
- "Available drivers"
- "Reassign driver for trip #1234"
- "Reassign trip #1234 to driver #5"

**Patient Lookup:**
- "Find patient Mary Johnson"
- "Patient info for John Smith"

I understand English and Spanish. Just type naturally!
Type "help" anytime to see this again.`,
    actions: [],
    suggestions: [
      "Show today's trips",
      "Available drivers",
      "Schedule a new trip",
    ],
  };
}

// ─── Main Chat Handler ───────────────────────────────────────────────────────

export async function processDispatchMessage(
  sessionId: number,
  userMessage: string,
  companyId: number,
  userId: number,
  cityId: number | null
): Promise<BotResponse> {
  const context = getSessionContext(sessionId);
  context.turnCount++;

  // Classify intent
  const { intent, confidence } = classifyIntent(userMessage);
  const newEntities = extractEntities(userMessage);

  // Merge entities with conversation context
  const mergedEntities = mergeEntities(context.accumulatedEntities, newEntities);
  context.accumulatedEntities = mergedEntities;
  context.lastIntent = intent;

  // Extract driver ID from "driver #123" or "to driver #123" pattern
  const driverIdMatch = userMessage.match(/(?:driver|conductor)\s*#?\s*(\d+)/i);
  if (driverIdMatch) {
    mergedEntities.driverId = parseInt(driverIdMatch[1]);
  }

  // Store user message
  await db.insert(dispatchChatMessages).values({
    sessionId,
    role: "user",
    content: userMessage,
    intent,
    entitiesJson: mergedEntities as any,
    confidence,
  });

  let response: Partial<BotResponse>;

  // Check for pending confirmation first
  const confirmResult = await handleTripCreationConfirmation(context, userMessage, companyId, cityId);
  if (confirmResult) {
    response = confirmResult;
  }
  // Ambiguity detection: when confidence is low, ask clarifying question
  else if (confidence < 0.5 && intent === "general") {
    response = {
      message: `I'm not quite sure what you mean. Could you rephrase or try one of these?`,
      actions: [],
      needsClarification: true,
      suggestions: [
        "Show today's trips",
        "Available drivers",
        "Status of trip #__",
        "Schedule a trip",
        "Help",
      ],
    };
  }
  else {
    // Generate response based on intent
    switch (intent) {
      case "create_trip": {
        // Check if we have all required info; if so, confirm first
        const missing: string[] = [];
        if (!mergedEntities.patientName && !mergedEntities.patientId) missing.push("patient name");
        if (!mergedEntities.date) missing.push("date");
        if (!mergedEntities.time) missing.push("pickup time");
        if (!mergedEntities.address) missing.push("pickup address");

        if (missing.length === 0) {
          // We have everything - ask for confirmation
          context.pendingAction = { type: "confirm_trip", data: { ...mergedEntities } };
          response = {
            message: `I'll create a trip with:\n- Patient: ${mergedEntities.patientName || `ID #${mergedEntities.patientId}`}\n- Date: ${mergedEntities.date}\n- Time: ${mergedEntities.time}\n- Pickup: ${mergedEntities.address}\n${mergedEntities.mobilityType ? `- Type: ${mergedEntities.mobilityType}\n` : ""}\nConfirm? (yes/no)`,
            actions: [],
            pendingAction: { type: "confirm_trip", data: { ...mergedEntities } },
            suggestions: ["Yes", "No"],
          };
        } else {
          response = await handleCreateTrip(mergedEntities, companyId, cityId);
        }
        break;
      }
      case "check_status":
      case "eta_query":
        response = await handleCheckStatus(mergedEntities);
        break;
      case "list_trips":
        response = await handleListTrips(companyId, cityId);
        break;
      case "driver_availability":
        response = await handleDriverAvailability(companyId);
        break;
      case "patient_lookup":
        response = await handlePatientLookup(mergedEntities, companyId);
        break;
      case "reassign":
        response = await handleReassign(mergedEntities, companyId);
        break;
      case "cancel_trip":
        if (!mergedEntities.tripId) {
          response = { message: "Please specify a trip ID. Example: \"Cancel trip #1234\"", actions: [] };
        } else {
          response = {
            message: `Are you sure you want to cancel trip #${mergedEntities.tripId}? This action requires dispatch board confirmation. Please cancel from the trip management screen.`,
            actions: [],
          };
        }
        break;
      case "help":
        response = handleHelpEnhanced();
        break;
      default:
        response = {
          message: "I'm not sure what you need. Here are some things I can help with:",
          actions: [],
          suggestions: ["Show today's trips", "Available drivers", "Schedule a trip", "Help"],
        };
    }
  }

  const botResponse: BotResponse = {
    message: response.message || "I couldn't process that request.",
    intent,
    entities: mergedEntities,
    actions: response.actions || [],
    confidence,
    suggestions: response.suggestions,
    needsClarification: response.needsClarification,
    pendingAction: response.pendingAction || null,
  };

  // Store bot response
  await db.insert(dispatchChatMessages).values({
    sessionId,
    role: "assistant",
    content: botResponse.message,
    intent,
    actionsTaken: botResponse.actions as any,
    confidence,
  });

  // Update session context in DB
  await db.update(dispatchChatSessions).set({
    context: {
      lastIntent: intent,
      turnCount: context.turnCount,
      pendingAction: context.pendingAction,
    } as any,
  }).where(eq(dispatchChatSessions.id, sessionId));

  return botResponse;
}

// ─── Session Management ──────────────────────────────────────────────────────

export async function createChatSession(
  companyId: number,
  userId: number,
  cityId: number | null,
  channel: string = "web"
): Promise<number> {
  const [session] = await db.insert(dispatchChatSessions).values({
    companyId,
    userId,
    cityId,
    channel,
    status: "active",
    context: {} as any,
  }).returning();
  return session.id;
}

export async function getChatHistory(sessionId: number, limit: number = 50) {
  return db.select().from(dispatchChatMessages)
    .where(eq(dispatchChatMessages.sessionId, sessionId))
    .orderBy(desc(dispatchChatMessages.createdAt))
    .limit(limit);
}

export async function getActiveSession(userId: number): Promise<number | null> {
  const [session] = await db.select().from(dispatchChatSessions).where(
    and(
      eq(dispatchChatSessions.userId, userId),
      eq(dispatchChatSessions.status, "active")
    )
  ).orderBy(desc(dispatchChatSessions.createdAt)).limit(1);
  return session?.id || null;
}
