import type { Express } from "express";
import { storage } from "../storage";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { etaMinutes } from "./googleMaps";
import { z } from "zod";
import { GOOGLE_MAPS_KEY } from "../../lib/mapsConfig";

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

        const vehicle = await storage.getVehicle(vehicle_id);
        if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });

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

        const driver = await storage.getDriver(driver_id);
        if (!driver) return res.status(404).json({ message: "Driver not found" });

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

        const patient = await storage.getPatient(trip.patientId);
        if (patient?.wheelchairRequired && vehicle && !vehicle.wheelchairAccessible) {
          return res.status(400).json({
            message: "Patient requires wheelchair accessibility but assigned vehicle does not support it",
          });
        }

        const updatedTrip = await storage.updateTrip(trip_id, {
          driverId: driver_id,
          vehicleId: driver.vehicleId,
          status: "ASSIGNED",
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

        const unassignedTrips = await storage.getUnassignedTrips(city_id);
        if (unassignedTrips.length === 0) {
          return res.json({ assigned: 0, skipped: 0, message: "No unassigned trips" });
        }

        const allDrivers = await storage.getDrivers(city_id);
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

          const patient = await storage.getPatient(trip.patientId);
          if (patient?.wheelchairRequired && vehicle && !vehicle.wheelchairAccessible) {
            const wcCandidate = candidates.find((c) => {
              return true;
            });
            skipped++;
            continue;
          }

          await storage.updateTrip(trip.id, {
            driverId: best.driver.id,
            vehicleId: best.driver.vehicleId,
            status: "ASSIGNED",
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

        const updatedDriver = await storage.updateDriver(driver_id, { dispatchStatus: status } as any);

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
    async (req: AuthRequest, res) => {
      try {
        const parsed = driverLocationSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body" });
        }

        const { driver_id, lat, lng } = parsed.data;

        const driver = await storage.getDriver(driver_id);
        if (!driver) return res.status(404).json({ message: "Driver not found" });

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

  app.get("/api/dispatch/map-data",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;

        const [allDrivers, allTrips, allVehicles, allClinics] = await Promise.all([
          storage.getDrivers(cityId),
          storage.getTrips(cityId),
          storage.getVehicles(cityId),
          storage.getClinics(cityId),
        ]);

        const activeTrips = allTrips.filter((t) =>
          ["SCHEDULED", "ASSIGNED", "IN_PROGRESS"].includes(t.status)
        );

        const vehicleMap = new Map(allVehicles.map((v) => [v.id, v]));

        const driversWithVehicles = allDrivers.map((d) => ({
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
}
