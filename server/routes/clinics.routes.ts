import express, { type Express } from "express";
import { authMiddleware, requireRole, requirePermission } from "../auth";
import { requireCompanyScope, requireCityAccess } from "../middleware";
import {
  getClinicsHandler,
  createClinicHandler,
  updateClinicHandler,
} from "../controllers/clinics.controller";

const router = express.Router();

router.get("/api/clinics", authMiddleware, requirePermission("clinics", "read"), requireCompanyScope, requireCityAccess, getClinicsHandler as any);
router.post("/api/clinics", authMiddleware, requirePermission("clinics", "write"), requireCompanyScope, createClinicHandler as any);
router.patch("/api/clinics/:id", authMiddleware, requirePermission("clinics", "write"), requireCompanyScope, updateClinicHandler as any);

export function registerClinicRoutes(app: Express) {
  app.use(router);
}
