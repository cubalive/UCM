import { Router, type Express, type Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import {
  runReconciliation,
  getReconciliationRuns,
  getReconciliationRunDetails,
  getAgingReport,
  writeOffItem,
  getReconciliationDashboard,
  getClinicReconciliation,
} from "../lib/paymentReconciliationEngine";

const router = Router();

// Helper: resolve companyId from user context or query param (SUPER_ADMIN can pass companyId)
function resolveCompanyId(req: AuthRequest): number | null {
  if (req.user?.companyId) return req.user.companyId;
  if (req.user?.role === "SUPER_ADMIN") {
    const qId = parseInt(req.query.companyId as string || req.body?.companyId);
    if (qId && !isNaN(qId)) return qId;
  }
  return null;
}

// Run a new reconciliation
router.post("/api/reconciliation/run", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const companyId = resolveCompanyId(req);
    if (!companyId) return res.status(400).json({ message: "companyId is required" });

    const { periodStart, periodEnd } = req.body;
    if (!periodStart || !periodEnd) {
      return res.status(400).json({ message: "periodStart and periodEnd are required" });
    }

    const result = await runReconciliation(companyId, periodStart, periodEnd, req.user?.userId);
    res.json(result);
  } catch (err: any) {
    console.error("[RECONCILIATION] Run error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// List reconciliation runs
router.get("/api/reconciliation/runs", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = resolveCompanyId(req);
    if (!companyId) return res.json([]);

    const limit = parseInt(String(req.query.limit || "20"));
    const runs = await getReconciliationRuns(companyId, limit);
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Get run details with all items
router.get("/api/reconciliation/runs/:runId", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const runId = parseInt(String(req.params.runId));
    const details = await getReconciliationRunDetails(runId);
    if (!details) return res.status(404).json({ message: "Run not found" });
    res.json(details);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Get aging report
router.get("/api/reconciliation/aging", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = resolveCompanyId(req);
    if (!companyId) return res.json({ message: "Select a company to view aging report" });

    const report = await getAgingReport(companyId);
    res.json(report || { message: "No reconciliation runs found. Run a reconciliation first." });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Dashboard with summary stats
router.get("/api/reconciliation/dashboard", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = resolveCompanyId(req);
    if (!companyId) return res.json({ totalRuns: 0, totalItems: 0, message: "Select a company" });

    const dashboard = await getReconciliationDashboard(companyId);
    res.json(dashboard);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Clinic-specific reconciliation
router.get("/api/reconciliation/clinic/:clinicId", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = resolveCompanyId(req);
    if (!companyId) return res.status(400).json({ message: "companyId is required" });

    const clinicId = parseInt(String(req.params.clinicId));
    const result = await getClinicReconciliation(companyId, clinicId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Write off an outstanding amount
router.post("/api/reconciliation/items/:itemId/write-off", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const itemId = parseInt(String(req.params.itemId));
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ message: "reason is required" });

    const result = await writeOffItem(itemId, reason, req.user!.userId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// Mark item as disputed
router.post("/api/reconciliation/items/:itemId/dispute", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const itemId = parseInt(String(req.params.itemId));
    const { notes } = req.body;

    const { db: dbInstance } = await import("../db");
    const { paymentReconciliationItems } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    await dbInstance.update(paymentReconciliationItems)
      .set({
        status: "disputed",
        notes: notes || "Disputed by user",
      })
      .where(eq(paymentReconciliationItems.id, itemId));

    res.json({ message: "Item marked as disputed" });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Resolve a disputed item
router.post("/api/reconciliation/items/:itemId/resolve", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const itemId = parseInt(String(req.params.itemId));
    const { notes, newStatus } = req.body;

    const { db: dbInstance } = await import("../db");
    const { paymentReconciliationItems } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const validStatuses = ["matched", "partial", "unmatched", "written_off"];
    if (!validStatuses.includes(newStatus)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }

    await dbInstance.update(paymentReconciliationItems)
      .set({
        status: newStatus,
        notes: notes || undefined,
        resolvedBy: req.user!.userId,
        resolvedAt: new Date(),
      })
      .where(eq(paymentReconciliationItems.id, itemId));

    res.json({ message: "Item resolved" });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export function registerReconciliationRoutes(app: Express) {
  app.use(router);
}
