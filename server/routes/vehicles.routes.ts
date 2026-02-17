import express, { type Express } from "express";
import { authMiddleware, requirePermission, type AuthRequest } from "../auth";
import { requireTenantScope, requireCityAccess } from "../middleware";
import {
  getVehicleMakesHandler,
  getVehicleModelsHandler,
  getVehiclesHandler,
  getVehicleByIdHandler,
  updateVehicleHandler,
  createVehicleHandler,
} from "../controllers/vehicles.controller";

const router = express.Router();

router.get("/api/vehicle-makes", authMiddleware, getVehicleMakesHandler as any);
router.get("/api/vehicle-models", authMiddleware, getVehicleModelsHandler as any);
router.get("/api/vehicles", authMiddleware, requirePermission("vehicles", "read"), requireTenantScope, requireCityAccess, getVehiclesHandler as any);
router.get("/api/vehicles/:id", authMiddleware, requirePermission("vehicles", "read"), requireTenantScope, getVehicleByIdHandler as any);
router.put("/api/vehicles/:id", authMiddleware, requirePermission("vehicles", "write"), requireTenantScope, updateVehicleHandler as any);
router.post("/api/vehicles", authMiddleware, requirePermission("vehicles", "write"), requireTenantScope, createVehicleHandler as any);

export function registerVehicleRoutes(app: Express) {
  app.use(router);
}
