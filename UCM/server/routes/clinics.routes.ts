import express, { type Express } from "express";
import { authMiddleware, requireRole, requirePermission } from "../auth";
import { requireTenantScope, requireCityAccess } from "../middleware";
import {
  getClinicsHandler,
  getClinicByIdHandler,
  createClinicHandler,
  updateClinicHandler,
} from "../controllers/clinics.controller";

const router = express.Router();

router.get("/api/clinics", authMiddleware, requirePermission("clinics", "read"), requireTenantScope, requireCityAccess, getClinicsHandler as any);
router.get("/api/clinics/:id", authMiddleware, requirePermission("clinics", "read"), requireTenantScope, getClinicByIdHandler as any);
router.post("/api/clinics", authMiddleware, requirePermission("clinics", "write"), requireTenantScope, createClinicHandler as any);
router.patch("/api/clinics/:id", authMiddleware, requirePermission("clinics", "write"), requireTenantScope, updateClinicHandler as any);

export function registerClinicRoutes(app: Express) {
  app.use(router);
}
