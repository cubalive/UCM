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
} from "../controllers/intelligence.controller";

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

export function registerIntelligenceRoutes(app: Express) {
  app.use(router);
}
