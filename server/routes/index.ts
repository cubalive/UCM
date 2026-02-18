import type { Express } from "express";
import { type Server } from "http";
import { authMiddleware, opsRouteGuard } from "../auth";
import { healthz, healthLegacy, pwaHealth } from "../controllers/health.controller";
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
import { registerOpsRoutes, startOpsAlertScheduler } from "../lib/opsRoutes";
import { registerAutomationRoutes } from "../lib/automationRoutes";
import { registerScheduleRoutes } from "../lib/scheduleRoutes";
import { registerPricingRoutes } from "../lib/pricingRoutes";
import { registerAssignmentRoutes } from "../lib/assignmentRoutes";
import { registerPublicApiRoutes } from "../lib/publicApiRoutes";
import { registerClinicBillingRoutes } from "../lib/clinicBillingRoutes";
import { registerStripeConnectRoutes } from "../lib/stripeConnectRoutes";
import { registerPayrollRoutes, startPayrollScheduler } from "../lib/payrollRoutes";
import { registerIntelligenceRoutes } from "./intelligence.routes";
import { registerImportRoutes } from "./imports.routes";
import { registerTimePayRoutes } from "./timepay.routes";
import { registerBillingV2Routes } from "./billingV2.routes";
import { registerPlatformFeeRoutes } from "./platformFee.routes";
import { registerInfraOpsRoutes } from "./ops.routes";
import { startRouteScheduler } from "../lib/routeEngine";
import { startNoShowScheduler } from "../lib/noShowEngine";
import { startRecurringScheduleScheduler } from "../lib/recurringScheduleEngine";
import { startAiEngine } from "../lib/aiEngine";
import { startOpsScheduler } from "../lib/opsScheduler";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/healthz", healthz);
  app.get("/api/health", healthLegacy);
  app.get("/api/pwa/health", pwaHealth);

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
  registerAssignmentRoutes(app, authMiddleware);
  registerPublicApiRoutes(app);
  registerClinicBillingRoutes(app);
  registerStripeConnectRoutes(app);
  registerPayrollRoutes(app);

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
  registerInfraOpsRoutes(app);

  startOpsAlertScheduler();
  startRouteScheduler();
  startNoShowScheduler();
  startRecurringScheduleScheduler();
  startAiEngine();
  startOpsScheduler();
  startPayrollScheduler();

  return httpServer;
}
