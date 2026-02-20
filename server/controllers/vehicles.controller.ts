import type { Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { insertVehicleSchema, vehicles, vehicleMakes, vehicleModels } from "@shared/schema";
import { db } from "../db";
import { eq, sql, and, isNull } from "drizzle-orm";
import { generatePublicId } from "../public-id";
import { getScope, requireScope, buildScopeFilters, forceCompanyOnCreate } from "../middleware/scopeContext";

export async function getVehicleMakesHandler(_req: AuthRequest, res: Response) {
  try {
    const makes = await db.select().from(vehicleMakes).where(eq(vehicleMakes.isActive, true)).orderBy(vehicleMakes.name);
    res.json(makes);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getVehicleModelsHandler(req: AuthRequest, res: Response) {
  try {
    const makeId = parseInt(req.query.make_id as string);
    if (!makeId) return res.status(400).json({ message: "make_id is required" });
    const models = await db.select().from(vehicleModels)
      .where(sql`${vehicleModels.makeId} = ${makeId} AND ${vehicleModels.isActive} = true`)
      .orderBy(vehicleModels.name);
    res.json(models);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getVehiclesHandler(req: AuthRequest, res: Response) {
  try {
    const scope = await getScope(req);
    if (!scope || !requireScope(scope, res)) return;
    const filters = buildScopeFilters(scope);

    const conditions: any[] = [eq(vehicles.active, true), isNull(vehicles.deletedAt)];
    if (filters.companyId) conditions.push(eq(vehicles.companyId, filters.companyId));
    if (!filters.companyId && scope.isSuperAdmin && req.query.companyId) {
      const filterCompanyId = parseInt(String(req.query.companyId));
      if (!isNaN(filterCompanyId)) conditions.push(eq(vehicles.companyId, filterCompanyId));
    }
    if (filters.cityId) conditions.push(eq(vehicles.cityId, filters.cityId));

    const result = await db.select().from(vehicles).where(and(...conditions)).orderBy(vehicles.name);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getVehicleByIdHandler(req: AuthRequest, res: Response) {
  try {
    const scope = await getScope(req);
    if (!scope) return res.status(401).json({ message: "Unauthorized" });
    const vehicle = await storage.getVehicle(parseInt(String(req.params.id)));
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
    if (!scope.isSuperAdmin && scope.companyId && vehicle.companyId !== scope.companyId) {
      return res.status(403).json({ message: "No access to this vehicle" });
    }
    if (!scope.isSuperAdmin && scope.allowedCityIds.length > 0 && !scope.allowedCityIds.includes(vehicle.cityId)) {
      return res.status(403).json({ message: "No access to this vehicle" });
    }
    res.json(vehicle);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function updateVehicleHandler(req: AuthRequest, res: Response) {
  try {
    const scope = await getScope(req);
    if (!scope) return res.status(401).json({ message: "Unauthorized" });
    const vehicleId = parseInt(String(req.params.id));
    const vehicle = await storage.getVehicle(vehicleId);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
    if (!scope.isSuperAdmin && scope.companyId && vehicle.companyId !== scope.companyId) {
      return res.status(403).json({ message: "Vehicle does not belong to your company" });
    }
    if (!scope.isSuperAdmin && scope.allowedCityIds.length > 0 && !scope.allowedCityIds.includes(vehicle.cityId)) {
      return res.status(403).json({ message: "No access to this vehicle" });
    }

    const { name, licensePlate, colorHex, make, model, makeId, modelId, makeText, modelText, year, capacity, wheelchairAccessible, status, cityId, lastServiceDate, maintenanceNotes } = req.body;

    if (!colorHex || !colorHex.trim()) {
      return res.status(400).json({ message: "Vehicle color is required" });
    }
    if (cityId && cityId !== vehicle.cityId) {
      if (!scope.isSuperAdmin && scope.allowedCityIds.length > 0 && !scope.allowedCityIds.includes(cityId)) {
        return res.status(403).json({ message: "No access to the target city" });
      }
      const assignedDriver = await storage.getDriverByVehicleId(vehicleId);
      if (assignedDriver && assignedDriver.cityId !== cityId) {
        return res.status(400).json({ message: "Vehicle is assigned to a driver in another city; unassign first." });
      }
    }
    let plate = licensePlate;
    if (plate) {
      plate = plate.trim().toUpperCase();
      if (!/^[A-Z0-9-]+$/.test(plate)) {
        return res.status(400).json({ message: "License plate may only contain letters, numbers, and hyphens" });
      }
    }

    const updated = await storage.updateVehicle(vehicleId, {
      name, licensePlate: plate, colorHex, make, model, year, capacity, wheelchairAccessible, status,
      ...(makeId !== undefined ? { makeId: makeId || null } : {}),
      ...(modelId !== undefined ? { modelId: modelId || null } : {}),
      ...(makeText !== undefined ? { makeText: makeText || null } : {}),
      ...(modelText !== undefined ? { modelText: modelText || null } : {}),
      ...(cityId ? { cityId } : {}),
      ...(lastServiceDate !== undefined ? { lastServiceDate: lastServiceDate ? new Date(lastServiceDate) : null } : {}),
      ...(maintenanceNotes !== undefined ? { maintenanceNotes } : {}),
    });
    if (!updated) return res.status(404).json({ message: "Vehicle not found" });

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "UPDATE",
      entity: "vehicle",
      entityId: updated.id,
      details: `Updated vehicle ${updated.name}`,
      cityId: updated.cityId,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function createVehicleHandler(req: AuthRequest, res: Response) {
  try {
    const scope = await getScope(req);
    if (!scope) return res.status(401).json({ message: "Unauthorized" });
    forceCompanyOnCreate(scope, req.body);
    const parsed = insertVehicleSchema.omit({ publicId: true }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid vehicle data" });
    }
    if (!parsed.data.colorHex || !parsed.data.colorHex.trim()) {
      return res.status(400).json({ message: "Vehicle color is required" });
    }
    if (!parsed.data.cityId) {
      return res.status(400).json({ message: "City is required" });
    }
    if (!scope.isSuperAdmin && scope.allowedCityIds.length > 0 && !scope.allowedCityIds.includes(parsed.data.cityId)) {
      return res.status(403).json({ message: "No access to this city" });
    }
    if (parsed.data.licensePlate) {
      parsed.data.licensePlate = parsed.data.licensePlate.trim().toUpperCase();
      if (!/^[A-Z0-9-]+$/.test(parsed.data.licensePlate)) {
        return res.status(400).json({ message: "License plate may only contain letters, numbers, and hyphens" });
      }
    }
    const publicId = await generatePublicId();
    const vehicle = await storage.createVehicle({ ...parsed.data, publicId });
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CREATE",
      entity: "vehicle",
      entityId: vehicle.id,
      details: `Created vehicle ${vehicle.name}`,
      cityId: vehicle.cityId,
    });
    res.json(vehicle);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
