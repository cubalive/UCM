import express, { type Express } from "express";
import { authMiddleware, requireRole } from "../auth";
import { requireCompanyScope, requireCityAccess } from "../middleware";
import {
  getPatientsHandler,
  getPatientClinicGroupsHandler,
  createPatientHandler,
  updatePatientHandler,
} from "../controllers/patients.controller";

const router = express.Router();

router.get("/api/patients", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER"), requireCompanyScope, requireCityAccess, getPatientsHandler as any);
router.get("/api/patients/clinic-groups", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN", "COMPANY_ADMIN"), requireCompanyScope, getPatientClinicGroupsHandler as any);
router.post("/api/patients", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER"), requireCompanyScope, createPatientHandler as any);
router.patch("/api/patients/:id", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER"), requireCompanyScope, updatePatientHandler as any);

export function registerPatientRoutes(app: Express) {
  app.use(router);
}
