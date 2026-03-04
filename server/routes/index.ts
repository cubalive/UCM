import type { Express } from "express";
import { type Server } from "http";
import { authMiddleware, opsRouteGuard } from "../auth";
import { healthz, healthLegacy, pwaHealth, healthDetailedHandler, healthDbDetails, versionHandler, crashSimulation, readyz } from "../controllers/health.controller";
import { dbCheckHandler } from "../controllers/dbCheck.controller";
import { requireRole } from "../auth";
import { registerAuthRoutes } from "./auth.routes";
import { registerCityRoutes } from "./cities.routes";
import { registerUserRoutes } from "./users.routes";
import { registerVehicleRoutes } from "./vehicles.routes";
import { registerDriverRoutes } from "./drivers.routes";
import { registerClinicRoutes } from "./clinics.routes";
import { registerPatientRoutes } from "./patients.routes";
import { registerTripRoutes } from "./trips.routes";
import { registerInvoiceRoutes } from "./invoices.routes";
import { registerDriverPortalRoutes } from "./driver-portal.routes";
import { registerClinicPortalRoutes } from "./clinic-portal.routes";
import { registerAdminRoutes } from "./admin.routes";
import { registerMapsRoutes } from "../lib/mapsRoutes";
import { registerDispatchRoutes } from "../lib/dispatchRoutes";
import { registerSmsRoutes } from "../lib/smsRoutes";
import { registerVehicleAssignRoutes } from "../lib/vehicleAssignRoutes";
import { registerTrackingRoutes } from "../lib/trackingRoutes";
import { registerTripSeriesRoutes } from "../lib/tripSeriesRoutes";
import { registerReportRoutes } from "../lib/reportRoutes";
import { registerOpsRoutes } from "../lib/opsRoutes";
import { registerAutomationRoutes } from "../lib/automationRoutes";
import { registerScheduleRoutes } from "../lib/scheduleRoutes";
import { registerPricingRoutes } from "../lib/pricingRoutes";
import { registerAdminPricingRoutes } from "../lib/adminPricingRoutes";
import { registerAssignmentRoutes } from "../lib/assignmentRoutes";
import { registerPublicApiRoutes } from "../lib/publicApiRoutes";
import { registerClinicBillingRoutes } from "../lib/clinicBillingRoutes";
import { registerStripeConnectRoutes } from "../lib/stripeConnectRoutes";
import { registerPayrollRoutes } from "../lib/payrollRoutes";
import { registerPayrollModifierRoutes } from "../controllers/payroll.controller";
import { registerIntelligenceRoutes } from "./intelligence.routes";
import { registerImportRoutes } from "./imports.routes";
import { registerTimePayRoutes } from "./timepay.routes";
import { registerBillingV2Routes } from "./billingV2.routes";
import { registerPlatformFeeRoutes } from "./platformFee.routes";
import { registerDispatcherPermissionsRoutes } from "./dispatcherPermissions.routes";
import { registerInfraOpsRoutes } from "./ops.routes";
import { registerSubscriptionRoutes, registerSubscriptionWebhook } from "./subscription.routes";
import { registerEnterpriseFinanceRoutes } from "./enterpriseFinance.routes";
import { registerFeeRulesRoutes } from "./feeRules.routes";
import { registerTripRequestRoutes } from "./trip-requests.routes";
import { registerQueueRoutes } from "./queue.routes";
import { registerAutoAssignV2Routes } from "../lib/autoAssignV2Routes";
import { registerEtaVarianceRoutes } from "../lib/etaVarianceRoutes";
import { registerZeroTouchDialysisRoutes } from "../lib/zeroTouchDialysisRoutes";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const { getAppKeyForHostname, getAASA } = await import("../config/apps");
  app.get("/.well-known/apple-app-site-association", (req, res) => {
    const appKey = getAppKeyForHostname(req.hostname || "");
    res.set({
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      "Pragma": "no-cache",
      "Surrogate-Control": "no-store",
      "Vary": "Host",
    });
    res.json(getAASA(appKey));
  });

  const { releaseReadinessHandler, smokeTestHandler } = await import("../controllers/releaseReadiness.controller");

  app.get("/api/healthz", healthz);
  app.get("/api/readyz", readyz);
  app.get("/api/health", healthLegacy);
  app.get("/api/version", versionHandler);
  app.get("/api/health/detailed", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN"), healthDetailedHandler as any);
  app.get("/api/health/details", authMiddleware, requireRole("SUPER_ADMIN"), healthDbDetails as any);
  app.get("/api/pwa/health", pwaHealth);
  app.get("/api/system/db-check", authMiddleware, requireRole("SUPER_ADMIN"), dbCheckHandler as any);
  app.get("/api/system/release-readiness", authMiddleware, requireRole("SUPER_ADMIN"), releaseReadinessHandler as any);
  app.post("/api/system/release-readiness/smoke-test", authMiddleware, requireRole("SUPER_ADMIN"), smokeTestHandler as any);
  app.get("/api/dev/crash", crashSimulation);

  registerMapsRoutes(app);
  registerDispatchRoutes(app);
  registerSmsRoutes(app);
  registerVehicleAssignRoutes(app);
  registerTrackingRoutes(app);
  registerTripSeriesRoutes(app);
  registerReportRoutes(app);
  app.use("/api/ops", authMiddleware, opsRouteGuard);
  registerOpsRoutes(app);
  registerAutomationRoutes(app);
  registerScheduleRoutes(app);
  registerPricingRoutes(app);
  registerAdminPricingRoutes(app);
  registerAssignmentRoutes(app, authMiddleware);
  registerPublicApiRoutes(app);
  registerClinicBillingRoutes(app);
  registerStripeConnectRoutes(app);
  registerPayrollRoutes(app);
  registerPayrollModifierRoutes(app);

  registerAuthRoutes(app);
  registerCityRoutes(app);
  registerUserRoutes(app);
  registerVehicleRoutes(app);
  registerDriverRoutes(app);
  registerClinicRoutes(app);
  registerPatientRoutes(app);
  registerTripRoutes(app);
  registerInvoiceRoutes(app);
  registerDriverPortalRoutes(app);
  registerClinicPortalRoutes(app);
  registerAdminRoutes(app);
  registerIntelligenceRoutes(app);
  registerImportRoutes(app);
  registerTimePayRoutes(app);
  registerBillingV2Routes(app);
  registerPlatformFeeRoutes(app);
  registerDispatcherPermissionsRoutes(app);
  registerInfraOpsRoutes(app);
  registerSubscriptionRoutes(app);
  registerSubscriptionWebhook(app);
  registerEnterpriseFinanceRoutes(app);
  registerFeeRulesRoutes(app);
  registerTripRequestRoutes(app);
  registerAutoAssignV2Routes(app);
  registerEtaVarianceRoutes(app);
  registerZeroTouchDialysisRoutes(app);
  registerQueueRoutes(app);

  return httpServer;
}
