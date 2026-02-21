import { Router, type Express, type Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { requireTenantScope } from "../middleware";
import {
  createAdjustmentHandler,
  listAdjustmentsHandler,
  getLedgerHandler,
  getLedgerSummaryHandler,
  getPayoutReconciliationHandler,
  getAuditLogHandler,
  getFinanceDashboardHandler,
  clinicPaymentMethodsHandler,
  clinicSetupIntentHandler,
  clinicSetDefaultPMHandler,
  clinicDetachPMHandler,
} from "../controllers/enterpriseFinance.controller";

const router = Router();

router.post("/api/finance/invoices/:invoiceId/adjustments", authMiddleware, createAdjustmentHandler as any);
router.get("/api/finance/invoices/:invoiceId/adjustments", authMiddleware, listAdjustmentsHandler as any);

router.get("/api/finance/ledger", authMiddleware, getLedgerHandler as any);
router.get("/api/finance/ledger/summary", authMiddleware, getLedgerSummaryHandler as any);

router.get("/api/finance/payouts", authMiddleware, getPayoutReconciliationHandler as any);

router.get("/api/finance/audit", authMiddleware, getAuditLogHandler as any);

router.get("/api/finance/dashboard", authMiddleware, getFinanceDashboardHandler as any);

router.get("/api/clinic/payment-methods", authMiddleware, clinicPaymentMethodsHandler as any);
router.post("/api/clinic/payment-methods/setup-intent", authMiddleware, clinicSetupIntentHandler as any);
router.post("/api/clinic/payment-methods/default", authMiddleware, clinicSetDefaultPMHandler as any);
router.delete("/api/clinic/payment-methods/:pmId", authMiddleware, clinicDetachPMHandler as any);

router.post("/api/admin/finance/dunning/run", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const { runDunningCycle } = await import("../services/dunningService");
    const result = await runDunningCycle();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/api/admin/finance/reconcile/:companyId", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const companyId = parseInt(req.params.companyId);
    const { reconcileCompanyPayouts } = await import("../services/payoutReconciliationService");
    const result = await reconcileCompanyPayouts(companyId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export function registerEnterpriseFinanceRoutes(app: Express) {
  app.use(router);
}

const DUNNING_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startDunningScheduler() {
  console.log("[DUNNING] Scheduler started (interval: 6h)");
  setInterval(async () => {
    try {
      const { runDunningCycle } = await import("../services/dunningService");
      await runDunningCycle();
    } catch (err: any) {
      console.error("[DUNNING] Scheduler error:", err.message);
    }
  }, DUNNING_INTERVAL_MS);
}
