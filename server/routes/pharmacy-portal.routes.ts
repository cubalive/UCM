import type { Express } from "express";
import { authMiddleware } from "../auth";
import { requirePharmacyScope, requirePharmacyAdmin } from "../middleware/requirePharmacyScope";
import { phiAuditFor } from "../middleware/phiAuditMiddleware";
import {
  pharmacyDashboardHandler,
  pharmacyOrdersListHandler,
  pharmacyOrderDetailHandler,
  pharmacyCreateOrderHandler,
  pharmacyUpdateOrderStatusHandler,
  pharmacyProfileHandler,
  pharmacyActiveDeliveriesHandler,
  pharmacyMetricsHandler,
  pharmacyPublicTrackingHandler,
} from "../controllers/pharmacy-portal.controller";

export function registerPharmacyPortalRoutes(app: Express) {
  // Dashboard
  app.get("/api/pharmacy/dashboard", authMiddleware, requirePharmacyScope as any, pharmacyDashboardHandler as any);

  // Orders CRUD — PHI audit logging for medication/patient data (HIPAA §164.312(b))
  app.get("/api/pharmacy/orders", authMiddleware, phiAuditFor("pharmacy_order") as any, requirePharmacyScope as any, pharmacyOrdersListHandler as any);
  app.get("/api/pharmacy/orders/:id", authMiddleware, phiAuditFor("pharmacy_order") as any, requirePharmacyScope as any, pharmacyOrderDetailHandler as any);
  app.post("/api/pharmacy/orders", authMiddleware, phiAuditFor("pharmacy_order") as any, requirePharmacyScope as any, pharmacyCreateOrderHandler as any);
  app.patch("/api/pharmacy/orders/:id/status", authMiddleware, phiAuditFor("pharmacy_order") as any, requirePharmacyScope as any, pharmacyUpdateOrderStatusHandler as any);

  // Active deliveries (live tracking) — contains patient destination info
  app.get("/api/pharmacy/active-deliveries", authMiddleware, phiAuditFor("pharmacy_delivery") as any, requirePharmacyScope as any, pharmacyActiveDeliveriesHandler as any);

  // Profile
  app.get("/api/pharmacy/profile", authMiddleware, requirePharmacyScope as any, pharmacyProfileHandler as any);

  // Metrics
  app.get("/api/pharmacy/metrics", authMiddleware, requirePharmacyScope as any, pharmacyMetricsHandler as any);

  // Public tracking (NO auth required)
  app.get("/api/pharmacy/track/:publicId", pharmacyPublicTrackingHandler as any);
}
