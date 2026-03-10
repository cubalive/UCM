import type { Express } from "express";
import { authMiddleware } from "../auth";
import { requirePharmacyScope, requirePharmacyAdmin } from "../middleware/requirePharmacyScope";
import {
  pharmacyDashboardHandler,
  pharmacyOrdersListHandler,
  pharmacyOrderDetailHandler,
  pharmacyCreateOrderHandler,
  pharmacyUpdateOrderStatusHandler,
  pharmacyProfileHandler,
  pharmacyActiveDeliveriesHandler,
  pharmacyMetricsHandler,
} from "../controllers/pharmacy-portal.controller";

export function registerPharmacyPortalRoutes(app: Express) {
  // Dashboard
  app.get("/api/pharmacy/dashboard", authMiddleware, requirePharmacyScope as any, pharmacyDashboardHandler as any);

  // Orders CRUD
  app.get("/api/pharmacy/orders", authMiddleware, requirePharmacyScope as any, pharmacyOrdersListHandler as any);
  app.get("/api/pharmacy/orders/:id", authMiddleware, requirePharmacyScope as any, pharmacyOrderDetailHandler as any);
  app.post("/api/pharmacy/orders", authMiddleware, requirePharmacyScope as any, pharmacyCreateOrderHandler as any);
  app.patch("/api/pharmacy/orders/:id/status", authMiddleware, requirePharmacyScope as any, pharmacyUpdateOrderStatusHandler as any);

  // Active deliveries (live tracking)
  app.get("/api/pharmacy/active-deliveries", authMiddleware, requirePharmacyScope as any, pharmacyActiveDeliveriesHandler as any);

  // Profile
  app.get("/api/pharmacy/profile", authMiddleware, requirePharmacyScope as any, pharmacyProfileHandler as any);

  // Metrics
  app.get("/api/pharmacy/metrics", authMiddleware, requirePharmacyScope as any, pharmacyMetricsHandler as any);
}
