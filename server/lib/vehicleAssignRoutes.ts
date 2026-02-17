import type { Express } from "express";
import { storage } from "../storage";
import { authMiddleware, requireRole, getUserCityIds, type AuthRequest } from "../auth";
import { z } from "zod";
import { runVehicleAutoAssignForCity, getLastRunTimestamp } from "./vehicleAutoAssign";
import { isJobEngineRunning } from "./jobEngine";

export function registerVehicleAssignRoutes(app: Express) {

  app.get("/api/city-settings",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (_req: AuthRequest, res) => {
      try {
        const settings = await storage.getAllCitySettings();
        res.json(settings);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/city-settings/:cityId",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const cityId = parseInt(req.params.cityId as string);
        const settings = await storage.getCitySettings(cityId);
        if (!settings) return res.status(404).json({ message: "City settings not found" });
        res.json(settings);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.patch("/api/city-settings/:cityId",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (req: AuthRequest, res) => {
      try {
        const cityId = parseInt(req.params.cityId as string);
        const schema = z.object({
          shiftStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          autoAssignEnabled: z.boolean().optional(),
          autoAssignDays: z.array(z.string()).optional(),
          autoAssignMinutesBefore: z.number().int().min(15).max(120).optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }

        const city = await storage.getCity(cityId);
        if (!city) return res.status(404).json({ message: "City not found" });

        const updated = await storage.upsertCitySettings({
          cityId,
          ...parsed.data,
        } as any);

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "UPDATE_CITY_SETTINGS",
          entity: "city_settings",
          entityId: null,
          details: `Updated city settings for ${city.name}: ${JSON.stringify(parsed.data)}`,
          cityId,
        });

        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/vehicle-assignments",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const cityId = parseInt(req.query.cityId as string);
        const date = req.query.date as string;
        if (!cityId || !date) {
          return res.status(400).json({ message: "cityId and date are required" });
        }
        const userCityIds = await getUserCityIds(req.user!.userId, req.user!.role);
        if (userCityIds.length > 0 && !userCityIds.includes(cityId)) {
          return res.status(403).json({ message: "You do not have access to this city" });
        }
        const assignments = await storage.getDriverVehicleAssignments(cityId, date);
        res.json(assignments);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/vehicle-assignments/override",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          driver_id: z.number().int().positive(),
          vehicle_id: z.number().int().positive(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }

        const { driver_id, vehicle_id, date } = parsed.data;

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

        const existingVehicleAssignment = (await storage.getDriverVehicleAssignments(vehicle.cityId, date))
          .find(a => a.vehicleId === vehicle_id && a.driverId !== driver_id);
        if (existingVehicleAssignment) {
          const otherDriver = await storage.getDriver(existingVehicleAssignment.driverId);
          return res.status(409).json({
            message: `Vehicle already assigned to ${otherDriver?.firstName} ${otherDriver?.lastName} for ${date}`,
          });
        }

        const existingDriverAssignment = await storage.getDriverVehicleAssignment(driver_id, date);

        let assignment;
        if (existingDriverAssignment) {
          assignment = await storage.updateDriverVehicleAssignment(existingDriverAssignment.id, {
            vehicleId: vehicle_id,
            assignedBy: "dispatch",
          });
        } else {
          const settings = await storage.getCitySettings(driver.cityId);
          assignment = await storage.createDriverVehicleAssignment({
            date,
            cityId: driver.cityId,
            shiftStartTime: settings?.shiftStartTime || "06:00",
            driverId: driver_id,
            vehicleId: vehicle_id,
            assignedBy: "dispatch",
          });
        }

        await storage.updateDriver(driver_id, { vehicleId: vehicle_id });

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "OVERRIDE_VEHICLE_ASSIGN",
          entity: "driver_vehicle_assignments",
          entityId: assignment?.id || null,
          details: `Dispatch override: assigned vehicle ${vehicle.name} (${vehicle.publicId}) to driver ${driver.firstName} ${driver.lastName} (${driver.publicId}) for ${date}`,
          cityId: driver.cityId,
        });

        res.json(assignment);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/dispatch/assignments/reassign-vehicle",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          assignmentId: z.number().int().positive(),
          newVehicleId: z.number().int().positive(),
          updateTrips: z.boolean().default(false),
          notes: z.string().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }

        const { assignmentId, newVehicleId, updateTrips, notes } = parsed.data;

        const { db } = await import("../db");
        const { driverVehicleAssignments } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const [assignmentRow] = await db.select().from(driverVehicleAssignments).where(eq(driverVehicleAssignments.id, assignmentId));

        if (!assignmentRow) {
          return res.status(404).json({ message: "Assignment not found" });
        }

        const driver = await storage.getDriver(assignmentRow.driverId);
        if (!driver) return res.status(404).json({ message: "Driver not found" });

        const userCityIds = await getUserCityIds(req.user!.userId, req.user!.role);
        if (userCityIds.length > 0 && !userCityIds.includes(driver.cityId)) {
          return res.status(403).json({ message: "You do not have access to this city" });
        }

        const newVehicle = await storage.getVehicle(newVehicleId);
        if (!newVehicle) return res.status(404).json({ message: "New vehicle not found" });

        if (driver.cityId !== newVehicle.cityId) {
          return res.status(400).json({ message: "Driver and vehicle must belong to the same city" });
        }

        if (newVehicle.status !== "ACTIVE") {
          return res.status(400).json({ message: `Vehicle is ${newVehicle.status}, must be ACTIVE` });
        }

        if (!newVehicle.active) {
          return res.status(400).json({ message: "Vehicle is archived" });
        }

        const cityAssignments = await storage.getDriverVehicleAssignments(driver.cityId, assignmentRow.date);
        const conflicting = cityAssignments.find(a => a.vehicleId === newVehicleId && a.id !== assignmentId);
        if (conflicting) {
          const otherDriver = await storage.getDriver(conflicting.driverId);
          return res.status(409).json({
            message: `Vehicle already assigned to ${otherDriver?.firstName} ${otherDriver?.lastName} for ${assignmentRow.date}`,
          });
        }

        const oldVehicleId = assignmentRow.vehicleId;
        const oldVehicle = await storage.getVehicle(oldVehicleId);

        await storage.updateDriverVehicleAssignment(assignmentId, {
          vehicleId: newVehicleId,
          assignedBy: "dispatch",
          status: "active",
          notes: notes || null,
          updatedBy: req.user!.userId,
          updatedAt: new Date(),
        } as any);

        await storage.updateDriver(driver.id, { vehicleId: newVehicleId });

        if (oldVehicleId) {
          await storage.closeVehicleAssignmentHistory(driver.id, oldVehicleId);
        }
        await storage.createVehicleAssignmentHistory({
          driverId: driver.id,
          vehicleId: newVehicleId,
          cityId: driver.cityId,
          assignedAt: new Date(),
          assignedBy: req.user!.userId.toString(),
        });

        let tripsUpdated = 0;
        if (updateTrips) {
          const driverTrips = await storage.getTripsByDriverAndDate(driver.id, assignmentRow.date);
          for (const trip of driverTrips) {
            await storage.updateTrip(trip.id, { vehicleId: newVehicleId });
            tripsUpdated++;
          }
        }

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "REASSIGN_VEHICLE",
          entity: "driver_vehicle_assignments",
          entityId: assignmentId,
          details: `Reassigned vehicle for driver ${driver.firstName} ${driver.lastName}: ${oldVehicle?.name || oldVehicleId} → ${newVehicle.name}${notes ? ` (notes: ${notes})` : ""}${updateTrips ? ` (${tripsUpdated} trips updated)` : ""}`,
          cityId: driver.cityId,
        });

        res.json({ success: true, tripsUpdated });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/dispatch/assignments/swap-drivers",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          assignmentIdA: z.number().int().positive(),
          assignmentIdB: z.number().int().positive(),
          updateTrips: z.boolean().default(false),
          notes: z.string().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }

        const { assignmentIdA, assignmentIdB, updateTrips, notes } = parsed.data;

        if (assignmentIdA === assignmentIdB) {
          return res.status(400).json({ message: "Cannot swap a driver with themselves" });
        }

        const { db } = await import("../db");
        const { driverVehicleAssignments } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");

        const [assignmentA] = await db.select().from(driverVehicleAssignments).where(eq(driverVehicleAssignments.id, assignmentIdA));
        const [assignmentB] = await db.select().from(driverVehicleAssignments).where(eq(driverVehicleAssignments.id, assignmentIdB));

        if (!assignmentA) return res.status(404).json({ message: "Assignment A not found" });
        if (!assignmentB) return res.status(404).json({ message: "Assignment B not found" });

        if (assignmentA.date !== assignmentB.date) {
          return res.status(400).json({ message: "Both assignments must be on the same date" });
        }

        const driverA = await storage.getDriver(assignmentA.driverId);
        const driverB = await storage.getDriver(assignmentB.driverId);
        if (!driverA || !driverB) return res.status(404).json({ message: "Driver not found" });

        if (driverA.cityId !== driverB.cityId) {
          return res.status(400).json({ message: "Both drivers must belong to the same city" });
        }

        const userCityIds = await getUserCityIds(req.user!.userId, req.user!.role);
        if (userCityIds.length > 0 && !userCityIds.includes(driverA.cityId)) {
          return res.status(403).json({ message: "You do not have access to this city" });
        }

        const vehicleIdA = assignmentA.vehicleId;
        const vehicleIdB = assignmentB.vehicleId;

        await storage.updateDriverVehicleAssignment(assignmentIdA, {
          vehicleId: vehicleIdB,
          assignedBy: "dispatch",
          status: "active",
          notes: notes || null,
          updatedBy: req.user!.userId,
          updatedAt: new Date(),
        } as any);

        await storage.updateDriverVehicleAssignment(assignmentIdB, {
          vehicleId: vehicleIdA,
          assignedBy: "dispatch",
          status: "active",
          notes: notes || null,
          updatedBy: req.user!.userId,
          updatedAt: new Date(),
        } as any);

        await storage.updateDriver(driverA.id, { vehicleId: vehicleIdB });
        await storage.updateDriver(driverB.id, { vehicleId: vehicleIdA });

        if (vehicleIdA) {
          await storage.closeVehicleAssignmentHistory(driverA.id, vehicleIdA);
          await storage.createVehicleAssignmentHistory({
            driverId: driverB.id, vehicleId: vehicleIdA, cityId: driverB.cityId,
            assignedAt: new Date(), assignedBy: req.user!.userId.toString(),
          });
        }
        if (vehicleIdB) {
          await storage.closeVehicleAssignmentHistory(driverB.id, vehicleIdB);
          await storage.createVehicleAssignmentHistory({
            driverId: driverA.id, vehicleId: vehicleIdB, cityId: driverA.cityId,
            assignedAt: new Date(), assignedBy: req.user!.userId.toString(),
          });
        }

        let tripsUpdated = 0;
        if (updateTrips) {
          const tripsA = await storage.getTripsByDriverAndDate(driverA.id, assignmentA.date);
          for (const trip of tripsA) {
            await storage.updateTrip(trip.id, { vehicleId: vehicleIdB });
            tripsUpdated++;
          }
          const tripsB = await storage.getTripsByDriverAndDate(driverB.id, assignmentB.date);
          for (const trip of tripsB) {
            await storage.updateTrip(trip.id, { vehicleId: vehicleIdA });
            tripsUpdated++;
          }
        }

        const vehicleA = vehicleIdA ? await storage.getVehicle(vehicleIdA) : null;
        const vehicleB = vehicleIdB ? await storage.getVehicle(vehicleIdB) : null;

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "SWAP_DRIVERS",
          entity: "driver_vehicle_assignments",
          entityId: assignmentIdA,
          details: `Swapped vehicles: ${driverA.firstName} ${driverA.lastName} (${vehicleA?.name || "none"} → ${vehicleB?.name || "none"}) ↔ ${driverB.firstName} ${driverB.lastName} (${vehicleB?.name || "none"} → ${vehicleA?.name || "none"})${notes ? ` (notes: ${notes})` : ""}${updateTrips ? ` (${tripsUpdated} trips updated)` : ""}`,
          cityId: driverA.cityId,
        });

        res.json({ success: true, tripsUpdated });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/vehicle-assignments/trigger",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({ city_id: z.number().int().positive() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request body" });
        }

        const city = await storage.getCity(parsed.data.city_id);
        if (!city) return res.status(404).json({ message: "City not found" });

        const settings = await storage.getCitySettings(city.id);
        if (!settings) return res.status(404).json({ message: "City settings not found" });

        const result = await runVehicleAutoAssignForCity(city, settings);

        res.json({
          message: `Auto-assign triggered for ${city.name}`,
          ...result,
        });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/assignments/health", async (_req, res) => {
    try {
      const cities = await storage.getCities();
      const allSettings = await storage.getAllCitySettings();
      const enabledCities = allSettings.filter(s => s.autoAssignEnabled).length;
      res.json({
        ok: true,
        schedulerRunning: isJobEngineRunning(),
        lastRunAt: getLastRunTimestamp(),
        totalCities: cities.length,
        autoAssignEnabledCities: enabledCities,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/assignments/run-today",
    authMiddleware,
    requireRole("SUPER_ADMIN"),
    async (_req: AuthRequest, res) => {
      try {
        const cities = await storage.getCities();
        const allSettings = await storage.getAllCitySettings();
        const results: Record<string, { assigned: number; skipped: number; reused: number; error?: string }> = {};

        for (const city of cities) {
          if (!city.active) continue;
          const settings = allSettings.find(s => s.cityId === city.id);
          if (!settings || !settings.autoAssignEnabled) {
            results[city.name] = { assigned: 0, skipped: 0, reused: 0, error: "auto-assign disabled" };
            continue;
          }

          try {
            const result = await runVehicleAutoAssignForCity(city, settings);
            results[city.name] = result;
          } catch (cityErr: any) {
            results[city.name] = { assigned: 0, skipped: 0, reused: 0, error: cityErr.message };
            console.error(`[Assignments] run-today error for ${city.name}: ${cityErr.message}`);
          }
        }

        res.json({ ok: true, results });
      } catch (err: any) {
        res.status(500).json({ ok: false, message: err.message });
      }
    }
  );
}
