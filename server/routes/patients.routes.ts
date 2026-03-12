import express, { type Express } from "express";
import { authMiddleware, requirePermission } from "../auth";
import { requireTenantScope, requireCityAccess } from "../middleware";
import { phiAuditDbMiddleware } from "../middleware/phiAudit";
import {
  getPatientsHandler,
  getPatientByIdHandler,
  getPatientClinicGroupsHandler,
  createPatientHandler,
  updatePatientHandler,
} from "../controllers/patients.controller";

const router = express.Router();

// PHI audit is handled globally by phiAuditMiddleware in index.ts

router.get("/api/patients", authMiddleware, requirePermission("patients", "read"), requireTenantScope, requireCityAccess, getPatientsHandler as any);
router.get("/api/patients/clinic-groups", authMiddleware, requirePermission("patients", "read"), requireTenantScope, getPatientClinicGroupsHandler as any);
router.get("/api/patients/:id", authMiddleware, requirePermission("patients", "read"), requireTenantScope, getPatientByIdHandler as any);
router.post("/api/patients", authMiddleware, requirePermission("patients", "write"), requireTenantScope, createPatientHandler as any);
router.patch("/api/patients/:id", authMiddleware, requirePermission("patients", "write"), requireTenantScope, updatePatientHandler as any);
router.put("/api/patients/:id", authMiddleware, requirePermission("patients", "write"), requireTenantScope, updatePatientHandler as any);

export function registerPatientRoutes(app: Express) {
  app.use(router);
}
