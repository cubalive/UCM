import express, { type Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { requireCompanyScope, requireCityAccess } from "../middleware";
import {
  getDriversHandler,
  createDriverHandler,
  updateDriverHandler,
  getDriverVehicleHistoryHandler,
} from "../controllers/drivers.controller";

const router = express.Router();

router.get("/api/drivers", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), requireCompanyScope, requireCityAccess, getDriversHandler as any);
router.post("/api/drivers", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), requireCompanyScope, createDriverHandler as any);
router.put("/api/drivers/:id", authMiddleware, requireRole("ADMIN", "DISPATCH"), requireCompanyScope, updateDriverHandler as any);
router.get("/api/drivers/:id/vehicle-history", authMiddleware, requireRole("ADMIN", "DISPATCH"), requireCompanyScope, getDriverVehicleHistoryHandler as any);

export function registerDriverRoutes(app: Express) {
  app.use(router);
}
