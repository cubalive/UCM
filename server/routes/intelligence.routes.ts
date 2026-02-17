import express, { type Express } from "express";
import { authMiddleware, requireRole } from "../auth";
import { requireCityAccess } from "../middleware/requireCityAccess";
import {
  getDailyRollupsHandler,
  getWeeklySnapshotsHandler,
  getRankingsHandler,
  getMyPerformanceHandler,
  getCostLeakAlertsHandler,
  acknowledgeCostLeakAlertHandler,
  resolveCostLeakAlertHandler,
  getCertificationsHandler,
  getTriScoresHandler,
  getIndexesSummaryHandler,
  getIndexesPdfHandler,
} from "../controllers/intelligence.controller";
import {
  listPublicationsHandler,
  createPublicationHandler,
  updatePublicationHandler,
  publishHandler,
  unpublishHandler,
  deletePublicationHandler,
  addTargetHandler,
  removeTargetHandler,
  listClinicsForTargetHandler,
} from "../controllers/publishCenter.controller";
import {
  getCertificationsModuleHandler,
  computeAndSaveCertificationsHandler,
  getCertificationPdfHandler,
  getRankingsModuleHandler,
  computeAndSaveRankingsHandler,
  getRankingPdfHandler,
  getAuditShieldHandler,
  getAuditPdfHandler,
  getPredictionsHandler,
  getPredictionPdfHandler,
  generateQuarterlyReportHandler,
  getQuarterlyReportPdfHandler,
  clinicCertificationHandler,
  clinicCertificationPdfHandler,
  clinicRankingHandler,
  clinicRankingPdfHandler,
  clinicAuditHandler,
  clinicAuditPdfHandler,
  clinicQuarterlyReportPdfHandler,
} from "../controllers/intelligenceModules.controller";
import { requirePublicationAccess } from "../lib/publicationGate";

const router = express.Router();

router.get(
  "/api/intel/rollups",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  requireCityAccess,
  getDailyRollupsHandler as any
);

router.get(
  "/api/intel/snapshots",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  requireCityAccess,
  getWeeklySnapshotsHandler as any
);

router.get(
  "/api/intel/rankings/:entityType",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  requireCityAccess,
  getRankingsHandler as any
);

router.get(
  "/api/intel/tri-scores",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  requireCityAccess,
  getTriScoresHandler as any
);

router.get(
  "/api/intel/my-performance/:entityType",
  authMiddleware,
  getMyPerformanceHandler as any
);

router.get(
  "/api/intel/cost-leak-alerts",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  requireCityAccess,
  getCostLeakAlertsHandler as any
);

router.patch(
  "/api/intel/cost-leak-alerts/:id/acknowledge",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  acknowledgeCostLeakAlertHandler as any
);

router.patch(
  "/api/intel/cost-leak-alerts/:id/resolve",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  resolveCostLeakAlertHandler as any
);

router.get(
  "/api/intel/certifications",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "CLINIC_USER"),
  requireCityAccess,
  getCertificationsHandler as any
);

router.get(
  "/api/intel/indexes",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  getIndexesSummaryHandler as any
);

router.get(
  "/api/intel/indexes/export.pdf",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  getIndexesPdfHandler as any
);

router.get(
  "/api/intelligence/publications",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  listPublicationsHandler as any
);

router.post(
  "/api/intelligence/publications",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  createPublicationHandler as any
);

router.patch(
  "/api/intelligence/publications/:id",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  updatePublicationHandler as any
);

router.post(
  "/api/intelligence/publications/:id/publish",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  publishHandler as any
);

router.post(
  "/api/intelligence/publications/:id/unpublish",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  unpublishHandler as any
);

router.delete(
  "/api/intelligence/publications/:id",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  deletePublicationHandler as any
);

router.post(
  "/api/intelligence/publications/:id/targets",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  addTargetHandler as any
);

router.delete(
  "/api/intelligence/publications/:id/targets/:targetId",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  removeTargetHandler as any
);

router.get(
  "/api/intelligence/clinics-list",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  listClinicsForTargetHandler as any
);

router.get(
  "/api/intelligence/certification",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  getCertificationsModuleHandler as any
);

router.post(
  "/api/intelligence/certification/compute",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  computeAndSaveCertificationsHandler as any
);

router.get(
  "/api/intelligence/certification/export.pdf",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  getCertificationPdfHandler as any
);

router.get(
  "/api/intelligence/ranking",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  getRankingsModuleHandler as any
);

router.post(
  "/api/intelligence/ranking/compute",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  computeAndSaveRankingsHandler as any
);

router.get(
  "/api/intelligence/ranking/export.pdf",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  getRankingPdfHandler as any
);

router.get(
  "/api/intelligence/audit",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  getAuditShieldHandler as any
);

router.get(
  "/api/intelligence/audit/export.pdf",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  getAuditPdfHandler as any
);

router.get(
  "/api/intelligence/prediction",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  getPredictionsHandler as any
);

router.get(
  "/api/intelligence/prediction/export.pdf",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  getPredictionPdfHandler as any
);

router.post(
  "/api/intelligence/quarterly/generate",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  generateQuarterlyReportHandler as any
);

router.get(
  "/api/intelligence/quarterly/export.pdf",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  getQuarterlyReportPdfHandler as any
);

router.get(
  "/api/clinic/certification/:quarter_key",
  authMiddleware,
  requirePublicationAccess("certification"),
  clinicCertificationHandler as any
);

router.get(
  "/api/clinic/certification/:quarter_key/pdf",
  authMiddleware,
  requirePublicationAccess("certification"),
  clinicCertificationPdfHandler as any
);

router.get(
  "/api/clinic/ranking",
  authMiddleware,
  requirePublicationAccess("ranking"),
  clinicRankingHandler as any
);

router.get(
  "/api/clinic/ranking/:quarter_key/pdf",
  authMiddleware,
  requirePublicationAccess("ranking"),
  clinicRankingPdfHandler as any
);

router.get(
  "/api/clinic/audit",
  authMiddleware,
  requirePublicationAccess("audit"),
  clinicAuditHandler as any
);

router.get(
  "/api/clinic/audit/:quarter_key/pdf",
  authMiddleware,
  requirePublicationAccess("audit"),
  clinicAuditPdfHandler as any
);

router.get(
  "/api/clinic/quarterly/:quarter_key/pdf",
  authMiddleware,
  requirePublicationAccess("certification"),
  clinicQuarterlyReportPdfHandler as any
);

export function registerIntelligenceRoutes(app: Express) {
  app.use(router);
}
