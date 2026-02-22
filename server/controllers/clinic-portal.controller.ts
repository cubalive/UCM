import type { Response } from "express";
import { storage } from "../storage";
import { type AuthRequest } from "../auth";
import { db } from "../db";
import { trips, patients, recurringSchedules, driverOffers, clinicFeatures, clinicCapacityConfig } from "@shared/schema";
import { eq, and, isNull, inArray, desc, gte, sql, or } from "drizzle-orm";
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
    if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const clinic = await storage.getClinic(user.clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const todayDate = new Date().toISOString().split("T")[0];
    const PRESENCE_TIMEOUT = 120_000;
    const LATE_THRESHOLD_MINUTES = 10;

    const clinicTrips = await db.select().from(trips).where(
      and(eq(trips.clinicId, user.clinicId), isNull(trips.deletedAt))
    );

    const todayTrips = clinicTrips.filter(t => t.scheduledDate === todayDate);
    const activeStatuses = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];
    const mapVisibleStatuses = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF"];
    const activeTrips = todayTrips.filter(t => activeStatuses.includes(t.status));

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

    const lateRisk = todayTrips.filter(t => {
      if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(t.status)) return false;
      if (t.lastEtaMinutes != null && t.estimatedArrivalTime) {
        const [h, m] = t.estimatedArrivalTime.split(":").map(Number);
        const now = new Date();
        const arrivalTarget = new Date(now);
        arrivalTarget.setHours(h, m, 0, 0);
        const scheduledMinutesFromNow = (arrivalTarget.getTime() - now.getTime()) / 60000;
        if (t.lastEtaMinutes > scheduledMinutesFromNow + LATE_THRESHOLD_MINUTES) return true;
      }
      if (t.noShowRisk) return true;
      return false;
    });

    const noDriverAssigned = todayTrips.filter(t =>
      !t.driverId && !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(t.status)
    );
    const completedToday = todayTrips.filter(t => t.status === "COMPLETED");
    const noShowsToday = todayTrips.filter(t => t.status === "NO_SHOW");

    const clinicPatientIds = await db.select({ id: patients.id }).from(patients).where(
      and(eq(patients.clinicId, user.clinicId), eq(patients.active, true), isNull(patients.deletedAt))
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
      kpis: {
        enRouteToClinic: enRouteToClinic.length,
        leavingClinic: leavingClinic.length,
        arrivalsNext60: arrivalsNext60.length,
        lateRisk: lateRisk.length,
        noDriverAssigned: noDriverAssigned.length,
        completedToday: completedToday.length,
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
    if (user.role !== "CLINIC_USER") return res.status(403).json({ message: "Access denied: clinic users only" });
    if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const clinic = await storage.getClinic(user.clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const ACTIVE_STATUSES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF"];
    const STALE_THRESHOLD_MS = 90 * 1000;

    const clinicTrips = await db.select().from(trips).where(
      and(
        eq(trips.clinicId, user.clinicId),
        inArray(trips.status, ACTIVE_STATUSES as any),
        isNull(trips.deletedAt),
      )
    );

    const result = await Promise.all(clinicTrips.map(async (trip) => {
      const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;
      let driverData: any = null;
      let driverStale = false;
      let driverLastLat: number | null = null;
      let driverLastLng: number | null = null;
      let driverLastSeenAt: string | null = null;

      if (trip.driverId) {
        const driver = await storage.getDriver(trip.driverId);
        if (driver) {
          driverLastLat = driver.lastLat ?? null;
          driverLastLng = driver.lastLng ?? null;
          try {
            const { getDriverLocationFromCache } = await import("../lib/driverLocationIngest");
            const cached = getDriverLocationFromCache(driver.id);
            if (cached) { driverLastLat = cached.lat; driverLastLng = cached.lng; }
          } catch {}
          driverLastSeenAt = driver.lastSeenAt ? new Date(driver.lastSeenAt).toISOString() : null;
          const lastSeenMs = driver.lastSeenAt ? Date.now() - new Date(driver.lastSeenAt).getTime() : Infinity;
          driverStale = lastSeenMs > STALE_THRESHOLD_MS;
          const vehicle = driver.vehicleId ? await storage.getVehicle(driver.vehicleId) : null;
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
          try {
            const { googleDistanceMatrix } = await import("../lib/googleMaps");
            const dmResult = await googleDistanceMatrix(
              { lat: driverLastLat, lng: driverLastLng },
              [{ lat: clinic.lat, lng: clinic.lng }]
            );
            const el = dmResult.elements[0];
            if (el && el.status === "OK") {
              etaToClinic = Math.round(el.durationSeconds / 60);
            } else {
              const dist = haversineDistanceMiles(driverLastLat, driverLastLng, clinic.lat, clinic.lng);
              etaToClinic = Math.round((dist / 25) * 60);
            }
            etaUpdatedAt = new Date().toISOString();
            etaStale = false;
            clinicEtaCache.set(trip.id, { eta: etaToClinic, stale: false, updatedAt: etaUpdatedAt });
          } catch {
            const dist = haversineDistanceMiles(driverLastLat, driverLastLng, clinic.lat, clinic.lng);
            etaToClinic = Math.round((dist / 25) * 60);
            etaUpdatedAt = new Date().toISOString();
            etaStale = false;
            clinicEtaCache.set(trip.id, { eta: etaToClinic, stale: false, updatedAt: etaUpdatedAt });
          }
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

export async function clinicMetricsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const now = new Date();
    const endDate = req.query.endDate as string || now.toISOString().split("T")[0];
    const startDefault = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];
    const startDate = req.query.startDate as string || startDefault;

    const clinicTrips = await db.select().from(trips).where(
      and(
        eq(trips.clinicId, user.clinicId),
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
    if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const CLINIC_MAP_STATUSES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF"];
    const PRESENCE_TIMEOUT = 120_000;

    const clinicTrips = await db.select().from(trips).where(
      and(
        eq(trips.clinicId, user.clinicId),
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
    if (!user || !user.clinicId) {
      return res.status(403).json({ message: "No clinic linked to this account" });
    }

    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: "startDate and endDate query params required (YYYY-MM-DD)" });
    }

    const conditions: any[] = [
      eq(trips.clinicId, user.clinicId),
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
    if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const statusFilter = (req.query.status as string || "active").toLowerCase();
    const conditions: any[] = [
      eq(trips.clinicId, user.clinicId),
      isNull(trips.deletedAt),
    ];

    if (statusFilter === "today") {
      const todayDate = new Date().toISOString().split("T")[0];
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
      conditions.push(inArray(trips.status, ["COMPLETED", "CANCELLED", "NO_SHOW"]));
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
    if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (trip.clinicId !== user.clinicId) return res.status(404).json({ message: "Trip not found" });

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
    if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (trip.clinicId !== user.clinicId) return res.status(404).json({ message: "Trip not found" });

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
    if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

    const tripId = parseInt(String(req.params.id));
    if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
    const trip = await storage.getTrip(tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (trip.clinicId !== user.clinicId) {
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

    if (!user.clinicId) {
      return res.status(403).json({ message: "No clinic linked to this account" });
    }

    const clinicInvoices = await storage.getInvoices(user.clinicId);
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

    if (!user.clinicId || user.clinicId !== invoice.clinicId) {
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
    if (!user || (user.role !== "VIEWER" && user.role !== "CLINIC_USER") || !user.clinicId) {
      return res.status(403).json({ message: "Only clinic users can use this endpoint" });
    }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const patient = await storage.getPatient(id);
    if (!patient) return res.status(404).json({ message: "Patient not found" });
    if (patient.clinicId !== user.clinicId) {
      return denyAsNotFound(res, "Patient");
    }
    const clinic = await storage.getClinic(user.clinicId);
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
    if (!user || (user.role !== "VIEWER" && user.role !== "CLINIC_USER") || !user.clinicId) {
      return res.status(403).json({ message: "Only clinic users can use this endpoint" });
    }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (trip.clinicId !== user.clinicId) {
      return denyAsNotFound(res, "Trip");
    }
    const clinic = await storage.getClinic(user.clinicId);
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
    if (!user || (user.role !== "VIEWER" && user.role !== "CLINIC_USER") || !user.clinicId) {
      return res.status(403).json({ message: "Only clinic users can use this endpoint" });
    }
    const clinic = await storage.getClinic(user.clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });
    const conditions: any[] = [
      eq(patients.clinicId, user.clinicId),
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
    if (!user || !user.clinicId) return res.status(403).json({ message: "No clinic linked" });
    const clinic = await storage.getClinic(user.clinicId);
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
    if (!user.clinicId) return res.status(403).json({ message: "No clinic linked" });

    const clinic = await storage.getClinic(user.clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const ACTIVE_STATUSES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];

    const clinicTrips = await db.select().from(trips).where(
      and(
        eq(trips.clinicId, user.clinicId),
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
    if (!user.clinicId) return res.status(403).json({ message: "No clinic linked" });

    const clinic = await storage.getClinic(user.clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const todayDate = new Date().toISOString().split("T")[0];
    const ACTIVE_STATUSES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];

    const clinicTrips = await db.select().from(trips).where(
      and(
        eq(trips.clinicId, user.clinicId),
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
    if (!user || (user.role !== "VIEWER" && user.role !== "CLINIC_USER") || !user.clinicId) {
      return res.status(403).json({ message: "Only clinic users can use this endpoint" });
    }
    const clinicPatientIds = await db.select({ id: patients.id }).from(patients).where(
      and(eq(patients.clinicId, user.clinicId), eq(patients.active, true), isNull(patients.deletedAt))
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
    if (!user?.clinicId) return res.status(403).json({ message: "No clinic linked" });

    const enabled = await checkClinicFeatureEnabled(user.clinicId, "clinic_intelligence_pack");
    if (!enabled) {
      return res.status(403).json({
        ok: false,
        paywalled: true,
        message: "Clinic Intelligence Pack is not enabled for this clinic. Contact your administrator.",
      });
    }

    const horizon = Math.min(parseInt(req.query.horizon as string) || 180, 360);
    const forecast = await getClinicForecast(user.clinicId, horizon);

    const next60 = forecast.filter(b => {
      const [h, m] = b.bucketStart.split(":").map(Number);
      const now = new Date();
      const bucketMin = h * 60 + m;
      const nowMin = now.getHours() * 60 + now.getMinutes();
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
    if (!user?.clinicId) return res.status(403).json({ message: "No clinic linked" });

    const enabled = await checkClinicFeatureEnabled(user.clinicId, "clinic_intelligence_pack");
    if (!enabled) {
      return res.status(403).json({
        ok: false,
        paywalled: true,
        message: "Clinic Intelligence Pack is not enabled for this clinic. Contact your administrator.",
      });
    }

    const forecast = await getClinicForecast(user.clinicId);
    const capacity = await getClinicCapacityForecast(user.clinicId, forecast);

    try { await saveClinicForecastSnapshot(user.clinicId); } catch (_) {}

    res.json({ ok: true, ...capacity });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function clinicFeatureStatusHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.clinicId) return res.status(403).json({ message: "No clinic linked" });

    const features = await db.select().from(clinicFeatures).where(eq(clinicFeatures.clinicId, user.clinicId));
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
