import express, { type Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { requireCompanyScope, requireCityAccess } from "../middleware";
import { idempotencyMiddleware } from "../lib/idempotency";
import {
  getRecurringSchedulesHandler,
  createRecurringScheduleHandler,
  updateRecurringScheduleHandler,
  deleteRecurringScheduleHandler,
  generateRecurringSchedulesHandler,
  assignTripHandler,
  getTripMessagesHandler,
  createTripMessageHandler,
  getTripsHandler,
  getTripByIdHandler,
  createTripHandler,
  updateTripHandler,
  updateTripStatusHandler,
  dialysisReturnCheckHandler,
  dialysisReturnAdjustHandler,
  approveTripHandler,
  cancelRequestHandler,
  rejectCancelHandler,
  cancelTripHandler,
  createReturnTripHandler,
  recomputeRouteHandler,
  driverSignatureHandler,
  clinicSignatureHandler,
  getSignatureHandler,
  getTripPdfHandler,
  downloadTripPdfHandler,
  getTripInvoiceHandler,
  createTripInvoiceHandler,
} from "../controllers/trips.controller";

const router = express.Router();

router.get("/api/recurring-schedules", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), getRecurringSchedulesHandler as any);
router.post("/api/recurring-schedules", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), createRecurringScheduleHandler as any);
router.patch("/api/recurring-schedules/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), updateRecurringScheduleHandler as any);
router.delete("/api/recurring-schedules/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), deleteRecurringScheduleHandler as any);
router.post("/api/recurring-schedules/generate", authMiddleware, requireRole("SUPER_ADMIN"), generateRecurringSchedulesHandler as any);

router.patch("/api/trips/:id/assign", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), assignTripHandler as any);

router.get("/api/trips/:id/messages", authMiddleware, requireRole("ADMIN", "DISPATCH", "DRIVER", "SUPER_ADMIN"), getTripMessagesHandler as any);
router.post("/api/trips/:id/messages", authMiddleware, requireRole("ADMIN", "DISPATCH", "DRIVER", "SUPER_ADMIN"), createTripMessageHandler as any);

router.get("/api/trips", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "SUPER_ADMIN", "COMPANY_ADMIN"), requireCompanyScope, requireCityAccess, getTripsHandler as any);
router.get("/api/trips/:id", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "SUPER_ADMIN", "COMPANY_ADMIN", "CLINIC_USER"), requireCompanyScope, getTripByIdHandler as any);
router.post("/api/trips", authMiddleware, idempotencyMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER"), requireCompanyScope, createTripHandler as any);
router.patch("/api/trips/:id", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER"), requireCompanyScope, updateTripHandler as any);

router.patch("/api/trips/:id/status", authMiddleware, requireRole("ADMIN", "DISPATCH", "DRIVER"), updateTripStatusHandler as any);

router.get("/api/trips/:id/dialysis-return-check", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN", "CLINIC_USER"), dialysisReturnCheckHandler as any);
router.post("/api/trips/:id/dialysis-return-adjust", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN", "CLINIC_USER"), dialysisReturnAdjustHandler as any);

router.patch("/api/trips/:id/approve", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), approveTripHandler as any);
router.patch("/api/trips/:id/cancel-request", authMiddleware, requireRole("VIEWER"), cancelRequestHandler as any);
router.patch("/api/trips/:id/reject-cancel", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), rejectCancelHandler as any);
router.patch("/api/trips/:id/cancel", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), cancelTripHandler as any);

router.post("/api/trips/:id/return-trip", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), createReturnTripHandler as any);
router.post("/api/trips/:id/route/recompute", authMiddleware, recomputeRouteHandler as any);

router.post("/api/trips/:id/signature/driver", authMiddleware, driverSignatureHandler as any);
router.post("/api/trips/:id/signature/clinic", authMiddleware, clinicSignatureHandler as any);
router.get("/api/trips/:id/signature", authMiddleware, getSignatureHandler as any);

router.get("/api/trips/:id/pdf", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER", "DRIVER"), getTripPdfHandler as any);
router.get("/api/trips/:id/pdf/download", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER", "DRIVER"), downloadTripPdfHandler as any);

router.get("/api/trips/:id/invoice", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER"), getTripInvoiceHandler as any);
router.post("/api/trips/:id/invoice", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), createTripInvoiceHandler as any);

export function registerTripRoutes(app: Express) {
  app.use(router);
}
