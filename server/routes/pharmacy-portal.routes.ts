import type { Express } from "express";
import { authMiddleware, requireRole } from "../auth";
import { requirePharmacyScope, requirePharmacyAdmin } from "../middleware/requirePharmacyScope";
import { phiAuditFor } from "../middleware/phiAudit";
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
  pharmacyGenerateRoutesHandler,
  pharmacyDispatchRouteHandler,
  pharmacyDriversHandler,
  driverDeliveryConfirmHandler,
  driverActiveDeliveriesHandler,
  dispatchPharmacyDeliveriesHandler,
  dispatchAssignPharmacyDeliveryHandler,
  pharmacyInventoryListHandler,
  pharmacyInventoryAdjustHandler,
  pharmacyInventoryAddHandler,
  pharmacyPrescriptionsListHandler,
  pharmacyPrescriptionCreateHandler,
  pharmacyBillingInvoicesHandler,
  pharmacyBillingSummaryHandler,
  pharmacyAdvancedMetricsHandler,
  pharmacyTemperatureLogHandler,
  pharmacyComplianceSummaryHandler,
  pharmacyChainOfCustodyHandler,
  pharmacyFeedbackHandler,
  pharmacyAutomationSettingsGetHandler,
  pharmacyAutomationSettingsUpdateHandler,
  pharmacyErxIncomingHandler,
  pharmacyErxWebhookHandler,
  pharmacyErxVerifyPrescriberHandler,
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

  // Smart routing — generate optimized delivery routes
  app.post("/api/pharmacy/routes/generate", authMiddleware, requirePharmacyScope as any, pharmacyGenerateRoutesHandler as any);

  // Dispatch route — assign to own driver or send to dispatcher
  app.post("/api/pharmacy/routes/dispatch", authMiddleware, requirePharmacyScope as any, pharmacyDispatchRouteHandler as any);

  // Pharmacy drivers — list available drivers for the pharmacy
  app.get("/api/pharmacy/drivers", authMiddleware, requirePharmacyScope as any, pharmacyDriversHandler as any);

  // Driver delivery confirmation — signature + photo + ID verification
  app.post("/api/driver/deliveries/:orderId/confirm", authMiddleware, phiAuditFor("pharmacy_delivery") as any, driverDeliveryConfirmHandler as any);

  // Driver active pharmacy deliveries
  app.get("/api/driver/pharmacy-deliveries", authMiddleware, driverActiveDeliveriesHandler as any);

  // Dispatch pharmacy deliveries panel (for dispatch/admin roles)
  app.get("/api/dispatch/pharmacy-deliveries", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH") as any, dispatchPharmacyDeliveriesHandler as any);
  app.post("/api/dispatch/pharmacy-deliveries/:id/assign", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH") as any, dispatchAssignPharmacyDeliveryHandler as any);

  // Inventory management
  app.get("/api/pharmacy/inventory", authMiddleware, requirePharmacyScope as any, pharmacyInventoryListHandler as any);
  app.post("/api/pharmacy/inventory", authMiddleware, requirePharmacyScope as any, pharmacyInventoryAddHandler as any);
  app.patch("/api/pharmacy/inventory", authMiddleware, requirePharmacyScope as any, pharmacyInventoryAdjustHandler as any);

  // Prescription management
  app.get("/api/pharmacy/prescriptions", authMiddleware, phiAuditFor("pharmacy_prescription") as any, requirePharmacyScope as any, pharmacyPrescriptionsListHandler as any);
  app.post("/api/pharmacy/prescriptions", authMiddleware, phiAuditFor("pharmacy_prescription") as any, requirePharmacyScope as any, pharmacyPrescriptionCreateHandler as any);

  // Billing
  app.get("/api/pharmacy/billing/invoices", authMiddleware, requirePharmacyScope as any, pharmacyBillingInvoicesHandler as any);
  app.get("/api/pharmacy/billing/summary", authMiddleware, requirePharmacyScope as any, pharmacyBillingSummaryHandler as any);

  // Advanced analytics
  app.get("/api/pharmacy/analytics", authMiddleware, requirePharmacyScope as any, pharmacyAdvancedMetricsHandler as any);

  // Temperature monitoring
  app.get("/api/pharmacy/orders/:id/temperature-log", authMiddleware, requirePharmacyScope as any, pharmacyTemperatureLogHandler as any);

  // Compliance
  app.get("/api/pharmacy/compliance/summary", authMiddleware, phiAuditFor("pharmacy_compliance") as any, requirePharmacyScope as any, pharmacyComplianceSummaryHandler as any);
  app.get("/api/pharmacy/compliance/chain-of-custody/:orderId", authMiddleware, phiAuditFor("pharmacy_compliance") as any, requirePharmacyScope as any, pharmacyChainOfCustodyHandler as any);

  // Customer feedback
  app.get("/api/pharmacy/feedback", authMiddleware, requirePharmacyScope as any, pharmacyFeedbackHandler as any);

  // Automation settings
  app.get("/api/pharmacy/automation-settings", authMiddleware, requirePharmacyAdmin as any, pharmacyAutomationSettingsGetHandler as any);
  app.patch("/api/pharmacy/automation-settings", authMiddleware, requirePharmacyAdmin as any, pharmacyAutomationSettingsUpdateHandler as any);

  // e-Rx / SureScripts integration
  app.post("/api/pharmacy/erx/incoming", authMiddleware, phiAuditFor("pharmacy_prescription") as any, requirePharmacyScope as any, pharmacyErxIncomingHandler as any);
  app.get("/api/pharmacy/erx/verify-prescriber", authMiddleware, requirePharmacyScope as any, pharmacyErxVerifyPrescriberHandler as any);

  // e-Rx webhook (NO auth — uses HMAC signature verification)
  app.post("/api/pharmacy/erx/webhook", pharmacyErxWebhookHandler as any);

  // Public tracking (NO auth required)
  app.get("/api/pharmacy/track/:publicId", pharmacyPublicTrackingHandler as any);
}
