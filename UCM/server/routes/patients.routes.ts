import express, { type Express } from "express";
import { authMiddleware, requireRole, requirePermission } from "../auth";
import { requireTenantScope, requireCityAccess } from "../middleware";
import {
  getPatientsHandler,
  getPatientByIdHandler,
  getPatientClinicGroupsHandler,
  createPatientHandler,
  updatePatientHandler,
} from "../controllers/patients.controller";

const router = express.Router();

router.get("/api/patients", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER", "SUPER_ADMIN"), requireTenantScope, requireCityAccess, getPatientsHandler as any);
router.get("/api/patients/clinic-groups", authMiddleware, requirePermission("patients", "read"), requireTenantScope, getPatientClinicGroupsHandler as any);
router.get("/api/patients/:id", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER", "SUPER_ADMIN"), requireTenantScope, getPatientByIdHandler as any);
router.post("/api/patients", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "SUPER_ADMIN"), requireTenantScope, createPatientHandler as any);
router.patch("/api/patients/:id", authMiddleware, requirePermission("patients", "write"), requireTenantScope, updatePatientHandler as any);
router.put("/api/patients/:id", authMiddleware, requirePermission("patients", "write"), requireTenantScope, updatePatientHandler as any);

export function registerPatientRoutes(app: Express) {
  app.use(router);
}
