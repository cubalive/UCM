import express, { type Express } from "express";
import { authMiddleware, requireRole } from "../auth";
import {
  getClinicsHandler,
  createClinicHandler,
  updateClinicHandler,
} from "../controllers/clinics.controller";

const router = express.Router();

router.get("/api/clinics", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), getClinicsHandler as any);
router.post("/api/clinics", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), createClinicHandler as any);
router.patch("/api/clinics/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), updateClinicHandler as any);

export function registerClinicRoutes(app: Express) {
  app.use(router);
}
