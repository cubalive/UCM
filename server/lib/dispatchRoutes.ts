import type { Express } from "express";
import { storage } from "../storage";
import { authMiddleware, requireRole, getCompanyIdFromAuth, checkCompanyOwnership, type AuthRequest } from "../auth";
import { etaMinutes } from "./googleMaps";
import { z } from "zod";
import { GOOGLE_MAPS_SERVER_KEY } from "../../lib/mapsConfig";
const GOOGLE_MAPS_KEY = GOOGLE_MAPS_SERVER_KEY;
import { autoNotifyPatient } from "./dispatchAutoSms";
import { tripLockedGuard } from "./tripLockGuard";
import { isDriverOnline, isDriverVisibleOnMap, isDriverAssignable, classifyDrivers } from "./driverClassification";

const assignDriverVehicleSchema = z.object({
  driver_id: z.number().int().positive(),
  vehicle_id: z.number().int().positive(),
});

const assignTripSchema = z.object({
  trip_id: z.number().int().positive(),
  driver_id: z.number().int().positive(),
});

const autoAssignSchema = z.object({
  city_id: z.number().int().positive(),
});

const driverStatusSchema = z.object({
  driver_id: z.number().int().positive(),
  status: z.enum(["available", "enroute", "off", "hold"]),
});

const driverLocationSchema = z.object({
  driver_id: z.number().int().positive(),
  lat: z.number(),
  lng: z.number(),
});

const reassignSchema = z.object({
  new_driver_id: z.number().int().positive(),
  reason: z.string().optional().default("readiness_escalation"),
});

const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW"];

export interface ReassignCandidate {
  id: number;
  name: string;
  publicId: string;
  phone: string;
  dispatch_status: string;
  vehicle_name: string | null;
  vehicle_id: number | null;
  distance_miles: number | null;
  has_active_trip: boolean;
  score: number;
}

export function scoreReassignCandidates(
  drivers: any[],
  activeTripsMap: Map<number, any>,
  vehicleMap: Map<number, any>,
  pickupLat: number | null,
  pickupLng: number | null,
  tripCityId: number,
): ReassignCandidate[] {
  const candidates: ReassignCandidate[] = [];

  for (const d of drivers) {
    if (!d.active || d.deletedAt || d.status !== "ACTIVE") continue;
    if (d.cityId !== tripCityId) continue;

    const assignCheck = isDriverAssignable(d);
    if (!assignCheck.ok) continue;

    if (d.dispatchStatus !== "available" && d.dispatchStatus !== "enroute") continue;

    if (!d.vehicleId) continue;

    const hasActiveTrip = activeTripsMap.has(d.id);
    const vehicle = d.vehicleId ? vehicleMap.get(d.vehicleId) : null;

    let distanceMiles: number | null = null;
    if (pickupLat != null && pickupLng != null && d.lastLat != null && d.lastLng != null) {
      distanceMiles = haversineDistance(d.lastLat, d.lastLng, pickupLat, pickupLng);
    }

    let score = 0;
    if (d.dispatchStatus === "available") score += 50;
    if (!hasActiveTrip) score += 30;
    if (distanceMiles != null) {
      score += Math.max(0, 20 - distanceMiles * 2);
    }

    candidates.push({
      id: d.id,
      name: `${d.firstName} ${d.lastName}`,
      publicId: d.publicId,
      phone: d.phone,
      dispatch_status: d.dispatchStatus,
      vehicle_name: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
      vehicle_id: d.vehicleId,
      distance_miles: distanceMiles != null ? Math.round(distanceMiles * 10) / 10 : null,
      has_active_trip: hasActiveTrip,
      score,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 5);
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function calculateAndStoreEta(tripId: number, driverLat: number | null, driverLng: number | null, pickupLat: number | null, pickupLng: number | null, pickupAddress: string, dropoffAddress: string) {
  try {
    if (!GOOGLE_MAPS_KEY) return null;

    const origin = (driverLat && driverLng)
      ? { lat: driverLat, lng: driverLng }
      : pickupAddress;

    const destination = dropoffAddress;

    const eta = await etaMinutes(origin, destination);

    await storage.updateTrip(tripId, {
      lastEtaMinutes: eta.minutes,
      distanceMiles: eta.distanceMiles.toString(),
      durationMinutes: eta.minutes,
      lastEtaUpdatedAt: new Date(),
    } as any);

    return eta;
  } catch (err: any) {
    console.warn(`ETA calculation failed for trip ${tripId}: ${err.message}`);
    return null;
  }
}

export function registerDispatchRoutes(app: Express) {

  app.post("/api/dispatch/assign-driver-vehicle",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const parsed = assignDriverVehicleSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }

        const { driver_id, vehicle_id } = parsed.data;

        const driver = await storage.getDriver(driver_id);
        if (!driver) return res.status(404).json({ message: "Driver not found" });
        const companyId = getCompanyIdFromAuth(req);
        if (!checkCompanyOwnership(driver, companyId)) return res.status(403).json({ message: "Access denied" });

        const vehicle = await storage.getVehicle(vehicle_id);
        if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
        if (!checkCompanyOwnership(vehicle, companyId)) return res.status(403).json({ message: "Access denied" });

        if (driver.cityId !== vehicle.cityId) {
          return res.status(400).json({ message: "Driver and vehicle must belong to the same city" });
        }

        if (vehicle.status !== "ACTIVE") {
          return res.status(400).json({ message: `Vehicle is ${vehicle.status}, must be ACTIVE` });
        }

        const existing = await storage.getDriverByVehicleId(vehicle_id, driver_id);
        if (existing) {
          return res.status(409).json({
            message: `Vehicle already assigned to driver ${existing.firstName} ${existing.lastName} (${existing.publicId})`,
          });
        }

        const updatedDriver = await storage.updateDriver(driver_id, { vehicleId: vehicle_id });

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "ASSIGN_VEHICLE",
          entity: "driver",
          entityId: driver_id,
          details: `Assigned vehicle ${vehicle.publicId} to driver ${driver.publicId}`,
          cityId: driver.cityId,
        });

        res.json({ driver: updatedDriver, vehicle });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/dispatch/assign-trip",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const parsed = assignTripSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }

        const { trip_id, driver_id } = parsed.data;

        const trip = await storage.getTrip(trip_id);
        if (!trip) return res.status(404).json({ message: "Trip not found" });
        const companyId = getCompanyIdFromAuth(req);
        if (!checkCompanyOwnership(trip, companyId)) return res.status(403).json({ message: "Access denied" });

        if (tripLockedGuard(trip, req, res)) return;

        const driver = await storage.getDriver(driver_id);
        if (!driver) return res.status(404).json({ message: "Driver not found" });
        if (!checkCompanyOwnership(driver, companyId)) return res.status(403).json({ message: "Access denied" });

        if (driver.status !== "ACTIVE") {
          return res.status(400).json({ message: `Driver status is ${driver.status}, must be ACTIVE` });
        }

        if (!driver.vehicleId) {
          return res.status(400).json({ message: "Driver has no vehicle assigned. Assign a vehicle first." });
        }

        if (trip.cityId !== driver.cityId) {
          return res.status(400).json({ message: "Trip and driver must belong to the same city" });
        }

        const vehicle = await storage.getVehicle(driver.vehicleId);
        if (!vehicle) {
          return res.status(400).json({ message: "Assigned vehicle not found" });
        }

        if (vehicle.cityId !== driver.cityId) {
          return res.status(400).json({ message: "Driver and vehicle must belong to the same city/base" });
        }

        if (vehicle.cityId !== trip.cityId) {
          return res.status(400).json({ message: "Vehicle must belong to the same city as the trip" });
        }

        const patient = await storage.getPatient(trip.patientId);
        if (patient?.wheelchairRequired && !vehicle.wheelchairAccessible) {
          return res.status(400).json({
            message: "Patient requires wheelchair accessibility but assigned vehicle does not support it",
          });
        }

        const updatedTrip = await storage.updateTrip(trip_id, {
          driverId: driver_id,
          vehicleId: driver.vehicleId,
          status: "ASSIGNED",
          fiveMinAlertSent: false,
        } as any);

        await storage.updateDriver(driver_id, { dispatchStatus: "enroute" } as any);

        const eta = await calculateAndStoreEta(
          trip_id,
          driver.lastLat,
          driver.lastLng,
          trip.pickupLat,
          trip.pickupLng,
          trip.pickupAddress,
          trip.dropoffAddress
        );

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "ASSIGN_TRIP",
          entity: "trip",
          entityId: trip_id,
          details: `Assigned driver ${driver.publicId} to trip ${trip.publicId}${eta ? ` (ETA: ${eta.minutes}min, ${eta.distanceMiles}mi)` : ""}`,
          cityId: trip.cityId,
        });

        autoNotifyPatient(trip_id, "driver_assigned");

        const finalTrip = await storage.getTrip(trip_id);
        res.json({
          trip: finalTrip,
          driver,
          vehicle,
          eta: eta || null,
        });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/dispatch/auto-assign",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const parsed = autoAssignSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }

        const { city_id } = parsed.data;

        const city = await storage.getCity(city_id);
        if (!city) return res.status(404).json({ message: "City not found" });

        const companyIdAA = getCompanyIdFromAuth(req);
        const { applyCompanyFilter: acf } = await import("../auth");
        const rawUnassignedTrips = await storage.getUnassignedTrips(city_id);
        const unassignedTrips = acf(rawUnassignedTrips, companyIdAA);
        if (unassignedTrips.length === 0) {
          return res.json({ assigned: 0, skipped: 0, message: "No unassigned trips" });
        }

        const rawAllDrivers = await storage.getDrivers(city_id);
        const allDrivers = acf(rawAllDrivers, companyIdAA);
        const availableDrivers = allDrivers.filter(
          (d) => d.status === "ACTIVE" &&
            d.dispatchStatus === "available" &&
            d.vehicleId &&
            d.lastLat && d.lastLng
        );

        if (availableDrivers.length === 0) {
          return res.json({ assigned: 0, skipped: unassignedTrips.length, message: "No available drivers with location" });
        }

        let assigned = 0;
        let skipped = 0;
        const usedDriverIds = new Set<number>();

        for (const trip of unassignedTrips) {
          if (!trip.pickupLat || !trip.pickupLng) {
            skipped++;
            continue;
          }

          const candidates = availableDrivers
            .filter((d) => !usedDriverIds.has(d.id))
            .map((d) => ({
              driver: d,
              distance: haversineDistance(d.lastLat!, d.lastLng!, trip.pickupLat!, trip.pickupLng!),
            }))
            .sort((a, b) => a.distance - b.distance);

          if (candidates.length === 0) {
            skipped++;
            continue;
          }

          const best = candidates[0];
          const vehicle = await storage.getVehicle(best.driver.vehicleId!);

          if (!vehicle || vehicle.cityId !== city_id) {
            skipped++;
            continue;
          }

          const patient = await storage.getPatient(trip.patientId);
          if (patient?.wheelchairRequired && !vehicle.wheelchairAccessible) {
            skipped++;
            continue;
          }

          await storage.updateTrip(trip.id, {
            driverId: best.driver.id,
            vehicleId: best.driver.vehicleId,
            status: "ASSIGNED",
            fiveMinAlertSent: false,
          } as any);

          await storage.updateDriver(best.driver.id, { dispatchStatus: "enroute" } as any);
          usedDriverIds.add(best.driver.id);

          await calculateAndStoreEta(
            trip.id,
            best.driver.lastLat,
            best.driver.lastLng,
            trip.pickupLat,
            trip.pickupLng,
            trip.pickupAddress,
            trip.dropoffAddress
          );

          assigned++;
        }

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "AUTO_ASSIGN",
          entity: "dispatch",
          entityId: null,
          details: `Auto-assigned ${assigned} trips, skipped ${skipped} in city ${city.name}`,
          cityId: city_id,
        });

        res.json({ assigned, skipped });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/drivers/status",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "DRIVER"),
    async (req: AuthRequest, res) => {
      try {
        const parsed = driverStatusSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }

        const { driver_id, status } = parsed.data;

        const driver = await storage.getDriver(driver_id);
        if (!driver) return res.status(404).json({ message: "Driver not found" });
        const companyId2 = getCompanyIdFromAuth(req);
        if (!checkCompanyOwnership(driver, companyId2)) return res.status(403).json({ message: "Access denied" });

        const updatedDriver = await storage.updateDriver(driver_id, { dispatchStatus: status } as any);

        if (status === "enroute") {
          const allTrips = await storage.getTrips(driver.cityId);
          const activeTrip = allTrips.find(
            (t) => t.driverId === driver_id && t.status === "ASSIGNED"
          );
          if (activeTrip) {
            let etaMins: number | null = null;
            if (driver.lastLat && driver.lastLng && activeTrip.pickupLat && activeTrip.pickupLng) {
              try {
                const eta = await etaMinutes(
                  { lat: driver.lastLat, lng: driver.lastLng },
                  { lat: activeTrip.pickupLat, lng: activeTrip.pickupLng }
                );
                if (eta) etaMins = eta.minutes;
              } catch {}
            }
            autoNotifyPatient(activeTrip.id, "en_route", { eta_minutes: etaMins });
          }
        }

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "DRIVER_STATUS",
          entity: "driver",
          entityId: driver_id,
          details: `Driver ${driver.publicId} status changed to ${status}`,
          cityId: driver.cityId,
        });

        res.json(updatedDriver);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/drivers/location",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "DRIVER"),
    async (req: AuthRequest, res) => {
      try {
        const parsed = driverLocationSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body" });
        }

        const { driver_id, lat, lng } = parsed.data;

        const driver = await storage.getDriver(driver_id);
        if (!driver) return res.status(404).json({ message: "Driver not found" });
        const companyId3 = getCompanyIdFromAuth(req);
        if (!checkCompanyOwnership(driver, companyId3)) return res.status(403).json({ message: "Access denied" });

        const updatedDriver = await storage.updateDriver(driver_id, {
          lastLat: lat,
          lastLng: lng,
          lastSeenAt: new Date(),
        } as any);

        res.json(updatedDriver);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/dispatch/drivers/status",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const cityId = req.query.city_id ? parseInt(req.query.city_id as string) : undefined;
        const companyId = getCompanyIdFromAuth(req);
        const { applyCompanyFilter } = await import("../auth");

        const rawDrivers = await storage.getDrivers(cityId);
        const allDrivers = applyCompanyFilter(rawDrivers, companyId).filter(
          (d) => d.active && !d.deletedAt && d.status === "ACTIVE"
        );

        const rawTrips = await storage.getTrips(cityId);
        const allTrips = applyCompanyFilter(rawTrips, companyId);
        const TERMINAL = ["COMPLETED", "CANCELLED", "NO_SHOW"];
        const activeTripsMap = new Map<number, any>();
        for (const t of allTrips) {
          if (t.driverId && !TERMINAL.includes(t.status)) {
            if (!activeTripsMap.has(t.driverId)) {
              activeTripsMap.set(t.driverId, t);
            }
          }
        }

        const rawVehicles = await storage.getVehicles(cityId);
        const vehicleMap = new Map(rawVehicles.map((v) => [v.id, v]));

        const groups = classifyDrivers(allDrivers, activeTripsMap, vehicleMap);

        res.json(groups);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/dispatch/map-data",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;

        const companyId = getCompanyIdFromAuth(req);
        const [rawDrivers, rawTrips, rawVehicles, rawClinics] = await Promise.all([
          storage.getDrivers(cityId),
          storage.getTrips(cityId),
          storage.getVehicles(cityId),
          storage.getClinics(cityId),
        ]);

        const { applyCompanyFilter } = await import("../auth");
        const allDrivers = applyCompanyFilter(rawDrivers, companyId);
        const allTrips = applyCompanyFilter(rawTrips, companyId);
        const allVehicles = applyCompanyFilter(rawVehicles, companyId);
        const allClinics = applyCompanyFilter(rawClinics, companyId);

        const activeTrips = allTrips.filter((t) =>
          ["SCHEDULED", "ASSIGNED", "IN_PROGRESS"].includes(t.status)
        );

        const vehicleMap = new Map(allVehicles.map((v) => [v.id, v]));

        const visibleDrivers = allDrivers.filter((d) => isDriverVisibleOnMap(d));

        const driversWithVehicles = visibleDrivers.map((d) => ({
          ...d,
          vehicle: d.vehicleId ? vehicleMap.get(d.vehicleId) || null : null,
        }));

        res.json({
          drivers: driversWithVehicles,
          trips: activeTrips,
          vehicles: allVehicles,
          clinics: allClinics,
        });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/dispatch/unassign-driver-vehicle",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({ driver_id: z.number().int().positive() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body" });
        }

        const driver = await storage.getDriver(parsed.data.driver_id);
        if (!driver) return res.status(404).json({ message: "Driver not found" });
        const companyIdU = getCompanyIdFromAuth(req);
        if (!checkCompanyOwnership(driver, companyIdU)) return res.status(403).json({ message: "Access denied" });

        const updatedDriver = await storage.updateDriver(parsed.data.driver_id, { vehicleId: null } as any);

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "UNASSIGN_VEHICLE",
          entity: "driver",
          entityId: parsed.data.driver_id,
          details: `Unassigned vehicle from driver ${driver.publicId}`,
          cityId: driver.cityId,
        });

        res.json(updatedDriver);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/dispatch/trips/:tripId/reassign-candidates",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(req.params.tripId as string);
        if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });

        const trip = await storage.getTrip(tripId);
        if (!trip) return res.status(404).json({ message: "Trip not found" });

        const companyId = getCompanyIdFromAuth(req);
        if (!checkCompanyOwnership(trip, companyId)) return res.status(403).json({ message: "Access denied" });

        if (TERMINAL_STATUSES.includes(trip.status)) {
          return res.status(400).json({ message: `Cannot reassign a ${trip.status.toLowerCase()} trip` });
        }

        const { applyCompanyFilter } = await import("../auth");
        const rawDrivers = await storage.getDrivers(trip.cityId);
        const allDrivers = applyCompanyFilter(rawDrivers, companyId);

        const rawTrips = await storage.getTrips(trip.cityId);
        const allTrips = applyCompanyFilter(rawTrips, companyId);
        const activeTripsMap = new Map<number, any>();
        for (const t of allTrips) {
          if (t.driverId && !TERMINAL_STATUSES.includes(t.status)) {
            if (!activeTripsMap.has(t.driverId)) {
              activeTripsMap.set(t.driverId, t);
            }
          }
        }

        const rawVehicles = await storage.getVehicles(trip.cityId);
        const vehicleMap = new Map(rawVehicles.map((v) => [v.id, v]));

        const candidates = scoreReassignCandidates(
          allDrivers,
          activeTripsMap,
          vehicleMap,
          trip.pickupLat,
          trip.pickupLng,
          trip.cityId,
        );

        const filtered = candidates.filter(c => c.id !== trip.driverId);

        res.json({ candidates: filtered });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/dispatch/trips/:tripId/reassign",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(req.params.tripId as string);
        if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });

        const parsed = reassignSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }

        const { new_driver_id, reason } = parsed.data;

        const trip = await storage.getTrip(tripId);
        if (!trip) return res.status(404).json({ message: "Trip not found" });

        const companyId = getCompanyIdFromAuth(req);
        if (!checkCompanyOwnership(trip, companyId)) return res.status(403).json({ message: "Access denied" });

        if (tripLockedGuard(trip, req, res)) return;
        if (TERMINAL_STATUSES.includes(trip.status)) {
          return res.status(400).json({ message: `Cannot reassign a ${trip.status.toLowerCase()} trip` });
        }

        const newDriver = await storage.getDriver(new_driver_id);
        if (!newDriver) return res.status(404).json({ message: "New driver not found" });
        if (!checkCompanyOwnership(newDriver, companyId)) return res.status(403).json({ message: "Access denied" });

        if (newDriver.cityId !== trip.cityId) {
          return res.status(400).json({ message: "Driver must belong to the same city as the trip" });
        }

        if (newDriver.status !== "ACTIVE") {
          return res.status(400).json({ message: `Driver status is ${newDriver.status}, must be ACTIVE` });
        }

        const assignCheck = isDriverAssignable(newDriver);
        if (!assignCheck.ok) {
          return res.status(400).json({ message: assignCheck.reason });
        }

        if (!newDriver.vehicleId) {
          return res.status(400).json({ message: "Driver has no vehicle assigned" });
        }

        const vehicle = await storage.getVehicle(newDriver.vehicleId);
        if (!vehicle) {
          return res.status(400).json({ message: "Assigned vehicle not found" });
        }

        const patient = await storage.getPatient(trip.patientId);
        if (patient?.wheelchairRequired && !vehicle.wheelchairAccessible) {
          return res.status(400).json({
            message: "Patient requires wheelchair accessibility but the new driver's vehicle does not support it",
          });
        }

        const oldDriverId = trip.driverId;
        let oldDriverInfo: string | null = null;
        if (oldDriverId) {
          const oldDriver = await storage.getDriver(oldDriverId);
          oldDriverInfo = oldDriver ? `${oldDriver.firstName} ${oldDriver.lastName} (${oldDriver.publicId})` : `ID:${oldDriverId}`;

          if (oldDriver && oldDriver.dispatchStatus === "enroute") {
            await storage.updateDriver(oldDriverId, { dispatchStatus: "available" } as any);
          }
        }

        const updatedTrip = await storage.updateTrip(tripId, {
          driverId: new_driver_id,
          vehicleId: newDriver.vehicleId,
          status: "ASSIGNED",
          fiveMinAlertSent: false,
        } as any);

        await storage.updateDriver(new_driver_id, { dispatchStatus: "enroute" } as any);

        const eta = await calculateAndStoreEta(
          tripId,
          newDriver.lastLat,
          newDriver.lastLng,
          trip.pickupLat,
          trip.pickupLng,
          trip.pickupAddress,
          trip.dropoffAddress
        );

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "TRIP_REASSIGNED",
          entity: "trip",
          entityId: tripId,
          details: `Reassigned trip ${trip.publicId}: ${oldDriverInfo || "unassigned"} -> ${newDriver.firstName} ${newDriver.lastName} (${newDriver.publicId}). Reason: ${reason}${eta ? ` (ETA: ${eta.minutes}min)` : ""}`,
          cityId: trip.cityId,
        });

        autoNotifyPatient(tripId, "driver_assigned");

        const finalTrip = await storage.getTrip(tripId);
        res.json({
          trip: finalTrip,
          old_driver_id: oldDriverId,
          new_driver: newDriver,
          vehicle,
          eta: eta || null,
          reason,
        });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );
}
