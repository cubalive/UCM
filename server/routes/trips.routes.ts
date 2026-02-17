import express, { type Express } from "express";
import { authMiddleware, requireRole, requirePermission, type AuthRequest } from "../auth";
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

router.get("/api/recurring-schedules", authMiddleware, requirePermission("trips", "read"), requireCompanyScope, getRecurringSchedulesHandler as any);
router.post("/api/recurring-schedules", authMiddleware, requirePermission("trips", "write"), requireCompanyScope, createRecurringScheduleHandler as any);
router.patch("/api/recurring-schedules/:id", authMiddleware, requirePermission("trips", "write"), requireCompanyScope, updateRecurringScheduleHandler as any);
router.delete("/api/recurring-schedules/:id", authMiddleware, requirePermission("trips", "write"), requireCompanyScope, deleteRecurringScheduleHandler as any);
router.post("/api/recurring-schedules/generate", authMiddleware, requireRole("SUPER_ADMIN"), generateRecurringSchedulesHandler as any);

router.patch("/api/trips/:id/assign", authMiddleware, requirePermission("dispatch", "write"), requireCompanyScope, assignTripHandler as any);

router.get("/api/trips/:id/messages", authMiddleware, requirePermission("trips", "read"), requireCompanyScope, getTripMessagesHandler as any);
router.post("/api/trips/:id/messages", authMiddleware, requirePermission("trips", "write"), requireCompanyScope, createTripMessageHandler as any);

router.get("/api/trips", authMiddleware, requirePermission("trips", "read"), requireCompanyScope, requireCityAccess, getTripsHandler as any);
router.get("/api/trips/:id", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "SUPER_ADMIN", "COMPANY_ADMIN", "CLINIC_USER"), requireCompanyScope, getTripByIdHandler as any);
router.post("/api/trips", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER", "SUPER_ADMIN"), requireCompanyScope, idempotencyMiddleware, createTripHandler as any);
router.patch("/api/trips/:id", authMiddleware, requirePermission("trips", "write"), requireCompanyScope, updateTripHandler as any);

router.patch("/api/trips/:id/status", authMiddleware, requireRole("ADMIN", "DISPATCH", "DRIVER", "SUPER_ADMIN", "COMPANY_ADMIN"), requireCompanyScope, updateTripStatusHandler as any);

router.get("/api/trips/:id/dialysis-return-check", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN", "COMPANY_ADMIN", "CLINIC_USER"), requireCompanyScope, dialysisReturnCheckHandler as any);
router.post("/api/trips/:id/dialysis-return-adjust", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN", "COMPANY_ADMIN", "CLINIC_USER"), requireCompanyScope, dialysisReturnAdjustHandler as any);

router.patch("/api/trips/:id/approve", authMiddleware, requirePermission("trips", "write"), requireCompanyScope, approveTripHandler as any);
router.patch("/api/trips/:id/cancel-request", authMiddleware, requireRole("VIEWER"), requireCompanyScope, cancelRequestHandler as any);
router.patch("/api/trips/:id/reject-cancel", authMiddleware, requirePermission("trips", "write"), requireCompanyScope, rejectCancelHandler as any);
router.patch("/api/trips/:id/cancel", authMiddleware, requirePermission("trips", "write"), requireCompanyScope, cancelTripHandler as any);

router.post("/api/trips/:id/return-trip", authMiddleware, requirePermission("trips", "write"), requireCompanyScope, createReturnTripHandler as any);
router.post("/api/trips/:id/route/recompute", authMiddleware, requirePermission("dispatch", "write"), requireCompanyScope, recomputeRouteHandler as any);

router.post("/api/trips/:id/signature/driver", authMiddleware, requireRole("DRIVER", "SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), requireCompanyScope, driverSignatureHandler as any);
router.post("/api/trips/:id/signature/clinic", authMiddleware, requireRole("CLINIC_USER", "SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), requireCompanyScope, clinicSignatureHandler as any);
router.get("/api/trips/:id/signature", authMiddleware, requirePermission("trips", "read"), requireCompanyScope, getSignatureHandler as any);

router.get("/api/trips/:id/pdf", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER", "DRIVER"), requireCompanyScope, getTripPdfHandler as any);
router.get("/api/trips/:id/pdf/download", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER", "DRIVER"), requireCompanyScope, downloadTripPdfHandler as any);

router.get("/api/trips/:id/invoice", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER"), requireCompanyScope, getTripInvoiceHandler as any);
router.post("/api/trips/:id/invoice", authMiddleware, requirePermission("invoices", "write"), requireCompanyScope, createTripInvoiceHandler as any);

export function registerTripRoutes(app: Express) {
  app.use(router);
}
