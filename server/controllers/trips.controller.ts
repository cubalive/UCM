import type { Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireRole, getCompanyIdFromAuth, applyCompanyFilter, checkCompanyOwnership, getUserCityIds, type AuthRequest } from "../auth";
import { insertTripSchema, drivers, vehicles, trips, tripMessages, recurringSchedules, driverOffers, invoices, tripPdfs, tripBilling, tripLocationPoints, patients, clinics } from "@shared/schema";
import { VALID_TRANSITIONS, STATUS_TIMESTAMP_MAP } from "@shared/tripStateMachine";
import { db } from "../db";
import { eq, ne, sql, and, or, not, isNull, inArray, notInArray, desc, gte } from "drizzle-orm";
import { generatePublicId } from "../public-id";
import { enforceCityContext, getAllowedCityId, checkCityAccess } from "../middleware/cityContext";
import { getScope, requireScope, buildScopeFilters, forceCompanyOnCreate } from "../middleware/scopeContext";
import { tripLockedGuard } from "../lib/tripLockGuard";
import { sendEmail } from "../lib/email";
import { z } from "zod";
import { idempotencyMiddleware } from "../lib/idempotency";
import { companyRpmLimiter, checkDriverQuota, checkActiveTripQuota } from "../lib/companyQuotas";
import { enqueueJob } from "../lib/jobQueue";
import { sendPushToDriver } from "../lib/push";
import { runRecurringScheduleGenerator } from "../lib/recurringScheduleEngine";

export async function getRecurringSchedulesHandler(req: AuthRequest, res: Response) {
  try {
    const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;
    if (patientId) {
      const schedules = await storage.getRecurringSchedulesByPatient(patientId);
      return res.json(schedules);
    }
    const cityId = req.query.cityId ? Number(req.query.cityId) : undefined;
    if (cityId) {
      if (!(await checkCityAccess(req, cityId))) {
        return res.status(403).json({ message: "No access to this city" });
      }
      const schedules = await storage.getRecurringSchedulesByCity(cityId);
      return res.json(schedules);
    }
    const schedules = await storage.getActiveRecurringSchedules();
    res.json(schedules);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function createRecurringScheduleHandler(req: AuthRequest, res: Response) {
  try {
    const { patientId, cityId, days, pickupTime, startDate, endDate } = req.body;
    if (!patientId || !cityId || !days?.length || !pickupTime || !startDate) {
      return res.status(400).json({ message: "patientId, cityId, days, pickupTime, and startDate are required" });
    }
    if (!(await checkCityAccess(req, cityId))) {
      return res.status(403).json({ message: "No access to this city" });
    }
    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }
    if (!patient.address) {
      return res.status(400).json({ message: "Cannot create recurring schedule: patient has no address on file. Please add an address first." });
    }
    const schedule = await storage.createRecurringSchedule({
      patientId,
      cityId,
      days,
      pickupTime,
      startDate,
      endDate: endDate || null,
      active: true,
    });
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CREATE",
      entity: "recurring_schedule",
      entityId: schedule.id,
      details: `Created recurring schedule for patient ${patientId}: ${days.join(",")} at ${pickupTime}`,
      cityId,
    });
    res.status(201).json(schedule);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function updateRecurringScheduleHandler(req: AuthRequest, res: Response) {
  try {
    const id = Number(req.params.id);
    const current = (await db.select().from(recurringSchedules).where(eq(recurringSchedules.id, id)).limit(1))[0];
    if (!current) return res.status(404).json({ message: "Schedule not found" });

    const allowedFields = ['days', 'pickupTime', 'dropoffAddress', 'dropoffLat', 'dropoffLng', 'pickupAddress', 'pickupLat', 'pickupLng', 'notes', 'active', 'startDate', 'endDate', 'serviceType', 'wheelchairRequired', 'returnTrip'];
    const updates: any = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const merged = { ...current, ...updates };
    if (merged.active) {
      if (!merged.days?.length || !merged.pickupTime) {
        return res.status(400).json({ message: "Cannot activate schedule without days and pickup time" });
      }
      const patient = await storage.getPatient(merged.patientId);
      if (!patient?.address) {
        return res.status(400).json({ message: "Cannot activate schedule: patient has no address on file" });
      }
    }
    if (merged.endDate && merged.startDate && merged.endDate < merged.startDate) {
      return res.status(400).json({ message: "End date must be on or after start date" });
    }

    const schedule = await storage.updateRecurringSchedule(id, req.body);
    if (!schedule) return res.status(404).json({ message: "Schedule not found" });
    res.json(schedule);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function deleteRecurringScheduleHandler(req: AuthRequest, res: Response) {
  try {
    const id = Number(req.params.id);
    await storage.deleteRecurringSchedule(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function generateRecurringSchedulesHandler(req: AuthRequest, res: Response) {
  try {
    const result = await runRecurringScheduleGenerator();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function enrichTripsWithRelations(tripList: any[]) {
  if (tripList.length === 0) return [];

  const allCities = await storage.getCities();
  const cityMap = new Map(allCities.map(c => [c.id, c]));

  const tripIds = tripList.map(t => t.id).filter(Boolean);
  const acceptedOffers = tripIds.length > 0
    ? await db.select({ tripId: driverOffers.tripId, acceptedAt: driverOffers.acceptedAt })
        .from(driverOffers)
        .where(and(inArray(driverOffers.tripId, tripIds), eq(driverOffers.status, "accepted")))
    : [];
  const acceptedMap = new Map(acceptedOffers.filter(o => o.acceptedAt).map(o => [o.tripId, o.acceptedAt]));

  // Batch-load all related entities in parallel instead of N+1 per trip
  const patientIds = [...new Set(tripList.map(t => t.patientId).filter(Boolean))];
  const clinicIds = [...new Set(tripList.map(t => t.clinicId).filter(Boolean))];
  const driverIds = [...new Set(tripList.map(t => t.driverId).filter(Boolean))];

  const [batchPatients, batchClinics, batchDrivers] = await Promise.all([
    patientIds.length > 0 ? db.select().from(patients).where(inArray(patients.id, patientIds)) : [],
    clinicIds.length > 0 ? db.select().from(clinics).where(inArray(clinics.id, clinicIds)) : [],
    driverIds.length > 0 ? db.select().from(drivers).where(inArray(drivers.id, driverIds)) : [],
  ]);

  const patientMap = new Map(batchPatients.map(p => [p.id, p]));
  const clinicMap = new Map(batchClinics.map(c => [c.id, c]));
  const driverMap = new Map(batchDrivers.map(d => [d.id, d]));

  // Batch-load vehicles for drivers + direct vehicle assignments
  const vehicleIds = [...new Set([
    ...batchDrivers.map(d => d.vehicleId).filter(Boolean),
    ...tripList.map(t => t.vehicleId).filter(Boolean),
  ])] as number[];
  const batchVehicles = vehicleIds.length > 0
    ? await db.select().from(vehicles).where(inArray(vehicles.id, vehicleIds))
    : [];
  const vehicleMap = new Map(batchVehicles.map(v => [v.id, v]));

  return tripList.map((t) => {
    const patient = t.patientId ? patientMap.get(t.patientId) : null;
    const clinic = t.clinicId ? clinicMap.get(t.clinicId) : null;
    const driver = t.driverId ? driverMap.get(t.driverId) : null;
    const vehicle = driver?.vehicleId ? vehicleMap.get(driver.vehicleId) : (t.vehicleId ? vehicleMap.get(t.vehicleId) : null);
    const city = cityMap.get(t.cityId);
    const offerAcceptedAt = acceptedMap.get(t.id);
    return {
      ...t,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
      clinicName: clinic?.name || null,
      driverName: driver ? `${driver.firstName} ${driver.lastName}` : null,
      driverPhone: driver?.phone || null,
      driverLastLat: driver?.lastLat || null,
      driverLastLng: driver?.lastLng || null,
      driverLastSeenAt: driver?.lastSeenAt || null,
      vehicleLabel: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
      vehicleType: vehicle?.capability || null,
      vehicleColor: vehicle?.colorHex || null,
      vehicleMake: vehicle?.make || null,
      vehicleModel: vehicle?.model || null,
      cityName: city?.name || null,
      acceptedAt: offerAcceptedAt ? new Date(offerAcceptedAt).toISOString() : null,
    };
  });
}

export async function assignTripHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (tripLockedGuard(trip, req, res)) return;
    const otherTerminal = ["CANCELLED", "NO_SHOW", "COMPLETED"];
    if (otherTerminal.includes(trip.status)) {
      return res.status(400).json({ message: `Cannot assign driver to a ${trip.status.toLowerCase()} trip` });
    }
    const { driverId, vehicleId } = req.body;
    if (!driverId) return res.status(400).json({ message: "driverId is required" });
    const driver = await storage.getDriver(driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });
    if (driver.cityId !== trip.cityId) {
      return res.status(400).json({ message: "Driver must be in the same city as the trip" });
    }

    const callerCompanyId = getCompanyIdFromAuth(req);
    if (callerCompanyId && trip.companyId && trip.companyId !== callerCompanyId) {
      return res.status(403).json({ message: "Trip does not belong to your company" });
    }
    if (callerCompanyId && driver.companyId && driver.companyId !== callerCompanyId) {
      return res.status(403).json({ message: "Driver does not belong to your company" });
    }
    if (trip.companyId && driver.companyId && trip.companyId !== driver.companyId) {
      return res.status(400).json({ message: "Cannot assign a driver from a different company to this trip" });
    }

    const { isDriverAssignable } = await import("../lib/driverClassification");
    const assignCheck = isDriverAssignable(driver);
    if (!assignCheck.ok) {
      return res.status(400).json({ message: assignCheck.reason });
    }
    const forceAssign = req.body.force === true;
    if (assignCheck.warning && !forceAssign) {
      return res.status(409).json({ message: assignCheck.warning, requiresConfirmation: true });
    }

    if (vehicleId) {
      const vehicle = await storage.getVehicle(vehicleId);
      if (vehicle) {
        if (vehicle.companyId && trip.companyId && vehicle.companyId !== trip.companyId) {
          return res.status(400).json({ message: "Vehicle does not belong to the same company as the trip" });
        }
        if (trip.mobilityRequirement) {
          const { isVehicleCompatible } = await import("@shared/schema");
          if (!isVehicleCompatible(trip.mobilityRequirement, vehicle.capability)) {
            return res.status(400).json({ message: `Vehicle capability "${vehicle.capability || "STANDARD"}" is not compatible with trip mobility requirement "${trip.mobilityRequirement}".` });
          }
        }
      }
    }

    const useOffer = req.body.useOffer === true;
    const now = new Date();

    await db.update(driverOffers).set({ status: "cancelled" }).where(
      and(
        eq(driverOffers.tripId, id),
        eq(driverOffers.status, "pending")
      )
    );

    if (useOffer) {
      const OFFER_TTL_SECONDS = 30;
      const expiresAt = new Date(now.getTime() + OFFER_TTL_SECONDS * 1000);

      const [offer] = await db.insert(driverOffers).values({
        tripId: id,
        driverId,
        offeredAt: now,
        expiresAt,
        status: "pending",
        createdBy: req.user!.userId,
      }).returning();

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "OFFER_SENT",
        entity: "trip",
        entityId: id,
        details: JSON.stringify({
          driverId,
          driverPublicId: driver.publicId,
          driverName: `${driver.firstName} ${driver.lastName}`,
          vehicleId: vehicleId || null,
          tripPublicId: trip.publicId,
          offerId: offer.id,
          expiresInSec: OFFER_TTL_SECONDS,
          requestId: (req as any)._requestId || req.headers["x-request-id"] || null,
          role: req.user!.role,
        }),
        cityId: trip.cityId,
      });

      sendPushToDriver(driverId, {
        title: "New Trip Offer",
        body: `You have a new trip offer for ${trip.pickupAddress || "pickup"}. Respond in ${OFFER_TTL_SECONDS}s.`,
        data: { tripId: String(id), action: "trip_offer", offerId: String(offer.id) },
      }).catch(err => console.error(`[PUSH] Offer push failed for driver ${driverId}:`, err.message));

      return res.json({
        offerId: offer.id,
        tripId: id,
        driverId,
        driverName: `${driver.firstName} ${driver.lastName}`,
        status: "pending",
        expiresAt: expiresAt.toISOString(),
        secondsRemaining: OFFER_TTL_SECONDS,
        offerSent: true,
      });
    }

    const updateData: any = {
      driverId,
      status: "ASSIGNED",
      assignedAt: now,
      assignedBy: req.user!.userId,
      assignmentSource: "dispatch_direct",
    };
    if (vehicleId) updateData.vehicleId = vehicleId;
    else if (driver.vehicleId) updateData.vehicleId = driver.vehicleId;

    if ((!trip.estimatedArrivalTime || trip.estimatedArrivalTime === "TBD") && trip.pickupTime) {
      const origin = (trip.pickupLat && trip.pickupLng)
        ? { lat: Number(trip.pickupLat), lng: Number(trip.pickupLng) }
        : trip.pickupAddress;
      const dest = (trip.dropoffLat && trip.dropoffLng)
        ? { lat: Number(trip.dropoffLat), lng: Number(trip.dropoffLng) }
        : trip.dropoffAddress;
      try {
        const { etaMinutes: getEtaMinutes } = await import("../lib/googleMaps");
        const routeEta = await getEtaMinutes(origin, dest);
        const bufferMinutes = 5;
        const totalMin = routeEta.minutes + bufferMinutes;
        const [h, m] = trip.pickupTime.split(":").map(Number);
        const arr = new Date(2000, 0, 1, h, m + totalMin);
        updateData.estimatedArrivalTime = `${String(arr.getHours()).padStart(2, "0")}:${String(arr.getMinutes()).padStart(2, "0")}`;
        updateData.lastEtaMinutes = routeEta.minutes;
        updateData.distanceMiles = String(routeEta.distanceMiles);
      } catch (etaErr: any) {
        console.warn(`[ASSIGN] Route ETA calc failed for trip ${id}: ${etaErr.message}`);
      }
    }

    // Use optimistic concurrency: only assign if trip is still in the expected status
    const [updatedTrip] = await db.update(trips).set(updateData)
      .where(and(eq(trips.id, id), eq(trips.status, trip.status)))
      .returning();

    if (!updatedTrip) {
      return res.status(409).json({ message: "Trip was modified by another user. Please refresh and try again.", code: "CONCURRENT_MODIFICATION" });
    }

    import("../lib/realtime").then(({ broadcastToTrip }) => {
      broadcastToTrip(id, { type: "status_change", data: { status: "ASSIGNED", tripId: id } });
    }).catch(() => {});

    import("../lib/supabaseRealtime").then(({ broadcastTripSupabase }) => {
      broadcastTripSupabase(id, { type: "status_change", data: { status: "ASSIGNED", tripId: id } });
    }).catch(() => {});

    const smsBaseUrl = process.env.PUBLIC_BASE_URL_APP
      || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://app.unitedcaremobility.com");
    import("../lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
      autoNotifyPatient(id, "driver_assigned", { base_url: smsBaseUrl });
    }).catch(() => {});

    sendPushToDriver(driverId, {
      title: "Trip Assigned",
      body: `You have been assigned a trip to ${trip.pickupAddress || "pickup"}.`,
      data: { tripId: String(id), action: "trip_assigned" },
    }).catch(err => console.error(`[PUSH] Assign push failed for driver ${driverId}:`, err.message));

    // Deliver trip.assigned webhook to broker if trip originated from a broker request
    if (trip.requestSource === "broker") {
      import("@shared/schema").then(({ brokerTripRequests }) => {
        db.select().from(brokerTripRequests)
          .where(eq(brokerTripRequests.tripId, id))
          .limit(1)
          .then(([request]) => {
            if (request?.brokerId) {
              import("../lib/brokerWebhookEngine").then(({ deliverWebhook }) => {
                deliverWebhook(request.brokerId, "trip.assigned", {
                  tripId: id,
                  requestId: request.id,
                  status: "ASSIGNED",
                  driverId,
                  driverName: `${driver.firstName} ${driver.lastName}`,
                  publicId: updatedTrip.publicId,
                  assignedAt: now.toISOString(),
                }).catch(() => {});
              }).catch(() => {});
            }
          }).catch(() => {});
      }).catch(() => {});
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ASSIGN",
      entity: "trip",
      entityId: id,
      details: JSON.stringify({
        driverId,
        driverPublicId: driver.publicId,
        driverName: `${driver.firstName} ${driver.lastName}`,
        vehicleId: updateData.vehicleId || null,
        tripPublicId: trip.publicId,
        oldStatus: trip.status,
        newStatus: "ASSIGNED",
        requestId: (req as any)._requestId || req.headers["x-request-id"] || null,
        role: req.user!.role,
      }),
      cityId: trip.cityId,
    });

    res.json({
      tripId: id,
      driverId,
      driverName: `${driver.firstName} ${driver.lastName}`,
      vehicleId: updateData.vehicleId || null,
      status: "ASSIGNED",
      assigned: true,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getTripMessagesHandler(req: AuthRequest, res: Response) {
  try {
    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (req.user!.role === "DRIVER") {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId || trip.driverId !== user.driverId) {
        return res.status(403).json({ message: "You can only view messages for your assigned trips" });
      }
    } else {
      const hasAccess = await checkCityAccess(req, trip.cityId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });
    }
    const messages = await db.select().from(tripMessages)
      .where(eq(tripMessages.tripId, tripId))
      .orderBy(tripMessages.createdAt);
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function createTripMessageHandler(req: AuthRequest, res: Response) {
  try {
    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (tripLockedGuard(trip, req, res)) return;
    const otherTerminalMsg = ["CANCELLED", "NO_SHOW"];
    if (otherTerminalMsg.includes(trip.status)) {
      return res.status(400).json({ message: `Cannot send messages on a ${trip.status.toLowerCase()} trip` });
    }
    if (req.user!.role === "DRIVER") {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId || trip.driverId !== user.driverId) {
        return res.status(403).json({ message: "You can only message on your assigned trips" });
      }
    } else {
      const hasAccess = await checkCityAccess(req, trip.cityId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });
    }
    const { message } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ message: "Message text is required" });
    }
    const [newMsg] = await db.insert(tripMessages).values({
      tripId,
      senderId: req.user!.userId,
      senderRole: req.user!.role,
      message: message.trim(),
    }).returning();

    if (trip.driverId && req.user!.role !== "DRIVER") {
      sendPushToDriver(trip.driverId, {
        title: "Dispatch Message",
        body: message.trim().length > 100 ? message.trim().slice(0, 97) + "..." : message.trim(),
        data: { tripId: String(tripId), action: "dispatch_message", messageId: String(newMsg.id) },
      }).catch(err => console.error(`[PUSH] Dispatch message push failed:`, err.message));
    }

    res.json(newMsg);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getTripsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if ((user?.role === "VIEWER" || user?.role === "CLINIC_USER") && user.clinicId) {
      const clinic = await storage.getClinic(user.clinicId);
      if (clinic) {
        const tripsResult = await storage.getTrips(clinic.cityId);
        return res.json(tripsResult);
      }
      return res.status(403).json({ message: "No clinic linked" });
    }

    const scope = await getScope(req);
    if (!scope) return res.status(401).json({ message: "Unauthorized" });
    if (!requireScope(scope, res)) return;
    const filters = buildScopeFilters(scope);

    const tab = (req.query.tab as string) || "all";
    const DEFAULT_TRIPS_PAGE = 50;
    const MAX_TRIPS_PAGE = 200;
    const limitParam = Math.min(
      req.query.limit ? parseInt(req.query.limit as string) : DEFAULT_TRIPS_PAGE,
      MAX_TRIPS_PAGE
    );
    const source = req.query.source as string | undefined;

    const conditions: any[] = [isNull(trips.deletedAt)];
    const archivedRoles = ["SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"];
    const includeArchived = req.query.includeArchived === "true" && archivedRoles.includes(req.user?.role || "");
    if (!includeArchived) {
      conditions.push(isNull(trips.archivedAt));
    }
    if (filters.cityId && filters.cityId > 0) conditions.push(eq(trips.cityId, filters.cityId));
    if (filters.companyId) conditions.push(eq(trips.companyId, filters.companyId));

    if (source === "clinic") {
      conditions.push(eq(trips.requestSource, "clinic"));
      const clinicIdFilter = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
      if (clinicIdFilter) conditions.push(eq(trips.clinicId, clinicIdFilter));
    } else if (source === "internal") {
      conditions.push(eq(trips.requestSource, "internal"));
    } else if (source === "private") {
      conditions.push(eq(trips.requestSource, "private"));
    }

    if (tab === "unassigned") {
      conditions.push(isNull(trips.driverId));
      conditions.push(inArray(trips.status, ["SCHEDULED", "ASSIGNED"]));
      conditions.push(eq(trips.approvalStatus, "approved"));
    } else if (tab === "scheduled") {
      conditions.push(inArray(trips.status, ["SCHEDULED", "ASSIGNED"]));
    } else if (tab === "active") {
      conditions.push(inArray(trips.status, ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"]));
    } else if (tab === "completed") {
      conditions.push(inArray(trips.status, ["COMPLETED", "CANCELLED", "NO_SHOW"]));
    }

    const q = (req.query.q as string)?.trim();
    if (q) {
      const pattern = `%${q}%`;
      conditions.push(or(
        sql`${trips.publicId} ILIKE ${pattern}`,
        sql`${trips.pickupAddress} ILIKE ${pattern}`,
        sql`${trips.dropoffAddress} ILIKE ${pattern}`,
      )!);
    }

    // Cursor-based pagination: ?cursor=<id>&limit=50
    const cursor = req.query.cursor ? parseInt(req.query.cursor as string) : undefined;
    if (cursor && !isNaN(cursor)) {
      conditions.push(sql`${trips.id} < ${cursor}`);
    }

    let query = db.select().from(trips).where(and(...conditions)).orderBy(desc(trips.createdAt)).limit(limitParam + 1);
    const result = await query;

    const hasMore = result.length > limitParam;
    const rows = hasMore ? result.slice(0, limitParam) : result;
    const nextCursor = hasMore && rows.length > 0 ? (rows[rows.length - 1] as any).id : null;

    // Field selection: ?fields=id,status,scheduledAt,patientName
    const fieldsParam = req.query.fields as string | undefined;
    let data: any[] = rows;
    if (fieldsParam) {
      const allowedFields = new Set(fieldsParam.split(",").map((f: string) => f.trim()));
      data = rows.map((row: any) => {
        const filtered: Record<string, any> = {};
        for (const key of Object.keys(row)) {
          if (allowedFields.has(key)) filtered[key] = row[key];
        }
        return filtered;
      });
    }

    res.json({
      data,
      nextCursor,
      hasMore,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export function buildProgressEvents(tripData: any): Array<{key: string; label: string; at: string; meta?: {reason?: string}}> {
  const CANONICAL_ORDER = [
    { key: "scheduled", label: "Scheduled Pickup", field: "pickupTime", isTimeOnly: true, dateField: "scheduledDate" },
    { key: "created", label: "Created", field: "createdAt" },
    { key: "approved", label: "Approved", field: "approvedAt" },
    { key: "assigned", label: "Assigned to Driver", field: "assignedAt" },
    { key: "accepted", label: "Driver Accepted", field: "acceptedAt" },
    { key: "en_route_pickup", label: "En Route to Pickup", field: "startedAt" },
    { key: "arrived_pickup", label: "Arrived at Pickup", field: "arrivedPickupAt" },
    { key: "picked_up", label: "Picked Up", field: "pickedUpAt" },
    { key: "en_route_dropoff", label: "En Route to Dropoff", field: "enRouteDropoffAt" },
    { key: "arrived_dropoff", label: "Arrived at Dropoff", field: "arrivedDropoffAt" },
    { key: "completed", label: "Completed", field: "completedAt" },
    { key: "cancelled", label: "Cancelled", field: "cancelledAt", reasonField: "cancelledReason" },
    { key: "no_show", label: "No-Show", field: "cancelledAt", reasonField: "cancelledReason" },
    { key: "company_error", label: "Company Error", field: "billingSetAt", reasonField: "billingReason" },
  ];

  const events: Array<{key: string; label: string; at: string; meta?: {reason?: string}}> = [];

  for (const step of CANONICAL_ORDER) {
    if (step.key === "no_show" && tripData.status !== "NO_SHOW") continue;
    if (step.key === "cancelled" && tripData.status !== "CANCELLED") continue;
    if (step.key === "completed" && (tripData.status === "CANCELLED" || tripData.status === "NO_SHOW")) continue;
    if (step.key === "company_error") {
      if (tripData.billingOutcome !== "company_error" || !tripData.billingSetAt) continue;
    }

    const val = tripData[step.field];
    if (!val) continue;

    let atStr: string;
    if (step.isTimeOnly) {
      atStr = typeof val === "string" ? val : String(val);
    } else {
      atStr = val instanceof Date ? val.toISOString() : String(val);
    }

    const event: any = { key: step.key, label: step.label, at: atStr };
    if (step.reasonField && tripData[step.reasonField]) {
      event.meta = { reason: tripData[step.reasonField] };
    }
    events.push(event);
  }

  return events;
}

export async function getTripByIdHandler(req: AuthRequest, res: Response) {
  try {
    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });

    const [trip] = await db.select().from(trips).where(and(eq(trips.id, tripId), isNull(trips.deletedAt)));
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const scope = await getScope(req);
    if (!scope) return res.status(401).json({ message: "Unauthorized" });

    if (scope.companyId && trip.companyId !== scope.companyId) {
      return res.status(404).json({ message: "Trip not found" });
    }

    if (scope.cityId && scope.allowedCityIds.length > 0 && !scope.allowedCityIds.includes(trip.cityId)) {
      return res.status(404).json({ message: "Trip not found" });
    }

    if (scope.clinicId && trip.clinicId !== scope.clinicId) {
      return res.status(404).json({ message: "Trip not found" });
    }

    const [enriched] = await enrichTripsWithRelations([trip]);
    const progressEvents = buildProgressEvents(enriched);
    res.json({ ...enriched, progressEvents });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export const createTripSchema = insertTripSchema.omit({ publicId: true }).refine(
  (d) => !!d.pickupZip,
  { message: "Pickup ZIP code is required", path: ["pickupZip"] }
).refine(
  (d) => !!d.dropoffZip,
  { message: "Dropoff ZIP code is required", path: ["dropoffZip"] }
).refine(
  (d) => d.tripType !== "recurring" || (Array.isArray(d.recurringDays) && d.recurringDays.length > 0),
  { message: "Recurring trips must have at least one day selected", path: ["recurringDays"] }
);

export async function createTripHandler(req: AuthRequest, res: Response) {
  try {
    const scope = await getScope(req);
    if (!scope) return res.status(401).json({ message: "Unauthorized" });
    forceCompanyOnCreate(scope, req.body);

    if (!req.body.companyId && scope.isSuperAdmin) {
      if (req.body.clinicId) {
        const clinic = await storage.getClinic(req.body.clinicId);
        if (clinic) req.body.companyId = clinic.companyId;
      }
      if (!req.body.companyId && req.body.patientId) {
        const patient = await storage.getPatient(req.body.patientId);
        if (patient) req.body.companyId = patient.companyId;
      }
    }

    const parsed = createTripSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const fieldPath = firstIssue?.path?.join(".") || "unknown";
      const msg = firstIssue?.message || "Invalid trip data";
      console.warn(`[TRIP-CREATE] Validation failed: field=${fieldPath}, message=${msg}`, JSON.stringify(parsed.error.issues.slice(0, 5)));
      return res.status(400).json({ message: `${msg} (field: ${fieldPath})` });
    }
    if (parsed.data.pickupAddress && !parsed.data.pickupZip) {
      return res.status(400).json({ message: "Pickup ZIP code is required" });
    }
    if (parsed.data.pickupLat == null || parsed.data.pickupLng == null) {
      if (parsed.data.pickupAddress) {
        try {
          const { geocodeAddress } = await import("../lib/googleMaps");
          const geo = await geocodeAddress(parsed.data.pickupAddress);
          (parsed.data as any).pickupLat = geo.lat;
          (parsed.data as any).pickupLng = geo.lng;
        } catch (geoErr: any) {
          return res.status(400).json({ message: `Could not geocode pickup address: ${geoErr.message}` });
        }
      } else {
        return res.status(400).json({ message: "Pickup address must be selected from autocomplete (lat/lng required)" });
      }
    }
    if (parsed.data.dropoffAddress && !parsed.data.dropoffZip) {
      return res.status(400).json({ message: "Dropoff ZIP code is required" });
    }
    if (parsed.data.dropoffLat == null || parsed.data.dropoffLng == null) {
      if (parsed.data.dropoffAddress) {
        try {
          const { geocodeAddress } = await import("../lib/googleMaps");
          const geo = await geocodeAddress(parsed.data.dropoffAddress);
          (parsed.data as any).dropoffLat = geo.lat;
          (parsed.data as any).dropoffLng = geo.lng;
        } catch (geoErr: any) {
          return res.status(400).json({ message: `Could not geocode dropoff address: ${geoErr.message}` });
        }
      } else {
        return res.status(400).json({ message: "Dropoff address must be selected from autocomplete (lat/lng required)" });
      }
    }
    if (!parsed.data.estimatedArrivalTime || parsed.data.estimatedArrivalTime === "TBD") {
      if (parsed.data.pickupLat != null && parsed.data.pickupLng != null &&
          parsed.data.dropoffLat != null && parsed.data.dropoffLng != null &&
          parsed.data.pickupTime) {
        try {
          const { etaMinutes: getEtaMinutes } = await import("../lib/googleMaps");
          const eta = await getEtaMinutes(
            { lat: Number(parsed.data.pickupLat), lng: Number(parsed.data.pickupLng) },
            { lat: Number(parsed.data.dropoffLat), lng: Number(parsed.data.dropoffLng) }
          );
          const bufferMinutes = 5;
          const totalMinutes = eta.minutes + bufferMinutes;
          const [h, m] = parsed.data.pickupTime.split(":").map(Number);
          const arrivalDate = new Date(2000, 0, 1, h, m + totalMinutes);
          const arrH = String(arrivalDate.getHours()).padStart(2, "0");
          const arrM = String(arrivalDate.getMinutes()).padStart(2, "0");
          (parsed.data as any).estimatedArrivalTime = `${arrH}:${arrM}`;
          (parsed.data as any).lastEtaMinutes = eta.minutes;
          (parsed.data as any).distanceMiles = String(eta.distanceMiles);
        } catch (etaErr: any) {
          console.warn(`[TRIP-CREATE] ETA auto-calc failed: ${etaErr.message}`);
          const [h, m] = parsed.data.pickupTime.split(":").map(Number);
          const fallback = new Date(2000, 0, 1, h, m + 30);
          const fH = String(fallback.getHours()).padStart(2, "0");
          const fM = String(fallback.getMinutes()).padStart(2, "0");
          (parsed.data as any).estimatedArrivalTime = `${fH}:${fM}`;
        }
      } else if (parsed.data.pickupTime) {
        const [h, m] = parsed.data.pickupTime.split(":").map(Number);
        const fallback = new Date(2000, 0, 1, h, m + 30);
        const fH = String(fallback.getHours()).padStart(2, "0");
        const fM = String(fallback.getMinutes()).padStart(2, "0");
        (parsed.data as any).estimatedArrivalTime = `${fH}:${fM}`;
      }
    }

    if (parsed.data.pickupTime && parsed.data.estimatedArrivalTime && parsed.data.estimatedArrivalTime !== "TBD" && parsed.data.pickupTime >= parsed.data.estimatedArrivalTime) {
      return res.status(400).json({ message: "Pickup time must be before estimated arrival time" });
    }
    if (!(await checkCityAccess(req, parsed.data.cityId))) {
      return res.status(403).json({ message: "No access to this city" });
    }

    const city = await storage.getCity(parsed.data.cityId);
    if (city) {
      const tz = city.timezone || "America/New_York";
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      const y = parts.find(p => p.type === "year")?.value;
      const m = parts.find(p => p.type === "month")?.value;
      const d = parts.find(p => p.type === "day")?.value;
      const todayStr = `${y}-${m}-${d}`;
      if (parsed.data.scheduledDate < todayStr) {
        return res.status(400).json({ message: "Trip date cannot be in the past" });
      }
    }

    const autoScheduledTime = (!parsed.data.scheduledTime && parsed.data.pickupTime) ? parsed.data.pickupTime : undefined;

    const publicId = await generatePublicId();
    const user = await storage.getUser(req.user!.userId);
    const isClinic = (user?.role === "VIEWER" || user?.role === "CLINIC_USER") && user.clinicId != null;

    if (isClinic && parsed.data.patientId) {
      const patient = await storage.getPatient(parsed.data.patientId);
      if (!patient || patient.clinicId !== user!.clinicId) {
        return res.status(403).json({ message: "You can only create trips for your clinic's patients" });
      }
    }

    const approvalFields: Record<string, any> = {};
    if (isClinic) {
      approvalFields.approvalStatus = "pending";
      if (!parsed.data.clinicId) {
        (parsed.data as any).clinicId = user!.clinicId;
      }
    } else {
      approvalFields.approvalStatus = "approved";
      approvalFields.approvedAt = new Date();
      approvalFields.approvedBy = req.user!.userId;
    }
    const callerCompanyId = getCompanyIdFromAuth(req);
    if (callerCompanyId) {
      const quota = await checkActiveTripQuota(callerCompanyId);
      if (!quota.allowed) {
        return res.status(429).json({
          message: "Active trip quota exceeded",
          code: "QUOTA_EXCEEDED",
          current: quota.current,
          max: quota.max,
        });
      }
    }
    const autoRequestSource = isClinic ? "clinic" : "internal";

    const isPrivatePay = !parsed.data.clinicId;
    if (isPrivatePay) {
      const { getDefaultPrivateClinicId } = await import("../lib/defaultClinic");
      (parsed.data as any).clinicId = await getDefaultPrivateClinicId(parsed.data.cityId);
      if (!(parsed.data as any).requestSource) {
        (parsed.data as any).requestSource = "phone";
      }
    }

    let pricingFields: Record<string, any> = {};
    const effectiveScheduledTime = parsed.data.scheduledTime || autoScheduledTime;
    if (isPrivatePay && parsed.data.pickupAddress && parsed.data.dropoffAddress && effectiveScheduledTime) {
      try {
        const { calculatePrivateQuote } = await import("../lib/privatePricing");
        const city = await storage.getCity(parsed.data.cityId);
        const quote = await calculatePrivateQuote({
          pickupAddress: parsed.data.pickupAddress,
          dropoffAddress: parsed.data.dropoffAddress,
          scheduledDate: parsed.data.scheduledDate || new Date().toISOString().slice(0, 10),
          scheduledTime: effectiveScheduledTime!,
          isWheelchair: (parsed.data as any).serviceType === "wheelchair",
          roundTrip: (parsed.data as any).roundTrip === true,
          cityName: city?.name || "ALL",
          clinicId: (parsed.data as any).clinicId || null,
        });
        pricingFields.priceTotalCents = quote.totalCents;
        pricingFields.pricingSnapshot = {
          computedAt: new Date().toISOString(),
          baseMiles: quote.baseMiles,
          baseMinutes: quote.baseMinutes,
          totalCents: quote.totalCents,
          preDiscountTotalCents: quote.preDiscountTotalCents,
          breakdown: quote.breakdown,
          ratesUsed: quote.ratesUsed,
          profileName: quote.profileName,
          profileSource: quote.profileSource,
          platformTariffsEnabled: quote.platformTariffsEnabled,
          discountPercent: quote.discountPercent,
          discountSource: quote.discountSource,
          discountAmountCents: quote.discountAmountCents,
        };
      } catch (err: any) {
        console.warn(`[Pricing] Failed to compute quote for new trip, continuing without:`, err.message);
      }
    }

    let effectiveCompanyId = callerCompanyId;
    if (!effectiveCompanyId && parsed.data.patientId) {
      const patientForCompany = await storage.getPatient(parsed.data.patientId);
      if (patientForCompany?.companyId) effectiveCompanyId = patientForCompany.companyId;
    }
    const tripCity = city || await storage.getCity(parsed.data.cityId);
    const tripTimezone = tripCity?.timezone || "America/Chicago";

    const trip = await storage.createTrip({ ...parsed.data, publicId, ...approvalFields, ...pricingFields, companyId: effectiveCompanyId, requestSource: (parsed.data as any).requestSource || autoRequestSource, tripTimezone, ...(autoScheduledTime ? { scheduledTime: autoScheduledTime } : {}) } as any);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CREATE",
      entity: "trip",
      entityId: trip.id,
      details: `Created trip ${publicId}${isClinic ? " (pending approval)" : ""}`,
      cityId: trip.cityId,
    });

    import("../lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
      autoNotifyPatient(trip.id, "scheduled");
    }).catch((err) => {
      console.error(`[SMS-AUTO] Failed to send scheduled SMS for trip ${trip.id}:`, err.message);
    });

    import("../lib/tripRouteService").then(({ ensureTripRouteNonBlocking }) => {
      ensureTripRouteNonBlocking(trip.id);
    }).catch(() => {});

    import("../lib/eventBus").then(({ emitEvent }) => {
      emitEvent("trip.created", {
        tripId: trip.id,
        cityId: trip.cityId,
        companyId: trip.companyId,
        clinicId: trip.clinicId,
        scheduledDate: trip.scheduledDate,
        scheduledTime: trip.scheduledTime,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        dropoffLat: trip.dropoffLat,
        dropoffLng: trip.dropoffLng,
        pickupPlaceId: trip.pickupPlaceId,
        dropoffPlaceId: trip.dropoffPlaceId,
      }, `trip.created:${trip.id}`);
    }).catch(() => {});

    if (!trip.driverId && trip.approvalStatus === "approved") {
      import("../lib/autoAssignV2Engine").then(({ assignTripAutomatically }) => {
        assignTripAutomatically(trip.id, "trip_created", req.user?.userId).catch(() => {});
      }).catch(() => {});
    }

    res.json(trip);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export const updateTripSchema = z.object({
  pickupAddress: z.string().optional(),
  pickupStreet: z.string().optional(),
  pickupCity: z.string().optional(),
  pickupState: z.string().optional(),
  pickupZip: z.string().optional(),
  pickupPlaceId: z.string().nullable().optional(),
  pickupLat: z.number().optional(),
  pickupLng: z.number().optional(),
  dropoffAddress: z.string().optional(),
  dropoffStreet: z.string().optional(),
  dropoffCity: z.string().optional(),
  dropoffState: z.string().optional(),
  dropoffZip: z.string().optional(),
  dropoffPlaceId: z.string().nullable().optional(),
  dropoffLat: z.number().optional(),
  dropoffLng: z.number().optional(),
  scheduledDate: z.string().optional(),
  scheduledTime: z.string().nullable().optional(),
  pickupTime: z.string().optional(),
  estimatedArrivalTime: z.string().optional(),
  tripType: z.enum(["one_time", "recurring"]).optional(),
  recurringDays: z.array(z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])).nullable().optional(),
  driverId: z.number().nullable().optional(),
  vehicleId: z.number().nullable().optional(),
  clinicId: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function updateTripHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });

    const scope = await getScope(req);
    if (!scope) return res.status(401).json({ message: "Unauthorized" });

    const parsed = updateTripSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return res.status(400).json({ message: firstIssue?.message || "Invalid trip data" });
    }

    const existing = await storage.getTrip(id);
    if (!existing) return res.status(404).json({ message: "Trip not found" });

    if (scope.companyId && existing.companyId !== scope.companyId) {
      return res.status(403).json({ message: "Trip does not belong to your company" });
    }

    if (tripLockedGuard(existing, req, res)) return;
    const otherTerminalEdit = ["CANCELLED", "NO_SHOW"];
    if (otherTerminalEdit.includes(existing.status)) {
      return res.status(400).json({ message: `Trip is ${existing.status.toLowerCase()} and locked. No changes allowed.` });
    }

    if (!(await checkCityAccess(req, existing.cityId))) {
      return res.status(403).json({ message: "No access to this city" });
    }

    const editUser = await storage.getUser(req.user!.userId);
    const isClinicEditor = (editUser?.role === "VIEWER" || editUser?.role === "CLINIC_USER") && editUser.clinicId != null;
    if (isClinicEditor) {
      if (existing.clinicId !== editUser.clinicId) {
        return res.status(403).json({ message: "You can only edit your own clinic's trips" });
      }
      const coreFields = ["pickupAddress", "pickupStreet", "pickupCity", "pickupState", "pickupZip", "pickupPlaceId", "pickupLat", "pickupLng",
        "dropoffAddress", "dropoffStreet", "dropoffCity", "dropoffState", "dropoffZip", "dropoffPlaceId", "dropoffLat", "dropoffLng",
        "scheduledDate", "scheduledTime", "pickupTime", "estimatedArrivalTime", "driverId", "vehicleId", "clinicId", "tripType", "recurringDays"];
      if (existing.approvalStatus !== "pending") {
        const hasCoreChange = Object.keys(req.body).some(k => coreFields.includes(k));
        if (hasCoreChange) {
          return res.status(403).json({ message: "Cannot edit core trip fields after approval. Contact dispatch for changes." });
        }
      }
    }

    const updateData: Record<string, any> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        updateData[key] = value;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const effectiveTripType = updateData.tripType ?? existing.tripType;
    if (effectiveTripType === "recurring") {
      const effectiveDays = updateData.recurringDays ?? existing.recurringDays;
      if (!Array.isArray(effectiveDays) || effectiveDays.length === 0) {
        return res.status(400).json({ message: "Recurring trips must have at least one day selected" });
      }
    }
    if (updateData.tripType === "one_time") {
      updateData.recurringDays = null;
    }

    if (updateData.pickupAddress) {
      const effectiveZip = updateData.pickupZip ?? existing.pickupZip;
      if (!effectiveZip) {
        return res.status(400).json({ message: "Pickup ZIP code is required" });
      }
      let effectiveLat = updateData.pickupLat ?? existing.pickupLat;
      let effectiveLng = updateData.pickupLng ?? existing.pickupLng;
      if (effectiveLat == null || effectiveLng == null) {
        try {
          const { geocodeAddress } = await import("../lib/googleMaps");
          const geo = await geocodeAddress(updateData.pickupAddress);
          updateData.pickupLat = geo.lat;
          updateData.pickupLng = geo.lng;
        } catch (geoErr: any) {
          return res.status(400).json({ message: `Could not geocode pickup address: ${geoErr.message}` });
        }
      }
    }
    if (updateData.dropoffAddress) {
      const effectiveZip = updateData.dropoffZip ?? existing.dropoffZip;
      if (!effectiveZip) {
        return res.status(400).json({ message: "Dropoff ZIP code is required" });
      }
      let effectiveLat = updateData.dropoffLat ?? existing.dropoffLat;
      let effectiveLng = updateData.dropoffLng ?? existing.dropoffLng;
      if (effectiveLat == null || effectiveLng == null) {
        try {
          const { geocodeAddress } = await import("../lib/googleMaps");
          const geo = await geocodeAddress(updateData.dropoffAddress);
          updateData.dropoffLat = geo.lat;
          updateData.dropoffLng = geo.lng;
        } catch (geoErr: any) {
          return res.status(400).json({ message: `Could not geocode dropoff address: ${geoErr.message}` });
        }
      }
    }

    const effectivePickup = updateData.pickupTime ?? existing.pickupTime;
    const effectiveArrival = updateData.estimatedArrivalTime ?? existing.estimatedArrivalTime;
    if (effectivePickup && effectiveArrival && effectiveArrival !== "TBD" && effectivePickup >= effectiveArrival) {
      return res.status(400).json({ message: "Pickup time must be before estimated arrival time" });
    }

    const addressChanged = updateData.pickupAddress || updateData.dropoffAddress
      || updateData.pickupLat != null || updateData.pickupLng != null
      || updateData.dropoffLat != null || updateData.dropoffLng != null
      || updateData.pickupPlaceId !== undefined || updateData.dropoffPlaceId !== undefined;
    if (addressChanged) {
      updateData.staticMapThumbUrl = null;
      updateData.staticMapFullUrl = null;
      updateData.staticMapGeneratedAt = null;
    }

    if (addressChanged) {
      updateData.routePolyline = null;
      updateData.routeFingerprint = null;
      updateData.routeDistanceMeters = null;
      updateData.routeDurationSeconds = null;
    }

    const trip = await storage.updateTrip(id, updateData);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "UPDATE",
      entity: "trip",
      entityId: id,
      details: `Updated trip fields: ${Object.keys(updateData).join(", ")}`,
      cityId: existing.cityId,
    });

    if (addressChanged) {
      import("../lib/tripRouteService").then(({ ensureTripRouteNonBlocking }) => {
        ensureTripRouteNonBlocking(id);
      }).catch(() => {});
    }

    res.json(trip);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export const updateStatusSchema = z.object({
  status: z.enum(["SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]),
});


export async function updateTripStatusHandler(req: AuthRequest, res: Response) {
  try {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const id = parseInt(String(req.params.id));

    const idempotencyKey = req.body.idempotencyKey;
    if (idempotencyKey) {
      const { cache } = await import("../lib/cache");
      const idemKey = `idem:status:${idempotencyKey}`;
      const claimed = cache.setIfNotExists(idemKey, true, 600_000);
      if (!claimed) {
        return res.json({ message: "Already applied", idempotent: true });
      }
    }

    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    if (tripLockedGuard(trip, req, res)) return;

    if (req.user!.role === "DRIVER") {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId || trip.driverId !== user.driverId) {
        if (idempotencyKey) {
          const { cache } = await import("../lib/cache");
          cache.delete(`idem:status:${idempotencyKey}`);
        }
        return res.status(403).json({ message: "You can only update status for your assigned trips" });
      }
    }

    if (trip.status === parsed.data.status) {
      return res.json({ message: "Already in this status", idempotent: true });
    }

    const allowedNext = VALID_TRANSITIONS[trip.status] || [];
    if (!allowedNext.includes(parsed.data.status)) {
      return res.status(409).json({
        message: `Invalid transition from ${trip.status} to ${parsed.data.status}`,
        code: "INVALID_TRANSITION",
        currentStatus: trip.status,
        requestedStatus: parsed.data.status,
        allowedStatuses: allowedNext,
      });
    }

    if (parsed.data.status === "COMPLETED" && !trip.pickedUpAt) {
      return res.status(400).json({ message: "Cannot complete trip: no pickup timestamp recorded. Trip must be picked up first." });
    }

    const { manualOverride } = req.body;
    const MANUAL_FALLBACK_RADIUS = 300;

    if (req.user!.role === "DRIVER" && process.env.GEOFENCE_ENABLED === "true") {
      const geofenceStatuses = ["ARRIVED_PICKUP", "ARRIVED_DROPOFF"];
      if (geofenceStatuses.includes(parsed.data.status) && trip.driverId) {
        const { getDriverLocationFromCache } = await import("../lib/driverLocationIngest");
        const driverLoc = getDriverLocationFromCache(trip.driverId);

        if (driverLoc) {
          const PICKUP_RADIUS = parseInt(process.env.GEOFENCE_PICKUP_RADIUS_METERS || "120");
          const DROPOFF_RADIUS = parseInt(process.env.GEOFENCE_DROPOFF_RADIUS_METERS || "160");

          const haversine = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
            const R = 6371000;
            const dLat = ((lat2 - lat1) * Math.PI) / 180;
            const dLng = ((lng2 - lng1) * Math.PI) / 180;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          };

          if (parsed.data.status === "ARRIVED_PICKUP" && trip.pickupLat && trip.pickupLng) {
            const dist = haversine(driverLoc.lat, driverLoc.lng, trip.pickupLat, trip.pickupLng);
            const effectiveRadius = manualOverride ? MANUAL_FALLBACK_RADIUS : PICKUP_RADIUS;
            console.info(JSON.stringify({ event: "geofence_check", tripId: id, type: "ARRIVED_PICKUP", dist: Math.round(dist), radius: effectiveRadius, manual: !!manualOverride }));
            if (dist > effectiveRadius) {
              return res.status(400).json({
                ok: false,
                code: "GEOFENCE_REQUIRED",
                message: `Must be within ${effectiveRadius}m of pickup. Current: ${Math.round(dist)}m.`,
                distanceMeters: Math.round(dist),
                radiusMeters: effectiveRadius,
              });
            }
            if (manualOverride) {
              storage.createAuditLog({
                userId: req.user!.userId,
                action: "MANUAL_ARRIVAL_OVERRIDE",
                entity: "trip",
                entityId: id,
                details: JSON.stringify({ status: parsed.data.status, distanceMeters: Math.round(dist), normalRadius: PICKUP_RADIUS, fallbackRadius: MANUAL_FALLBACK_RADIUS }),
                cityId: trip.cityId,
              }).catch(() => {});
            }
          }
          if (parsed.data.status === "ARRIVED_DROPOFF" && trip.dropoffLat && trip.dropoffLng) {
            const dist = haversine(driverLoc.lat, driverLoc.lng, trip.dropoffLat, trip.dropoffLng);
            const effectiveRadius = manualOverride ? MANUAL_FALLBACK_RADIUS : DROPOFF_RADIUS;
            console.info(JSON.stringify({ event: "geofence_check", tripId: id, type: "ARRIVED_DROPOFF", dist: Math.round(dist), radius: effectiveRadius, manual: !!manualOverride }));
            if (dist > effectiveRadius) {
              return res.status(400).json({
                ok: false,
                code: "GEOFENCE_REQUIRED",
                message: `Must be within ${effectiveRadius}m of dropoff. Current: ${Math.round(dist)}m.`,
                distanceMeters: Math.round(dist),
                radiusMeters: effectiveRadius,
              });
            }
            if (manualOverride) {
              storage.createAuditLog({
                userId: req.user!.userId,
                action: "MANUAL_ARRIVAL_OVERRIDE",
                entity: "trip",
                entityId: id,
                details: JSON.stringify({ status: parsed.data.status, distanceMeters: Math.round(dist), normalRadius: DROPOFF_RADIUS, fallbackRadius: MANUAL_FALLBACK_RADIUS }),
                cityId: trip.cityId,
              }).catch(() => {});
            }
          }
        }
      }
    }

    const timestampField = STATUS_TIMESTAMP_MAP[parsed.data.status];
    const updateData: any = { status: parsed.data.status };
    if (timestampField) {
      updateData[timestampField] = new Date();
    }

    if (parsed.data.status === "ARRIVED_PICKUP") {
      const { companySettings } = await import("@shared/schema");
      const [cs] = await db.select().from(companySettings).where(eq(companySettings.companyId, trip.companyId));
      const waitCfg = (cs?.driverV3 as any)?.waiting;
      const waitMinutes = waitCfg?.minutes ?? 10;
      updateData.waitingStartedAt = new Date();
      updateData.waitingMinutes = waitMinutes;
      updateData.waitingEndedAt = null;
      updateData.waitingReason = null;
      updateData.waitingOverride = false;
      updateData.waitingExtendCount = 0;
      console.info(JSON.stringify({ event: "waiting_timer_started", tripId: id, waitMinutes }));
    }

    const updated = await db.update(trips).set(updateData).where(and(eq(trips.id, id), eq(trips.status, trip.status))).returning();
    if (!updated.length) {
      return res.status(409).json({ message: "Concurrent status update detected, please retry", code: "CONCURRENT_UPDATE" });
    }
    const updatedTrip = updated[0];

    if (updatedTrip.driverId) {
      const inMotionStatuses = ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "IN_PROGRESS", "ARRIVED_DROPOFF"];
      const terminalStatuses = ["COMPLETED", "CANCELLED", "NO_SHOW"];
      if (inMotionStatuses.includes(parsed.data.status)) {
        db.update(drivers).set({ dispatchStatus: "enroute" }).where(eq(drivers.id, updatedTrip.driverId)).catch((err: any) => {
          console.error(`[DISPATCH] Failed to set driver ${updatedTrip.driverId} to enroute:`, err.message);
        });
      } else if (terminalStatuses.includes(parsed.data.status)) {
        db.update(drivers).set({ dispatchStatus: "available" }).where(eq(drivers.id, updatedTrip.driverId)).catch((err: any) => {
          console.error(`[DISPATCH] Failed to set driver ${updatedTrip.driverId} to available:`, err.message);
        });
      }
    }

    import("../lib/realtime").then(({ broadcastToTrip }) => {
      broadcastToTrip(id, { type: "status_change", data: { status: parsed.data.status, tripId: id } });
    }).catch(() => {});

    import("../lib/supabaseRealtime").then(({ broadcastTripSupabase }) => {
      broadcastTripSupabase(id, { type: "status_change", data: { status: parsed.data.status, tripId: id } });
    }).catch(() => {});

    const STATUS_PERSIST_TRIGGERS = ["ARRIVED_PICKUP", "PICKED_UP", "ARRIVED_DROPOFF", "EN_ROUTE_TO_DROPOFF"];
    if (updatedTrip.driverId && STATUS_PERSIST_TRIGGERS.includes(parsed.data.status)) {
      import("../lib/driverLocationIngest").then(({ persistOnStatusEvent, getDriverLocationFromCache }) => {
        const loc = getDriverLocationFromCache(updatedTrip.driverId!);
        if (loc) {
          persistOnStatusEvent(updatedTrip.driverId!, loc.lat, loc.lng);
        }
      }).catch(() => {});
    }

    const smsBaseUrl = process.env.PUBLIC_BASE_URL_APP
      || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://app.unitedcaremobility.com");

    if (parsed.data.status === "EN_ROUTE_TO_PICKUP") {
      import("../lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
        autoNotifyPatient(id, "en_route", { base_url: smsBaseUrl });
      }).catch(() => {});
    }

    if (parsed.data.status === "ARRIVED_PICKUP") {
      import("../lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
        autoNotifyPatient(id, "arrived");
      }).catch(() => {});
    }

    if (parsed.data.status === "PICKED_UP") {
      import("../lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
        autoNotifyPatient(id, "picked_up");
      }).catch(() => {});
    }

    if (parsed.data.status === "CANCELLED") {
      import("../lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
        autoNotifyPatient(id, "canceled");
      }).catch(() => {});
    }

    if (parsed.data.status === "COMPLETED") {
      import("../lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
        autoNotifyPatient(id, "completed");
      }).catch(() => {});

      // Send patient rating request SMS after trip completion
      import("../lib/patientRatingEngine").then(({ autoSendRatingRequest }) => {
        autoSendRatingRequest(id);
      }).catch((err) => {
        console.error(`[RATING] Failed to send rating request for trip ${id}:`, err.message);
      });
    }

    const terminalStatuses = ["COMPLETED", "CANCELLED", "NO_SHOW"];
    if (terminalStatuses.includes(parsed.data.status)) {
      storage.revokeTokensForTrip(id).catch((err: any) => {
        console.error(`[TRACKING] Failed to revoke tokens for trip ${id}:`, err.message);
      });

      if (!updatedTrip.billingOutcome) {
        import("../lib/clinicBillingRoutes").then(({ autoBillingClassify }) => {
          autoBillingClassify(updatedTrip).catch((err: any) => {
            console.error(`[BILLING] Auto-classify failed for trip ${id}:`, err.message);
          });
        }).catch(() => {});
      }

      if (parsed.data.status === "COMPLETED" && updatedTrip.clinicId) {
        import("../lib/clinicBillingRoutes").then(({ computeTripBilling }) => {
          computeTripBilling(id).catch((err: any) => {
            console.error(`[TARIFF-BILLING] Auto-compute failed for trip ${id}:`, err.message);
          });
        }).catch(() => {});
      }
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "UPDATE_STATUS",
      entity: "trip",
      entityId: updatedTrip.id,
      details: JSON.stringify({
        oldStatus: trip.status,
        newStatus: parsed.data.status,
        role: req.user!.role,
        requestId: (req as any)._requestId || req.headers["x-request-id"] || null,
        driverId: trip.driverId,
        patientId: trip.patientId,
        clinicId: trip.clinicId,
      }),
      cityId: updatedTrip.cityId,
    });
    res.json(updatedTrip);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

const OVERRIDE_REASON_CODES = [
  "GPS_ISSUE",
  "PATIENT_CONFIRMED",
  "MANUAL_OVERRIDE",
  "SYSTEM_ERROR",
  "DRIVER_PHONE_ISSUE",
  "GEOFENCE_INACCURATE",
] as const;

const ALLOWED_OVERRIDE_STATUSES = [
  "SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP",
  "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF",
  "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW",
] as const;

const dispatchOverrideSchema = z.object({
  status: z.enum(ALLOWED_OVERRIDE_STATUSES),
  reasonCode: z.enum(OVERRIDE_REASON_CODES as any),
  notes: z.string().optional(),
});

export async function dispatchOverrideStatusHandler(req: AuthRequest, res: Response) {
  try {
    const parsed = dispatchOverrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: `Invalid override request: ${parsed.error.issues.map(i => i.message).join("; ")}` });
    }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });

    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    if (tripLockedGuard(trip, req, res)) return;

    if (!(await checkCityAccess(req, trip.cityId))) {
      return res.status(403).json({ message: "No access to this city" });
    }
    const callerCompanyId = getCompanyIdFromAuth(req);
    if (callerCompanyId && trip.companyId && trip.companyId !== callerCompanyId) {
      return res.status(403).json({ message: "Trip does not belong to your company" });
    }

    const terminalStatuses = ["COMPLETED", "CANCELLED", "NO_SHOW"];
    if (terminalStatuses.includes(trip.status)) {
      return res.status(400).json({ message: `Cannot override: trip is already in terminal status ${trip.status}` });
    }

    if (trip.status === parsed.data.status) {
      return res.json({ message: "Already in this status", idempotent: true });
    }

    const timestampField = STATUS_TIMESTAMP_MAP[parsed.data.status];
    const updateData: any = { status: parsed.data.status };
    if (timestampField) {
      updateData[timestampField] = new Date();
    }

    const conditions = [eq(trips.id, id)];
    if (callerCompanyId) conditions.push(eq(trips.companyId, callerCompanyId));

    const updated = await db.update(trips).set(updateData).where(and(...conditions)).returning();
    if (!updated.length) {
      return res.status(404).json({ message: "Trip not found or access denied" });
    }
    const updatedTrip = updated[0];

    import("../lib/realtime").then(({ broadcastToTrip }) => {
      broadcastToTrip(id, { type: "status_change", data: { status: parsed.data.status, tripId: id } });
    }).catch(() => {});

    import("../lib/supabaseRealtime").then(({ broadcastTripSupabase }) => {
      broadcastTripSupabase(id, { type: "status_change", data: { status: parsed.data.status, tripId: id } });
    }).catch(() => {});

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "DISPATCH_OVERRIDE",
      entity: "trip",
      entityId: updatedTrip.id,
      details: JSON.stringify({
        oldStatus: trip.status,
        newStatus: parsed.data.status,
        reasonCode: parsed.data.reasonCode,
        notes: parsed.data.notes || null,
        role: req.user!.role,
        overriddenBy: req.user!.userId,
        previousTimestamps: {
          startedAt: trip.startedAt,
          arrivedPickupAt: trip.arrivedPickupAt,
          pickedUpAt: trip.pickedUpAt,
          arrivedDropoffAt: trip.arrivedDropoffAt,
          completedAt: trip.completedAt,
        },
      }),
      cityId: updatedTrip.cityId,
    });
    res.json(updatedTrip);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function acceptTripHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });

    const idempotencyKey = req.body.idempotencyKey;
    if (idempotencyKey) {
      const { cache } = await import("../lib/cache");
      const idemKey = `idem:accept:${idempotencyKey}`;
      const claimed = cache.setIfNotExists(idemKey, true, 600_000);
      if (!claimed) {
        return res.json({ message: "Already applied", idempotent: true });
      }
    }

    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    if (tripLockedGuard(trip, req, res)) return;

    const companyId = getCompanyIdFromAuth(req);
    if (!checkCompanyOwnership(trip, companyId)) {
      return res.status(403).json({ message: "Access denied: trip belongs to a different company" });
    }

    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId || trip.driverId !== user.driverId) {
      return res.status(403).json({ message: "You can only accept your assigned trips" });
    }

    if (trip.status === "EN_ROUTE_TO_PICKUP") {
      return res.json({ message: "Already accepted", idempotent: true });
    }

    if (trip.status !== "ASSIGNED") {
      return res.status(400).json({ message: `Cannot accept trip in ${trip.status} status. Trip must be ASSIGNED.` });
    }

    const updateData: any = {
      status: "EN_ROUTE_TO_PICKUP",
      startedAt: new Date(),
    };

    const updated = await db.update(trips).set(updateData).where(
      and(eq(trips.id, id), eq(trips.status, "ASSIGNED"))
    ).returning();

    if (!updated.length) {
      return res.json({ message: "Trip status already changed", idempotent: true });
    }

    const updatedTrip = updated[0];

    import("../lib/realtime").then(({ broadcastToTrip }) => {
      broadcastToTrip(id, { type: "status_change", data: { status: "EN_ROUTE_TO_PICKUP", tripId: id } });
    }).catch(() => {});

    import("../lib/supabaseRealtime").then(({ broadcastTripSupabase }) => {
      broadcastTripSupabase(id, { type: "status_change", data: { status: "EN_ROUTE_TO_PICKUP", tripId: id } });
    }).catch(() => {});

    const baseUrl = process.env.PUBLIC_BASE_URL_APP
      || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://app.unitedcaremobility.com");

    import("../lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
      autoNotifyPatient(id, "en_route", { base_url: baseUrl });
    }).catch(() => {});

    if (updatedTrip.driverId) {
      import("../lib/driverLocationIngest").then(({ persistOnStatusEvent, getDriverLocationFromCache }) => {
        const loc = getDriverLocationFromCache(updatedTrip.driverId!);
        if (loc) {
          persistOnStatusEvent(updatedTrip.driverId!, loc.lat, loc.lng);
        }
      }).catch(() => {});
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "TRIP_ACCEPTED",
      entity: "trip",
      entityId: updatedTrip.id,
      details: JSON.stringify({
        oldStatus: "ASSIGNED",
        newStatus: "EN_ROUTE_TO_PICKUP",
        driverId: trip.driverId,
        patientId: trip.patientId,
        clinicId: trip.clinicId,
      }),
      cityId: updatedTrip.cityId,
    });

    res.json(updatedTrip);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function dialysisReturnCheckHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    if (req.user!.role === "CLINIC_USER") {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.clinicId || user.clinicId !== trip.clinicId) {
        return res.status(403).json({ message: "Access denied: trip belongs to a different clinic" });
      }
    }
    const dialysisCompanyId = getCompanyIdFromAuth(req);
    if (!checkCompanyOwnership(trip, dialysisCompanyId)) {
      return res.status(403).json({ message: "Access denied: trip belongs to a different company" });
    }

    if (trip.tripType !== "dialysis") {
      return res.json({ ok: true, applicable: false, reason: "Not a dialysis trip" });
    }
    if (trip.status !== "COMPLETED") {
      return res.json({ ok: true, applicable: false, reason: "Trip not completed" });
    }

    const clinic = trip.clinicId ? await storage.getClinic(trip.clinicId) : null;
    const isOutbound = clinic && clinic.lat && clinic.lng && trip.dropoffLat && trip.dropoffLng
      && (Math.abs(trip.dropoffLat - clinic.lat) + Math.abs(trip.dropoffLng - clinic.lng)) < 0.01;

    if (!isOutbound) {
      return res.json({ ok: true, applicable: false, reason: "Not an outbound trip to clinic" });
    }

    const sameDayDialysis = await db.select().from(trips).where(
      and(
        eq(trips.patientId, trip.patientId),
        eq(trips.scheduledDate, trip.scheduledDate),
        eq(trips.tripType, "dialysis"),
        isNull(trips.deletedAt),
        sql`${trips.id} != ${trip.id}`,
        sql`${trips.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW')`,
      )
    );

    const returnTrip = sameDayDialysis.find(t => {
      if (!clinic?.lat || !clinic?.lng || !t.pickupLat || !t.pickupLng) return false;
      return (Math.abs(t.pickupLat - clinic.lat) + Math.abs(t.pickupLng - clinic.lng)) < 0.01;
    });

    if (!returnTrip) {
      return res.json({ ok: true, applicable: false, reason: "No linked return trip found" });
    }

    const BUFFER_MINUTES = 30;
    const completedAt = trip.completedAt || trip.arrivedDropoffAt || new Date();
    const completedTime = new Date(completedAt);
    const proposedTime = new Date(completedTime.getTime() + BUFFER_MINUTES * 60000);
    const proposedPickupTime = `${String(proposedTime.getHours()).padStart(2, "0")}:${String(proposedTime.getMinutes()).padStart(2, "0")}`;

    const currentReturnPickupTime = returnTrip.pickupTime;
    const needsAdjustment = proposedPickupTime !== currentReturnPickupTime;

    res.json({
      ok: true,
      applicable: true,
      needsAdjustment,
      outboundTripId: trip.id,
      outboundPublicId: trip.publicId,
      returnTripId: returnTrip.id,
      returnPublicId: returnTrip.publicId,
      completedAtTime: completedTime.toISOString(),
      currentReturnPickupTime,
      proposedReturnPickupTime: proposedPickupTime,
      bufferMinutes: BUFFER_MINUTES,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function dialysisReturnAdjustHandler(req: AuthRequest, res: Response) {
  try {
    const outboundId = parseInt(String(req.params.id));
    if (isNaN(outboundId)) return res.status(400).json({ message: "Invalid trip ID" });

    const { action, returnTripId, proposedPickupTime } = req.body;
    if (!action || !returnTripId) {
      return res.status(400).json({ message: "action and returnTripId are required" });
    }
    if (!["confirm", "keep"].includes(action)) {
      return res.status(400).json({ message: "action must be 'confirm' or 'keep'" });
    }

    const outbound = await storage.getTrip(outboundId);
    if (!outbound) return res.status(404).json({ message: "Outbound trip not found" });

    if (req.user!.role === "CLINIC_USER") {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.clinicId || user.clinicId !== outbound.clinicId) {
        return res.status(403).json({ message: "Access denied: trip belongs to a different clinic" });
      }
    }
    const linkCompanyId = getCompanyIdFromAuth(req);
    if (!checkCompanyOwnership(outbound, linkCompanyId)) {
      return res.status(403).json({ message: "Access denied: trip belongs to a different company" });
    }

    const returnTrip = await storage.getTrip(returnTripId);
    if (!returnTrip) return res.status(404).json({ message: "Return trip not found" });

    if (returnTrip.patientId !== outbound.patientId || returnTrip.scheduledDate !== outbound.scheduledDate) {
      return res.status(400).json({ message: "Return trip does not match outbound trip" });
    }

    const terminalStatuses = ["COMPLETED", "CANCELLED", "NO_SHOW"];
    if (terminalStatuses.includes(returnTrip.status)) {
      return res.status(400).json({ message: "Return trip is already in a terminal status" });
    }

    if (action === "confirm") {
      if (!proposedPickupTime) {
        return res.status(400).json({ message: "proposedPickupTime is required for confirm action" });
      }

      const previousTime = returnTrip.pickupTime;
      await db.update(trips).set({
        pickupTime: proposedPickupTime,
        scheduledTime: proposedPickupTime,
        updatedAt: new Date(),
      }).where(eq(trips.id, returnTripId));

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "DIALYSIS_RETURN_ADJUST",
        entity: "trip",
        entityId: returnTripId,
        details: `Dialysis return trip pickup time adjusted from ${previousTime} to ${proposedPickupTime} (linked to outbound trip #${outbound.publicId})`,
        cityId: outbound.cityId,
      });

      return res.json({ ok: true, action: "confirmed", returnTripId, previousTime, newTime: proposedPickupTime });
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "DIALYSIS_RETURN_KEEP",
      entity: "trip",
      entityId: returnTripId,
      details: `Dialysis return trip pickup time kept at ${returnTrip.pickupTime} (linked to outbound trip #${outbound.publicId})`,
      cityId: outbound.cityId,
    });

    return res.json({ ok: true, action: "kept", returnTripId, currentTime: returnTrip.pickupTime });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function approveTripHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (trip.approvalStatus !== "pending") {
      return res.status(400).json({ message: `Trip is already ${trip.approvalStatus}` });
    }
    const updated = await storage.updateTrip(id, {
      approvalStatus: "approved",
      approvedAt: new Date(),
      approvedBy: req.user!.userId,
    } as any);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "APPROVE",
      entity: "trip",
      entityId: id,
      details: `Approved trip ${trip.publicId}`,
      cityId: trip.cityId,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export function computeCancelStage(trip: any): string {
  if (["PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"].includes(trip.status)) return "picked_up";
  if (trip.status === "ARRIVED_PICKUP") return "arrived_pickup";
  if (trip.status === "EN_ROUTE_TO_PICKUP") return "enroute_pickup";
  if (trip.driverId) return "assigned";
  return "pre_assign";
}

export const CANCEL_FEE_SCHEDULE: Record<string, number> = {
  pre_assign: 0,
  assigned: 25,
  enroute_pickup: 50,
  arrived_pickup: 75,
  picked_up: 0,
};

export function computeCancelFee(cancelStage: string): number {
  return CANCEL_FEE_SCHEDULE[cancelStage] ?? 0;
}

export async function cancelRequestHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (tripLockedGuard(trip, req, res)) return;
    const cancelReqTerminal = ["CANCELLED", "NO_SHOW", "COMPLETED"];
    if (cancelReqTerminal.includes(trip.status)) {
      return res.status(400).json({ message: `Trip is ${trip.status.toLowerCase()} and locked` });
    }
    const user = await storage.getUser(req.user!.userId);
    if (!user?.clinicId || trip.clinicId !== user.clinicId) {
      return res.status(403).json({ message: "You can only cancel your own clinic's trips" });
    }
    const cancelStage = computeCancelStage(trip);
    const cancelFee = computeCancelFee(cancelStage);
    if (trip.approvalStatus === "pending") {
      const updated = await storage.updateTrip(id, {
        approvalStatus: "cancelled",
        cancelledBy: req.user!.userId,
        cancelledReason: req.body.reason || "Cancelled by clinic",
        cancelType: "soft",
        cancelledAt: new Date(),
        status: "CANCELLED",
        faultParty: "clinic",
        cancelStage,
        billable: false,
        cancelFee: "0",
      } as any);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "CANCEL",
        entity: "trip",
        entityId: id,
        details: `Clinic cancelled pending trip ${trip.publicId} (stage: ${cancelStage})`,
        cityId: trip.cityId,
      });

      import("../lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
        autoNotifyPatient(id, "canceled");
      }).catch(() => {});

      if (updated && !updated.billingOutcome) {
        import("../lib/clinicBillingRoutes").then(({ autoBillingClassify }) => {
          autoBillingClassify(updated).catch(() => {});
        }).catch(() => {});
      }

      return res.json(updated);
    }
    if (trip.approvalStatus !== "approved") {
      return res.status(400).json({ message: `Cannot request cancellation: trip is ${trip.approvalStatus}` });
    }
    const updated = await storage.updateTrip(id, {
      approvalStatus: "cancel_requested",
      cancelledBy: req.user!.userId,
      cancelledReason: req.body.reason || "Cancellation requested by clinic",
      cancelledAt: new Date(),
      faultParty: "clinic",
      cancelStage,
      billable: true,
      cancelFee: String(cancelFee),
    } as any);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "clinic_cancel_request",
      entity: "trip",
      entityId: id,
      details: JSON.stringify({
        reason: req.body.reason || "No reason given",
        notes: req.body.notes || null,
        cancelStage,
        cancelFee,
        faultParty: "clinic",
        clinicId: user.clinicId,
      }),
      cityId: trip.cityId,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function rejectCancelHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    const companyId = getCompanyIdFromAuth(req);
    if (!checkCompanyOwnership(trip, companyId)) return res.status(403).json({ message: "Access denied" });
    if (trip.approvalStatus !== "cancel_requested") {
      return res.status(400).json({ message: `Trip is not in cancel_requested state (current: ${trip.approvalStatus})` });
    }
    const updated = await storage.updateTrip(id, {
      approvalStatus: "approved",
      cancelledBy: null,
      cancelledReason: null,
    } as any);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "REJECT_CANCEL_REQUEST",
      entity: "trip",
      entityId: id,
      details: `Rejected clinic cancellation request for trip ${trip.publicId}`,
      cityId: trip.cityId,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function cancelTripHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (tripLockedGuard(trip, req, res)) return;
    if (trip.status === "NO_SHOW") {
      return res.status(400).json({ message: "Trip is no_show and locked" });
    }
    if (trip.approvalStatus === "cancelled") {
      return res.status(400).json({ message: "Trip is already cancelled" });
    }
    const cancelType = req.body.type || "soft";
    if (!["soft", "hard"].includes(cancelType)) {
      return res.status(400).json({ message: "Cancel type must be 'soft' or 'hard'" });
    }
    const validFaultParties = ["clinic", "driver", "patient", "dispatch", "unknown"];
    const faultParty = req.body.faultParty && validFaultParties.includes(req.body.faultParty)
      ? req.body.faultParty
      : (trip as any).faultParty || "unknown";
    const isBillable = ["driver", "dispatch"].includes(faultParty) ? false : (req.body.billable !== undefined ? req.body.billable : true);
    const cancelStage = (trip as any).cancelStage || computeCancelStage(trip);
    let finalFee = 0;
    if (isBillable) {
      const baseFee = computeCancelFee(cancelStage);
      if (req.body.feeOverride !== undefined && req.body.feeOverride !== null) {
        finalFee = Number(req.body.feeOverride);
      } else {
        finalFee = baseFee;
      }
    }
    const updated = await storage.updateTrip(id, {
      approvalStatus: "cancelled",
      cancelledBy: req.user!.userId,
      cancelledReason: req.body.reason || "Cancelled by dispatch",
      cancelType: cancelType,
      cancelledAt: new Date(),
      status: "CANCELLED",
      faultParty,
      billable: isBillable,
      cancelStage,
      cancelFee: String(finalFee),
      cancelFeeOverride: req.body.feeOverride !== undefined && req.body.feeOverride !== null ? String(req.body.feeOverride) : null,
      cancelFeeOverrideNote: req.body.overrideNote || null,
    } as any);
    storage.revokeTokensForTrip(id).catch(() => {});

    if (updated && !updated.billingOutcome) {
      import("../lib/clinicBillingRoutes").then(({ autoBillingClassify }) => {
        autoBillingClassify(updated).catch(() => {});
      }).catch(() => {});
    }

    let invoiceId: number | null = null;
    if (isBillable && finalFee > 0) {
      try {
        let cancelClinicId = trip.clinicId;
        if (!cancelClinicId) {
          const { getDefaultPrivateClinicId } = await import("../lib/defaultClinic");
          cancelClinicId = await getDefaultPrivateClinicId(trip.cityId);
          await storage.updateTrip(id, { clinicId: cancelClinicId } as any);
        }
        const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;
        const invoice = await storage.createInvoice({
          clinicId: cancelClinicId,
          tripId: id,
          patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Unknown",
          serviceDate: trip.scheduledDate,
          amount: String(finalFee),
          status: "pending",
          notes: `Cancel fee (stage: ${cancelStage}, fault: ${faultParty})${req.body.overrideNote ? ` | Override: ${req.body.overrideNote}` : ""}`,
          reason: `Late cancellation - ${cancelStage}`,
          faultParty,
          relatedTripId: id,
        } as any);
        invoiceId = invoice.id;
        await storage.updateTrip(id, { invoiceId: invoice.id } as any);
        if (patient?.email && (patient.source === "private" || patient.source === "internal")) {
          try {
            await db.update(invoices).set({ emailTo: patient.email }).where(eq(invoices.id, invoice.id));
            const { sendInvoicePaymentEmail } = await import("../services/invoiceEmailService");
            sendInvoicePaymentEmail(invoice.id).catch((e: any) => console.error("[CANCEL] Invoice email error:", e.message));
          } catch {}
        }
      } catch (invErr: any) {
        console.error("[CANCEL] Invoice creation failed:", invErr.message);
      }
    }
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CANCEL_TRIP",
      entity: "trip",
      entityId: id,
      details: JSON.stringify({
        publicId: trip.publicId,
        cancelType,
        faultParty,
        billable: isBillable,
        cancelStage,
        fee: finalFee,
        feeOverride: req.body.feeOverride ?? null,
        overrideNote: req.body.overrideNote ?? null,
        invoiceId,
        reason: req.body.reason || "No reason given",
      }),
      cityId: trip.cityId,
      actorRole: req.user?.role,
      companyId: trip.companyId,
      beforeJson: { status: trip.status, approvalStatus: trip.approvalStatus },
      afterJson: { status: "CANCELLED", approvalStatus: "cancelled", cancelType, faultParty, cancelFee: finalFee },
    } as any);

    import("../lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
      autoNotifyPatient(id, "canceled");
    }).catch(() => {});

    import("../lib/tripTransitionHelper").then(({ broadcastCompanyTripUpdate }) => {
      broadcastCompanyTripUpdate(trip.companyId, {
        tripId: id,
        status: "CANCELLED",
        previousStatus: trip.status,
        driverId: trip.driverId,
        clinicId: trip.clinicId,
        cityId: trip.cityId,
        publicId: trip.publicId,
      });
    }).catch(() => {});

    if (trip.driverId) {
      import("../lib/realtime").then(({ broadcastToDriver }) => {
        broadcastToDriver(trip.driverId!, {
          type: "trip_cancelled",
          tripId: id,
          publicId: trip.publicId,
          ts: Date.now(),
        });
      }).catch(() => {});
    }

    res.json({ ...updated, invoiceId, cancelFee: finalFee, billable: isBillable });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function createReturnTripHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
    const parentTrip = await storage.getTrip(id);
    if (!parentTrip) return res.status(404).json({ message: "Trip not found" });
    const companyId = getCompanyIdFromAuth(req);
    if (!checkCompanyOwnership(parentTrip, companyId)) return res.status(403).json({ message: "Access denied" });
    const publicId = await generatePublicId();
    const returnTripTz = parentTrip.tripTimezone || "America/Chicago";
    const { nowInCity, cityNowDate, cityNowTime } = await import("@shared/timeUtils");
    const timeStr = cityNowTime(returnTripTz);
    const dateStr = cityNowDate(returnTripTz);
    const returnTrip = await storage.createTrip({
      publicId,
      cityId: parentTrip.cityId,
      patientId: parentTrip.patientId,
      clinicId: parentTrip.clinicId,
      companyId: parentTrip.companyId,
      pickupAddress: parentTrip.dropoffAddress,
      pickupStreet: parentTrip.dropoffStreet,
      pickupCity: parentTrip.dropoffCity,
      pickupState: parentTrip.dropoffState,
      pickupZip: parentTrip.dropoffZip,
      pickupPlaceId: parentTrip.dropoffPlaceId,
      pickupLat: parentTrip.dropoffLat,
      pickupLng: parentTrip.dropoffLng,
      dropoffAddress: parentTrip.pickupAddress,
      dropoffStreet: parentTrip.pickupStreet,
      dropoffCity: parentTrip.pickupCity,
      dropoffState: parentTrip.pickupState,
      dropoffZip: parentTrip.pickupZip,
      dropoffPlaceId: parentTrip.pickupPlaceId,
      dropoffLat: parentTrip.pickupLat,
      dropoffLng: parentTrip.pickupLng,
      scheduledDate: dateStr,
      scheduledTime: timeStr,
      pickupTime: timeStr,
      estimatedArrivalTime: timeStr,
      tripType: "one_time",
      status: "SCHEDULED",
      requestSource: "internal",
      tripTimezone: returnTripTz,
      notes: `Return trip for ${parentTrip.publicId}${req.body.notes ? ` - ${req.body.notes}` : ""}`,
    } as any);
    await storage.updateTrip(returnTrip.id, { parentTripId: id } as any);
    if (parentTrip.driverId) {
      await storage.updateTrip(returnTrip.id, {
        driverId: parentTrip.driverId,
        vehicleId: parentTrip.vehicleId,
        status: "ASSIGNED",
        assignedAt: new Date(),
        assignedBy: req.user!.userId,
        assignmentSource: "dispatch_return",
      } as any);
    }
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CREATE_RETURN_TRIP",
      entity: "trip",
      entityId: returnTrip.id,
      details: JSON.stringify({
        parentTripId: id,
        parentPublicId: parentTrip.publicId,
        returnPublicId: publicId,
        driverId: parentTrip.driverId,
      }),
      cityId: parentTrip.cityId,
    });
    const finalTrip = await storage.getTrip(returnTrip.id);
    res.json(finalTrip);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getTripRouteHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const { ensureTripRoute } = await import("../lib/tripRouteService");
    const result = await ensureTripRoute(id);

    let tripData = trip;
    let actualPolyline = (trip as any).actualPolyline || null;

    if (!actualPolyline && ["COMPLETED", "NO_SHOW"].includes(trip.status)) {
      try {
        const { finalizeTripRoute } = await import("../lib/tripFinalizationService");
        await finalizeTripRoute(id);
        const refreshed = await storage.getTrip(id);
        if (refreshed) tripData = refreshed;
        actualPolyline = (tripData as any).actualPolyline || null;
      } catch (err: any) {
        console.warn(`[TRIP-ROUTE] Actual polyline generation failed for trip ${id}: ${err.message}`);
      }
    }

    const distMiles = tripData.distanceMiles ? parseFloat(tripData.distanceMiles) : null;
    const durMin = tripData.durationMinutes ?? null;

    const response: any = {
      routePolyline: result?.routePolyline || null,
      distanceMeters: result?.routeDistanceMeters || null,
      durationSeconds: result?.routeDurationSeconds || null,
      routeVersion: result?.routeVersion || null,
      actualPolyline,
      actualDistanceMeters: tripData.actualDistanceMeters || null,
      actualDistanceSource: tripData.actualDistanceSource || null,
      actualDurationSeconds: (tripData as any).actualDurationSeconds ?? null,
      waitingSeconds: (tripData as any).waitingSeconds ?? null,
      routeSource: (tripData as any).routeSource || null,
      routeQualityScore: (tripData as any).routeQualityScore ?? null,
      status: tripData.status,
      timeline: (tripData as any).timeline || [],
      distanceMiles: distMiles,
      durationMinutes: durMin,
    };

    return res.json(response);
  } catch (err: any) {
    console.warn(`[TRIP-ROUTE] Error for trip ${req.params.id}: ${err.message}`);
    return res.json({
      routePolyline: null,
      distanceMeters: null,
      durationSeconds: null,
      error: err.message,
    });
  }
}

export async function getTripRouteHistoryHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const { getTripRouteHistory } = await import("../lib/tripRouteService");
    const routes = await getTripRouteHistory(id);
    return res.json({ routes });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
}

export async function recomputeRouteHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const TERMINAL = ["COMPLETED", "CANCELLED", "NO_SHOW"];
    if (TERMINAL.includes(trip.status)) return res.status(400).json({ message: "Trip is in terminal status" });

    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const isDriver = user.role === "DRIVER" && user.driverId && trip.driverId === user.driverId;
    const isDispatch = ["ADMIN", "DISPATCH", "SUPER_ADMIN"].includes(user.role);
    const isClinic = user.role === "CLINIC_USER" && user.clinicId && trip.clinicId === user.clinicId;
    if (!isDriver && !isDispatch && !isClinic) {
      return res.status(403).json({ message: "Not authorized for this trip" });
    }

    const { originLat, originLng } = req.body;
    if (typeof originLat !== "number" || typeof originLng !== "number") {
      return res.status(400).json({ message: "originLat and originLng are required numbers" });
    }

    const PICKUP_STAGES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "SCHEDULED"];
    const isPickupPhase = PICKUP_STAGES.includes(trip.status);
    const targetLat = isPickupPhase ? trip.pickupLat : trip.dropoffLat;
    const targetLng = isPickupPhase ? trip.pickupLng : trip.dropoffLng;

    if (!targetLat || !targetLng) {
      return res.status(400).json({ message: "Trip missing target coordinates" });
    }

    const { incrDirectionsMetric } = await import("../lib/googleMaps");
    incrDirectionsMetric("recomputeRequests");

    const { cache, cacheKeys } = await import("../lib/cache");
    const routeCacheKey = `trip:${id}:route_last_compute`;
    const lastCompute = cache.get<number>(routeCacheKey);
    if (lastCompute && (Date.now() - lastCompute) < 45_000) {
      incrDirectionsMetric("recomputeThrottled");
      const existingTrip = await storage.getTrip(id);
      return res.json({
        ok: true,
        polyline: existingTrip?.routePolyline || null,
        etaMinutes: existingTrip?.lastEtaMinutes || null,
        distanceMiles: existingTrip?.distanceMiles ? parseFloat(existingTrip.distanceMiles) : null,
        updatedAt: existingTrip?.lastEtaUpdatedAt?.toISOString() || new Date().toISOString(),
        source: "throttled",
      });
    }

    try {
      const { computeRouteFromCoords } = await import("../lib/tripRouteService");
      const result = await computeRouteFromCoords(
        id, originLat, originLng, Number(targetLat), Number(targetLng), "reroute"
      );

      if (result) {
        const now = new Date();
        await storage.updateTrip(id, {
          lastEtaMinutes: Math.round(result.routeDurationSeconds / 60),
          lastEtaUpdatedAt: now,
        });
        cache.set(routeCacheKey, Date.now(), 50_000);

        res.json({
          ok: true,
          polyline: result.routePolyline,
          etaMinutes: Math.round(result.routeDurationSeconds / 60),
          distanceMiles: result.routeDistanceMeters / 1609.344,
          updatedAt: now.toISOString(),
          source: "google",
          routeVersion: result.routeVersion,
        });
      } else {
        throw new Error("Route computation returned null");
      }
    } catch (routeErr: any) {
      const { haversineEta } = await import("../lib/etaThrottle");
      const fallback = haversineEta(
        { lat: originLat, lng: originLng },
        { lat: Number(targetLat), lng: Number(targetLng) }
      );

      const updateData: any = {
        lastEtaMinutes: fallback.minutes,
        distanceMiles: String(fallback.distanceMiles),
        lastEtaUpdatedAt: new Date(),
      };
      await storage.updateTrip(id, updateData);
      cache.set(routeCacheKey, Date.now(), 50_000);

      res.json({
        ok: true,
        polyline: null,
        etaMinutes: fallback.minutes,
        distanceMiles: fallback.distanceMiles,
        updatedAt: updateData.lastEtaUpdatedAt.toISOString(),
        source: "haversine",
      });
    }
  } catch (err: any) {
    console.error("[ROUTE-RECOMPUTE]", err.message);
    res.status(500).json({ message: err.message });
  }
}

export async function driverSignatureHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "DRIVER" && user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }
    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (user.role === "DRIVER") {
      const driverRecord = await db.select().from(drivers).where(eq(drivers.userId, user.id)).limit(1);
      if (!driverRecord.length || driverRecord[0].id !== trip.driverId) {
        return res.status(403).json({ message: "Not assigned to this trip" });
      }
    }
    const { signature } = req.body;
    if (!signature || typeof signature !== "string") {
      return res.status(400).json({ message: "Signature data required" });
    }
    if (signature.length > 500000) {
      return res.status(400).json({ message: "Signature too large" });
    }
    const sig = await storage.upsertTripSignature(tripId, {
      driverSigBase64: signature,
      driverSignedAt: new Date(),
    });
    res.json({ success: true, driverSignedAt: sig.driverSignedAt });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicSignatureHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (user.role === "CLINIC_USER") {
      if (!user.clinicId || trip.clinicId !== user.clinicId) {
        return res.status(403).json({ message: "Access denied" });
      }
    } else if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }
    const { signature } = req.body;
    if (!signature || typeof signature !== "string") {
      return res.status(400).json({ message: "Signature data required" });
    }
    if (signature.length > 500000) {
      return res.status(400).json({ message: "Signature too large" });
    }
    const sig = await storage.upsertTripSignature(tripId, {
      clinicSigBase64: signature,
      clinicSignedAt: new Date(),
    });
    res.json({ success: true, clinicSignedAt: sig.clinicSignedAt });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getSignatureHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (user.role === "CLINIC_USER") {
      if (!user.clinicId || trip.clinicId !== user.clinicId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }
    if (user.role === "COMPANY_ADMIN") {
      if (!user.companyId || !trip.companyId || trip.companyId !== user.companyId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }
    if (user.role === "DRIVER") {
      const driverRecord = await db.select().from(drivers).where(eq(drivers.userId, user.id)).limit(1);
      if (!driverRecord.length || driverRecord[0].id !== trip.driverId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }
    const sig = await storage.getTripSignature(tripId);
    if (!sig) return res.json({ driverSigned: false, clinicSigned: false });
    res.json({
      driverSigned: !!sig.driverSigBase64,
      clinicSigned: !!sig.clinicSigBase64,
      driverSignedAt: sig.driverSignedAt,
      clinicSignedAt: sig.clinicSignedAt,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getTripPdfHandler(req: AuthRequest, res: Response) {
  try {
    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "CLINIC_USER") {
      if (!user.clinicId || trip.clinicId !== user.clinicId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }
    if (user.role === "COMPANY_ADMIN") {
      if (!user.companyId || !trip.companyId || trip.companyId !== user.companyId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }
    if (user.role === "DRIVER") {
      if (!user.driverId || trip.driverId !== user.driverId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const companyId = getCompanyIdFromAuth(req);
    const jobId = await enqueueJob("pdf_trip_details", {
      tripId,
      companyId,
      userId: req.user!.userId,
    }, {
      companyId,
      idempotencyKey: `pdf:trip:${tripId}:${Date.now().toString(36)}`,
    });

    res.status(202).json({
      message: "PDF generation queued",
      jobId,
      statusUrl: `/api/jobs/${jobId}`,
      downloadUrl: `/api/trips/${tripId}/pdf/download`,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function downloadTripPdfHandler(req: AuthRequest, res: Response) {
  try {
    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "CLINIC_USER") {
      if (!user.clinicId || trip.clinicId !== user.clinicId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }
    if (user.role === "COMPANY_ADMIN") {
      if (!user.companyId || !trip.companyId || trip.companyId !== user.companyId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }
    if (user.role === "DRIVER") {
      if (!user.driverId || trip.driverId !== user.driverId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const pdfRows = await db
      .select()
      .from(tripPdfs)
      .where(eq(tripPdfs.tripId, tripId))
      .orderBy(desc(tripPdfs.createdAt))
      .limit(1);

    if (pdfRows.length === 0) {
      return res.status(404).json({ message: "PDF not yet generated. Please request generation first via GET /api/trips/:id/pdf" });
    }

    const pdf = pdfRows[0];
    let buffer = Buffer.from(pdf.bytes, "base64");

    const wantWatermark = req.query.watermark === "1";
    if (wantWatermark) {
      const user = await storage.getUser(req.user!.userId);
      const isAdmin = user && ["SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"].includes(user.role || "");
      if (isAdmin) {
        try {
          const { addWatermarkToPdf } = await import("../lib/pdfWatermark");
          const companyName = "United Care Mobility";
          const watermarkText = `${companyName} • ${trip.publicId || tripId} • ${new Date().toISOString().split("T")[0]}`;
          buffer = await addWatermarkToPdf(buffer, watermarkText);
        } catch {}
      }
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="trip-${trip.publicId || tripId}.pdf"`);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getTripInvoiceHandler(req: AuthRequest, res: Response) {
  try {
    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });

    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const invoiceLookupCompanyId = getCompanyIdFromAuth(req);
    if (!checkCompanyOwnership(trip, invoiceLookupCompanyId)) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (req.user!.role === "CLINIC_USER") {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.clinicId || user.clinicId !== trip.clinicId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    let invoice = trip.invoiceId ? await storage.getInvoice(trip.invoiceId) : null;
    if (!invoice) {
      invoice = (await storage.getInvoiceByTripId(tripId)) || null;
      if (invoice && !trip.invoiceId) {
        await storage.updateTrip(trip.id, { invoiceId: invoice.id });
      }
    }
    res.json({ invoice });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function createTripInvoiceHandler(req: AuthRequest, res: Response) {
  try {
    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });

    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (trip.status !== "COMPLETED") {
      return res.status(400).json({ message: "Invoice can only be created for completed trips" });
    }

    const createInvCompanyId = getCompanyIdFromAuth(req);
    if (!checkCompanyOwnership(trip, createInvCompanyId)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const existing = await storage.getInvoiceByTripId(tripId);
    if (existing) {
      return res.status(409).json({ message: "Invoice already exists for this trip", invoice: existing });
    }

    const { amount, notes } = req.body;
    if (!amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({ message: "Valid amount is required" });
    }

    let tripClinicId = trip.clinicId;
    if (!tripClinicId) {
      const { getDefaultPrivateClinicId } = await import("../lib/defaultClinic");
      tripClinicId = await getDefaultPrivateClinicId(trip.cityId);
      await storage.updateTrip(trip.id, { clinicId: tripClinicId } as any);
    }

    const patient = await storage.getPatient(trip.patientId);
    const patientName = patient ? `${patient.firstName} ${patient.lastName}` : "Unknown";

    const invoice = await storage.createInvoice({
      clinicId: tripClinicId,
      tripId: trip.id,
      patientName,
      serviceDate: trip.scheduledDate,
      amount: parseFloat(amount).toFixed(2),
      status: "pending",
      notes: notes || null,
    });

    await storage.updateTrip(trip.id, { invoiceId: invoice.id });

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "invoice_created",
      entity: "trip",
      entityId: trip.id,
      details: `Invoice #${invoice.id} created for trip #${trip.publicId}, amount: $${parseFloat(amount).toFixed(2)}${notes ? `, notes: ${notes}` : ""}`,
      cityId: trip.cityId,
    });

    if (patient?.email && (patient.source === "private" || patient.source === "internal")) {
      try {
        await db.update(invoices).set({ emailTo: patient.email }).where(eq(invoices.id, invoice.id));
        const { sendInvoicePaymentEmail } = await import("../services/invoiceEmailService");
        const emailResult = await sendInvoicePaymentEmail(invoice.id);
        if (emailResult.success) {
          console.info(JSON.stringify({ event: "invoice_email_sent", invoiceId: invoice.id, to: patient.email }));
        } else {
          console.error(`[Invoice] Auto-send failed for invoice #${invoice.id}:`, emailResult.error);
        }
      } catch (emailErr: any) {
        console.error("[Invoice] Auto-send email error:", emailErr.message);
      }
    }

    const updatedInvoice = await storage.getInvoice(invoice.id);
    res.status(201).json(updatedInvoice || invoice);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getTripRouteProofHandler(req: AuthRequest, res: any) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });

    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const userRole = req.user?.role;
    const isAdmin = ["SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"].includes(userRole || "");

    const { db } = await import("../db");
    const { tripRoutePlans, tripRouteSummary, tripRoutePointChunks } = await import("@shared/schema");
    const { eq, asc } = await import("drizzle-orm");
    const { decodePolyline } = await import("../lib/polylineCodec");

    const [plan] = await db.select().from(tripRoutePlans).where(eq(tripRoutePlans.tripId, id)).limit(1);
    const [summary] = await db.select().from(tripRouteSummary).where(eq(tripRouteSummary.tripId, id)).limit(1);

    const chunkPage = Math.max(parseInt(req.query.chunkPage as string) || 0, 0);
    const chunkSize = Math.min(Math.max(parseInt(req.query.chunkSize as string) || 20, 1), 50);
    const MAX_POINTS_PER_PAGE = 2000;

    const { count: countFn } = await import("drizzle-orm");
    const [{ total: totalChunksRaw }] = await db.select({ total: countFn(tripRoutePointChunks.id) }).from(tripRoutePointChunks).where(eq(tripRoutePointChunks.tripId, id));
    const totalChunks = Number(totalChunksRaw) || 0;

    let actualPoints: Array<{ lat: number; lng: number }> = [];
    if (isAdmin && totalChunks > 0) {
      const paginatedChunks = await db.select().from(tripRoutePointChunks)
        .where(eq(tripRoutePointChunks.tripId, id))
        .orderBy(asc(tripRoutePointChunks.chunkIndex))
        .limit(chunkSize)
        .offset(chunkPage * chunkSize);

      for (const chunk of paginatedChunks) {
        const decoded = decodePolyline(chunk.polylineChunk);
        const remaining = MAX_POINTS_PER_PAGE - actualPoints.length;
        if (remaining <= 0) break;
        actualPoints = actualPoints.concat(decoded.slice(0, remaining));
      }
    }

    res.json({
      ok: true,
      tripId: id,
      plan: plan ? {
        provider: plan.provider,
        polyline: isAdmin ? plan.polyline : undefined,
        distanceMeters: plan.distanceMeters,
        durationSeconds: plan.durationSeconds,
        createdAt: plan.createdAt,
      } : null,
      summary: summary ? {
        plannedDistanceMeters: summary.plannedDistanceMeters,
        plannedDurationSeconds: summary.plannedDurationSeconds,
        actualDistanceMeters: summary.actualDistanceMeters,
        actualDurationSeconds: summary.actualDurationSeconds,
        pointsTotal: summary.pointsTotal,
        gpsQualityScore: summary.gpsQualityScore,
        computedAt: summary.computedAt,
      } : null,
      actualPath: isAdmin ? {
        chunkCount: totalChunks,
        totalPoints: actualPoints.length,
        points: actualPoints,
        page: chunkPage,
        pageSize: chunkSize,
        hasMore: (chunkPage + 1) * chunkSize < totalChunks,
      } : { chunkCount: 0, totalPoints: 0, points: [], restricted: true },
    });
  } catch (err: any) {
    console.error("[ROUTE-PROOF] Error:", err.message);
    res.status(500).json({ message: "Failed to load route proof data" });
  }
}

export async function getTripGpsHandler(req: AuthRequest, res: Response) {
  try {
    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const limit = Math.min(parseInt(String(req.query.limit)) || 2000, 5000);
    const after = req.query.after ? new Date(String(req.query.after)) : null;

    const conditions = [eq(tripLocationPoints.tripId, tripId)];
    if (after) {
      conditions.push(gte(tripLocationPoints.ts, after));
    }

    const points = await db.select({
      lat: tripLocationPoints.lat,
      lng: tripLocationPoints.lng,
      ts: tripLocationPoints.ts,
      accuracyM: tripLocationPoints.accuracyM,
      speedMps: tripLocationPoints.speedMps,
      headingDeg: tripLocationPoints.headingDeg,
      source: tripLocationPoints.source,
    }).from(tripLocationPoints)
      .where(and(...conditions))
      .orderBy(tripLocationPoints.ts)
      .limit(limit);

    res.json({ ok: true, tripId, count: points.length, points });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function patchTripPlacesHandler(req: AuthRequest, res: Response) {
  try {
    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const { pickupPlaceId, dropoffPlaceId, pickupLat, pickupLng, dropoffLat, dropoffLng } = req.body;
    const updateData: any = {};

    if (pickupPlaceId !== undefined) updateData.pickupPlaceId = pickupPlaceId;
    if (dropoffPlaceId !== undefined) updateData.dropoffPlaceId = dropoffPlaceId;
    if (typeof pickupLat === "number") updateData.pickupLat = pickupLat;
    if (typeof pickupLng === "number") updateData.pickupLng = pickupLng;
    if (typeof dropoffLat === "number") updateData.dropoffLat = dropoffLat;
    if (typeof dropoffLng === "number") updateData.dropoffLng = dropoffLng;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    updateData.updatedAt = new Date();
    updateData.routeStatus = "missing";

    const [updated] = await db.update(trips).set(updateData).where(eq(trips.id, tripId)).returning();

    storage.createAuditLog({
      userId: req.user!.userId,
      action: "REPAIR_PLACES",
      entity: "trip",
      entityId: tripId,
      details: JSON.stringify(updateData),
      cityId: trip.cityId,
    }).catch(() => {});

    const { ensureTripRouteNonBlocking } = await import("../lib/tripRouteService");
    ensureTripRouteNonBlocking(tripId, "place_repair");

    res.json({ ok: true, trip: updated });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
