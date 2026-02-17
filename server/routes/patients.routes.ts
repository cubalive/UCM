import express, { type Express } from "express";
import { authMiddleware, requireRole } from "../auth";
import {
  getPatientsHandler,
  getPatientClinicGroupsHandler,
  createPatientHandler,
  updatePatientHandler,
} from "../controllers/patients.controller";

const router = express.Router();

router.get("/api/patients", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER"), getPatientsHandler as any);
router.get("/api/patients/clinic-groups", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN", "COMPANY_ADMIN"), getPatientClinicGroupsHandler as any);
router.post("/api/patients", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER"), createPatientHandler as any);
router.patch("/api/patients/:id", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER"), updatePatientHandler as any);

export function registerPatientRoutes(app: Express) {
  app.use(router);
}
