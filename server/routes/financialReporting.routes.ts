import { Router, type Express } from "express";
import { authMiddleware, requirePermission } from "../auth";
import { requireTenantScope } from "../middleware";
import {
  revenueReportHandler,
  arAgingReportHandler,
  clinicBillingSummaryHandler,
  usageReportHandler,
} from "../controllers/financialReporting.controller";

const router = Router();

// Revenue P&L dashboard
router.get(
  "/api/finance/reporting/revenue",
  authMiddleware,
  requirePermission("billing", "read"),
  requireTenantScope,
  revenueReportHandler as any
);

// AR aging buckets
router.get(
  "/api/finance/reporting/ar-aging",
  authMiddleware,
  requirePermission("billing", "read"),
  requireTenantScope,
  arAgingReportHandler as any
);

// Per-clinic billing summary
router.get(
  "/api/finance/reporting/clinic-summary",
  authMiddleware,
  requirePermission("billing", "read"),
  requireTenantScope,
  clinicBillingSummaryHandler as any
);

// Subscription usage & tier
router.get(
  "/api/finance/reporting/usage",
  authMiddleware,
  requirePermission("billing", "read"),
  requireTenantScope,
  usageReportHandler as any
);

export function registerFinancialReportingRoutes(app: Express) {
  app.use(router);
}
