import type { Response } from "express";
import { storage } from "../storage";
import { type AuthRequest } from "../auth";
import { db } from "../db";
import { trips, patients, drivers, vehicles, recurringSchedules, driverOffers, clinicFeatures, clinicCapacityConfig, cities, clinics, tripSignatures, deliveryProofs, companies, patientRatings } from "@shared/schema";
import { eq, and, isNull, inArray, desc, gte, sql, or, gt, avg, count } from "drizzle-orm";
import { getClinicScopeId } from "../middleware/requireClinicScope";

function resolveClinicId(req: AuthRequest, user: any): number | null {
  return user?.clinicId || getClinicScopeId(req) || null;
}

function getTodayInTimezone(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

async function getClinicTimezone(clinicCityId: number | null | undefined): Promise<string> {
  if (!clinicCityId) return "America/Los_Angeles";
  try {
    const [city] = await db.select({ timezone: cities.timezone }).from(cities).where(eq(cities.id, clinicCityId));
    return city?.timezone || "America/Los_Angeles";
  } catch {
    return "America/Los_Angeles";
  }
}
import { getClinicForecast, getClinicCapacityForecast, saveClinicForecastSnapshot } from "../lib/clinicForecastEngine";
import { generateTripPdf } from "../lib/tripPdfGenerator";
import { denyAsNotFound } from "../lib/denyAsNotFound";

const clinicEtaCache = new Map<number, { eta: number | null; stale: boolean; updatedAt: string; }>();
const CLINIC_ETA_CACHE_TTL = 60_000;

function haversineDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function enrichTripsWithRelations(tripList: any[]) {
  const allCities = await storage.getCities();
  const cityMap = new Map(allCities.map(c => [c.id, c]));

  const tripIds = tripList.map(t => t.id).filter(Boolean);
  const acceptedOffers = tripIds.length > 0
    ? await db.select({ tripId: driverOffers.tripId, acceptedAt: driverOffers.acceptedAt })
        .from(driverOffers)
        .where(and(inArray(driverOffers.tripId, tripIds), eq(driverOffers.status, "accepted")))
    : [];
  const acceptedMap = new Map(acceptedOffers.filter(o => o.acceptedAt).map(o => [o.tripId, o.acceptedAt]));

  return Promise.all(tripList.map(async (t) => {
    const patient = t.patientId ? await storage.getPatient(t.patientId) : null;
    const clinic = t.clinicId ? await storage.getClinic(t.clinicId) : null;
    const driver = t.driverId ? await storage.getDriver(t.driverId) : null;
    const vehicle = driver?.vehicleId ? await storage.getVehicle(driver.vehicleId) : (t.vehicleId ? await storage.getVehicle(t.vehicleId) : null);
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
      vehicleType: (vehicle as any)?.type || null,
      vehicleColor: (vehicle as any)?.color || null,
      vehicleMake: vehicle?.make || null,
      vehicleModel: vehicle?.model || null,
      cityName: city?.name || null,
      acceptedAt: offerAcceptedAt ? new Date(offerAcceptedAt).toISOString() : null,
    };
  }));
}

function buildProgressEvents(tripData: any): Array<{key: string; label: string; at: string; meta?: {reason?: string}}> {
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
    if (step.isTimeOnly && step.dateField) {
      const dateStr = tripData[step.dateField];
      if (dateStr && typeof val === "string" && val.includes(":") && val.length <= 5) {
        const [h, m] = val.split(":").map(Number);
        const dt = new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
        atStr = isNaN(dt.getTime()) ? val : dt.toISOString();
      } else {
        atStr = typeof val === "string" ? val : new Date(val).toISOString();
      }
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

export async function clinicOpsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const clinic = await storage.getClinic(effectiveClinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const clinicTz = await getClinicTimezone((clinic as any).cityId);
    const todayDate = getTodayInTimezone(clinicTz);
    const PRESENCE_TIMEOUT = 120_000;
    const LATE_THRESHOLD_MINUTES = 10;

    const clinicTrips = await db.select().from(trips).where(
      and(eq(trips.clinicId, effectiveClinicId), isNull(trips.deletedAt))
    );

    const terminalStatuses = ["COMPLETED", "CANCELLED", "NO_SHOW"];
    const todayTrips = clinicTrips.filter(t => t.scheduledDate === todayDate && !terminalStatuses.includes(t.status));
    const activeNowStatuses = ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];
    const mapVisibleStatuses = ["EN_ROUTE_TO_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF"];
    const activeTrips = todayTrips.filter(t => activeNowStatuses.includes(t.status));
    const scheduledNotActive = todayTrips.filter(t => ["SCHEDULED", "ASSIGNED"].includes(t.status));
    const allTodayIncludingTerminal = clinicTrips.filter(t => t.scheduledDate === todayDate);

    const isToClinic = (trip: any) => {
      if (!clinic.lat || !clinic.lng) return false;
      if (trip.dropoffLat && trip.dropoffLng) {
        const dist = Math.abs(trip.dropoffLat - clinic.lat) + Math.abs(trip.dropoffLng - clinic.lng);
        if (dist < 0.01) return true;
      }
      return false;
    };

    const isFromClinic = (trip: any) => {
      if (!clinic.lat || !clinic.lng) return false;
      if (trip.pickupLat && trip.pickupLng) {
        const dist = Math.abs(trip.pickupLat - clinic.lat) + Math.abs(trip.pickupLng - clinic.lng);
        if (dist < 0.01) return true;
      }
      return false;
    };

    const enRouteToClinic = activeTrips.filter(t => isToClinic(t) && ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF"].includes(t.status));
    const leavingClinic = activeTrips.filter(t => isFromClinic(t) && ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF"].includes(t.status));

    const arrivalsNext60 = activeTrips.filter(t => {
      if (!isToClinic(t)) return false;
      if (t.lastEtaMinutes != null && t.lastEtaMinutes <= 60) return true;
      if (t.estimatedArrivalTime) {
        const [h, m] = t.estimatedArrivalTime.split(":").map(Number);
        const now = new Date();
        const arrivalToday = new Date(now);
        arrivalToday.setHours(h, m, 0, 0);
        const diffMin = (arrivalToday.getTime() - now.getTime()) / 60000;
        return diffMin >= 0 && diffMin <= 60;
      }
      return false;
    });

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60_000);

    const arrivingNext15 = activeTrips.filter(t => {
      if (t.status !== "EN_ROUTE_TO_PICKUP" && t.status !== "EN_ROUTE_TO_DROPOFF" && t.status !== "PICKED_UP") return false;
      if (t.lastEtaMinutes != null && t.lastEtaMinutes <= 15) return true;
      return false;
    });

    const departingNext15 = activeTrips.filter(t => {
      if (!isFromClinic(t)) return false;
      if (t.status !== "EN_ROUTE_TO_PICKUP" && t.status !== "ARRIVED_PICKUP" && t.status !== "ASSIGNED") return false;
      if (t.pickupTime) {
        const [h, m] = t.pickupTime.split(":").map(Number);
        const pickupTarget = new Date(now);
        pickupTarget.setHours(h, m, 0, 0);
        const diffMin = (pickupTarget.getTime() - now.getTime()) / 60000;
        return diffMin >= 0 && diffMin <= 15;
      }
      return false;
    });

    const departuresLast60 = allTodayIncludingTerminal.filter(t => {
      if (!isFromClinic(t)) return false;
      if (t.pickedUpAt) {
        return new Date(t.pickedUpAt).getTime() >= oneHourAgo.getTime();
      }
      return false;
    });

    const arrivalsToClinicNext15 = activeTrips.filter(t => {
      if (!isToClinic(t)) return false;
      if (t.lastEtaMinutes != null && t.lastEtaMinutes <= 15) return true;
      return false;
    });

    const arrivalsToClinicLast60 = allTodayIncludingTerminal.filter(t => {
      if (!isToClinic(t)) return false;
      if (t.arrivedDropoffAt) {
        return new Date(t.arrivedDropoffAt).getTime() >= oneHourAgo.getTime();
      }
      return false;
    });

    const departedLast60 = allTodayIncludingTerminal.filter(t => {
      if (t.status !== "ARRIVED_DROPOFF" && t.status !== "COMPLETED") return false;
      if (t.arrivedDropoffAt) {
        return new Date(t.arrivedDropoffAt).getTime() >= oneHourAgo.getTime();
      }
      return false;
    });

    const arrivedPickupLast60 = allTodayIncludingTerminal.filter(t => {
      if (t.arrivedPickupAt) {
        return new Date(t.arrivedPickupAt).getTime() >= oneHourAgo.getTime();
      }
      return false;
    });

    const lateRisk = todayTrips.filter(t => {
      if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(t.status)) return false;
      if (t.lastEtaMinutes != null && t.estimatedArrivalTime) {
        const [h, m] = t.estimatedArrivalTime.split(":").map(Number);
        const arrivalTarget = new Date(now);
        arrivalTarget.setHours(h, m, 0, 0);
        const scheduledMinutesFromNow = (arrivalTarget.getTime() - now.getTime()) / 60000;
        if (t.lastEtaMinutes > scheduledMinutesFromNow + LATE_THRESHOLD_MINUTES) return true;
      }
      if (t.noShowRisk) return true;
      return false;
    });

    const noDriverAssigned = todayTrips.filter(t =>
      !t.driverId && !terminalStatuses.includes(t.status)
    );
    const completedToday = allTodayIncludingTerminal.filter(t => t.status === "COMPLETED");
    const cancelledToday = allTodayIncludingTerminal.filter(t => t.status === "CANCELLED");
    const noShowsToday = allTodayIncludingTerminal.filter(t => t.status === "NO_SHOW");

    const clinicPatientIds = await db.select({ id: patients.id }).from(patients).where(
      and(eq(patients.clinicId, effectiveClinicId), eq(patients.active, true), isNull(patients.deletedAt))
    );
    const patientIds = clinicPatientIds.map(p => p.id);
    let recurringActiveCount = 0;
    if (patientIds.length > 0) {
      const schedules = await db.select().from(recurringSchedules).where(
        and(inArray(recurringSchedules.patientId, patientIds), eq(recurringSchedules.active, true))
      );
      recurringActiveCount = schedules.length;
    }

    const alerts: { type: string; severity: string; message: string; tripId?: number; tripPublicId?: string }[] = [];

    for (const trip of activeTrips) {
      if (trip.driverId) {
        const driver = await storage.getDriver(trip.driverId);
        if (driver) {
          const lastSeenMs = driver.lastSeenAt ? Date.now() - new Date(driver.lastSeenAt).getTime() : Infinity;
          if (lastSeenMs > PRESENCE_TIMEOUT) {
            alerts.push({ type: "driver_offline", severity: "warning", message: `Driver ${driver.firstName} ${driver.lastName} offline during trip ${trip.publicId}`, tripId: trip.id, tripPublicId: trip.publicId });
          }
        }
      }

      if (trip.lastEtaUpdatedAt) {
        const etaAge = (Date.now() - new Date(trip.lastEtaUpdatedAt).getTime()) / 60000;
        if (etaAge > 5) {
          alerts.push({ type: "eta_stale", severity: "info", message: `ETA stale for trip ${trip.publicId} (${Math.round(etaAge)} min old)`, tripId: trip.id, tripPublicId: trip.publicId });
        }
      }
    }

    for (const trip of lateRisk) {
      alerts.push({ type: "late_risk", severity: "danger", message: `Late risk: Trip ${trip.publicId}`, tripId: trip.id, tripPublicId: trip.publicId });
    }

    for (const trip of noDriverAssigned) {
      alerts.push({ type: "no_driver", severity: "warning", message: `No driver assigned to trip ${trip.publicId}`, tripId: trip.id, tripPublicId: trip.publicId });
    }

    const enrichedActiveTrips = await Promise.all(activeTrips.map(async (trip) => {
      const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;
      let driverData = null;
      if (trip.driverId) {
        const driver = await storage.getDriver(trip.driverId);
        if (driver) {
          const lastSeenMs = driver.lastSeenAt ? Date.now() - new Date(driver.lastSeenAt).getTime() : Infinity;
          const isOnline = lastSeenMs < PRESENCE_TIMEOUT && driver.dispatchStatus !== "off" && driver.dispatchStatus !== "hold";
          const vehicle = driver.vehicleId ? await storage.getVehicle(driver.vehicleId) : null;
          let cachedLat = driver.lastLat;
          let cachedLng = driver.lastLng;
          try {
            const { getDriverLocationFromCache } = await import("../lib/driverLocationIngest");
            const cached = getDriverLocationFromCache(driver.id);
            if (cached) { cachedLat = cached.lat; cachedLng = cached.lng; }
          } catch {}
          driverData = {
            id: driver.id, firstName: driver.firstName, lastName: driver.lastName,
            phone: driver.phone, lastLat: cachedLat, lastLng: cachedLng,
            lastSeenAt: driver.lastSeenAt, isOnline,
            vehicleColor: (vehicle as any)?.color || null,
            vehicleLabel: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
          };
        }
      }

      const direction = isToClinic(trip) ? "TO_CLINIC" : isFromClinic(trip) ? "FROM_CLINIC" : "UNKNOWN";
      let lateStatus = "on_time";
      if (trip.estimatedArrivalTime && trip.lastEtaMinutes != null) {
        const [h, m] = trip.estimatedArrivalTime.split(":").map(Number);
        const now = new Date();
        const target = new Date(now);
        target.setHours(h, m, 0, 0);
        const scheduledMinFromNow = (target.getTime() - now.getTime()) / 60000;
        if (trip.lastEtaMinutes > scheduledMinFromNow + LATE_THRESHOLD_MINUTES) lateStatus = "late";
        else if (trip.lastEtaMinutes > scheduledMinFromNow) lateStatus = "at_risk";
      }

      const driverVisible = trip.lastEtaMinutes != null && trip.lastEtaMinutes < 15;

      const mapVisible = mapVisibleStatuses.includes(trip.status) && !!trip.driverId;

      return {
        tripId: trip.id, publicId: trip.publicId, status: trip.status,
        pickupAddress: trip.pickupAddress, dropoffAddress: trip.dropoffAddress,
        pickupLat: trip.pickupLat, pickupLng: trip.pickupLng,
        dropoffLat: trip.dropoffLat, dropoffLng: trip.dropoffLng,
        scheduledDate: trip.scheduledDate, pickupTime: trip.pickupTime,
        estimatedArrivalTime: trip.estimatedArrivalTime,
        tripType: trip.tripType, tripSeriesId: trip.tripSeriesId,
        direction, lateStatus, driverVisible, mapVisible,
        patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, phone: patient.phone } : null,
        driver: driverData ? {
          ...driverData,
          lastLat: driverVisible ? driverData.lastLat : null,
          lastLng: driverVisible ? driverData.lastLng : null,
        } : null,
        eta: trip.lastEtaMinutes != null ? { minutes: trip.lastEtaMinutes, updatedAt: trip.lastEtaUpdatedAt?.toISOString() || null } : null,
      };
    }));

    res.json({
      ok: true,
      clinic: { id: clinic.id, name: clinic.name, lat: clinic.lat, lng: clinic.lng, address: clinic.address },
      timezone: clinicTz,
      todayDate,
      todayTrips: todayTrips.length + completedToday.length + cancelledToday.length + noShowsToday.length,
      activeNow: activeTrips.length,
      scheduledUpcoming: scheduledNotActive.length,
      completedToday: completedToday.length,
      cancelledToday: cancelledToday.length,
      kpis: {
        activeNow: activeTrips.length,
        scheduledUpcoming: scheduledNotActive.length,
        enRouteToClinic: enRouteToClinic.length,
        leavingClinic: leavingClinic.length,
        arrivalsNext60: arrivalsNext60.length,
        arrivingNext15: arrivingNext15.length,
        departedLast60: departedLast60.length,
        departingNext15: departingNext15.length,
        departuresLast60: departuresLast60.length,
        arrivalsToClinicNext15: arrivalsToClinicNext15.length,
        arrivalsToClinicLast60: arrivalsToClinicLast60.length,
        arrivedPickupLast60: arrivedPickupLast60.length,
        lateRisk: lateRisk.length,
        noDriverAssigned: noDriverAssigned.length,
        completedToday: completedToday.length,
        cancelledToday: cancelledToday.length,
        noShowsToday: noShowsToday.length,
        recurringActive: recurringActiveCount,
      },
      activeTrips: enrichedActiveTrips,
      alerts,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function clinicActiveTripsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const clinic = await storage.getClinic(effectiveClinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const ACTIVE_STATUSES = ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];
    const STALE_THRESHOLD_MS = 90 * 1000;

    const clinicTrips = await db.select().from(trips).where(
      and(
        eq(trips.clinicId, effectiveClinicId),
        inArray(trips.status, ACTIVE_STATUSES as any),
        isNull(trips.deletedAt),
      )
    );

    // Batch-load all patients, drivers, vehicles in parallel (fixes N+1)
    const patientIds = [...new Set(clinicTrips.map(t => t.patientId).filter(Boolean))] as number[];
    const driverIds = [...new Set(clinicTrips.map(t => t.driverId).filter(Boolean))] as number[];

    const [batchPatients, batchDrivers] = await Promise.all([
      patientIds.length > 0 ? db.select().from(patients).where(inArray(patients.id, patientIds)) : [],
      driverIds.length > 0 ? db.select().from(drivers).where(inArray(drivers.id, driverIds)) : [],
    ]);

    const patientMap = new Map(batchPatients.map(p => [p.id, p]));
    const driverMap = new Map(batchDrivers.map(d => [d.id, d]));

    const vehicleIds = [...new Set(batchDrivers.map(d => d.vehicleId).filter(Boolean))] as number[];
    const batchVehicles = vehicleIds.length > 0
      ? await db.select().from(vehicles).where(inArray(vehicles.id, vehicleIds))
      : [];
    const vehicleMap = new Map(batchVehicles.map(v => [v.id, v]));

    let getDriverLocationFromCache: ((id: number) => { lat: number; lng: number } | null) | null = null;
    try {
      const mod = await import("../lib/driverLocationIngest");
      getDriverLocationFromCache = mod.getDriverLocationFromCache;
    } catch {}

    const result = clinicTrips.map((trip) => {
      const patient = trip.patientId ? patientMap.get(trip.patientId) : null;
      let driverData: any = null;
      let driverStale = false;
      let driverLastLat: number | null = null;
      let driverLastLng: number | null = null;
      let driverLastSeenAt: string | null = null;

      if (trip.driverId) {
        const driver = driverMap.get(trip.driverId);
        if (driver) {
          driverLastLat = driver.lastLat ?? null;
          driverLastLng = driver.lastLng ?? null;
          if (getDriverLocationFromCache) {
            const cached = getDriverLocationFromCache(driver.id);
            if (cached) { driverLastLat = cached.lat; driverLastLng = cached.lng; }
          }
          driverLastSeenAt = driver.lastSeenAt ? new Date(driver.lastSeenAt).toISOString() : null;
          const lastSeenMs = driver.lastSeenAt ? Date.now() - new Date(driver.lastSeenAt).getTime() : Infinity;
          driverStale = lastSeenMs > STALE_THRESHOLD_MS;
          const vehicle = driver.vehicleId ? vehicleMap.get(driver.vehicleId) : null;
          driverData = {
            id: driver.id,
            firstName: driver.firstName,
            lastName: driver.lastName,
            phone: driver.phone,
            lastLat: driverLastLat,
            lastLng: driverLastLng,
            lastSeenAt: driverLastSeenAt,
            stale: driverStale,
            vehicleColor: (vehicle as any)?.color || null,
            vehicleLabel: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
          };
        }
      }

      let etaToClinic: number | null = null;
      let etaUpdatedAt: string | null = null;
      let etaStale = true;

      if (clinic.lat && clinic.lng && driverLastLat && driverLastLng && !driverStale) {
        const cacheEntry = clinicEtaCache.get(trip.id);
        const now = Date.now();
        if (cacheEntry && (now - new Date(cacheEntry.updatedAt).getTime()) < CLINIC_ETA_CACHE_TTL) {
          etaToClinic = cacheEntry.eta;
          etaUpdatedAt = cacheEntry.updatedAt;
          etaStale = cacheEntry.stale;
        } else {
          const dist = haversineDistanceMiles(driverLastLat, driverLastLng, clinic.lat, clinic.lng);
          etaToClinic = Math.round((dist / 25) * 60);
          etaUpdatedAt = new Date().toISOString();
          etaStale = false;
          clinicEtaCache.set(trip.id, { eta: etaToClinic, stale: false, updatedAt: etaUpdatedAt });
        }
      } else if (driverStale) {
        etaToClinic = null;
        etaStale = true;
        etaUpdatedAt = null;
      }

      return {
        tripId: trip.id,
        publicId: trip.publicId,
        status: trip.status,
        approvalStatus: trip.approvalStatus,
        scheduledDate: trip.scheduledDate,
        pickupTime: trip.pickupTime,
        pickupAddress: trip.pickupAddress,
        dropoffAddress: trip.dropoffAddress,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        dropoffLat: trip.dropoffLat,
        dropoffLng: trip.dropoffLng,
        tripType: trip.tripType,
        routePolyline: trip.routePolyline || null,
        lastEtaMinutes: trip.lastEtaMinutes ?? null,
        distanceMiles: trip.distanceMiles ? Number(trip.distanceMiles) : null,
        lastEtaUpdatedAt: trip.lastEtaUpdatedAt ? new Date(trip.lastEtaUpdatedAt).toISOString() : null,
        patient: patient ? {
          id: patient.id,
          firstName: patient.firstName,
          lastName: patient.lastName,
          phone: patient.phone,
        } : null,
        driver: driverData,
        etaToClinic: etaToClinic,
        etaUpdatedAt: etaUpdatedAt,
        stale: driverStale,
      };
    });

    res.json({
      ok: true,
      clinic: { id: clinic.id, name: clinic.name, lat: clinic.lat, lng: clinic.lng, address: clinic.address },
      trips: result,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function clinicMetricsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const now = new Date();
    const endDate = req.query.endDate as string || now.toISOString().split("T")[0];
    const startDefault = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];
    const startDate = req.query.startDate as string || startDefault;

    const clinicTrips = await db.select().from(trips).where(
      and(
        eq(trips.clinicId, effectiveClinicId),
        isNull(trips.deletedAt),
        gte(trips.scheduledDate, startDate),
        sql`${trips.scheduledDate} <= ${endDate}`,
      )
    );

    const total = clinicTrips.length;
    const completed = clinicTrips.filter(t => t.status === "COMPLETED");
    const cancelled = clinicTrips.filter(t => t.status === "CANCELLED");
    const noShows = clinicTrips.filter(t => t.status === "NO_SHOW");

    let totalDelayMinutes = 0;
    let delayCount = 0;
    let onTimeCount = 0;

    for (const trip of completed) {
      if (trip.lastEtaMinutes != null && trip.estimatedArrivalTime) {
        const [h, m] = trip.estimatedArrivalTime.split(":").map(Number);
        if (!isNaN(h) && !isNaN(m)) {
          if (trip.completedAt) {
            const completedTime = new Date(trip.completedAt);
            const targetTime = new Date(completedTime);
            targetTime.setHours(h, m, 0, 0);
            const delayMin = (completedTime.getTime() - targetTime.getTime()) / 60000;
            if (delayMin > 0) {
              totalDelayMinutes += delayMin;
              delayCount++;
            } else {
              onTimeCount++;
            }
          } else {
            onTimeCount++;
          }
        }
      } else {
        onTimeCount++;
      }
    }

    const onTimeRate = completed.length > 0 ? Math.round((onTimeCount / completed.length) * 100) : 100;
    const avgDelayMinutes = delayCount > 0 ? Math.round(totalDelayMinutes / delayCount) : 0;
    const noShowRate = total > 0 ? Math.round((noShows.length / total) * 100) : 0;
    const cancellationRate = total > 0 ? Math.round((cancelled.length / total) * 100) : 0;

    const dayMap: Record<string, { total: number; completed: number; late: number; noShows: number }> = {};
    for (const trip of clinicTrips) {
      if (!dayMap[trip.scheduledDate]) dayMap[trip.scheduledDate] = { total: 0, completed: 0, late: 0, noShows: 0 };
      dayMap[trip.scheduledDate].total++;
      if (trip.status === "COMPLETED") dayMap[trip.scheduledDate].completed++;
      if (trip.status === "NO_SHOW") dayMap[trip.scheduledDate].noShows++;
    }

    const dailyData = Object.entries(dayMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, data]) => ({ date, ...data }));
    const daysInRange = Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1);
    const tripsPerDay = Math.round((total / daysInRange) * 10) / 10;

    const recurringTrips = clinicTrips.filter(t => t.tripType === "dialysis" || t.tripType === "recurring" || t.tripSeriesId);
    const recurringCompleted = recurringTrips.filter(t => t.status === "COMPLETED");
    const recurringReliability = recurringTrips.length > 0 ? Math.round((recurringCompleted.length / recurringTrips.length) * 100) : 100;

    let busiestDay = "";
    let busiestCount = 0;
    for (const [date, data] of Object.entries(dayMap)) {
      if (data.total > busiestCount) { busiestCount = data.total; busiestDay = date; }
    }

    res.json({
      ok: true,
      period: { startDate, endDate },
      metrics: {
        totalTrips: total,
        completedTrips: completed.length,
        cancelledTrips: cancelled.length,
        noShowTrips: noShows.length,
        onTimeRate,
        avgDelayMinutes,
        noShowRate,
        cancellationRate,
        tripsPerDay,
        recurringReliability,
        busiestDay,
        busiestDayCount: busiestCount,
      },
      dailyData,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function clinicMapHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const CLINIC_MAP_STATUSES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF"];
    const PRESENCE_TIMEOUT = 120_000;

    const clinicTrips = await db.select().from(trips).where(
      and(
        eq(trips.clinicId, effectiveClinicId),
        inArray(trips.status, CLINIC_MAP_STATUSES as any),
        isNull(trips.deletedAt),
      )
    );

    const result = await Promise.all(clinicTrips.map(async (trip) => {
      let driverData = null;
      if (trip.driverId) {
        const driver = await storage.getDriver(trip.driverId);
        if (driver) {
          const lastSeenMs = driver.lastSeenAt ? Date.now() - new Date(driver.lastSeenAt).getTime() : Infinity;
          const isOnline = lastSeenMs < PRESENCE_TIMEOUT
            && driver.dispatchStatus !== "off"
            && driver.dispatchStatus !== "hold";
          const vehicle = driver.vehicleId ? await storage.getVehicle(driver.vehicleId) : null;
          let cachedLat2 = driver.lastLat;
          let cachedLng2 = driver.lastLng;
          try {
            const { getDriverLocationFromCache } = await import("../lib/driverLocationIngest");
            const cached = getDriverLocationFromCache(driver.id);
            if (cached) { cachedLat2 = cached.lat; cachedLng2 = cached.lng; }
          } catch {}
          driverData = {
            id: driver.id,
            firstName: driver.firstName,
            lastName: driver.lastName,
            lastLat: cachedLat2,
            lastLng: cachedLng2,
            lastSeenAt: driver.lastSeenAt,
            dispatchStatus: driver.dispatchStatus,
            isOnline,
            vehicleColor: (vehicle as any)?.color || null,
            vehicleLabel: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
          };
        }
      }

      const driverVisible = trip.lastEtaMinutes != null && trip.lastEtaMinutes < 15;

      return {
        tripId: trip.id,
        publicId: trip.publicId,
        status: trip.status,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        pickupAddress: trip.pickupAddress,
        dropoffLat: trip.dropoffLat,
        dropoffLng: trip.dropoffLng,
        dropoffAddress: trip.dropoffAddress,
        scheduledDate: trip.scheduledDate,
        pickupTime: trip.pickupTime,
        driverVisible,
        driver: driverData ? {
          ...driverData,
          lastLat: driverVisible ? driverData.lastLat : null,
          lastLng: driverVisible ? driverData.lastLng : null,
        } : null,
        eta: trip.lastEtaMinutes != null ? {
          minutes: trip.lastEtaMinutes,
          updatedAt: trip.lastEtaUpdatedAt?.toISOString() || null,
        } : null,
      };
    }));

    res.json({ ok: true, trips: result });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function clinicTripsExportHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) {
      return res.status(403).json({ message: "No clinic linked to this account" });
    }

    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: "startDate and endDate query params required (YYYY-MM-DD)" });
    }

    const conditions: any[] = [
      eq(trips.clinicId, effectiveClinicId),
      isNull(trips.deletedAt),
      gte(trips.scheduledDate, startDate),
    ];
    conditions.push(sql`${trips.scheduledDate} <= ${endDate}`);

    const result = await db.select().from(trips).where(and(...conditions)).orderBy(trips.scheduledDate);
    const enriched = await enrichTripsWithRelations(result);

    const csvHeader = "Trip ID,Date,Pickup Time,Patient,Pickup Address,Dropoff Address,Status,Driver,ETA (min),Mileage\n";
    const csvRows = enriched.map((t: any) => {
      const fields = [
        t.publicId || "",
        t.scheduledDate || "",
        t.pickupTime || "",
        (t.patientName || "").replace(/,/g, " "),
        (t.pickupAddress || "").replace(/,/g, " "),
        (t.dropoffAddress || "").replace(/,/g, " "),
        t.status || "",
        (t.driverName || "").replace(/,/g, " "),
        t.lastEtaMinutes != null ? t.lastEtaMinutes : "",
        t.estimatedMiles != null ? t.estimatedMiles : "",
      ];
      return fields.join(",");
    });

    const csv = csvHeader + csvRows.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="trips_${startDate}_to_${endDate}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(csv);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicTripsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    let clinicId = resolveClinicId(req, user);
    if (!clinicId && req.query.clinicId) {
      const qClinicId = parseInt(req.query.clinicId as string);
      if (!isNaN(qClinicId)) {
        const clinic = await storage.getClinic(qClinicId);
        if (!clinic) return res.status(404).json({ message: "Clinic not found" });
        if (user.companyId && clinic.companyId !== user.companyId && req.user!.role !== "SUPER_ADMIN") {
          return res.status(403).json({ message: "Access denied" });
        }
        clinicId = qClinicId;
      }
    }
    if (!clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const clinicObj = await storage.getClinic(clinicId);
    const tripsTz = await getClinicTimezone((clinicObj as any)?.cityId);

    const rawStatus = (req.query.status as string || "").trim().toLowerCase();
    // Default to "all" if empty — shows every trip for this clinic
    const statusFilter = rawStatus || "all";
    const conditions: any[] = [
      eq(trips.clinicId, clinicId),
      isNull(trips.deletedAt),
    ];

    if (statusFilter === "all") {
      // No extra filter — return all trips
    } else if (statusFilter === "today") {
      const todayDate = getTodayInTimezone(tripsTz);
      conditions.push(eq(trips.scheduledDate, todayDate));
    } else if (statusFilter === "active") {
      conditions.push(
        inArray(trips.status, ["SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"])
      );
    } else if (statusFilter === "live") {
      conditions.push(
        inArray(trips.status, ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"])
      );
    } else if (statusFilter === "scheduled") {
      conditions.push(inArray(trips.status, ["SCHEDULED", "ASSIGNED"]));
    } else if (statusFilter === "pending") {
      conditions.push(eq(trips.approvalStatus, "pending"));
      conditions.push(sql`${trips.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW')`);
    } else if (statusFilter === "completed") {
      conditions.push(eq(trips.status, "COMPLETED"));
    } else if (statusFilter === "cancelled") {
      conditions.push(eq(trips.status, "CANCELLED"));
    } else if (statusFilter === "no_show") {
      conditions.push(eq(trips.status, "NO_SHOW"));
    } else {
      // Try matching as a raw DB status (e.g., SCHEDULED, ASSIGNED, IN_PROGRESS, etc.)
      const upperStatus = rawStatus.toUpperCase();
      const validStatuses = ["SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
      if (validStatuses.includes(upperStatus as any)) {
        conditions.push(sql`${trips.status} = ${upperStatus}`);
      }
    }

    const tripTypeFilter = req.query.tripType as string;
    if (tripTypeFilter === "recurring") {
      conditions.push(or(
        inArray(trips.tripType, ["recurring", "dialysis"]),
        sql`${trips.tripSeriesId} IS NOT NULL`
      )!);
    } else if (tripTypeFilter === "one_time") {
      conditions.push(eq(trips.tripType, "one_time"));
      conditions.push(isNull(trips.tripSeriesId));
    }

    const result = await db.select().from(trips).where(and(...conditions)).orderBy(desc(trips.createdAt));
    const enriched = await enrichTripsWithRelations(result);
    const sanitized = enriched.map((t: any) => {
      const { routePolyline, lastEtaMinutes, distanceMiles, lastEtaUpdatedAt, ...rest } = t;
      if (rest.driver) {
        const { lastLat, lastLng, lastLocationAt, ...driverRest } = rest.driver;
        rest.driver = driverRest;
      }
      return rest;
    });
    res.json(sanitized);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicTripByIdHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    let clinicId = resolveClinicId(req, user);
    if (!clinicId && req.query.clinicId) {
      const qClinicId = parseInt(req.query.clinicId as string);
      if (!isNaN(qClinicId)) {
        const clinic = await storage.getClinic(qClinicId);
        if (!clinic) return res.status(404).json({ message: "Clinic not found" });
        if (user.companyId && clinic.companyId !== user.companyId && req.user!.role !== "SUPER_ADMIN") {
          return res.status(403).json({ message: "Access denied" });
        }
        clinicId = qClinicId;
      }
    }
    if (!clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (trip.clinicId !== clinicId) return res.status(404).json({ message: "Trip not found" });

    const [enriched] = await enrichTripsWithRelations([trip]);

    const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;

    let mapSnapshotUrl = enriched.staticMapFullUrl || enriched.staticMapThumbUrl || null;
    if (!mapSnapshotUrl && enriched.pickupLat && enriched.pickupLng && enriched.dropoffLat && enriched.dropoffLng) {
      const gmKey = process.env.GOOGLE_MAPS_API_KEY;
      if (gmKey) {
        const pA = `${enriched.pickupLat},${enriched.pickupLng}`;
        const pB = `${enriched.dropoffLat},${enriched.dropoffLng}`;
        mapSnapshotUrl = `https://maps.googleapis.com/maps/api/staticmap?size=600x300&markers=color:green|label:A|${pA}&markers=color:red|label:B|${pB}&path=color:0x4285F4FF|weight:4|${pA}|${pB}&key=${gmKey}`;
      }
    }

    const clinicSafe = {
      id: enriched.id,
      publicId: enriched.publicId,
      clinicName: enriched.clinicName,
      patientName: enriched.patientName,
      scheduledDate: enriched.scheduledDate,
      pickupTime: enriched.pickupTime,
      estimatedArrivalTime: enriched.estimatedArrivalTime,
      pickupAddress: enriched.pickupAddress,
      pickupLat: enriched.pickupLat,
      pickupLng: enriched.pickupLng,
      dropoffAddress: enriched.dropoffAddress,
      dropoffLat: enriched.dropoffLat,
      dropoffLng: enriched.dropoffLng,
      distanceMiles: enriched.distanceMiles ? parseFloat(enriched.distanceMiles) : null,
      durationMinutes: enriched.durationMinutes || null,
      status: enriched.status,
      tripType: enriched.tripType,
      direction: enriched.direction,
      mobilityRequirement: enriched.mobilityRequirement || "STANDARD",
      passengerCount: enriched.passengerCount || 1,
      cityName: enriched.cityName || null,
      wheelchairRequired: patient?.wheelchairRequired || false,
      patientNotes: patient?.notes || null,
      approvalStatus: enriched.approvalStatus,
      approvedAt: enriched.approvedAt,
      assignedAt: enriched.assignedAt,
      acceptedAt: enriched.acceptedAt,
      startedAt: enriched.startedAt,
      arrivedPickupAt: enriched.arrivedPickupAt,
      pickedUpAt: enriched.pickedUpAt,
      enRouteDropoffAt: enriched.enRouteDropoffAt,
      arrivedDropoffAt: enriched.arrivedDropoffAt,
      completedAt: enriched.completedAt,
      cancelledAt: enriched.cancelledAt,
      cancelledReason: enriched.cancelledReason,
      billingOutcome: enriched.billingOutcome,
      billingReason: enriched.billingReason,
      actualDistanceSource: enriched.actualDistanceSource,
      billingSetAt: enriched.billingSetAt,
      driverName: enriched.driverName,
      vehicleLabel: enriched.vehicleLabel,
      vehicleColor: enriched.vehicleColor,
      vehicleMake: enriched.vehicleMake,
      vehicleModel: enriched.vehicleModel,
      routePolyline: enriched.routePolyline,
      staticMapThumbUrl: mapSnapshotUrl,
      staticMapFullUrl: mapSnapshotUrl,
      routeImageUrl: mapSnapshotUrl,
      lastEtaMinutes: enriched.lastEtaMinutes,
      createdAt: enriched.createdAt,
      progressEvents: buildProgressEvents(enriched),
      waitTimeMinutes: enriched.arrivedPickupAt && enriched.pickedUpAt
        ? Math.round((new Date(enriched.pickedUpAt).getTime() - new Date(enriched.arrivedPickupAt).getTime()) / 60000)
        : null,
      totalDurationMinutes: enriched.startedAt && enriched.completedAt
        ? Math.round((new Date(enriched.completedAt).getTime() - new Date(enriched.startedAt).getTime()) / 60000)
        : enriched.durationMinutes || null,
      transportMinutes: enriched.pickedUpAt && enriched.arrivedDropoffAt
        ? Math.round((new Date(enriched.arrivedDropoffAt).getTime() - new Date(enriched.pickedUpAt).getTime()) / 60000)
        : null,
      // Full patient details for clinic view
      patient: patient ? {
        id: patient.id,
        publicId: patient.publicId,
        firstName: patient.firstName,
        lastName: patient.lastName,
        phone: patient.phone,
        email: patient.email,
        dateOfBirth: patient.dateOfBirth,
        address: patient.address,
        insuranceId: patient.insuranceId,
        medicaidId: patient.medicaidId,
        medicaidState: patient.medicaidState,
        wheelchairRequired: patient.wheelchairRequired,
        isFrequent: patient.isFrequent,
        notes: patient.notes,
      } : null,
      driverPhone: enriched.driverPhone || null,
    };

    res.json(clinicSafe);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicTripPdfHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (trip.clinicId !== effectiveClinicId) return res.status(404).json({ message: "Trip not found" });

    const [enriched] = await enrichTripsWithRelations([trip]);
    const clinic = trip.clinicId ? await storage.getClinic(trip.clinicId) : null;
    const clinicName = clinic?.name || "Unknown Clinic";
    const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;
    const allCities = await storage.getCities();
    const city = allCities.find(c => c.id === trip.cityId);

    await generateTripPdf({
      trip, enriched, clinicName, patient,
      cityName: city?.name || null,
      driverName: enriched.driverName || null,
      vehicleLabel: enriched.vehicleLabel || null,
      vehicleDetails: [enriched.vehicleColor, enriched.vehicleMake, enriched.vehicleModel].filter(Boolean).join(" ") || null,
      licensePlate: null,
    }, res);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicTripTrackingHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (trip.clinicId !== effectiveClinicId) {
      return res.status(404).json({ message: "Trip not found" });
    }

    const terminalStatuses = ["COMPLETED", "CANCELLED", "NO_SHOW"];
    if (terminalStatuses.includes(trip.status)) {
      return res.json({
        ok: true,
        tripId: trip.id,
        status: trip.status,
        completed: true,
        driver: null,
        route: null,
      });
    }

    const driver = trip.driverId ? await storage.getDriver(trip.driverId) : null;
    const vehicle = driver?.vehicleId ? await storage.getVehicle(driver.vehicleId) : null;

    const driverVisible = trip.lastEtaMinutes != null && trip.lastEtaMinutes < 15;

    let driverLat = driver?.lastLat ?? null;
    let driverLng = driver?.lastLng ?? null;
    if (driver) {
      try {
        const { getDriverLocationFromCache } = await import("../lib/driverLocationIngest");
        const cached = getDriverLocationFromCache(driver.id);
        if (cached) {
          driverLat = cached.lat;
          driverLng = cached.lng;
        }
      } catch {}
    }

    const driverData = driver ? {
      id: driver.id,
      name: `${driver.firstName} ${driver.lastName}`,
      phone: driver.phone,
      lat: driverVisible ? driverLat : null,
      lng: driverVisible ? driverLng : null,
      lastSeenAt: driver.lastSeenAt,
      connected: driver.lastSeenAt ? (Date.now() - new Date(driver.lastSeenAt).getTime()) < 120000 : false,
      vehicleLabel: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
      vehicleColor: (vehicle as any)?.color || null,
      vehicleMake: vehicle?.make || null,
      vehicleModel: vehicle?.model || null,
      driverVisible,
    } : null;

    const routeData = {
      pickupAddress: trip.pickupAddress,
      pickupLat: trip.pickupLat,
      pickupLng: trip.pickupLng,
      dropoffAddress: trip.dropoffAddress,
      dropoffLat: trip.dropoffLat,
      dropoffLng: trip.dropoffLng,
      etaMinutes: trip.lastEtaMinutes,
      distanceMiles: trip.distanceMiles ? Number(trip.distanceMiles) : null,
      routePolyline: trip.routePolyline || null,
    };

    res.json({
      ok: true,
      tripId: trip.id,
      publicId: trip.publicId,
      status: trip.status,
      scheduledDate: trip.scheduledDate,
      pickupTime: trip.pickupTime,
      completed: false,
      driverVisible,
      driver: driverData,
      route: routeData,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicInvoicesHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "SUPER_ADMIN") {
      const allInvoices = await storage.getInvoices();
      return res.json(allInvoices);
    }

    if (user.role === "ADMIN" || user.role === "DISPATCH" || user.role === "COMPANY_ADMIN") {
      const companyId = req.user!.companyId;
      if (!companyId) {
        return res.status(403).json({ message: "No company assigned to your account" });
      }
      const allInvoices = await storage.getInvoices();
      const companyClinics = (await storage.getClinics()).filter((c: any) => c.companyId === companyId);
      const companyClinicIds = new Set(companyClinics.map((c: any) => c.id));
      const filtered = allInvoices.filter((inv: any) => inv.clinicId && companyClinicIds.has(inv.clinicId));
      return res.json(filtered);
    }

    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) {
      return res.status(403).json({ message: "No clinic linked to this account" });
    }

    const clinicInvoices = await storage.getInvoices(effectiveClinicId);
    res.json(clinicInvoices);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicInvoiceByIdHandler(req: AuthRequest, res: Response) {
  try {
    const invoiceId = parseInt(String(req.params.id));
    if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "SUPER_ADMIN") {
      return res.json(invoice);
    }

    if (user.role === "ADMIN" || user.role === "DISPATCH" || user.role === "COMPANY_ADMIN") {
      const companyId = req.user!.companyId;
      if (!companyId) {
        return res.status(403).json({ message: "No company assigned to your account" });
      }
      if (invoice.clinicId) {
        const invoiceClinic = await storage.getClinic(invoice.clinicId);
        if (!invoiceClinic || invoiceClinic.companyId !== companyId) {
          return denyAsNotFound(res, "Invoice");
        }
      } else {
        return denyAsNotFound(res, "Invoice");
      }
      return res.json(invoice);
    }

    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId || effectiveClinicId !== invoice.clinicId) {
      return denyAsNotFound(res, "Invoice");
    }

    res.json(invoice);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicDeletePatientHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) {
      return res.status(403).json({ message: "Only clinic users can use this endpoint" });
    }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const patient = await storage.getPatient(id);
    if (!patient) return res.status(404).json({ message: "Patient not found" });
    if (patient.clinicId !== effectiveClinicId) {
      return denyAsNotFound(res, "Patient");
    }
    const clinic = await storage.getClinic(effectiveClinicId);
    if (clinic?.companyId && patient.companyId !== clinic.companyId) {
      return denyAsNotFound(res, "Patient");
    }
    const hasActive = await storage.hasActiveTripsForPatient(id);
    if (hasActive) return res.status(409).json({ message: "Cannot delete patient with active trips" });
    const reason = req.body?.reason || null;
    const updated = await storage.updatePatient(id, { active: false, deletedAt: new Date(), deletedBy: req.user!.userId, deleteReason: reason } as any);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ARCHIVE",
      entity: "patient",
      entityId: id,
      details: `Clinic user archived patient ${patient.firstName} ${patient.lastName}`,
      cityId: patient.cityId,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicDeleteTripHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) {
      return res.status(403).json({ message: "Only clinic users can use this endpoint" });
    }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (trip.clinicId !== effectiveClinicId) {
      return denyAsNotFound(res, "Trip");
    }
    const clinic = await storage.getClinic(effectiveClinicId);
    if (clinic?.companyId && trip.companyId !== clinic.companyId) {
      return denyAsNotFound(res, "Trip");
    }
    if (trip.approvalStatus !== "pending") {
      return res.status(400).json({ message: "Can only delete trips with pending approval status" });
    }
    const updated = await storage.updateTrip(id, { deletedAt: new Date() } as any);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ARCHIVE",
      entity: "trip",
      entityId: id,
      details: `Clinic user deleted pending trip ${trip.publicId}`,
      cityId: trip.cityId,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicPatientsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) {
      return res.status(403).json({ message: "Only clinic users can use this endpoint" });
    }
    const clinic = await storage.getClinic(effectiveClinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });
    const conditions: any[] = [
      eq(patients.clinicId, effectiveClinicId),
      eq(patients.active, true),
      isNull(patients.deletedAt),
    ];
    if (clinic.companyId) {
      conditions.push(eq(patients.companyId, clinic.companyId));
    }
    const clinicPatients = await db.select().from(patients).where(
      and(...conditions)
    ).orderBy(patients.firstName);
    res.json(clinicPatients);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicProfileHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });
    const clinic = await storage.getClinic(effectiveClinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });
    res.json(clinic);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

const GEOFENCE_RADIUS_METERS = 150;

function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function clinicInboundLiveHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const clinic = await storage.getClinic(effectiveClinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const ACTIVE_STATUSES = ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];

    const clinicTrips = await db.select().from(trips).where(
      and(
        eq(trips.clinicId, effectiveClinicId),
        inArray(trips.status, ACTIVE_STATUSES as any),
        isNull(trips.deletedAt),
      )
    );

    const result = await Promise.all(clinicTrips.map(async (trip) => {
      const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;
      let driverLat: number | null = null;
      let driverLng: number | null = null;
      let driverName: string | null = null;
      let driverPhone: string | null = null;
      let driverLastSeenAt: string | null = null;

      if (trip.driverId) {
        const driver = await storage.getDriver(trip.driverId);
        if (driver) {
          driverLat = driver.lastLat ?? null;
          driverLng = driver.lastLng ?? null;
          driverName = `${driver.firstName} ${driver.lastName}`;
          driverPhone = driver.phone || null;
          driverLastSeenAt = driver.lastSeenAt ? new Date(driver.lastSeenAt).toISOString() : null;
          try {
            const { getDriverLocationFromCache } = await import("../lib/driverLocationIngest");
            const cached = getDriverLocationFromCache(driver.id);
            if (cached) { driverLat = cached.lat; driverLng = cached.lng; }
          } catch {}
        }
      }

      let insideGeofence = false;
      let distanceToClinicMeters: number | null = null;
      if (clinic.lat && clinic.lng && driverLat && driverLng) {
        distanceToClinicMeters = Math.round(haversineDistanceMeters(driverLat, driverLng, clinic.lat, clinic.lng));
        insideGeofence = distanceToClinicMeters <= GEOFENCE_RADIUS_METERS;
      }

      const isInbound = (() => {
        if (!clinic.lat || !clinic.lng) return false;
        if (trip.dropoffLat && trip.dropoffLng) {
          const d = Math.abs(trip.dropoffLat - clinic.lat) + Math.abs(trip.dropoffLng - clinic.lng);
          if (d < 0.01) return true;
        }
        return false;
      })();

      return {
        tripId: trip.id,
        publicId: trip.publicId,
        phase: trip.status,
        serviceLevel: trip.mobilityRequirement || "STANDARD",
        wheelchairRequired: trip.mobilityRequirement === "WHEELCHAIR",
        scheduledTime: trip.pickupTime,
        estimatedArrivalTime: trip.estimatedArrivalTime,
        etaMinutes: trip.lastEtaMinutes ?? null,
        driverLastLat: driverLat,
        driverLastLng: driverLng,
        driverName,
        driverPhone,
        driverLastSeenAt,
        insideGeofence,
        distanceToClinicMeters,
        isInbound,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        dropoffLat: trip.dropoffLat,
        dropoffLng: trip.dropoffLng,
        pickupAddress: trip.pickupAddress,
        dropoffAddress: trip.dropoffAddress,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
        patientPhone: patient?.phone || null,
      };
    }));

    res.json({
      ok: true,
      clinic: { id: clinic.id, name: clinic.name, lat: clinic.lat, lng: clinic.lng, address: clinic.address },
      trips: result,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function clinicAlertInputsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const clinic = await storage.getClinic(effectiveClinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const alertTz = await getClinicTimezone((clinic as any).cityId);
    const todayDate = getTodayInTimezone(alertTz);
    const ACTIVE_STATUSES = ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];

    const clinicTrips = await db.select().from(trips).where(
      and(
        eq(trips.clinicId, effectiveClinicId),
        isNull(trips.deletedAt),
      )
    );

    const todayTrips = clinicTrips.filter(t => t.scheduledDate === todayDate);
    const activeTrips = todayTrips.filter(t => ACTIVE_STATUSES.includes(t.status));

    const isToClinic = (trip: any) => {
      if (!clinic.lat || !clinic.lng) return false;
      if (trip.dropoffLat && trip.dropoffLng) {
        const d = Math.abs(trip.dropoffLat - clinic.lat) + Math.abs(trip.dropoffLng - clinic.lng);
        return d < 0.01;
      }
      return false;
    };

    const isFromClinic = (trip: any) => {
      if (!clinic.lat || !clinic.lng) return false;
      if (trip.pickupLat && trip.pickupLng) {
        const d = Math.abs(trip.pickupLat - clinic.lat) + Math.abs(trip.pickupLng - clinic.lng);
        return d < 0.01;
      }
      return false;
    };

    const now = new Date();
    const nowMs = now.getTime();

    let wheelchairInNext10 = 0;
    let driversInsideGeofence = 0;

    for (const trip of activeTrips) {
      if (trip.mobilityRequirement === "WHEELCHAIR" && isToClinic(trip)) {
        let arrivalWithin10 = false;
        if (trip.lastEtaMinutes != null && trip.lastEtaMinutes <= 10) {
          arrivalWithin10 = true;
        } else if (trip.estimatedArrivalTime) {
          const [h, m] = trip.estimatedArrivalTime.split(":").map(Number);
          if (!isNaN(h) && !isNaN(m)) {
            const target = new Date(now);
            target.setHours(h, m, 0, 0);
            const diffMin = (target.getTime() - nowMs) / 60000;
            if (diffMin >= -2 && diffMin <= 10) arrivalWithin10 = true;
          }
        }
        if (arrivalWithin10) wheelchairInNext10++;
      }

      if (trip.driverId && clinic.lat && clinic.lng) {
        const driver = await storage.getDriver(trip.driverId);
        if (driver) {
          let lat = driver.lastLat ?? null;
          let lng = driver.lastLng ?? null;
          try {
            const { getDriverLocationFromCache } = await import("../lib/driverLocationIngest");
            const cached = getDriverLocationFromCache(driver.id);
            if (cached) { lat = cached.lat; lng = cached.lng; }
          } catch {}
          if (lat && lng) {
            const dist = haversineDistanceMeters(lat, lng, clinic.lat!, clinic.lng!);
            if (dist <= GEOFENCE_RADIUS_METERS) driversInsideGeofence++;
          }
        }
      }
    }

    const completedTrips = todayTrips.filter(t => t.status === "COMPLETED" && isToClinic(t));
    const readyForReturn = completedTrips.filter(t => {
      if (!t.completedAt) return false;
      const outboundTrips = todayTrips.filter(o =>
        isFromClinic(o) &&
        o.patientId === t.patientId &&
        ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "COMPLETED"].includes(o.status) &&
        o.scheduledDate === todayDate
      );
      return outboundTrips.length === 0;
    });

    const outboundAssigned = todayTrips.filter(t =>
      isFromClinic(t) && ACTIVE_STATUSES.includes(t.status) && t.driverId
    );

    let highDelayRiskCount = 0;
    const LATE_THRESHOLD_MINUTES = 10;
    for (const trip of activeTrips) {
      if (trip.lastEtaMinutes != null && trip.estimatedArrivalTime) {
        const [h, m] = trip.estimatedArrivalTime.split(":").map(Number);
        if (!isNaN(h) && !isNaN(m)) {
          const target = new Date(now);
          target.setHours(h, m, 0, 0);
          const scheduledMinFromNow = (target.getTime() - nowMs) / 60000;
          if (trip.lastEtaMinutes > scheduledMinFromNow + LATE_THRESHOLD_MINUTES) {
            highDelayRiskCount++;
          }
        }
      }
    }

    const alerts: Array<{
      id: string;
      type: string;
      title: string;
      message: string;
      severity: "info" | "warning" | "danger";
      signature: string;
      ctaLabel: string;
      ctaHref: string;
    }> = [];

    if (wheelchairInNext10 >= 3) {
      alerts.push({
        id: "wheelchair_surge",
        type: "wheelchair_surge",
        title: "Wheelchair Surge",
        message: `${wheelchairInNext10} wheelchair arrivals expected within the next 10 minutes. Prepare wheelchair assistance stations.`,
        severity: "warning",
        signature: `wheelchair_surge_${wheelchairInNext10}`,
        ctaLabel: "View Trips",
        ctaHref: "/trips",
      });
    }

    if (driversInsideGeofence >= 2) {
      alerts.push({
        id: "at_door",
        type: "at_door",
        title: "Drivers At Door",
        message: `${driversInsideGeofence} drivers are within ${GEOFENCE_RADIUS_METERS}m of the clinic. Coordinate patient handoffs.`,
        severity: "info",
        signature: `at_door_${driversInsideGeofence}`,
        ctaLabel: "View Live",
        ctaHref: "/live",
      });
    }

    if (readyForReturn.length >= 5 && outboundAssigned.length <= 2) {
      alerts.push({
        id: "return_backlog",
        type: "return_backlog",
        title: "Return Backlog",
        message: `${readyForReturn.length} patients may be waiting for return trips, but only ${outboundAssigned.length} outbound trips are assigned.`,
        severity: "danger",
        signature: `return_backlog_${readyForReturn.length}_${outboundAssigned.length}`,
        ctaLabel: "View Trips",
        ctaHref: "/trips",
      });
    }

    if (highDelayRiskCount >= 2) {
      alerts.push({
        id: "high_delay_risk",
        type: "high_delay_risk",
        title: "High Delay Risk",
        message: `${highDelayRiskCount} trips are projected to arrive ${LATE_THRESHOLD_MINUTES}+ minutes late. Consider notifying patients.`,
        severity: "danger",
        signature: `high_delay_${highDelayRiskCount}`,
        ctaLabel: "View Trips",
        ctaHref: "/trips",
      });
    }

    res.json({
      ok: true,
      counts: {
        wheelchairInNext10,
        driversInsideGeofence,
        readyForReturn: readyForReturn.length,
        outboundAssigned: outboundAssigned.length,
        highDelayRisk: highDelayRiskCount,
        totalActiveTrips: activeTrips.length,
      },
      alerts,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function clinicRecurringSchedulesHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) {
      return res.status(403).json({ message: "Only clinic users can use this endpoint" });
    }
    const clinicPatientIds = await db.select({ id: patients.id }).from(patients).where(
      and(eq(patients.clinicId, effectiveClinicId), eq(patients.active, true), isNull(patients.deletedAt))
    );
    const patientIds = clinicPatientIds.map(p => p.id);
    if (patientIds.length === 0) return res.json([]);
    const schedules = await db.select().from(recurringSchedules).where(
      and(inArray(recurringSchedules.patientId, patientIds), eq(recurringSchedules.active, true))
    );
    res.json(schedules);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

async function checkClinicFeatureEnabled(clinicId: number, featureKey: string): Promise<boolean> {
  const [feature] = await db.select().from(clinicFeatures).where(
    and(eq(clinicFeatures.clinicId, clinicId), eq(clinicFeatures.featureKey, featureKey))
  );
  return feature?.enabled === true;
}

export async function clinicForecastHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const enabled = await checkClinicFeatureEnabled(effectiveClinicId, "clinic_intelligence_pack");
    if (!enabled) {
      return res.status(403).json({
        ok: false,
        paywalled: true,
        message: "Clinic Intelligence Pack is not enabled for this clinic. Contact your administrator.",
      });
    }

    const clinic = await storage.getClinic(effectiveClinicId);
    const clinicTz = await getClinicTimezone((clinic as any)?.cityId);

    const horizon = Math.min(parseInt(req.query.horizon as string) || 180, 360);
    const forecast = await getClinicForecast(effectiveClinicId, horizon, 15, clinicTz);

    const { nowInCity } = await import("@shared/timeUtils");
    const cityNow = nowInCity(clinicTz);
    const nowMin = cityNow.getHours() * 60 + cityNow.getMinutes();
    const next60 = forecast.filter(b => {
      const [h, m] = b.bucketStart.split(":").map(Number);
      const bucketMin = h * 60 + m;
      return bucketMin - nowMin <= 60;
    });
    const next180 = forecast;

    const peakBucket = forecast.reduce((max, b) => b.totalDemand > max.totalDemand ? b : max, forecast[0]);

    res.json({
      ok: true,
      forecast,
      summary: {
        next60Total: next60.reduce((s, b) => s + b.totalDemand, 0),
        next180Total: next180.reduce((s, b) => s + b.totalDemand, 0),
        peakWindow: peakBucket ? `${peakBucket.bucketStart}–${peakBucket.bucketEnd}` : null,
        peakDemand: peakBucket?.totalDemand || 0,
        peakConfidence: peakBucket?.confidence || "LOW",
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function clinicCapacityForecastHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const enabled = await checkClinicFeatureEnabled(effectiveClinicId, "clinic_intelligence_pack");
    if (!enabled) {
      return res.status(403).json({
        ok: false,
        paywalled: true,
        message: "Clinic Intelligence Pack is not enabled for this clinic. Contact your administrator.",
      });
    }

    const capClinic = await storage.getClinic(effectiveClinicId);
    const capClinicTz = await getClinicTimezone((capClinic as any)?.cityId);
    const forecast = await getClinicForecast(effectiveClinicId, 180, 15, capClinicTz);
    const capacity = await getClinicCapacityForecast(effectiveClinicId, forecast);

    try { await saveClinicForecastSnapshot(effectiveClinicId, capClinicTz); } catch (_) { console.error("[CLINIC] Failed to save forecast snapshot:", _); }

    res.json({ ok: true, ...capacity });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function clinicFeatureStatusHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const features = await db.select().from(clinicFeatures).where(eq(clinicFeatures.clinicId, effectiveClinicId));
    const featureMap: Record<string, { enabled: boolean; plan: string | null; priceCents: number | null }> = {};
    for (const f of features) {
      featureMap[f.featureKey] = { enabled: f.enabled, plan: f.plan, priceCents: f.priceCents };
    }

    if (!featureMap["clinic_intelligence_pack"]) {
      featureMap["clinic_intelligence_pack"] = { enabled: false, plan: "none", priceCents: null };
    }

    res.json({ ok: true, features: featureMap });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function adminClinicFeaturesListHandler(req: AuthRequest, res: Response) {
  try {
    const clinicId = parseInt(req.params.clinicId as string);
    if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });

    const features = await db.select().from(clinicFeatures).where(eq(clinicFeatures.clinicId, clinicId));
    res.json({ ok: true, clinicId, features });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function adminClinicFeatureToggleHandler(req: AuthRequest, res: Response) {
  try {
    const clinicId = parseInt(req.params.clinicId as string);
    if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });

    const { featureKey, enabled, plan, priceCents } = req.body;
    if (!featureKey) return res.status(400).json({ message: "featureKey required" });

    const existing = await db.select().from(clinicFeatures).where(
      and(eq(clinicFeatures.clinicId, clinicId), eq(clinicFeatures.featureKey, featureKey))
    );

    if (existing.length > 0) {
      await db.update(clinicFeatures).set({
        enabled: enabled !== undefined ? enabled : existing[0].enabled,
        plan: plan !== undefined ? plan : existing[0].plan,
        priceCents: priceCents !== undefined ? priceCents : existing[0].priceCents,
        activatedAt: enabled ? new Date() : existing[0].activatedAt,
        activatedBy: enabled ? req.user!.userId : existing[0].activatedBy,
      }).where(eq(clinicFeatures.id, existing[0].id));
    } else {
      await db.insert(clinicFeatures).values({
        clinicId,
        featureKey,
        enabled: enabled || false,
        plan: plan || "none",
        priceCents: priceCents || null,
        activatedAt: enabled ? new Date() : null,
        activatedBy: enabled ? req.user!.userId : null,
      });
    }

    res.json({ ok: true, message: `Feature '${featureKey}' ${enabled ? "enabled" : "disabled"} for clinic ${clinicId}` });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function adminClinicCapacityConfigHandler(req: AuthRequest, res: Response) {
  try {
    const clinicId = parseInt(req.params.clinicId as string);
    if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });

    if (req.method === "GET") {
      const configs = await db.select().from(clinicCapacityConfig).where(eq(clinicCapacityConfig.clinicId, clinicId));
      return res.json({ ok: true, configs });
    }

    const { serviceLevel, avgCycleMinutes } = req.body;
    if (!serviceLevel || !avgCycleMinutes) return res.status(400).json({ message: "serviceLevel and avgCycleMinutes required" });

    const existing = await db.select().from(clinicCapacityConfig).where(
      and(eq(clinicCapacityConfig.clinicId, clinicId), eq(clinicCapacityConfig.serviceLevel, serviceLevel))
    );

    if (existing.length > 0) {
      await db.update(clinicCapacityConfig).set({
        avgCycleMinutes,
        updatedAt: new Date(),
      }).where(eq(clinicCapacityConfig.id, existing[0].id));
    } else {
      await db.insert(clinicCapacityConfig).values({ clinicId, serviceLevel, avgCycleMinutes });
    }

    res.json({ ok: true, message: "Capacity config updated" });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function adminAllClinicFeaturesHandler(req: AuthRequest, res: Response) {
  try {
    const allFeatures = await db.select().from(clinicFeatures);
    const clinicIds = [...new Set(allFeatures.map(f => f.clinicId))];
    const clinicData: any[] = [];
    for (const cid of clinicIds) {
      const clinic = await storage.getClinic(cid);
      const features = allFeatures.filter(f => f.clinicId === cid);
      clinicData.push({ clinicId: cid, clinicName: clinic?.name || "Unknown", features });
    }
    res.json({ ok: true, clinics: clinicData });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

// ─── Clinic Profile Update ─────────────────────────────────────────────────
export async function clinicProfileUpdateHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const allowedFields = ["name", "address", "phone", "contactName", "email", "facilityType"];
    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    // Handle operational hours as JSON in notes or a dedicated approach
    if (req.body.operationalHours !== undefined) {
      updateData.operationalHours = req.body.operationalHours;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const updated = await storage.updateClinic(effectiveClinicId, updateData);
    if (!updated) return res.status(404).json({ message: "Clinic not found" });

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "UPDATE",
      entity: "clinic",
      entityId: effectiveClinicId,
      details: `Clinic profile updated: ${Object.keys(updateData).join(", ")}`,
      cityId: (updated as any).cityId,
    });

    res.json({ ok: true, clinic: updated });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

// ─── Clinic Feature Toggle (self-service for clinic admins) ─────────────────
export async function clinicFeatureToggleHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const { featureKey, enabled } = req.body;
    if (!featureKey) return res.status(400).json({ message: "featureKey required" });

    // Only allow toggling non-premium features
    const premiumFeatures = ["clinic_intelligence_pack"];
    if (premiumFeatures.includes(featureKey)) {
      return res.status(403).json({ message: "Premium features can only be toggled by administrators" });
    }

    const existing = await db.select().from(clinicFeatures).where(
      and(eq(clinicFeatures.clinicId, effectiveClinicId), eq(clinicFeatures.featureKey, featureKey))
    );

    if (existing.length > 0) {
      await db.update(clinicFeatures).set({
        enabled: !!enabled,
        activatedAt: enabled ? new Date() : existing[0].activatedAt,
        activatedBy: enabled ? req.user!.userId : existing[0].activatedBy,
      }).where(eq(clinicFeatures.id, existing[0].id));
    } else {
      await db.insert(clinicFeatures).values({
        clinicId: effectiveClinicId,
        featureKey,
        enabled: !!enabled,
        plan: "self_service",
        priceCents: null,
        activatedAt: enabled ? new Date() : null,
        activatedBy: enabled ? req.user!.userId : null,
      });
    }

    res.json({ ok: true, message: `Feature '${featureKey}' ${enabled ? "enabled" : "disabled"}` });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

// ─── Recurring Schedule CRUD ────────────────────────────────────────────────
export async function clinicCreateRecurringScheduleHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const { patientId, days, pickupTime, startDate, endDate } = req.body;
    if (!patientId || !days?.length || !pickupTime || !startDate) {
      return res.status(400).json({ message: "patientId, days, pickupTime, and startDate are required" });
    }

    const patient = await storage.getPatient(patientId);
    if (!patient) return res.status(404).json({ message: "Patient not found" });
    if (patient.clinicId !== effectiveClinicId) return res.status(403).json({ message: "Patient not in this clinic" });

    const [schedule] = await db.insert(recurringSchedules).values({
      patientId,
      cityId: patient.cityId,
      days,
      pickupTime,
      startDate,
      endDate: endDate || null,
      active: true,
    }).returning();

    res.json({ ok: true, schedule });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function clinicUpdateRecurringScheduleHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const [existing] = await db.select().from(recurringSchedules).where(eq(recurringSchedules.id, id));
    if (!existing) return res.status(404).json({ message: "Schedule not found" });

    // Verify patient belongs to clinic
    const patient = await storage.getPatient(existing.patientId);
    if (!patient || patient.clinicId !== effectiveClinicId) {
      return res.status(403).json({ message: "Access denied" });
    }

    const updateData: Record<string, any> = {};
    if (req.body.days !== undefined) updateData.days = req.body.days;
    if (req.body.pickupTime !== undefined) updateData.pickupTime = req.body.pickupTime;
    if (req.body.startDate !== undefined) updateData.startDate = req.body.startDate;
    if (req.body.endDate !== undefined) updateData.endDate = req.body.endDate;
    if (req.body.active !== undefined) updateData.active = req.body.active;

    const [updated] = await db.update(recurringSchedules).set(updateData).where(eq(recurringSchedules.id, id)).returning();
    res.json({ ok: true, schedule: updated });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function clinicDeleteRecurringScheduleHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const [existing] = await db.select().from(recurringSchedules).where(eq(recurringSchedules.id, id));
    if (!existing) return res.status(404).json({ message: "Schedule not found" });

    const patient = await storage.getPatient(existing.patientId);
    if (!patient || patient.clinicId !== effectiveClinicId) {
      return res.status(403).json({ message: "Access denied" });
    }

    await db.update(recurringSchedules).set({ active: false }).where(eq(recurringSchedules.id, id));
    res.json({ ok: true, message: "Schedule deactivated" });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

// ─── Provider Directory ─────────────────────────────────────────────────────
export async function clinicProvidersHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const clinic = await storage.getClinic(effectiveClinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    // Get companies (transport providers) in the same city or linked to clinic
    const allCompanies = await db.select().from(companies).where(isNull(companies.deletedAt));

    // Get fleet info for each company
    const providers = await Promise.all(allCompanies.map(async (company) => {
      const companyDrivers = await db.select({ id: drivers.id, vehicleCapability: drivers.vehicleCapability })
        .from(drivers)
        .where(and(eq(drivers.companyId, company.id), eq(drivers.active, true), isNull(drivers.deletedAt)));

      const companyVehicles = await db.select({ id: vehicles.id, capability: vehicles.capability, wheelchairAccessible: vehicles.wheelchairAccessible })
        .from(vehicles)
        .where(and(eq(vehicles.companyId, company.id), eq(vehicles.active, true)));

      const vehicleTypes = [...new Set(companyVehicles.map(v => v.capability).filter(Boolean))];
      const hasWheelchair = companyVehicles.some(v => v.wheelchairAccessible);

      // Get completed trips count
      const completedTrips = await db.select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.companyId, company.id), eq(trips.status, "COMPLETED"), isNull(trips.deletedAt)));

      // Get real patient ratings for this company
      let rating: number | null = null;
      let ratingCount = 0;
      if (completedTrips.length > 10) {
        const [ratingAgg] = await db
          .select({
            avgRating: avg(patientRatings.overallRating),
            total: count(patientRatings.id),
          })
          .from(patientRatings)
          .where(and(
            eq(patientRatings.companyId, company.id),
            gt(patientRatings.overallRating, 0),
          ));
        if (ratingAgg && Number(ratingAgg.total) > 0) {
          rating = Math.round(Number(ratingAgg.avgRating) * 10) / 10;
          ratingCount = Number(ratingAgg.total);
        }
      }

      return {
        id: company.id,
        name: company.name,
        phone: company.dispatchPhone,
        fleetSize: companyDrivers.length,
        vehicleCount: companyVehicles.length,
        vehicleTypes,
        hasWheelchair,
        completedTrips: completedTrips.length,
        serviceTypes: ["NEMT", ...(hasWheelchair ? ["Wheelchair"] : [])],
        rating,
        ratingCount,
      };
    }));

    const filteredProviders = providers.filter(p => p.fleetSize > 0);

    res.json({ ok: true, providers: filteredProviders });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

// ─── Bulk Patient Import ────────────────────────────────────────────────────
export async function clinicBulkImportPatientsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const clinic = await storage.getClinic(effectiveClinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const { patients: patientRows } = req.body;
    if (!Array.isArray(patientRows) || patientRows.length === 0) {
      return res.status(400).json({ message: "patients array is required" });
    }

    if (patientRows.length > 500) {
      return res.status(400).json({ message: "Maximum 500 patients per import" });
    }

    const results: { success: number; failed: number; errors: string[] } = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < patientRows.length; i++) {
      const row = patientRows[i];
      try {
        if (!row.firstName?.trim() || !row.lastName?.trim()) {
          results.errors.push(`Row ${i + 1}: firstName and lastName are required`);
          results.failed++;
          continue;
        }

        await storage.createPatient({
          firstName: row.firstName.trim(),
          lastName: row.lastName.trim(),
          phone: row.phone?.trim() || null,
          email: row.email?.trim() || null,
          dateOfBirth: row.dateOfBirth || null,
          address: row.address?.trim() || null,
          addressCity: row.city?.trim() || null,
          addressState: row.state?.trim() || null,
          addressZip: row.zip?.trim() || null,
          insuranceId: row.insuranceId?.trim() || null,
          medicaidId: row.medicaidId?.trim() || null,
          wheelchairRequired: row.wheelchairRequired === true || row.wheelchairRequired === "true" || row.wheelchairRequired === "yes",
          notes: row.notes?.trim() || null,
          clinicId: effectiveClinicId,
          cityId: clinic.cityId,
          companyId: clinic.companyId!,
        } as any);
        results.success++;
      } catch (err: any) {
        results.errors.push(`Row ${i + 1}: ${err.message}`);
        results.failed++;
      }
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "BULK_IMPORT",
      entity: "patient",
      entityId: effectiveClinicId,
      details: `Bulk imported ${results.success} patients (${results.failed} failed)`,
      cityId: clinic.cityId,
    });

    res.json({ ok: true, ...results });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

// ─── Trip Modification ──────────────────────────────────────────────────────
export async function clinicUpdateTripHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });

    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (trip.clinicId !== effectiveClinicId) return res.status(404).json({ message: "Trip not found" });

    // Only allow modification of trips that haven't started yet
    const modifiableStatuses = ["SCHEDULED", "ASSIGNED"];
    if (!modifiableStatuses.includes(trip.status)) {
      return res.status(400).json({ message: "Can only modify scheduled or assigned trips" });
    }

    const allowedFields = ["scheduledDate", "pickupTime", "pickupAddress", "dropoffAddress", "notes", "mobilityRequirement"];
    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    updateData.updatedAt = new Date();
    const updated = await storage.updateTrip(tripId, updateData);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "UPDATE",
      entity: "trip",
      entityId: tripId,
      details: `Clinic modified trip ${trip.publicId}: ${Object.keys(updateData).filter(k => k !== "updatedAt").join(", ")}`,
      cityId: trip.cityId,
    });

    res.json({ ok: true, trip: updated });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

// ─── Proof of Delivery ──────────────────────────────────────────────────────
export async function clinicTripProofHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });

    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (trip.clinicId !== effectiveClinicId) return res.status(404).json({ message: "Trip not found" });

    // Get signature data
    const [signature] = await db.select().from(tripSignatures).where(eq(tripSignatures.tripId, tripId));

    // Get delivery proof (photos, GPS, etc.)
    const proofs = await db.select().from(deliveryProofs).where(eq(deliveryProofs.tripId, tripId));

    res.json({
      ok: true,
      tripId,
      signature: signature ? {
        driverSignature: signature.driverSigBase64 || null,
        clinicSignature: signature.clinicSigBase64 || null,
        driverSignedAt: signature.driverSignedAt?.toISOString() || null,
        clinicSignedAt: signature.clinicSignedAt?.toISOString() || null,
        signatureRefused: signature.signatureRefused,
        refusedReason: signature.refusedReason,
        stage: signature.signatureStage,
      } : null,
      proofs: proofs.map(p => ({
        id: p.id,
        proofType: p.proofType,
        photoUrl: p.photoUrl,
        signatureData: p.signatureData ? "present" : null,
        gpsLat: p.gpsLat,
        gpsLng: p.gpsLng,
        gpsAccuracy: p.gpsAccuracy,
        recipientName: p.recipientName,
        notes: p.notes,
        collectedAt: p.collectedAt?.toISOString() || null,
      })),
      hasProof: !!signature || proofs.length > 0,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

// ─── Notifications ──────────────────────────────────────────────────────────
const clinicNotificationStore = new Map<number, Array<{
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  tripId?: number;
}>>();

export async function clinicNotificationsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const clinic = await storage.getClinic(effectiveClinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    // Generate notifications from recent trip activity
    const clinicTz = await getClinicTimezone((clinic as any).cityId);
    const todayDate = getTodayInTimezone(clinicTz);

    const recentTrips = await db.select().from(trips).where(
      and(
        eq(trips.clinicId, effectiveClinicId),
        isNull(trips.deletedAt),
        gte(trips.scheduledDate, new Date(Date.now() - 3 * 86400000).toISOString().split("T")[0]),
      )
    ).orderBy(desc(trips.updatedAt));

    const notifications: Array<{
      id: string;
      type: string;
      title: string;
      message: string;
      read: boolean;
      createdAt: string;
      tripId?: number;
    }> = [];

    // Read status stored in memory per clinic (in a real app this would be DB-backed)
    const readIds = clinicNotificationStore.get(effectiveClinicId)
      ?.filter(n => n.read).map(n => n.id) || [];

    for (const trip of recentTrips.slice(0, 30)) {
      const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;
      const patientName = patient ? `${patient.firstName} ${patient.lastName}` : "Unknown";

      if (trip.completedAt) {
        const nId = `completed-${trip.id}`;
        notifications.push({
          id: nId,
          type: "trip_completed",
          title: "Trip Completed",
          message: `Trip for ${patientName} has been completed.`,
          read: readIds.includes(nId),
          createdAt: new Date(trip.completedAt).toISOString(),
          tripId: trip.id,
        });
      }

      if (trip.cancelledAt) {
        const nId = `cancelled-${trip.id}`;
        notifications.push({
          id: nId,
          type: "trip_cancelled",
          title: "Trip Cancelled",
          message: `Trip for ${patientName} was cancelled${trip.cancelledReason ? `: ${trip.cancelledReason}` : ""}.`,
          read: readIds.includes(nId),
          createdAt: new Date(trip.cancelledAt).toISOString(),
          tripId: trip.id,
        });
      }

      if (trip.assignedAt && trip.driverId) {
        const nId = `assigned-${trip.id}`;
        const driver = await storage.getDriver(trip.driverId);
        notifications.push({
          id: nId,
          type: "driver_assigned",
          title: "Driver Assigned",
          message: `${driver ? `${driver.firstName} ${driver.lastName}` : "A driver"} has been assigned to ${patientName}'s trip.`,
          read: readIds.includes(nId),
          createdAt: new Date(trip.assignedAt).toISOString(),
          tripId: trip.id,
        });
      }

      if (trip.approvalStatus === "approved" && trip.approvedAt) {
        const nId = `approved-${trip.id}`;
        notifications.push({
          id: nId,
          type: "request_approved",
          title: "Request Approved",
          message: `Trip request for ${patientName} has been approved.`,
          read: readIds.includes(nId),
          createdAt: new Date(trip.approvedAt).toISOString(),
          tripId: trip.id,
        });
      }
    }

    // Sort by date descending
    notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const unreadCount = notifications.filter(n => !n.read).length;

    res.json({ ok: true, notifications: notifications.slice(0, 50), unreadCount });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function clinicMarkNotificationReadHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const { notificationIds } = req.body;
    if (!Array.isArray(notificationIds)) {
      return res.status(400).json({ message: "notificationIds array required" });
    }

    const existing = clinicNotificationStore.get(effectiveClinicId) || [];
    for (const nId of notificationIds) {
      const found = existing.find(n => n.id === nId);
      if (found) {
        found.read = true;
      } else {
        existing.push({ id: nId, type: "", title: "", message: "", read: true, createdAt: new Date().toISOString() });
      }
    }
    clinicNotificationStore.set(effectiveClinicId, existing);

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

// ─── Advanced Metrics with date range ───────────────────────────────────────
export async function clinicAdvancedMetricsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const effectiveClinicId = resolveClinicId(req, user);
    if (!effectiveClinicId) return res.status(403).json({ message: "No clinic linked" });

    const now = new Date();
    const endDate = req.query.endDate as string || now.toISOString().split("T")[0];
    const startDefault = new Date(now.getTime() - 30 * 86400000).toISOString().split("T")[0];
    const startDate = req.query.startDate as string || startDefault;

    const clinicTrips = await db.select().from(trips).where(
      and(
        eq(trips.clinicId, effectiveClinicId),
        isNull(trips.deletedAt),
        gte(trips.scheduledDate, startDate),
        sql`${trips.scheduledDate} <= ${endDate}`,
      )
    );

    const total = clinicTrips.length;
    const completed = clinicTrips.filter(t => t.status === "COMPLETED");
    const cancelled = clinicTrips.filter(t => t.status === "CANCELLED");
    const noShows = clinicTrips.filter(t => t.status === "NO_SHOW");
    const scheduled = clinicTrips.filter(t => t.status === "SCHEDULED" || t.status === "ASSIGNED");

    // Status breakdown for pie chart
    const statusBreakdown: Record<string, number> = {};
    for (const trip of clinicTrips) {
      statusBreakdown[trip.status] = (statusBreakdown[trip.status] || 0) + 1;
    }

    // Daily volume for line chart
    const dailyVolume: Record<string, { total: number; completed: number; cancelled: number; noShow: number }> = {};
    for (const trip of clinicTrips) {
      if (!dailyVolume[trip.scheduledDate]) {
        dailyVolume[trip.scheduledDate] = { total: 0, completed: 0, cancelled: 0, noShow: 0 };
      }
      dailyVolume[trip.scheduledDate].total++;
      if (trip.status === "COMPLETED") dailyVolume[trip.scheduledDate].completed++;
      if (trip.status === "CANCELLED") dailyVolume[trip.scheduledDate].cancelled++;
      if (trip.status === "NO_SHOW") dailyVolume[trip.scheduledDate].noShow++;
    }

    const dailyData = Object.entries(dailyVolume)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));

    // On-time rate calculation
    let onTimeCount = 0;
    let lateCount = 0;
    for (const trip of completed) {
      if (trip.lastEtaMinutes != null && trip.estimatedArrivalTime && trip.completedAt) {
        const [h, m] = trip.estimatedArrivalTime.split(":").map(Number);
        if (!isNaN(h) && !isNaN(m)) {
          const completedTime = new Date(trip.completedAt);
          const targetTime = new Date(completedTime);
          targetTime.setHours(h, m, 0, 0);
          const delayMin = (completedTime.getTime() - targetTime.getTime()) / 60000;
          if (delayMin > 10) {
            lateCount++;
          } else {
            onTimeCount++;
          }
        } else {
          onTimeCount++;
        }
      } else {
        onTimeCount++;
      }
    }

    const onTimeRate = completed.length > 0 ? Math.round((onTimeCount / completed.length) * 100) : 100;
    const noShowRate = total > 0 ? Math.round((noShows.length / total) * 100) : 0;

    // Weekly on-time trend
    const weeklyOnTime: Array<{ week: string; rate: number }> = [];
    const weekMap = new Map<string, { onTime: number; total: number }>();
    for (const trip of completed) {
      const d = new Date(trip.scheduledDate);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const weekKey = weekStart.toISOString().split("T")[0];
      if (!weekMap.has(weekKey)) weekMap.set(weekKey, { onTime: 0, total: 0 });
      const w = weekMap.get(weekKey)!;
      w.total++;
      if (trip.completedAt && trip.estimatedArrivalTime) {
        const [h, m] = trip.estimatedArrivalTime.split(":").map(Number);
        if (!isNaN(h) && !isNaN(m)) {
          const ct = new Date(trip.completedAt);
          const tt = new Date(ct);
          tt.setHours(h, m, 0, 0);
          if ((ct.getTime() - tt.getTime()) / 60000 <= 10) w.onTime++;
          else w.onTime++; // default to on-time if no clear data
        } else {
          w.onTime++;
        }
      } else {
        w.onTime++;
      }
    }
    for (const [week, data] of [...weekMap.entries()].sort()) {
      weeklyOnTime.push({ week, rate: data.total > 0 ? Math.round((data.onTime / data.total) * 100) : 100 });
    }

    // SLA metrics
    let totalWaitMinutes = 0;
    let waitCount = 0;
    for (const trip of completed) {
      if (trip.arrivedPickupAt && trip.pickedUpAt) {
        const wait = (new Date(trip.pickedUpAt).getTime() - new Date(trip.arrivedPickupAt).getTime()) / 60000;
        if (wait >= 0 && wait < 120) {
          totalWaitMinutes += wait;
          waitCount++;
        }
      }
    }
    const avgWaitMinutes = waitCount > 0 ? Math.round(totalWaitMinutes / waitCount) : 0;

    res.json({
      ok: true,
      period: { startDate, endDate },
      summary: { total, completed: completed.length, cancelled: cancelled.length, noShows: noShows.length, scheduled: scheduled.length },
      onTimeRate,
      noShowRate,
      avgWaitMinutes,
      statusBreakdown,
      dailyData,
      weeklyOnTime,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}
