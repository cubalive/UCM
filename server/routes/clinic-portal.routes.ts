import type { Express } from "express";
import { authMiddleware, type AuthRequest } from "../auth";
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
} from "../controllers/clinic-portal.controller";

export function registerClinicPortalRoutes(app: Express) {
  app.get("/api/clinic/ops", authMiddleware, clinicOpsHandler as any);
  app.get("/api/clinic/active-trips", authMiddleware, clinicActiveTripsHandler as any);
  app.get("/api/clinic/metrics", authMiddleware, clinicMetricsHandler as any);
  app.get("/api/clinic/map", authMiddleware, clinicMapHandler as any);
  app.get("/api/clinic/trips/export", authMiddleware, clinicTripsExportHandler as any);
  app.get("/api/clinic/trips", authMiddleware, clinicTripsHandler as any);
  app.get("/api/clinic/trips/:id", authMiddleware, clinicTripByIdHandler as any);
  app.get("/api/clinic/trips/:id/pdf", authMiddleware, clinicTripPdfHandler as any);
  app.get("/api/clinic/trips/:id/tracking", authMiddleware, clinicTripTrackingHandler as any);
  app.get("/api/clinic/invoices", authMiddleware, clinicInvoicesHandler as any);
  app.get("/api/clinic/invoices/:id", authMiddleware, clinicInvoiceByIdHandler as any);
  app.delete("/api/clinic/patients/:id", authMiddleware, clinicDeletePatientHandler as any);
  app.delete("/api/clinic/trips/:id", authMiddleware, clinicDeleteTripHandler as any);
  app.get("/api/clinic/patients", authMiddleware, clinicPatientsHandler as any);
  app.get("/api/clinic/profile", authMiddleware, clinicProfileHandler as any);
  app.get("/api/clinic/recurring-schedules", authMiddleware, clinicRecurringSchedulesHandler as any);
}
