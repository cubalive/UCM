import { Router, type Express, type Response } from "express";
import { authMiddleware, requirePermission, type AuthRequest } from "../auth";
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

router.post("/api/admin/finance/dunning/run", authMiddleware, requirePermission("billing", "write"), async (req: AuthRequest, res: Response) => {
  try {
    const { runDunningCycle } = await import("../services/dunningService");
    const result = await runDunningCycle();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/api/admin/finance/reconcile/:companyId", authMiddleware, requirePermission("billing", "write"), async (req: AuthRequest, res: Response) => {
  try {
    const companyId = parseInt(String(req.params.companyId));
    const { reconcileCompanyPayouts } = await import("../services/payoutReconciliationService");
    const result = await reconcileCompanyPayouts(companyId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Manual trigger for auto-invoice generation
router.post("/api/admin/finance/auto-invoice/run", authMiddleware, requirePermission("billing", "write"), async (req: AuthRequest, res: Response) => {
  try {
    const { runAutoInvoiceGeneration } = await import("../services/autoInvoiceScheduler");
    const result = await runAutoInvoiceGeneration();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Manual trigger for dunning email cycle
router.post("/api/admin/finance/dunning-email/run", authMiddleware, requirePermission("billing", "write"), async (req: AuthRequest, res: Response) => {
  try {
    const { runDunningEmailCycle } = await import("../services/dunningEmailService");
    const result = await runDunningEmailCycle();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Manual trigger for reconciliation
router.post("/api/admin/finance/reconciliation/run", authMiddleware, requirePermission("billing", "write"), async (req: AuthRequest, res: Response) => {
  try {
    const { runAutoReconciliation } = await import("../services/autoReconciliationScheduler");
    const result = await runAutoReconciliation();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Subscription tier usage check
router.get("/api/admin/finance/tier-usage/:companyId", authMiddleware, requirePermission("billing", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const companyId = parseInt(String(req.params.companyId));
    const { getCompanyUsage } = await import("../services/subscriptionTiers");
    const usage = await getCompanyUsage(companyId);
    res.json(usage);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export function registerEnterpriseFinanceRoutes(app: Express) {
  app.use(router);
}

import { createHarnessedTask, registerInterval, type HarnessedTask } from "../lib/schedulerHarness";

const DUNNING_INTERVAL_MS = 6 * 60 * 60 * 1000;

let dunningTask: HarnessedTask | null = null;

export function startDunningScheduler() {
  if (dunningTask) return;

  dunningTask = createHarnessedTask({
    name: "dunning",
    lockKey: "scheduler:lock:dunning",
    lockTtlSeconds: 30,
    timeoutMs: 120_000,
    fn: async () => {
      const { runDunningCycle } = await import("../services/dunningService");
      await runDunningCycle();
    },
  });

  registerInterval("dunning", DUNNING_INTERVAL_MS, dunningTask);
  console.info(JSON.stringify({ event: "dunning_scheduler_started", intervalMs: DUNNING_INTERVAL_MS }));
}

export function stopDunningScheduler() {
  if (dunningTask) {
    dunningTask.stop();
    dunningTask = null;
    console.info(JSON.stringify({ event: "dunning_scheduler_stopped" }));
  }
}
