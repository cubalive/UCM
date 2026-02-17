import express, { type Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
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
router.get("/api/vehicles", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), getVehiclesHandler as any);
router.get("/api/vehicles/:id", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), getVehicleByIdHandler as any);
router.put("/api/vehicles/:id", authMiddleware, requireRole("ADMIN", "DISPATCH"), updateVehicleHandler as any);
router.post("/api/vehicles", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), createVehicleHandler as any);

export function registerVehicleRoutes(app: Express) {
  app.use(router);
}
