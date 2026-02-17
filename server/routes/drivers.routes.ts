import express, { type Express } from "express";
import { authMiddleware, requirePermission, type AuthRequest } from "../auth";
import { requireCompanyScope, requireCityAccess } from "../middleware";
import {
  getDriversHandler,
  createDriverHandler,
  updateDriverHandler,
  getDriverVehicleHistoryHandler,
} from "../controllers/drivers.controller";

const router = express.Router();

router.get("/api/drivers", authMiddleware, requirePermission("drivers", "read"), requireCompanyScope, requireCityAccess, getDriversHandler as any);
router.post("/api/drivers", authMiddleware, requirePermission("drivers", "write"), requireCompanyScope, createDriverHandler as any);
router.put("/api/drivers/:id", authMiddleware, requirePermission("drivers", "write"), requireCompanyScope, updateDriverHandler as any);
router.get("/api/drivers/:id/vehicle-history", authMiddleware, requirePermission("drivers", "read"), requireCompanyScope, getDriverVehicleHistoryHandler as any);

export function registerDriverRoutes(app: Express) {
  app.use(router);
}
