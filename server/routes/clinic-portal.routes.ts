import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { requireClinicScope, requireClinicAdmin } from "../middleware/requireClinicScope";
import {
  clinicOpsHandler,
  clinicActiveTripsHandler,
  clinicMetricsHandler,
  clinicMapHandler,
  clinicTripsExportHandler,
  clinicTripsHandler,
  clinicTripByIdHandler,
  clinicTripPdfHandler,
  clinicTripTrackingHandler,
  clinicInvoicesHandler,
  clinicInvoiceByIdHandler,
  clinicDeletePatientHandler,
  clinicDeleteTripHandler,
  clinicPatientsHandler,
  clinicProfileHandler,
  clinicRecurringSchedulesHandler,
  clinicInboundLiveHandler,
  clinicAlertInputsHandler,
} from "../controllers/clinic-portal.controller";
import {
  getClinicUsersHandler,
  createClinicUserHandler,
  updateClinicUserHandler,
  resetClinicUserPasswordHandler,
} from "../controllers/clinic-users.controller";

export function registerClinicPortalRoutes(app: Express) {
  app.get("/api/clinic/ops", authMiddleware, requireClinicScope as any, clinicOpsHandler as any);
  app.get("/api/clinic/active-trips", authMiddleware, requireClinicScope as any, clinicActiveTripsHandler as any);
  app.get("/api/clinic/metrics", authMiddleware, requireClinicScope as any, clinicMetricsHandler as any);
  app.get("/api/clinic/map", authMiddleware, requireClinicScope as any, clinicMapHandler as any);
  app.get("/api/clinic/trips/export", authMiddleware, requireClinicScope as any, clinicTripsExportHandler as any);
  app.get("/api/clinic/trips", authMiddleware, requireClinicScope as any, clinicTripsHandler as any);
  app.get("/api/clinic/trips/:id", authMiddleware, requireClinicScope as any, clinicTripByIdHandler as any);
  app.get("/api/clinic/trips/:id/pdf", authMiddleware, requireClinicScope as any, clinicTripPdfHandler as any);
  app.get("/api/clinic/trips/:id/tracking", authMiddleware, requireClinicScope as any, clinicTripTrackingHandler as any);
  app.get("/api/clinic/invoices", authMiddleware, requireClinicScope as any, clinicInvoicesHandler as any);
  app.get("/api/clinic/invoices/:id", authMiddleware, requireClinicScope as any, clinicInvoiceByIdHandler as any);
  app.delete("/api/clinic/patients/:id", authMiddleware, requireClinicScope as any, clinicDeletePatientHandler as any);
  app.delete("/api/clinic/trips/:id", authMiddleware, requireClinicScope as any, clinicDeleteTripHandler as any);
  app.get("/api/clinic/patients", authMiddleware, requireClinicScope as any, clinicPatientsHandler as any);
  app.get("/api/clinic/profile", authMiddleware, requireClinicScope as any, clinicProfileHandler as any);
  app.get("/api/clinic/recurring-schedules", authMiddleware, requireClinicScope as any, clinicRecurringSchedulesHandler as any);
  app.get("/api/clinic/inbound-live", authMiddleware, requireClinicScope as any, clinicInboundLiveHandler as any);
  app.get("/api/clinic/alert-inputs", authMiddleware, requireClinicScope as any, clinicAlertInputsHandler as any);

  app.get("/api/clinic/users", authMiddleware, requireClinicAdmin as any, getClinicUsersHandler as any);
  app.post("/api/clinic/users", authMiddleware, requireClinicAdmin as any, createClinicUserHandler as any);
  app.patch("/api/clinic/users/:id", authMiddleware, requireClinicAdmin as any, updateClinicUserHandler as any);
  app.post("/api/clinic/users/:id/reset", authMiddleware, requireClinicAdmin as any, resetClinicUserPasswordHandler as any);
}
