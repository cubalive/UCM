/**
 * EHR/FHIR Integration Engine
 * Connects with Epic, Cerner, Athena, and generic FHIR R4 servers
 * to sync appointments and auto-create NEMT trips.
 */
import { db } from "../db";
import { ehrConnections, ehrAppointmentSync, patients, trips, clinics } from "@shared/schema";
import { eq, and, gte, isNull, inArray } from "drizzle-orm";
import { cityNowDate } from "@shared/timeUtils";

// ─── FHIR R4 Types (subset) ──────────────────────────────────────────────────

interface FhirAppointment {
  resourceType: "Appointment";
  id: string;
  status: "proposed" | "pending" | "booked" | "arrived" | "fulfilled" | "cancelled" | "noshow";
  start?: string; // ISO datetime
  end?: string;
  participant?: Array<{
    actor?: { reference?: string; display?: string };
    status?: string;
  }>;
  reasonCode?: Array<{ text?: string }>;
  description?: string;
}

interface FhirPatient {
  resourceType: "Patient";
  id: string;
  name?: Array<{ given?: string[]; family?: string; text?: string }>;
  telecom?: Array<{ system?: string; value?: string }>;
  birthDate?: string;
  address?: Array<{
    line?: string[];
    city?: string;
    state?: string;
    postalCode?: string;
    text?: string;
  }>;
}

interface FhirBundle {
  resourceType: "Bundle";
  total?: number;
  entry?: Array<{ resource: any }>;
  link?: Array<{ relation: string; url: string }>;
}

// ─── Provider-Specific Configuration ─────────────────────────────────────────

const PROVIDER_CONFIGS: Record<string, {
  tokenEndpoint: (baseUrl: string) => string;
  appointmentPath: string;
  patientPath: string;
  authType: "oauth2" | "smart_on_fhir" | "basic";
  defaultScopes: string;
}> = {
  EPIC: {
    tokenEndpoint: (base) => `${base}/oauth2/token`,
    appointmentPath: "/api/FHIR/R4/Appointment",
    patientPath: "/api/FHIR/R4/Patient",
    authType: "smart_on_fhir",
    defaultScopes: "patient/Appointment.read patient/Patient.read",
  },
  CERNER: {
    tokenEndpoint: (base) => `${base}/oauth2/token`,
    appointmentPath: "/fhir/r4/Appointment",
    patientPath: "/fhir/r4/Patient",
    authType: "oauth2",
    defaultScopes: "system/Appointment.read system/Patient.read",
  },
  ATHENA: {
    tokenEndpoint: (base) => `${base}/oauth2/v1/token`,
    appointmentPath: "/fhir/r4/Appointment",
    patientPath: "/fhir/r4/Patient",
    authType: "oauth2",
    defaultScopes: "athena/Appointment.read athena/Patient.read",
  },
  GENERIC_FHIR: {
    tokenEndpoint: (base) => `${base}/auth/token`,
    appointmentPath: "/Appointment",
    patientPath: "/Patient",
    authType: "oauth2",
    defaultScopes: "Appointment.read Patient.read",
  },
};

// ─── Token Management ────────────────────────────────────────────────────────

async function refreshAccessToken(connection: typeof ehrConnections.$inferSelect): Promise<string | null> {
  const config = PROVIDER_CONFIGS[connection.provider] || PROVIDER_CONFIGS.GENERIC_FHIR;

  // Check if existing token is still valid (5 min buffer)
  if (connection.accessToken && connection.tokenExpiresAt) {
    const expiresAt = new Date(connection.tokenExpiresAt);
    if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
      return connection.accessToken;
    }
  }

  if (!connection.clientId || !connection.clientSecret) {
    console.error(`[EHR] Missing credentials for connection ${connection.id}`);
    return null;
  }

  try {
    const tokenUrl = config.tokenEndpoint(connection.fhirBaseUrl);
    const body = new URLSearchParams({
      grant_type: connection.refreshToken ? "refresh_token" : "client_credentials",
      client_id: connection.clientId,
      client_secret: connection.clientSecret,
      scope: connection.scopes || config.defaultScopes,
      ...(connection.refreshToken ? { refresh_token: connection.refreshToken } : {}),
    });

    const resp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Token refresh failed: ${resp.status} ${errText}`);
    }

    const tokenData = await resp.json() as { access_token: string; expires_in?: number; refresh_token?: string };
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);

    await db.update(ehrConnections).set({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || connection.refreshToken,
      tokenExpiresAt: expiresAt,
      status: "active",
      lastError: null,
      updatedAt: new Date(),
    }).where(eq(ehrConnections.id, connection.id));

    return tokenData.access_token;
  } catch (err: any) {
    console.error(`[EHR] Token refresh error for connection ${connection.id}:`, err.message);
    await db.update(ehrConnections).set({
      status: "error",
      lastError: err.message,
      updatedAt: new Date(),
    }).where(eq(ehrConnections.id, connection.id));
    return null;
  }
}

// ─── FHIR API Client ─────────────────────────────────────────────────────────

async function fhirGet(connection: typeof ehrConnections.$inferSelect, path: string, params?: Record<string, string>): Promise<any | null> {
  const token = await refreshAccessToken(connection);
  if (!token) return null;

  const config = PROVIDER_CONFIGS[connection.provider] || PROVIDER_CONFIGS.GENERIC_FHIR;
  const url = new URL(connection.fhirBaseUrl + (path.startsWith("/") ? path : config.appointmentPath + "/" + path));
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/fhir+json",
    },
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[EHR] FHIR GET ${path} failed: ${resp.status} ${errText}`);
    return null;
  }

  return resp.json();
}

// ─── Appointment Sync ────────────────────────────────────────────────────────

export async function syncClinicAppointments(connectionId: number): Promise<{
  synced: number;
  tripsCreated: number;
  errors: number;
}> {
  const [connection] = await db.select().from(ehrConnections).where(eq(ehrConnections.id, connectionId));
  if (!connection || connection.status === "disabled") {
    return { synced: 0, tripsCreated: 0, errors: 0 };
  }

  const config = PROVIDER_CONFIGS[connection.provider] || PROVIDER_CONFIGS.GENERIC_FHIR;
  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, connection.clinicId));
  if (!clinic) return { synced: 0, tripsCreated: 0, errors: 0 };

  const clinicTz = (clinic as any).timezone || "America/Los_Angeles";
  const today = cityNowDate(clinicTz);

  // Fetch appointments for today and next 7 days
  const endDate = new Date(new Date(today).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const bundle: FhirBundle | null = await fhirGet(connection, config.appointmentPath, {
    date: `ge${today}`,
    "date:end": `le${endDate}`,
    status: "booked,pending",
    _count: "200",
  });

  if (!bundle?.entry) {
    await db.update(ehrConnections).set({
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(ehrConnections.id, connection.id));
    return { synced: 0, tripsCreated: 0, errors: 0 };
  }

  let synced = 0, tripsCreated = 0, errors = 0;

  for (const entry of bundle.entry) {
    const appt = entry.resource as FhirAppointment;
    if (appt.resourceType !== "Appointment") continue;

    try {
      // Check if already synced
      const [existing] = await db.select().from(ehrAppointmentSync).where(
        and(
          eq(ehrAppointmentSync.ehrConnectionId, connection.id),
          eq(ehrAppointmentSync.fhirAppointmentId, appt.id)
        )
      );

      if (existing?.syncStatus === "trip_created") {
        synced++;
        continue;
      }

      // Extract appointment details
      const apptStart = appt.start ? new Date(appt.start) : null;
      const apptEnd = appt.end ? new Date(appt.end) : null;
      const apptDate = apptStart ? apptStart.toISOString().split("T")[0] : today;
      const apptTime = apptStart
        ? `${String(apptStart.getHours()).padStart(2, "0")}:${String(apptStart.getMinutes()).padStart(2, "0")}`
        : null;
      const apptEndTime = apptEnd
        ? `${String(apptEnd.getHours()).padStart(2, "0")}:${String(apptEnd.getMinutes()).padStart(2, "0")}`
        : null;

      // Extract patient reference
      const patientRef = appt.participant?.find(p =>
        p.actor?.reference?.startsWith("Patient/")
      );
      const fhirPatientId = patientRef?.actor?.reference?.replace("Patient/", "") || null;

      // Extract practitioner name
      const practRef = appt.participant?.find(p =>
        p.actor?.reference?.startsWith("Practitioner/")
      );
      const practitionerName = practRef?.actor?.display || null;

      // Match patient in our system
      let localPatientId: number | null = null;
      if (fhirPatientId && existing?.patientId) {
        localPatientId = existing.patientId;
      }

      // Upsert sync record
      const syncValues = {
        ehrConnectionId: connection.id,
        clinicId: connection.clinicId,
        fhirAppointmentId: appt.id,
        fhirPatientId,
        patientId: localPatientId,
        appointmentDate: apptDate,
        appointmentTime: apptTime,
        appointmentEndTime: apptEndTime,
        appointmentStatus: appt.status,
        practitionerName,
        reasonText: appt.reasonCode?.[0]?.text || appt.description || null,
        rawFhirJson: appt as any,
        syncStatus: "pending" as const,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(ehrAppointmentSync).set(syncValues).where(eq(ehrAppointmentSync.id, existing.id));
      } else {
        await db.insert(ehrAppointmentSync).values(syncValues);
      }

      synced++;
    } catch (err: any) {
      console.error(`[EHR] Sync appointment ${appt.id} error:`, err.message);
      errors++;
    }
  }

  await db.update(ehrConnections).set({
    lastSyncAt: new Date(),
    lastError: errors > 0 ? `${errors} errors during sync` : null,
    status: errors > 0 && synced === 0 ? "error" : "active",
    updatedAt: new Date(),
  }).where(eq(ehrConnections.id, connection.id));

  return { synced, tripsCreated, errors };
}

// ─── Auto-Create Trips from Synced Appointments ──────────────────────────────

export async function createTripsFromAppointments(clinicId: number): Promise<{
  created: number;
  skipped: number;
  errors: number;
}> {
  const pendingSyncs = await db.select().from(ehrAppointmentSync).where(
    and(
      eq(ehrAppointmentSync.clinicId, clinicId),
      eq(ehrAppointmentSync.syncStatus, "pending"),
      gte(ehrAppointmentSync.appointmentDate, new Date().toISOString().split("T")[0])
    )
  );

  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId));
  if (!clinic) return { created: 0, skipped: 0, errors: 0 };

  let created = 0, skipped = 0, errors = 0;

  for (const sync of pendingSyncs) {
    try {
      // Skip if no patient linked or no appointment time
      if (!sync.patientId || !sync.appointmentTime) {
        await db.update(ehrAppointmentSync).set({
          syncStatus: "skipped",
          syncError: !sync.patientId ? "No linked patient" : "No appointment time",
          updatedAt: new Date(),
        }).where(eq(ehrAppointmentSync.id, sync.id));
        skipped++;
        continue;
      }

      // Get patient for address
      const [patient] = await db.select().from(patients).where(eq(patients.id, sync.patientId));
      if (!patient) {
        await db.update(ehrAppointmentSync).set({
          syncStatus: "skipped",
          syncError: "Patient not found",
          updatedAt: new Date(),
        }).where(eq(ehrAppointmentSync.id, sync.id));
        skipped++;
        continue;
      }

      // Calculate pickup time (appointment time minus estimated travel)
      const [apptH, apptM] = sync.appointmentTime.split(":").map(Number);
      const bufferMinutes = 30; // default 30 min before appointment
      const pickupMinutes = apptH * 60 + apptM - bufferMinutes;
      const pickupH = Math.max(0, Math.floor(pickupMinutes / 60));
      const pickupM = Math.max(0, pickupMinutes % 60);
      const pickupTime = `${String(pickupH).padStart(2, "0")}:${String(pickupM).padStart(2, "0")}`;

      // Create the trip
      const [newTrip] = await db.insert(trips).values({
        patientId: sync.patientId,
        clinicId,
        companyId: (clinic as any).companyId || null,
        scheduledDate: sync.appointmentDate,
        scheduledTime: pickupTime,
        pickupTime,
        pickupAddress: (patient as any).address || "",
        dropoffAddress: (clinic as any).address || "",
        pickupLat: (patient as any).lat || null,
        pickupLng: (patient as any).lng || null,
        dropoffLat: (clinic as any).lat || null,
        dropoffLng: (clinic as any).lng || null,
        status: "SCHEDULED",
        mobilityRequirement: (patient as any).mobilityType || "AMBULATORY",
        tripTimezone: (clinic as any).timezone || "America/Los_Angeles",
        notes: `EHR Auto: ${sync.reasonText || "Appointment"} with ${sync.practitionerName || "provider"}`,
        source: "ehr_sync",
      } as any).returning();

      // Update sync record
      await db.update(ehrAppointmentSync).set({
        tripId: newTrip.id,
        syncStatus: "trip_created",
        syncError: null,
        updatedAt: new Date(),
      }).where(eq(ehrAppointmentSync.id, sync.id));

      created++;
      console.log(`[EHR] Created trip ${newTrip.id} from appointment ${sync.fhirAppointmentId}`);
    } catch (err: any) {
      console.error(`[EHR] Create trip for sync ${sync.id} error:`, err.message);
      await db.update(ehrAppointmentSync).set({
        syncStatus: "error",
        syncError: err.message,
        updatedAt: new Date(),
      }).where(eq(ehrAppointmentSync.id, sync.id));
      errors++;
    }
  }

  return { created, skipped, errors };
}

// ─── Patient Matching (FHIR Patient → Local Patient) ─────────────────────────

export async function matchFhirPatient(
  connectionId: number,
  fhirPatientId: string
): Promise<number | null> {
  const [connection] = await db.select().from(ehrConnections).where(eq(ehrConnections.id, connectionId));
  if (!connection) return null;

  const config = PROVIDER_CONFIGS[connection.provider] || PROVIDER_CONFIGS.GENERIC_FHIR;
  const fhirPatient: FhirPatient | null = await fhirGet(connection, `${config.patientPath}/${fhirPatientId}`);
  if (!fhirPatient) return null;

  // Try matching by name + DOB
  const name = fhirPatient.name?.[0];
  const fullName = name?.text || [
    ...(name?.given || []),
    name?.family || "",
  ].join(" ").trim();
  const dob = fhirPatient.birthDate || null;

  if (!fullName) return null;

  // Search local patients by clinic
  const clinicPatients = await db.select().from(patients).where(
    and(
      eq(patients.clinicId, connection.clinicId),
      isNull(patients.deletedAt)
    )
  );

  // Fuzzy match: exact name + DOB, or close name match
  for (const p of clinicPatients) {
    const localName = ((p as any).firstName + " " + (p as any).lastName).toLowerCase().trim();
    const fhirNameLower = fullName.toLowerCase().trim();

    if (localName === fhirNameLower) {
      if (!dob || (p as any).dateOfBirth === dob) {
        return p.id;
      }
    }
  }

  return null;
}

// ─── Connection Health Check ─────────────────────────────────────────────────

export async function checkEhrConnectionHealth(connectionId: number): Promise<{
  healthy: boolean;
  message: string;
}> {
  const [connection] = await db.select().from(ehrConnections).where(eq(ehrConnections.id, connectionId));
  if (!connection) return { healthy: false, message: "Connection not found" };

  try {
    const config = PROVIDER_CONFIGS[connection.provider] || PROVIDER_CONFIGS.GENERIC_FHIR;
    const result = await fhirGet(connection, config.appointmentPath, { _count: "1" });
    if (result) {
      return { healthy: true, message: "Connection active and responding" };
    }
    return { healthy: false, message: "No response from FHIR server" };
  } catch (err: any) {
    return { healthy: false, message: err.message };
  }
}

// ─── Sync All Active Connections (Scheduler Entry Point) ─────────────────────

export async function syncAllEhrConnections(): Promise<void> {
  const activeConnections = await db.select().from(ehrConnections).where(
    inArray(ehrConnections.status, ["active", "pending"])
  );

  for (const conn of activeConnections) {
    try {
      console.log(`[EHR] Syncing connection ${conn.id} (${conn.provider}) for clinic ${conn.clinicId}`);
      const result = await syncClinicAppointments(conn.id);
      console.log(`[EHR] Sync result: ${result.synced} synced, ${result.tripsCreated} trips, ${result.errors} errors`);

      // Auto-create trips from pending synced appointments
      const tripResult = await createTripsFromAppointments(conn.clinicId);
      console.log(`[EHR] Trip creation: ${tripResult.created} created, ${tripResult.skipped} skipped, ${tripResult.errors} errors`);
    } catch (err: any) {
      console.error(`[EHR] Sync connection ${conn.id} failed:`, err.message);
    }
  }
}
