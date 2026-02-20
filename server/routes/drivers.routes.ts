import express, { type Express } from "express";
import { authMiddleware, requirePermission, type AuthRequest } from "../auth";
import { requireTenantScope, requireCityAccess } from "../middleware";
import {
  getDriversHandler,
  getDriverByIdHandler,
  createDriverHandler,
  updateDriverHandler,
  getDriverVehicleHistoryHandler,
} from "../controllers/drivers.controller";

const router = express.Router();

router.get("/api/drivers", authMiddleware, requirePermission("drivers", "read"), requireTenantScope, requireCityAccess, getDriversHandler as any);
router.get("/api/drivers/:id", authMiddleware, requirePermission("drivers", "read"), requireTenantScope, getDriverByIdHandler as any);
router.post("/api/drivers", authMiddleware, requirePermission("drivers", "write"), requireTenantScope, createDriverHandler as any);
router.put("/api/drivers/:id", authMiddleware, requirePermission("drivers", "write"), requireTenantScope, updateDriverHandler as any);
router.patch("/api/drivers/:id", authMiddleware, requirePermission("drivers", "write"), requireTenantScope, updateDriverHandler as any);
router.get("/api/drivers/:id/vehicle-history", authMiddleware, requirePermission("drivers", "read"), requireTenantScope, getDriverVehicleHistoryHandler as any);

export function registerDriverRoutes(app: Express) {
  app.use(router);
}
