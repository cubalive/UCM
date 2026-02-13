import type { Express } from "express";
import { storage } from "../storage";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { z } from "zod";
import { runVehicleAutoAssignForCity } from "./vehicleAutoAssign";

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
}
