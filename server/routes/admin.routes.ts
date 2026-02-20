import express, { type Express } from "express";
import { authMiddleware, requireRole, requirePermission, type AuthRequest } from "../auth";
import {
  getCityMismatchHandler,
  archiveClinicHandler,
  restoreClinicHandler,
  permanentDeleteClinicHandler,
  archiveDriverHandler,
  restoreDriverHandler,
  permanentDeleteDriverHandler,
  archivePatientHandler,
  restorePatientHandler,
  permanentDeletePatientHandler,
  archiveUserHandler,
  restoreUserHandler,
  permanentDeleteUserHandler,
  resetUserPasswordHandler,
  resetClinicPasswordHandler,
  resetDriverPasswordHandler,
  archiveVehicleHandler,
  restoreVehicleHandler,
  permanentDeleteVehicleHandler,
  archiveCompanyHandler,
  restoreCompanyHandler,
  permanentDeleteCompanyHandler,
  archiveTripHandler,
  restoreTripHandler,
  permanentDeleteTripHandler,
  deepHealthHandler,
  aiEngineSnapshotHandler,
  aiEngineStatusHandler,
  opsIntelScoresHandler,
  opsIntelAnomaliesHandler,
  opsIntelRecomputeHandler,
  opsIntelScoresCsvHandler,
  batchPdfHandler,
  batchPdfDownloadHandler,
  appConfigHandler,
  realtimeTokenHandler,
  realtimeMetricsHandler,
  realtimeTestHandler,
  directionsMetricsHandler,
  corsOriginsHandler,
  authDiagnosticsHandler,
  getJobHandler,
  queueStatsHandler,
  systemEventsHandler,
  opsJobsHandler,
  debugEmailHealthHandler,
  healthEmailHandler,
  clinicPatientArchiveHandler,
  clinicPatientUnarchiveHandler,
  hardDeletePreviewHandler,
  hardDeleteHandler,
  getCompanyCitiesHandler,
  setCompanyCitiesHandler,
  getClinicCompaniesHandler,
  setClinicCompaniesHandler,
  getAllCompanyCitiesHandler,
  getAllClinicCompaniesHandler,
  batchArchiveTripsHandler,
  unarchiveTripHandler,
  archiveStatsHandler,
} from "../controllers/admin.controller";

const router = express.Router();

router.get("/api/admin/clinics/city-mismatch", authMiddleware, requireRole("SUPER_ADMIN"), getCityMismatchHandler as any);
router.patch("/api/admin/clinics/:id/archive", authMiddleware, requirePermission("clinics", "write"), archiveClinicHandler as any);
router.patch("/api/admin/clinics/:id/restore", authMiddleware, requirePermission("clinics", "write"), restoreClinicHandler as any);
router.delete("/api/admin/clinics/:id/permanent", authMiddleware, requireRole("SUPER_ADMIN"), permanentDeleteClinicHandler as any);
router.patch("/api/admin/drivers/:id/archive", authMiddleware, requirePermission("drivers", "write"), archiveDriverHandler as any);
router.patch("/api/admin/drivers/:id/restore", authMiddleware, requirePermission("drivers", "write"), restoreDriverHandler as any);
router.delete("/api/admin/drivers/:id/permanent", authMiddleware, requireRole("SUPER_ADMIN"), permanentDeleteDriverHandler as any);
router.patch("/api/admin/patients/:id/archive", authMiddleware, requirePermission("patients", "write"), archivePatientHandler as any);
router.patch("/api/admin/patients/:id/restore", authMiddleware, requirePermission("patients", "write"), restorePatientHandler as any);
router.delete("/api/admin/patients/:id/permanent", authMiddleware, requireRole("SUPER_ADMIN"), permanentDeletePatientHandler as any);
router.patch("/api/admin/users/:id/archive", authMiddleware, requireRole("SUPER_ADMIN"), archiveUserHandler as any);
router.patch("/api/admin/users/:id/restore", authMiddleware, requireRole("SUPER_ADMIN"), restoreUserHandler as any);
router.delete("/api/admin/users/:id/permanent", authMiddleware, requireRole("SUPER_ADMIN"), permanentDeleteUserHandler as any);
router.post("/api/admin/users/:id/reset-password", authMiddleware, requireRole("SUPER_ADMIN"), resetUserPasswordHandler as any);
router.post("/api/admin/clinics/:id/reset-password", authMiddleware, requireRole("SUPER_ADMIN"), resetClinicPasswordHandler as any);
router.post("/api/admin/drivers/:id/reset-password", authMiddleware, requireRole("SUPER_ADMIN"), resetDriverPasswordHandler as any);
router.patch("/api/admin/vehicles/:id/archive", authMiddleware, requirePermission("vehicles", "write"), archiveVehicleHandler as any);
router.patch("/api/admin/vehicles/:id/restore", authMiddleware, requirePermission("vehicles", "write"), restoreVehicleHandler as any);
router.delete("/api/admin/vehicles/:id/permanent", authMiddleware, requireRole("SUPER_ADMIN"), permanentDeleteVehicleHandler as any);

router.patch("/api/admin/companies/:id/archive", authMiddleware, requireRole("SUPER_ADMIN"), archiveCompanyHandler as any);
router.patch("/api/admin/companies/:id/restore", authMiddleware, requireRole("SUPER_ADMIN"), restoreCompanyHandler as any);
router.delete("/api/admin/companies/:id/permanent", authMiddleware, requireRole("SUPER_ADMIN"), permanentDeleteCompanyHandler as any);

router.patch("/api/admin/trips/:id/archive", authMiddleware, requirePermission("trips", "write"), archiveTripHandler as any);
router.patch("/api/admin/trips/:id/restore", authMiddleware, requirePermission("trips", "write"), restoreTripHandler as any);
router.delete("/api/admin/trips/:id/permanent", authMiddleware, requireRole("SUPER_ADMIN"), permanentDeleteTripHandler as any);

router.patch("/api/clinic/patients/:id/archive", authMiddleware, requireRole("CLINIC_USER", "CLINIC_ADMIN"), clinicPatientArchiveHandler as any);
router.patch("/api/clinic/patients/:id/unarchive", authMiddleware, requireRole("CLINIC_USER", "CLINIC_ADMIN"), clinicPatientUnarchiveHandler as any);

router.get("/api/admin/hard-delete/preview", authMiddleware, requireRole("SUPER_ADMIN"), hardDeletePreviewHandler as any);
router.post("/api/admin/hard-delete", authMiddleware, requireRole("SUPER_ADMIN"), hardDeleteHandler as any);

router.get("/api/admin/health/deep", authMiddleware, requirePermission("dashboard", "read"), deepHealthHandler as any);
router.get("/api/admin/ai-engine/snapshot", authMiddleware, requirePermission("dashboard", "read"), aiEngineSnapshotHandler as any);
router.get("/api/admin/ai-engine/status", authMiddleware, requirePermission("dashboard", "read"), aiEngineStatusHandler as any);
router.get("/api/admin/ops-intel/scores", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN"), opsIntelScoresHandler as any);
router.get("/api/admin/ops-intel/anomalies", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN"), opsIntelAnomaliesHandler as any);
router.post("/api/admin/ops-intel/scores/recompute", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN"), opsIntelRecomputeHandler as any);
router.get("/api/admin/ops-intel/scores/csv", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN"), opsIntelScoresCsvHandler as any);
router.post("/api/trips/pdf/batch", authMiddleware, requirePermission("trips", "read"), batchPdfHandler as any);
router.get("/api/trips/pdf/batch/:jobId/download", authMiddleware, requirePermission("trips", "read"), batchPdfDownloadHandler as any);
router.get("/api/app-config", authMiddleware, appConfigHandler as any);
router.post("/api/realtime/token", authMiddleware, requireRole("CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER", "DISPATCH", "ADMIN", "SUPER_ADMIN", "DRIVER", "COMPANY_ADMIN"), realtimeTokenHandler as any);
router.get("/api/ops/realtime-metrics", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN"), realtimeMetricsHandler as any);
router.post("/api/realtime/test", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), realtimeTestHandler as any);
router.get("/api/ops/directions-metrics", authMiddleware, requirePermission("dashboard", "read"), directionsMetricsHandler as any);
router.get("/api/ops/cors-origins", authMiddleware, requireRole("SUPER_ADMIN"), corsOriginsHandler as any);
router.get("/api/ops/auth-diagnostics", authMiddleware, requireRole("SUPER_ADMIN"), authDiagnosticsHandler as any);
router.get("/api/jobs/:id", authMiddleware, getJobHandler as any);
router.get("/api/ops/queue-stats", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN"), queueStatsHandler as any);
router.get("/api/ops/system-events", authMiddleware, requireRole("SUPER_ADMIN"), systemEventsHandler as any);
router.get("/api/ops/jobs", authMiddleware, requirePermission("dashboard", "read"), opsJobsHandler as any);
router.get("/api/debug/email-health", authMiddleware, requireRole("SUPER_ADMIN"), debugEmailHealthHandler as any);
router.get("/api/health/email", healthEmailHandler as any);

router.get("/api/admin/company-cities", authMiddleware, requireRole("SUPER_ADMIN"), getAllCompanyCitiesHandler as any);
router.get("/api/admin/companies/:companyId/cities", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"), getCompanyCitiesHandler as any);
router.put("/api/admin/companies/:companyId/cities", authMiddleware, requireRole("SUPER_ADMIN"), setCompanyCitiesHandler as any);
router.get("/api/admin/clinic-companies", authMiddleware, requireRole("SUPER_ADMIN"), getAllClinicCompaniesHandler as any);
router.get("/api/admin/clinics/:clinicId/companies", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"), getClinicCompaniesHandler as any);
router.put("/api/admin/clinics/:clinicId/companies", authMiddleware, requireRole("SUPER_ADMIN"), setClinicCompaniesHandler as any);

router.post("/api/admin/archive-trips", authMiddleware, requireRole("SUPER_ADMIN"), batchArchiveTripsHandler as any);
router.post("/api/admin/unarchive-trip/:id", authMiddleware, requireRole("SUPER_ADMIN"), unarchiveTripHandler as any);
router.get("/api/admin/archive-stats", authMiddleware, requireRole("SUPER_ADMIN"), archiveStatsHandler as any);

export function registerAdminRoutes(app: Express) {
  app.use(router);
}
