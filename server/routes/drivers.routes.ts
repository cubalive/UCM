import express, { type Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import {
  getDriversHandler,
  createDriverHandler,
  updateDriverHandler,
  getDriverVehicleHistoryHandler,
} from "../controllers/drivers.controller";

const router = express.Router();

router.get("/api/drivers", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), getDriversHandler as any);
router.post("/api/drivers", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), createDriverHandler as any);
router.put("/api/drivers/:id", authMiddleware, requireRole("ADMIN", "DISPATCH"), updateDriverHandler as any);
router.get("/api/drivers/:id/vehicle-history", authMiddleware, requireRole("ADMIN", "DISPATCH"), getDriverVehicleHistoryHandler as any);

export function registerDriverRoutes(app: Express) {
  app.use(router);
}
