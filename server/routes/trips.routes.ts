import express, { type Express } from "express";
import { authMiddleware, requireRole, requirePermission, type AuthRequest } from "../auth";
import { requireTenantScope, requireCityAccess } from "../middleware";
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
  acceptTripHandler,
  createReturnTripHandler,
  recomputeRouteHandler,
  driverSignatureHandler,
  clinicSignatureHandler,
  getSignatureHandler,
  getTripPdfHandler,
  downloadTripPdfHandler,
  getTripInvoiceHandler,
  createTripInvoiceHandler,
  dispatchOverrideStatusHandler,
} from "../controllers/trips.controller";

const router = express.Router();

router.get("/api/recurring-schedules", authMiddleware, requirePermission("trips", "read"), requireTenantScope, getRecurringSchedulesHandler as any);
router.post("/api/recurring-schedules", authMiddleware, requirePermission("trips", "write"), requireTenantScope, createRecurringScheduleHandler as any);
router.patch("/api/recurring-schedules/:id", authMiddleware, requirePermission("trips", "write"), requireTenantScope, updateRecurringScheduleHandler as any);
router.delete("/api/recurring-schedules/:id", authMiddleware, requirePermission("trips", "write"), requireTenantScope, deleteRecurringScheduleHandler as any);
router.post("/api/recurring-schedules/generate", authMiddleware, requireRole("SUPER_ADMIN"), generateRecurringSchedulesHandler as any);

router.patch("/api/trips/:id/assign", authMiddleware, requirePermission("dispatch", "write"), requireTenantScope, assignTripHandler as any);

router.get("/api/trips/:id/messages", authMiddleware, requirePermission("trips", "read"), requireTenantScope, getTripMessagesHandler as any);
router.post("/api/trips/:id/messages", authMiddleware, requirePermission("trips", "write"), requireTenantScope, createTripMessageHandler as any);

router.get("/api/trips", authMiddleware, requirePermission("trips", "read"), requireTenantScope, requireCityAccess, getTripsHandler as any);
router.get("/api/trips/:id", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "SUPER_ADMIN", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER"), requireTenantScope, getTripByIdHandler as any);
router.post("/api/trips", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "SUPER_ADMIN"), requireTenantScope, idempotencyMiddleware, createTripHandler as any);
router.patch("/api/trips/:id", authMiddleware, requirePermission("trips", "write"), requireTenantScope, updateTripHandler as any);

router.patch("/api/trips/:id/status", authMiddleware, requireRole("ADMIN", "DISPATCH", "DRIVER", "SUPER_ADMIN", "COMPANY_ADMIN"), requireTenantScope, updateTripStatusHandler as any);
router.post("/api/trips/:id/status/override", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), requireTenantScope, dispatchOverrideStatusHandler as any);

router.post("/api/trips/:id/accept", authMiddleware, requireRole("DRIVER"), requireTenantScope, acceptTripHandler as any);

router.get("/api/trips/:id/dialysis-return-check", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN"), requireTenantScope, dialysisReturnCheckHandler as any);
router.post("/api/trips/:id/dialysis-return-adjust", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN"), requireTenantScope, dialysisReturnAdjustHandler as any);

router.patch("/api/trips/:id/approve", authMiddleware, requirePermission("trips", "write"), requireTenantScope, approveTripHandler as any);
router.patch("/api/trips/:id/cancel-request", authMiddleware, requireRole("VIEWER", "CLINIC_USER", "CLINIC_ADMIN"), requireTenantScope, cancelRequestHandler as any);
router.patch("/api/trips/:id/reject-cancel", authMiddleware, requirePermission("trips", "write"), requireTenantScope, rejectCancelHandler as any);
router.patch("/api/trips/:id/cancel", authMiddleware, requirePermission("trips", "write"), requireTenantScope, cancelTripHandler as any);

router.post("/api/trips/:id/return-trip", authMiddleware, requirePermission("trips", "write"), requireTenantScope, createReturnTripHandler as any);
router.post("/api/trips/:id/route/recompute", authMiddleware, requirePermission("dispatch", "write"), requireTenantScope, recomputeRouteHandler as any);

router.post("/api/trips/:id/signature/driver", authMiddleware, requireRole("DRIVER", "SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), requireTenantScope, driverSignatureHandler as any);
router.post("/api/trips/:id/signature/clinic", authMiddleware, requireRole("CLINIC_USER", "CLINIC_ADMIN", "SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), requireTenantScope, clinicSignatureHandler as any);
router.get("/api/trips/:id/signature", authMiddleware, requirePermission("trips", "read"), requireTenantScope, getSignatureHandler as any);

router.get("/api/trips/:id/pdf", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER", "DRIVER"), requireTenantScope, getTripPdfHandler as any);
router.get("/api/trips/:id/pdf/download", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER", "DRIVER"), requireTenantScope, downloadTripPdfHandler as any);

router.get("/api/trips/:id/invoice", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER"), requireTenantScope, getTripInvoiceHandler as any);
router.post("/api/trips/:id/invoice", authMiddleware, requirePermission("invoices", "write"), requireTenantScope, createTripInvoiceHandler as any);

export function registerTripRoutes(app: Express) {
  app.use(router);
}
